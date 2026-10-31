// Poucas chamadas, ambas por RPC com a chave de serviço (que nunca sai do servidor do coletor).
export function makeApi(baseUrl, serviceKey) {
  const call = async (fn, body) => {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20_000),   // nunca ficar pendurado esperando o Supabase
    })
    if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    return res.json()
  }
  return {
    targets: () => call('bigo_targets'),
    ingest: (reads) => call('bigo_ingest', { p_reads: reads }),
    pending: () => call('bigo_pending_refresh'),                       // pedidos do botão "Consultar agora"
    refreshDone: (ids) => call('bigo_refresh_done', { p_member_ids: ids }),
  }
}
