type Automacao = {
  automacao_id: string;
  ativa: boolean;
  gatilho: { tipo?: string; lista_id?: number | string } |
           { tipo?: string; lista_id?: number | string }[] | null;
};

type Passo = {
  automacao_fk: string;
  ordem: number;
  tipo: string;
  config: { tag?: string; criar?: boolean } | null;
};

export type PassoManyChatImediato = {
  automacaoId: string;
  tag: string;
  criar: boolean;
  passoManyChat: number;
  proximoPasso: number | null;
};

// O ManyChat pode ser o primeiro passo de um fluxo maior. Ele sai daqui já;
// o motor recebe apenas o próximo passo (planilha, e-mail etc.).
export function selecionarPassosManyChatImediatos(
  listaId: number,
  automacoes: Automacao[],
  passos: Passo[],
): PassoManyChatImediato[] {
  const resultado: PassoManyChatImediato[] = [];

  for (const automacao of automacoes) {
    const gatilhos = Array.isArray(automacao.gatilho)
      ? automacao.gatilho
      : automacao.gatilho ? [automacao.gatilho] : [];
    const corresponde = gatilhos.some((gatilho) =>
      gatilho.tipo === "lista_inscrita" && Number(gatilho.lista_id) === listaId
    );
    if (!automacao.ativa || !corresponde) continue;

    const fluxo = passos
      .filter((passo) => passo.automacao_fk === automacao.automacao_id)
      .sort((a, b) => a.ordem - b.ordem);
    if (!fluxo.length || fluxo[0].tipo !== "manychat_tag") continue;

    const tag = String(fluxo[0].config?.tag ?? "").trim();
    if (tag) resultado.push({
      automacaoId: automacao.automacao_id,
      tag,
      criar: fluxo[0].config?.criar !== false,
      passoManyChat: fluxo[0].ordem,
      proximoPasso: fluxo[1]?.ordem ?? null,
    });
  }

  return resultado;
}
