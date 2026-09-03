import assert from "node:assert/strict";
import test from "node:test";

async function carregar() {
  try {
    return await import("./imediato.ts");
  } catch {
    assert.fail("falta o seletor de passos que rodam dentro da requisição do formulário");
  }
}

test("executa imediatamente automação de lista composta só por um passo ManyChat", async () => {
  const { selecionarPassosManyChatImediatos } = await carregar();
  const automacoes = [{
    automacao_id: "black",
    ativa: true,
    gatilho: { tipo: "lista_inscrita", lista_id: 32 },
  }];
  const passos = [{
    automacao_fk: "black",
    ordem: 1,
    tipo: "manychat_tag",
    config: { tag: "BLACK_2026_INSCRITOS" },
  }];

  assert.deepEqual(
    selecionarPassosManyChatImediatos(32, automacoes, passos),
    [{
      automacaoId: "black",
      tag: "BLACK_2026_INSCRITOS",
      criar: true,
      passoManyChat: 1,
      proximoPasso: null,
    }],
  );
});

test("antecipa o primeiro passo ManyChat e preserva o próximo passo para o motor", async () => {
  const { selecionarPassosManyChatImediatos } = await carregar();
  const automacoes = [
    { automacao_id: "outra", ativa: true, gatilho: { tipo: "lista_inscrita", lista_id: 6 } },
    { automacao_id: "composta", ativa: true, gatilho: { tipo: "lista_inscrita", lista_id: 32 } },
  ];
  const passos = [
    { automacao_fk: "outra", ordem: 1, tipo: "manychat_tag", config: { tag: "OUTRA" } },
    { automacao_fk: "composta", ordem: 1, tipo: "manychat_tag", config: { tag: "IMEDIATA" } },
    { automacao_fk: "composta", ordem: 2, tipo: "google_sheets", config: {} },
  ];

  assert.deepEqual(selecionarPassosManyChatImediatos(32, automacoes, passos), [{
    automacaoId: "composta",
    tag: "IMEDIATA",
    criar: true,
    passoManyChat: 1,
    proximoPasso: 2,
  }]);
});

test("reconhece gatilho múltiplo que contém a inscrição da lista", async () => {
  const { selecionarPassosManyChatImediatos } = await carregar();
  const automacoes = [{
    automacao_id: "multipla",
    ativa: true,
    gatilho: [
      { tipo: "tag_adicionada", tag_id: 85 },
      { tipo: "lista_inscrita", lista_id: 32 },
    ],
  }];
  const passos = [{
    automacao_fk: "multipla", ordem: 1, tipo: "manychat_tag", config: { tag: "MULTIPLA" },
  }];

  assert.equal(selecionarPassosManyChatImediatos(32, automacoes, passos).length, 1);
});
