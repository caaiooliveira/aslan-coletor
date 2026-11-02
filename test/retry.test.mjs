// Pedido sob demanda que falha NÃO é concluído: o coletor avisa o banco (bigo_refresh_failed) com a data do pedido.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

const bigo = http.createServer((req, res) => { res.statusCode = 404; res.end('nope') }).listen(0)
const calls = []
const sb = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    const fn = req.url.split('/').pop()
    calls.push([fn, body ? JSON.parse(body) : null])
    if (fn === 'bigo_pending_refresh') return res.end(JSON.stringify([{ member_id: '00000000-0000-0000-0000-000000000009', bigo_id: 'abc.def_9', requested_at: '2026-10-31T20:00:00Z' }]))
    res.end(fn === 'bigo_ingest' ? '{"ok":0,"failed":1}' : '1')
  })
}).listen(0)

test('falha na leitura: ingere o erro e libera nova tentativa em vez de concluir', async () => {
  await new Promise((r) => setTimeout(r, 50))
  process.env.SUPABASE_URL = `http://127.0.0.1:${sb.address().port}`
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'SERVICE'
  process.env.BIGO_URL_TEMPLATE = `http://127.0.0.1:${bigo.address().port}/{id}`
  const { runPending } = await import('../src/index.mjs')
  const { makeApi } = await import('../src/supabase.mjs')
  assert.equal(await runPending(makeApi(process.env.SUPABASE_URL, 'SERVICE')), 1)
  const names = calls.map((c) => c[0])
  assert.ok(names.includes('bigo_ingest')); assert.ok(names.includes('bigo_refresh_failed')); assert.ok(!names.includes('bigo_refresh_done'))
  const failed = calls.find((c) => c[0] === 'bigo_refresh_failed')[1]
  assert.deepEqual(failed.p_member_ids, ['00000000-0000-0000-0000-000000000009'])
  assert.deepEqual(failed.p_requested_ats, ['2026-10-31T20:00:00Z'])
  const sent = calls.find((c) => c[0] === 'bigo_ingest')[1].p_reads[0]
  assert.equal(sent.ok, false)
  bigo.closeAllConnections(); sb.closeAllConnections(); bigo.close(); sb.close()
})

test('ID com letras, ponto, underscore e hífen vira URL válida', async () => {
  const { urlFor } = await import('../src/bigo.mjs')
  assert.equal(urlFor('https://www.bigo.tv/pt/{id}', 'Ana.Live_9-x'), 'https://www.bigo.tv/pt/Ana.Live_9-x')
  assert.throws(() => urlFor('https://www.bigo.tv/pt/{id}', 'a b!'))
})
