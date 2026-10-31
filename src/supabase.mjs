
// Comunicação com Supabase através de RPC.
// A Service Role Key permanece exclusivamente no servidor do coletor.

export function makeApi(baseUrl, serviceKey) {
  const call = async (fn, body = {}) => {
    const res = await fetch(
      `${baseUrl}/rest/v1/rpc/${fn}`,
      {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      }
    )

    if (!res.ok) {
      const error = await res.text()

      throw new Error(
        `${fn}: HTTP ${res.status} ${error.slice(0, 300)}`
      )
    }

    return res.json()
  }

  return {
    // Todas as integrantes cadastradas, independentemente
    // de estarem administrativamente ativas ou inativas.
    targets: () => call('bigo_targets'),

    // Grava os resultados das consultas.
    ingest: (reads) =>
      call('bigo_ingest', {
        p_reads: reads,
      }),

    // Busca solicitações de atualização manual.
    pending: () =>
      call('bigo_pending_refresh'),

    // Confirma o processamento das solicitações.
    refreshDone: (ids) =>
      call('bigo_refresh_done', {
        p_member_ids: ids,
      }),
  }
}
