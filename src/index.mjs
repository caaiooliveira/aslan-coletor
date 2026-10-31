
#!/usr/bin/env node

// Coletor ASLAN
// --once: consulta todas as integrantes uma única vez.
// --pending: atende somente solicitações pendentes.
// --loop: modo contínuo para servidor próprio.
// --probe <id>: testa a leitura de uma integrante.

import { pathToFileURL } from 'node:url'
import { makeApi } from './supabase.mjs'
import {
  fetchFast,
  fetchRendered,
  openBrowser,
  urlFor
} from './bigo.mjs'

const env = (k, d) => process.env[k] ?? d

const SUPABASE_URL = env('SUPABASE_URL', '').replace(/\/$/, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY', '')

const TEMPLATE = env(
  'BIGO_URL_TEMPLATE',
  'https://www.bigo.tv/pt/{id}'
)

const CONCURRENCY = Math.min(
  Math.max(Number(env('CONCURRENCY', '4')), 1),
  10
)

const INTERVAL = Math.max(
  Number(env('INTERVAL_SECONDS', '7200')),
  60
)

const MODE_FAST = env('FAST_PATH', '1') !== '0'
const LIVE_SIGNAL = env('LIVE_SIGNAL', 'room')

const log = (...a) =>
  console.log(new Date().toISOString(), ...a)

/**
 * Executa tarefas respeitando o limite de concorrência.
 */
export async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0

  await Promise.all(
    Array.from(
      { length: Math.min(n, items.length) },
      async () => {
        while (i < items.length) {
          const k = i++
          out[k] = await fn(items[k], k)
        }
      }
    )
  )

  return out
}

/**
 * Determina se a integrante está ao vivo.
 */
export function liveSignal(r) {
  if (LIVE_SIGNAL === 'views' || r.roomStatus == null) {
    return r.viewNums
  }

  return r.roomStatus === 0
    ? 0
    : Math.max(r.viewNums ?? 0, 1)
}

/**
 * Consulta uma integrante na Bigo.
 */
async function readOne(target, browserRef) {
  const url = urlFor(TEMPLATE, target.bigo_id)

  let r = MODE_FAST
    ? await fetchFast(url)
    : { ok: false }

  const gone = (x) =>
    /^HTTP (404|410)/.test(x.error ?? '')

  if (!r.ok && !gone(r)) {
    browserRef.b ??= await openBrowser()

    r = await fetchRendered(browserRef.b, url)

    if (
      !r.ok &&
      !r.final &&
      /timeout/.test(r.error ?? '')
    ) {
      r = await fetchRendered(browserRef.b, url)
    }
  }

  return r.ok
    ? {
        member_id: target.member_id,
        ok: true,
        beans: r.beans,
        view_nums: liveSignal(r)
      }
    : {
        member_id: target.member_id,
        ok: false,
        error: r.error
      }
}

/**
 * Consulta todas as integrantes ativas.
 * Utilizada na rotina automática de 2 horas.
 */
export async function runOnce(api) {
  const t0 = Date.now()

  const targets = await api.targets()

  if (!targets.length) {
    log('nenhum integrante ativo com ID numérico')
    return
  }

  const browserRef = { b: null }

  try {
    const reads = await pool(
      targets,
      CONCURRENCY,
      (t) => readOne(t, browserRef)
    )

    const res = await api.ingest(reads)

    log(
      `lidos ${reads.length} em ${
        ((Date.now() - t0) / 1000).toFixed(1)
      }s →`,
      JSON.stringify(res)
    )

  } finally {
    await browserRef.b?.close()
  }
}

/**
 * Consulta exclusivamente quem solicitou atualização.
 */
export async function runPending(api) {
  const targets = await api.pending()

  if (!targets.length) {
    log('nenhuma solicitação pendente')
    return 0
  }

  const t0 = Date.now()
  const browserRef = { b: null }

  try {
    const reads = await pool(
      targets,
      CONCURRENCY,
      (t) => readOne(t, browserRef)
    )

    await api.ingest(reads)

    await api.refreshDone(
      targets.map((t) => t.member_id)
    )

    log(
      `consulta imediata: ${
        reads.filter((r) => r.ok).length
      }/${reads.length} ok em ${
        ((Date.now() - t0) / 1000).toFixed(1)
      }s`
    )

  } finally {
    await browserRef.b?.close()
  }

  return targets.length
}

/**
 * Diagnóstico de leitura de uma integrante.
 */
async function probe(id) {
  if (!id) {
    throw new Error('Informe um ID Bigo.')
  }

  const url = urlFor(TEMPLATE, id)

  log('URL:', url)

  const t0 = Date.now()
  const fast = await fetchFast(url)

  log(
    `[HTTP simples] ${Date.now() - t0}ms`,
    JSON.stringify(fast)
  )

  const b = await openBrowser()
  const jsons = []

  b.context.on('response', async (res) => {
    try {
      if (
        !(res.headers()['content-type'] ?? '')
          .includes('json')
      ) return

      const txt = await res.text()

      if (/bean|diamond|view/i.test(txt)) {
        jsons.push(
          `${res.request().method()} ${res.url()}`
        )
      }
    } catch {
      // Ignora erros de leitura de respostas.
    }
  })

  const t1 = Date.now()
  const r = await fetchRendered(b, url)

  log(
    `[navegador] ${Date.now() - t1}ms`,
    JSON.stringify(r),
    '→ ao vivo?',
    liveSignal(r) > 0 ? 'SIM' : 'não'
  )

  if (jsons.length) {
    log(
      'Respostas JSON candidatas:\n  ' +
      jsons.join('\n  ')
    )
  }

  await b.close()

  if (!fast.ok && !r.ok) {
    log('Não foi possível ler a página da Bigo.')
    process.exitCode = 2
  }
}

/**
 * Inicialização.
 */
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

  const api = makeApi(SUPABASE_URL, KEY)

  // Consulta geral: uma execução e encerramento.
  if (mode === '--once') {
    await runOnce(api)
    return
  }

  // Consulta manual: somente solicitações pendentes.
  if (mode === '--pending') {
    await runPending(api)
    return
  }

  // Modo contínuo: reservado para servidor permanente.
  if (mode === '--loop') {
    let running = false
    let watching = false

    const tick = async () => {
      if (running) {
        log('rodada anterior em andamento; ignorando')
        return
      }

      running = true

      try {
        await runOnce(api)
      } catch (e) {
        log('erro na rodada:', e.message)
      } finally {
        running = false
      }
    }

    setInterval(async () => {
      if (watching) return

      watching = true

      try {
        await runPending(api)
      } catch (e) {
        log('erro nos pedidos imediatos:', e.message)
      } finally {
        watching = false
      }
    }, 10000)

    await tick()

    for (;;) {
      await new Promise((resolve) =>
        setTimeout(resolve, INTERVAL * 1000)
      )

      await tick()
    }
  }

  throw new Error(`Modo desconhecido: ${mode}`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
