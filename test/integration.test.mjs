// Sobe uma "Bigo" falsa (uma página com número no HTML e outra que preenche por JavaScript) e um "Supabase" falso,
// e roda o coletor de ponta a ponta: lê, usa o navegador quando preciso e grava o lote numa única chamada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

const bigo = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  if (req.url === '/111111') return res.end('<div class="info-bean">1.500</div><div class="info-view-nums">0</div>')
  if (req.url === '/222222') return res.end('<div class="info-bean">--</div><div class="info-view-nums">0</div><script>setTimeout(()=>{document.querySelector(".info-bean").textContent="3.200";document.querySelector(".info-view-nums").textContent="12"},300)</script>')
  res.statusCode = 404; res.end('nope')
}).listen(0)
const captured = { ingest: null, calls: 0, done: null, pendingServed: false }
const sb = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    assert.equal(req.headers.apikey, 'SERVICE')
    res.setHeader('content-type', 'application/json')
    if (req.url.endsWith('/bigo_targets')) return res.end(JSON.stringify([
      { member_id: '00000000-0000-0000-0000-000000000001', bigo_id: '111111' },
      { member_id: '00000000-0000-0000-0000-000000000002', bigo_id: '222222' },
      { member_id: '00000000-0000-0000-0000-000000000003', bigo_id: '333333' }]))
    if (req.url.endsWith('/bigo_pending_refresh')) { const r = captured.pendingServed ? [] : [{ member_id: '00000000-0000-0000-0000-000000000001', bigo_id: '111111' }]; captured.pendingServed = true; return res.end(JSON.stringify(r)) }
    if (req.url.endsWith('/bigo_refresh_done')) { captured.done = JSON.parse(body); return res.end('1') }
    if (req.url.endsWith('/bigo_ingest')) { captured.calls++; captured.ingest = JSON.parse(body); return res.end(JSON.stringify({ ok: 2, failed: 1 })) }
    res.statusCode = 404; res.end('{}')
  })
}).listen(0)

test('rodada completa: caminho rápido, navegador e falha, tudo numa chamada só', async () => {
  await new Promise((r) => setTimeout(r, 50))
  process.env.SUPABASE_URL = `http://127.0.0.1:${sb.address().port}`
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'SERVICE'
  process.env.BIGO_URL_TEMPLATE = `http://127.0.0.1:${bigo.address().port}/{id}`
  const { runOnce } = await import('../src/index.mjs')
  const { makeApi } = await import('../src/supabase.mjs')
  await runOnce(makeApi(process.env.SUPABASE_URL, 'SERVICE'))
  assert.equal(captured.calls, 1, 'o lote inteiro vai em UMA chamada')
  const by = Object.fromEntries(captured.ingest.p_reads.map((r) => [r.member_id.slice(-1), r]))
  assert.deepEqual([by[1].ok, by[1].beans, by[1].view_nums], [true, 1500, 0])
  assert.deepEqual([by[2].ok, by[2].beans, by[2].view_nums], [true, 3200, 12])   // preenchido por JS
  assert.equal(by[3].ok, false); assert.ok(by[3].error)
  // consulta imediata: lê só quem pediu, grava e confirma; sem pedidos, não faz nada
  captured.calls = 0
  const { runPending } = await import('../src/index.mjs')
  const api = makeApi(process.env.SUPABASE_URL, 'SERVICE')
  assert.equal(await runPending(api), 1)
  assert.equal(captured.ingest.p_reads.length, 1); assert.equal(captured.ingest.p_reads[0].beans, 1500)
  assert.deepEqual(captured.done.p_member_ids, ['00000000-0000-0000-0000-000000000001'])
  assert.equal(await runPending(api), 0); assert.equal(captured.calls, 1)
  bigo.closeAllConnections(); sb.closeAllConnections(); bigo.close(); sb.close()
})
