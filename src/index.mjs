#!/usr/bin/env node
// Coletor ASLAN: a cada 5 minutos (alinhado ao relógio: :00, :05, :10…) lê beans e "ao vivo" de cada integrante.
// Uso:  node src/index.mjs --loop | --once | --window <segundos> | --probe <idBigo>
//   --window: para rodar em agendador (GitHub Actions). Lê todo mundo uma vez e, até acabar o tempo, atende o botão "Consultar agora".
import { pathToFileURL } from 'node:url'
import { makeApi } from './supabase.mjs'
import { fetchFast, fetchRendered, openBrowser, urlFor } from './bigo.mjs'

const env = (k, d) => process.env[k] ?? d
const SUPABASE_URL = env('SUPABASE_URL', '').replace(/\/$/, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY', '')
const TEMPLATE = env('BIGO_URL_TEMPLATE', 'https://www.bigo.tv/pt/{id}')
const CONCURRENCY = Math.min(Math.max(Number(env('CONCURRENCY', '4')), 1), 10)
const INTERVAL = Math.max(Number(env('INTERVAL_SECONDS', '300')), 60)
const MODE_FAST = env('FAST_PATH', '1') !== '0'
const REFRESH_POLL = Math.max(Number(env('REFRESH_POLL_SECONDS', '5')), 2)   // quão rápido o botão "Consultar agora" é atendido
const LIVE_SIGNAL = env('LIVE_SIGNAL', 'room')   // 'room' (padrão: data-room-status) ou 'views' (número de espectadores)
const log = (...a) => console.log(new Date().toISOString(), ...a)

/** Processa a lista com no máximo N tarefas ao mesmo tempo. */
export async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) }
  }))
  return out
}

/** Número que o banco usa para decidir "ao vivo" (0 = fora do ar). Prefere o status da sala da Bigo, porque as visualizações têm robôs. */
export function liveSignal(r) {
  if (LIVE_SIGNAL === 'views' || r.roomStatus == null) return r.viewNums
  return r.roomStatus === 0 ? 0 : Math.max(r.viewNums ?? 0, 1)
}

async function readOne(target, browserRef) {
  const url = urlFor(TEMPLATE, target.bigo_id)
  let r = MODE_FAST ? await fetchFast(url) : { ok: false }
  const gone = (x) => /^HTTP (404|410)/.test(x.error ?? '')   // ID inexistente: não adianta abrir navegador
  if (!r.ok && !gone(r)) {
    browserRef.b ??= await openBrowser()
    r = await fetchRendered(browserRef.b, url)
    if (!r.ok && !r.final && /timeout/.test(r.error ?? '')) r = await fetchRendered(browserRef.b, url) // 1 nova tentativa
  }
  return r.ok
    ? { member_id: target.member_id, ok: true, beans: r.beans, view_nums: liveSignal(r) }
    : { member_id: target.member_id, ok: false, error: r.error }
}

export async function runOnce(api) {
  const t0 = Date.now()
  const targets = await api.targets()
  if (!targets.length) { log('nenhum integrante ativo com ID numérico'); return }
  const browserRef = { b: null }
  try {
    const reads = await pool(targets, CONCURRENCY, (t) => readOne(t, browserRef))
    const res = await api.ingest(reads)   // UMA chamada grava o lote inteiro
    log(`lidos ${reads.length} em ${((Date.now() - t0) / 1000).toFixed(1)}s →`, JSON.stringify(res))
  } finally { await browserRef.b?.close() }
}

/** Atende os pedidos do botão "Consultar agora": lê só quem pediu, grava e confirma. Barato quando não há pedidos. */
export async function runPending(api) {
  const targets = await api.pending()
  if (!targets.length) return 0
  const t0 = Date.now()
  const browserRef = { b: null }
  try {
    const reads = await pool(targets, CONCURRENCY, (t) => readOne(t, browserRef))
    await api.ingest(reads)
    await api.refreshDone(targets.map((t) => t.member_id))   // confirma mesmo se a leitura falhou: o erro fica registrado para o site mostrar
    log(`consulta imediata: ${reads.filter((r) => r.ok).length}/${reads.length} ok em ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  } finally { await browserRef.b?.close() }
  return targets.length
}

async function probe(id) {
  const url = urlFor(TEMPLATE, id)
  log('URL:', url)
  const t0 = Date.now()
  const fast = await fetchFast(url)
  log(`[HTTP simples] ${Date.now() - t0}ms`, JSON.stringify(fast))
  const b = await openBrowser()
  const jsons = []
  b.context.on('response', async (res) => {
    try {
      if (!(res.headers()['content-type'] ?? '').includes('json')) return
      const txt = await res.text()
      if (/bean|diamond|view/i.test(txt)) jsons.push(`${res.request().method()} ${res.url()}`)
    } catch { /* ignora */ }
  })
  const t1 = Date.now()
  const r = await fetchRendered(b, url)
  log(`[navegador] ${Date.now() - t1}ms`, JSON.stringify(r), '→ ao vivo?', liveSignal(r) > 0 ? 'SIM' : 'não')
  if (jsons.length) log('Respostas JSON que mencionam bean/view (candidatas a uma leitura mais leve):\n  ' + jsons.join('\n  '))
  await b.close()
  if (!fast.ok && !r.ok) { log('NÃO foi possível ler. Abra a página no Chrome, F12 > Elements, e confira o nome exato das classes info-bean / info-view-nums.'); process.exitCode = 2 }
}

async function main() {
  const mode = process.argv[2] ?? '--loop'
  if (mode === '--probe') return probe(process.argv[3] ?? '')
  if (!SUPABASE_URL || !KEY) { console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }
  const api = makeApi(SUPABASE_URL, KEY)
  if (mode === '--once') { await runPending(api); return runOnce(api) }
  if (mode === '--window') {
    const secs = Math.min(Math.max(Number(process.argv[3] ?? '240'), 10), 3000)
    const end = Date.now() + secs * 1000
    setTimeout(() => { log('tempo limite da rodada: encerrando'); process.exit(0) }, (secs + 90) * 1000)   // trava de segurança: nunca prende o agendador
    await runPending(api)
    await runOnce(api)
    while (Date.now() + REFRESH_POLL * 1000 < end) {
      await new Promise((r) => setTimeout(r, REFRESH_POLL * 1000))
      try { await runPending(api) } catch (e) { log('erro nos pedidos imediatos:', e.message) }
    }
    process.exit(0)   // encerra mesmo que alguma conexão ainda esteja aberta
  }
  let running = false
  const tick = async () => {
    if (running) { log('rodada anterior ainda em andamento; pulando'); return }
    running = true
    try { await runOnce(api) } catch (e) { log('erro na rodada:', e.message) } finally { running = false }
  }
  // Vigia dos pedidos do botão "Consultar agora" (uma chamada leve a cada poucos segundos)
  let watching = false
  setInterval(async () => {
    if (watching) return
    watching = true
    try { await runPending(api) } catch (e) { log('erro nos pedidos imediatos:', e.message) } finally { watching = false }
  }, REFRESH_POLL * 1000)
  await tick()
  for (;;) {
    const ms = INTERVAL * 1000
    await new Promise((r) => setTimeout(r, ms - (Date.now() % ms) + 500))  // próxima marca do relógio (:00, :05, …)
    await tick()
  }
}
// Compara como URL (no Windows o caminho tem C:\ e barras invertidas, e a comparação de texto simples falhava em silêncio)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1) })
