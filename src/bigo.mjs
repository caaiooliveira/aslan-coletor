
import { parseBigo } from './parse.mjs'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/**
 * Valida o ID Bigo e monta a URL do perfil.
 *
 * Aceita:
 * - Números
 * - Letras maiúsculas e minúsculas
 * - Underscore (_)
 * - Ponto (.)
 *
 * Limite: 1 a 50 caracteres.
 */
export function urlFor(template, id) {
  const normalizedId = String(id ?? '').trim()

  if (!/^[A-Za-z0-9_.-]{1,50}$/.test(normalizedId)) {
    throw new Error(
      `ID Bigo inválido: "${normalizedId}" (valor original: "${id}")`
    )
  }

  if (!template || !template.includes('{id}')) {
    throw new Error(
      'BIGO_URL_TEMPLATE inválido ou sem o marcador {id}'
    )
  }

  return template.replace(
    '{id}',
    encodeURIComponent(normalizedId)
  )
}

/**
 * Consulta rápida: tenta obter os dados diretamente do HTML.
 */
export async function fetchFast(url, timeoutMs = 8000) {
  const controller = new AbortController()

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  )

  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': UA,
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
      }
    }

    const html = await response.text()
    const parsed = parseBigo(html)

    if (parsed.beans == null) {
      return {
        ok: false,
        error: parsed.beansReason || 'Saldo não encontrado no HTML',
      }
    }

    if (process.env.LIVE_DEBUG === '1' && !looksLive(parsed)) {
      // Diagnóstico: mostra o trecho da página onde ficam saldo, status e espectadores.
      const html = await page.content()
      const i = html.indexOf('host-info')
      console.log(
        `[debug] ${url} sem sinal de ao vivo; trecho:`,
        html.slice(Math.max(0, i - 40), i + 700).replace(/\s+/g, ' ')
      )
    }

    return {
      ok: true,
      beans: parsed.beans,
      viewNums: parsed.viewNums,
      roomStatus: parsed.roomStatus,
      playerLive,
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error?.name === 'AbortError'
          ? 'timeout'
          : String(error?.message ?? error).slice(0, 120),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Abre o navegador Playwright para consultas que
 * não funcionaram pelo método rápido.
 */
export async function openBrowser() {
  const { chromium } = await import('playwright')

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--proxy-bypass-list=<-loopback>',
    ],
  })

  const context = await browser.newContext({
    userAgent: UA,
    locale: 'pt-BR',
    viewport: {
      width: 1000,
      height: 800,
    },
  })

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  // Bloqueia recursos que não são necessários para a leitura.
  await context.route('**/*', (route) => {
    const resourceType = route.request().resourceType()

    // Por padrão só imagens e fontes são bloqueadas. Vídeo e estilos carregam normalmente,
    // porque a Bigo pode só contar espectadores depois de a sala "tocar".
    // BLOCK_HEAVY=1 volta a bloquear tudo (mais leve, porém pode não achar os espectadores).
    const blocked = process.env.BLOCK_HEAVY === '1'
      ? ['image', 'font', 'media', 'stylesheet']
      : ['image', 'font']

    if (blocked.includes(resourceType)) {
      return route.abort()
    }

    return route.continue()
  })

  return {
    browser,
    context,

    close: () =>
      Promise.race([
        browser.close(),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]).catch(() => {}),
  }
}

/**
 * Consulta com navegador: utilizada quando a consulta rápida
 * não consegue obter os dados.
 */
export async function fetchRendered(
  browserRef,
  url,
  timeoutMs = 15000
) {
  const page = await browserRef.context.newPage()

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    })

    if (response && response.status() >= 400) {
      return {
        ok: false,
        error: `HTTP ${response.status()}`,
        final: true,
      }
    }

    await page.waitForSelector('.info-bean', {
      timeout: timeoutMs,
    })

    await page.waitForFunction(
      () =>
        /\d/.test(
          document.querySelector('.info-bean')?.textContent ?? ''
        ),
      null,
      {
        timeout: 4000,
      }
    ).catch(() => {})

    let parsed = parseBigo(await page.content())

    if (parsed.beans == null) {
      return {
        ok: false,
        error: parsed.beansReason || 'Saldo não encontrado na página',
      }
    }

    // O saldo aparece antes do status da sala e da audiência (a Bigo preenche depois).
    // Espera até LIVE_SETTLE_MS por um sinal de "ao vivo"; quem está offline espera o tempo todo e segue.
    const settleMs = Number(process.env.LIVE_SETTLE_MS ?? 10000)
    const until = Date.now() + (Number.isFinite(settleMs) ? settleMs : 10000)
    // Player ativo: o <video> do player recebe um "blob:" (stream) só quando a live está no ar.
    // Também vale a marca d'água "water-marker-visable" sobre o vídeo. Fora do ar a página mostra
    // "O host está chegando..." e não tem nada disso.
    const hasPlayer = () =>
      page
        .evaluate(() => {
          const v = document.querySelector('video[src^="blob:"]')
          return (
            Boolean(v) ||
            Boolean(document.querySelector('.video-js.vjs-has-started.vjs-live')) ||
            Boolean(document.querySelector('.water-marker.water-marker-visable'))
          )
        })
        .catch(() => false)

    let playerLive = await hasPlayer()
    const looksLive = (r) => playerLive || (r.roomStatus ?? 0) > 0 || (r.viewNums ?? 0) > 0

    while (!looksLive(parsed) && Date.now() < until) {
      await page.waitForTimeout(500)
      const next = parseBigo(await page.content())

      if (next.beans != null) parsed = next
      playerLive = await hasPlayer()
    }

    return {
      ok: true,
      beans: parsed.beans,
      viewNums: parsed.viewNums,
      roomStatus: parsed.roomStatus,
      playerLive,
    }
  } catch (error) {
    return {
      ok: false,
      error: /Timeout/i.test(String(error?.message))
        ? 'timeout (info-bean não apareceu)'
        : String(error?.message ?? error)
            .split('\n')[0]
            .slice(0, 120),
    }
  } finally {
    await page.close().catch(() => {})
  }
}
