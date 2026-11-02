
// Funções puras para interpretar os dados da página da Bigo.
// Sem requisições de rede ou dependências externas.

const entities = (s) =>
  s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )

/**
 * Extrai o texto do primeiro elemento que contém determinada classe.
 */
export function textOfClass(html, cls) {
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const re = new RegExp(
    `<([a-z0-9]+)[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)</\\1>`,
    'i'
  )

  const m = re.exec(html)

  if (!m) return null

  return entities(
    m[2].replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Converte valores numéricos em inteiros.
 * Não aceita abreviações ambíguas como 1.2K.
 */
export function parseCount(text) {
  if (text == null) {
    return { value: null, reason: 'ausente' }
  }

  const t = String(text).trim()

  if (!t) {
    return { value: null, reason: 'vazio' }
  }

  const s = t.replace(/\s+/g, '')

  let value

  if (/^\d+$/.test(s)) {
    value = Number(s)
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
    value = Number(s.replace(/[.,]/g, ''))
  } else {
    if (/^\d+([.,]\d+)?[kKmM]$/.test(s)) {
      return {
        value: null,
        reason: `abreviado (${t})`
      }
    }

    return {
      value: null,
      reason: `formato inesperado (${t})`
    }
  }

  if (!Number.isSafeInteger(value)) {
    return {
      value: null,
      reason: `valor fora do limite seguro (${t})`
    }
  }

  return { value }
}

/**
 * Interpreta beans, visualizações e status da sala.
 */
export function parseBigo(html) {
  const bean = textOfClass(html, 'info-bean')
  const view = textOfClass(html, 'info-view-nums')

  const b = bean == null
    ? {
        value: null,
        reason: 'info-bean não encontrado'
      }
    : parseCount(bean)

  let v

  if (view == null) {
    v = {
      value: null,
      reason: 'info-view-nums não encontrado'
    }
  } else {
    v = parseCount(view)

    // Visualizações abreviadas servem apenas para identificar
    // se existe audiência.
    if (
      v.value == null &&
      /^[\d.,\s]+[kKmM]$/.test(view.trim()) &&
      /[1-9]/.test(view)
    ) {
      v = { value: 1 }
    }
  }

  const rs = /data-room-status\s*=\s*["']?(\d+)/i.exec(html)

  return {
    beans: b.value,
    viewNums: v.value,
    roomStatus: rs ? Number(rs[1]) : null,
    beansReason: b.reason,
    viewReason: v.reason
  }
}
