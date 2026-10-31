
// Coletor ASLAN
//
// --once: consulta todas as integrantes cadastradas uma vez.
// --pending: atende solicitações de atualização pendentes.
// --loop: modo contínuo para servidor próprio.
// --probe <id>: testa a leitura de uma integrante.

import { pathToFileURL } from 'node:url'

import { makeApi } from './supabase.mjs'

import {
  fetchFast,
  fetchRendered,
  openBrowser,
  urlFor,
} from './bigo.mjs'

// --------------------------------------------------
// CONFIGURAÇÕES
// --------------------------------------------------

const env = (key, fallback) =>
  process.env[key] ?? fallback

const SUPABASE_URL = env(
  'SUPABASE_URL',
  ''
).replace(/\/$/, '')

const KEY = env(
  'SUPABASE_SERVICE_ROLE_KEY',
  ''
)

const TEMPLATE = env(
  'BIGO_URL_TEMPLATE',
  'https://www.bigo.tv/pt/{id}'
)

function positiveNumber(value, fallback, min, max) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return fallback

  return Math.min(Math.max(parsed, min), max)
}

const CONCURRENCY = positiveNumber(
  env('CONCURRENCY', '4'),
  4,
  1,
  10
)

const INTERVAL = positiveNumber(
  env('INTERVAL_SECONDS', '7200'),
  7200,
  60,
  86400
)

const MODE_FAST = env('FAST_PATH', '1') !== '0'

const LIVE_SIGNAL = env(
  'LIVE_SIGNAL',
  'room'
)

const log = (...args) => {
  console.log(new Date().toISOString(), ...args)
}

// --------------------------------------------------
// CONTROLE DE CONCORRÊNCIA
// --------------------------------------------------

export async function pool(items, limit, fn) {
  const results = new Array(items.length)
  let index = 0

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (true) {
          const current = index++

          if (current >= items.length) break

          results[current] = await fn(
            items[current],
            current
          )
        }
      }
    )
  )

  return results
}

// --------------------------------------------------
// DETECÇÃO DE STATUS AO VIVO
// --------------------------------------------------

export function liveSignal(result) {
  if (
    LIVE_SIGNAL === 'views' ||
    result.roomStatus == null
  ) {
    return result.viewNums
  }

  return result.roomStatus === 0
    ? 0
    : Math.max(result.viewNums ?? 0, 1)
}

// --------------------------------------------------
// GERENCIAMENTO DO NAVEGADOR
// --------------------------------------------------

async function getBrowser(browserRef) {
  if (!browserRef.b) {
    browserRef.promise ??= openBrowser()

    browserRef.b = await browserRef.promise
  }

  return browserRef.b
}

// --------------------------------------------------
// CONSULTA INDIVIDUAL
// --------------------------------------------------

async function readOne(target, browserRef) {
  try {
    const url = urlFor(
      TEMPLATE,
      target.bigo_id
    )

    let result = MODE_FAST
      ? await fetchFast(url)
      : {
          ok: false,
          error: 'Consulta rápida desativada',
        }

    const notFound = (response) =>
      /^HTTP (404|410)/.test(response.error ?? '')

    // Se a consulta rápida falhar, tenta pelo navegador.
    if (!result.ok && !notFound(result)) {
      const browser = await getBrowser(browserRef)

      result = await fetchRendered(
        browser,
        url
      )

      // Segunda tentativa em caso de timeout.
      if (
        !result.ok &&
        !result.final &&
        /timeout/i.test(result.error ?? '')
      ) {
        result = await fetchRendered(
          browser,
          url
        )
      }
    }

    if (result.ok) {
      return {
        member_id: target.member_id,
        ok: true,
        beans: result.beans,
        view_nums: liveSignal(result),
      }
    }

    return {
      member_id: target.member_id,
      ok: false,
      error: result.error ?? 'Falha desconhecida na consulta',
    }

  } catch (error) {
    // Uma integrante com problema não interrompe a coleta inteira.
    return {
      member_id: target.member_id,
      ok: false,
      error: String(error?.message ?? error).slice(0, 200),
    }
  }
}

// --------------------------------------------------
// CONSULTA GERAL
// --------------------------------------------------

export async function runOnce(api) {
  const startedAt = Date.now()

  const targets = await api.targets()

  if (!Array.isArray(targets) || targets.length === 0) {
    log('Nenhuma integrante com ID Bigo válido encontrada.')
    return
  }

  log(`Iniciando consulta geral: ${targets.length} integrantes.`)

  const browserRef = {
    b: null,
    promise: null,
  }

  try {
    const reads = await pool(
      targets,
      CONCURRENCY,
      (target) => readOne(target, browserRef)
    )

    const result = await api.ingest(reads)

    const successful = reads.filter(
      (item) => item.ok
    ).length

    const failed = reads.length - successful

    log(
      `Consulta geral finalizada: ${successful} sucesso(s), ${failed} falha(s), em ${(
        (Date.now() - startedAt) / 1000
      ).toFixed(1)}s.`
    )

    log('Resultado Supabase:', JSON.stringify(result))

    for (const item of reads.filter((r) => !r.ok)) {
      log(
        `Falha na integrante ${item.member_id}: ${item.error}`
      )
    }

  } finally {
    await browserRef.b?.close()
  }
}

// --------------------------------------------------
// CONSULTAS SOB DEMANDA
// --------------------------------------------------

export async function runPending(api) {
  const targets = await api.pending()

  if (!Array.isArray(targets) || targets.length === 0) {
    log('Nenhuma solicitação pendente.')
    return 0
  }

  const startedAt = Date.now()

  log(
    `Iniciando consultas sob demanda: ${targets.length} solicitação(ões).`
  )

  const browserRef = {
    b: null,
    promise: null,
  }

  try {
    const reads = await pool(
      targets,
      CONCURRENCY,
      (target) => readOne(target, browserRef)
    )

    const result = await api.ingest(reads)

    // Somente consultas bem-sucedidas são finalizadas.
    const successfulIds = reads
      .filter((item) => item.ok)
      .map((item) => item.member_id)

    if (successfulIds.length > 0) {
      await api.refreshDone(successfulIds)
    }

    const successful = successfulIds.length
    const failed = reads.length - successful

    log(
      `Consultas sob demanda finalizadas: ${successful} sucesso(s), ${failed} falha(s), em ${(
        (Date.now() - startedAt) / 1000
      ).toFixed(1)}s.`
    )

    log('Resultado Supabase:', JSON.stringify(result))

    for (const item of reads.filter((r) => !r.ok)) {
      log(
        `Falha na integrante ${item.member_id}: ${item.error}`
      )
    }

  } finally {
    await browserRef.b?.close()
  }

  return targets.length
}

// --------------------------------------------------
// TESTE INDIVIDUAL
// --------------------------------------------------

async function probe(id) {
  if (!id) {
    throw new Error('Informe um ID Bigo.')
  }

  const url = urlFor(TEMPLATE, id)

  log('Testando ID:', id)
  log('URL:', url)

  const startedAt = Date.now()

  const fast = await fetchFast(url)

  log(
    `[HTTP simples] ${Date.now() - startedAt}ms`,
    JSON.stringify(fast)
  )

  const browser = await openBrowser()

  try {
    const jsonResponses = []

    browser.context.on('response', async (response) => {
      try {
        const contentType =
          response.headers()['content-type'] ?? ''

        if (!contentType.includes('json')) return

        const body = await response.text()

        if (/bean|diamond|view/i.test(body)) {
          jsonResponses.push(
            `${response.request().method()} ${response.url()}`
          )
        }
      } catch {
        // Ignora falhas na leitura de respostas.
      }
    })

    const browserStartedAt = Date.now()

    const result = await fetchRendered(
      browser,
      url
    )

    log(
      `[Navegador] ${Date.now() - browserStartedAt}ms`,
      JSON.stringify(result)
    )

    if (result.ok) {
      log(
        'Integrante ao vivo?',
        liveSignal(result) > 0 ? 'SIM' : 'NÃO'
      )
    }

    if (jsonResponses.length) {
      log(
        'Respostas JSON candidatas:\n  ' +
        jsonResponses.join('\n  ')
      )
    }

    if (!fast.ok && !result.ok) {
      log('Não foi possível obter os dados da Bigo.')
      process.exitCode = 2
    }

  } finally {
    await browser.close()
  }
}

// --------------------------------------------------
// INICIALIZAÇÃO
// --------------------------------------------------

async function main() {
  const mode = process.argv[2] ?? '--once'

  if (mode === '--probe') {
    return probe(process.argv[3] ?? '')
  }

  if (!SUPABASE_URL || !KEY) {
    throw new Error(
      'Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.'
    )
  }

  const api = makeApi(
    SUPABASE_URL,
    KEY
  )

  if (mode === '--once') {
    await runOnce(api)
    return
  }

  if (mode === '--pending') {
    await runPending(api)
    return
  }

  if (mode === '--loop') {
    let running = false
    let watching = false

    const tick = async () => {
      if (running) {
        log('Consulta geral anterior ainda em andamento.')
        return
      }

      running = true

      try {
        await runOnce(api)
      } catch (error) {
        log('Erro na consulta geral:', error.message)
      } finally {
        running = false
      }
    }

    setInterval(async () => {
      if (watching) return

      watching = true

      try {
        await runPending(api)
      } catch (error) {
        log('Erro nas solicitações:', error.message)
      } finally {
        watching = false
      }
    }, 10000)

    await tick()

    while (true) {
      await new Promise((resolve) => {
        setTimeout(resolve, INTERVAL * 1000)
      })

      await tick()
    }
  }

  throw new Error(`Modo desconhecido: ${mode}`)
}

// --------------------------------------------------
// EXECUÇÃO DIRETA
// --------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error('ERRO FATAL:', error)
    process.exit(1)
  })
}
