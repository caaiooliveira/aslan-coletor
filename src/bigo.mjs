
import { parseBigo } from './parse.mjs'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/**
 * Gera a URL do perfil da Bigo.
 * Aceita letras, números, pontos e underline.
 */
export function urlFor(template, id) {
  const normalizedId = String(id ?? '').trim()

  if (!/^[A-Za-z0-9_.]{1,50}$/.test(normalizedId)) {
    throw new Error(
      `id inválido: "${normalizedId}" (original: "${id}")`
    )
  }

  if (!template || !template.includes('{id}')) {
    throw new Error('BIGO_URL_TEMPLATE inválido ou sem {id}')
  }

  return template.replace(
    '{id}',
    encodeURIComponent(normalizedId)
  )
}

/**
 * Consulta rápida via HTTP.
 */
export async function fetchFast(url, timeoutMs = 8000) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: ctl.signal,
      redirect: 'follow',
    })

    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}`,
      }
    }

    const p = parseBigo(await res.text())

    return p.beans != null
      ? {
          ok: true,
          beans: p.beans,
          viewNums: p.viewNums,
          roomStatus: p.roomStatus,
        }
      : {
          ok: false,
          error: p.beansReason,
        }
  } catch (e) {
    return {
      ok: false,
      error:
        e?.name === 'AbortError'
          ? 'timeout'
          : String(e?.message ?? e).slice(0, 120),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Abre um navegador reutilizável.
 * Bloqueia imagens, fontes, mídia e CSS para economizar recursos.
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

  await context.route('**/*', (route) => {
    const type = route.request().resourceType()

    if (
      ['image', 'font', 'media', 'stylesheet'].includes(type)
    ) {
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
 * Consulta usando a página renderizada pelo navegador.
 */
export async function fetchRendered(ctx, url, timeoutMs = 15000) {
  const page = await ctx.context.newPage()

  try {
    const resp = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    })

    if (resp && resp.status() >= 400) {
      return {
        ok: false,
        error: `HTTP ${resp.status()}`,
        final: true,
      }
    }

    await page.waitForSelector('.info-bean', {
      timeout: timeoutMs,
    })

    // Aguarda o valor deixar de ser um possível placeholder.
    await page
      .waitForFunction(
        () =>
          /\d/.test(
            document.querySelector('.info-bean')?.textContent ?? ''
          ),
        null,
        { timeout: 4000 }
      )
      .catch(() => {})

    const p = parseBigo(await page.content())

    return p.beans != null
      ? {
          ok: true,
          beans: p.beans,
          viewNums: p.viewNums,
          roomStatus: p.roomStatus,
        }
      : {
          ok: false,
          error: p.beansReason,
        }
  } catch (e) {
    return {
      ok: false,
      error: /Timeout/i.test(String(e?.message))
        ? 'timeout (info-bean não apareceu)'
        : String(e?.message ?? e)
            .split('\n')[0]
            .slice(0, 120),
    }
  } finally {
    await page.close().catch(() => {})
  }
}
