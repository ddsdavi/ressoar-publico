export type PlanoExclusaoEmLote = {
  ids: string[];
  fraseDeConfirmacao: string;
};

export const MAXIMO_LEADS_POR_EXCLUSAO = 100;

type RespostaRpcExclusao = {
  data: { quantidade?: number } | null;
  error: { message: string } | null;
  status?: number;
};

type ResultadoExclusaoEmLote =
  | { ok: true; ids: string[]; quantidade: number }
  | { ok: false; tipo: "rejeitada" | "incerta"; erro: string };

export type SegmentoComIds = { nome: string; ids: string[] };

export function prepararExclusaoEmLote(
  marcados: ReadonlySet<string>,
): PlanoExclusaoEmLote | null {
  const ids = [...marcados].sort();
  if (ids.length === 0) return null;

  return {
    ids,
    fraseDeConfirmacao: `EXCLUIR ${ids.length}`,
  };
}

export function confirmarExclusaoEmLote(
  texto: string,
  fraseDeConfirmacao: string,
): boolean {
  return texto === fraseDeConfirmacao;
}

export function confirmarExclusaoEmDuasEtapas(
  plano: PlanoExclusaoEmLote,
  confirmarRisco: () => boolean,
  pedirFrase: (fraseEsperada: string) => string | null,
): boolean {
  if (!confirmarRisco()) return false;
  return confirmarExclusaoEmLote(
    pedirFrase(plano.fraseDeConfirmacao) ?? "",
    plano.fraseDeConfirmacao,
  );
}

export function podeOferecerExclusaoEmLote(
  ehAdmin: boolean,
  quantidadeMarcada: number,
): boolean {
  return ehAdmin && quantidadeMarcada > 0;
}

export function quantidadePermitidaParaExclusao(quantidade: number): boolean {
  return quantidade > 0 && quantidade <= MAXIMO_LEADS_POR_EXCLUSAO;
}

export async function executarExclusaoEmLote(
  plano: PlanoExclusaoEmLote,
  executarRpc: (ids: string[]) => Promise<RespostaRpcExclusao>,
): Promise<ResultadoExclusaoEmLote> {
  try {
    const ids = [...plano.ids];
    const { data, error, status } = await executarRpc(ids);
    if (error) {
      return {
        ok: false,
        tipo: status === 0 ? "incerta" : "rejeitada",
        erro: error.message,
      };
    }

    const quantidadeRecebida = Number(data?.quantidade);
    const quantidade = Number.isInteger(quantidadeRecebida) && quantidadeRecebida >= 0
      ? quantidadeRecebida
      : ids.length;
    return { ok: true, ids, quantidade };
  } catch (erro) {
    return {
      ok: false,
      tipo: "incerta",
      erro: erro instanceof Error ? erro.message : "Falha de rede ao excluir os leads.",
    };
  }
}

export function resumirReconciliacaoExclusao(
  idsSolicitados: readonly string[],
  idsAindaPresentes: readonly string[],
) {
  const presentes = new Set(idsAindaPresentes);
  const quantidadePresente = idsSolicitados.filter((id) => presentes.has(id)).length;
  const quantidadeAusente = idsSolicitados.length - quantidadePresente;

  return {
    quantidadePresente,
    quantidadeAusente,
    todosPresentes: quantidadePresente === idsSolicitados.length,
    todosAusentes: quantidadeAusente === idsSolicitados.length,
  };
}

export function aplicarExclusaoEmLoteNoEstado<T extends { lead_id: string }>(
  leadsAtuais: readonly T[],
  segmentoAtual: SegmentoComIds | null,
  paginaAtual: number,
  idsExcluidos: readonly string[],
  quantidadeExcluida: number,
) {
  const excluidos = new Set(idsExcluidos);
  const paginaFicouVazia = leadsAtuais.length > 0
    && leadsAtuais.every((lead) => excluidos.has(lead.lead_id));

  return {
    leads: leadsAtuais.filter((lead) => !excluidos.has(lead.lead_id)),
    segmento: segmentoAtual
      ? { ...segmentoAtual, ids: segmentoAtual.ids.filter((id) => !excluidos.has(id)) }
      : null,
    pagina: paginaAtual > 0 && paginaFicouVazia ? paginaAtual - 1 : paginaAtual,
    mensagem: quantidadeExcluida + " leads excluídos da Ressoar.",
  };
}
