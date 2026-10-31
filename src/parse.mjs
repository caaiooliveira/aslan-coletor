// Funções puras (sem rede) para ler os dois valores da página da Bigo. Testadas em test/parse.test.mjs.

const entities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

/** Texto do primeiro elemento que tem a classe `cls` (div, span, p...). Retorna null se não existir. */
export function textOfClass(html, cls) {
  const re = new RegExp(`<([a-z0-9]+)[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)</\\1>`, 'i')
  const m = re.exec(html)
  if (!m) return null
  return entities(m[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * Converte "1.234", "1,234", "1 234" ou "1234" em inteiro.
 * Valores abreviados ("1.2K") ou decimais são ambíguos para saldo: retorna { value: null, reason }.
 */
export function parseCount(text) {
  if (text == null) return { value: null, reason: 'ausente' }
  const t = String(text).trim()
  if (t === '') return { value: null, reason: 'vazio' }
  const s = t.replace(/\s+/g, '')
  if (/^\d+$/.test(s)) return { value: Number(s) }
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return { value: Number(s.replace(/[.,]/g, '')) }
  if (/^\d+([.,]\d+)?\s*[kKmM]$/.test(s)) return { value: null, reason: `abreviado (${t})` }
  return { value: null, reason: `formato inesperado (${t})` }
}

/** { beans, viewNums, error? } a partir do HTML já renderizado. */
export function parseBigo(html) {
  const bean = textOfClass(html, 'info-bean')
  const view = textOfClass(html, 'info-view-nums')
  const b = bean == null ? { value: null, reason: 'info-bean não encontrado' } : parseCount(bean)
  // view-nums pode vir abreviado ("1.2K"): para "ao vivo" basta saber que é diferente de zero.
  let v
  if (view == null) v = { value: null, reason: 'info-view-nums não encontrado' }
  else {
    v = parseCount(view)
    if (v.value == null && /^[\d.,\s]+[kKmM]$/.test(view.trim()) && /[1-9]/.test(view)) v = { value: 1 }
  }
  // data-room-status="0" no bloco da integrante (0 = fora do ar). Não é afetado por robôs que inflam as visualizações.
  const rs = /data-room-status\s*=\s*["']?(\d+)/i.exec(html)
  return { beans: b.value, viewNums: v.value, roomStatus: rs ? Number(rs[1]) : null, beansReason: b.reason, viewReason: v.reason }
}
