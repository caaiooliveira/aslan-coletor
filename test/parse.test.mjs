import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBigo, parseCount, textOfClass } from '../src/parse.mjs'

test('parseCount: inteiros e separadores de milhar', () => {
  assert.equal(parseCount('1234').value, 1234)
  assert.equal(parseCount('1.234').value, 1234)
  assert.equal(parseCount('1,234,567').value, 1234567)
  assert.equal(parseCount(' 12 345 ').value, 12345)
  assert.equal(parseCount('0').value, 0)
})
test('parseCount: ambíguo/abreviado não vira número (não chutamos saldo)', () => {
  assert.equal(parseCount('1.2K').value, null)
  assert.equal(parseCount('12,5').value, null)
  assert.equal(parseCount('abc').value, null)
  assert.equal(parseCount('').value, null)
  assert.equal(parseCount(null).value, null)
})
test('textOfClass acha a classe entre várias, ignora tags internas e entidades', () => {
  const html = '<div class="x info-bean y"><i class="ico"></i> 1&nbsp;234 </div>'
  assert.equal(textOfClass(html, 'info-bean'), '1 234')
  assert.equal(textOfClass(html, 'info-bea'), null)       // não casa prefixo
  assert.equal(textOfClass('<p>sem</p>', 'info-bean'), null)
})
test('parseBigo: os dois valores', () => {
  const html = '<div class="info-bean">8.450</div><div class="info-view-nums">0</div>'
  const p = parseBigo(html)
  assert.equal(p.beans, 8450); assert.equal(p.viewNums, 0)
})
test('parseBigo: ao vivo com audiência abreviada conta como diferente de zero', () => {
  assert.equal(parseBigo('<div class="info-bean">10</div><div class="info-view-nums">1.2K</div>').viewNums, 1)
})
test('parseBigo: sem info-bean => erro claro, sem número', () => {
  const p = parseBigo('<html><body>nada</body></html>')
  assert.equal(p.beans, null); assert.match(p.beansReason, /não encontrado/)
})

import { liveSignal } from '../src/index.mjs'
test('status da sala: ignora robôs nas visualizações', () => {
  const off = parseBigo('<div class="host-info" data-room-status="0"><div class="info-bean">7898</div><div class="info-view-nums">350</div></div>')
  assert.equal(off.roomStatus, 0); assert.equal(liveSignal({ viewNums: 350, roomStatus: 0 }), 0)
  const on = parseBigo('<div data-room-status="1"><div class="info-bean">1</div><div class="info-view-nums">0</div></div>')
  assert.equal(on.roomStatus, 1); assert.equal(liveSignal({ viewNums: 0, roomStatus: 1 }), 1)
  assert.equal(parseBigo('<div class="info-bean">1</div>').roomStatus, null)
  assert.equal(liveSignal({ viewNums: 5, roomStatus: null }), 5)   // sem o atributo: volta para as visualizações
})
