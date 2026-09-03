import assert from "node:assert/strict";
import test from "node:test";
import {
  aplicarExclusaoEmLoteNoEstado,
  confirmarExclusaoEmDuasEtapas,
  confirmarExclusaoEmLote,
  executarExclusaoEmLote,
  MAXIMO_LEADS_POR_EXCLUSAO,
  podeOferecerExclusaoEmLote,
  prepararExclusaoEmLote,
  quantidadePermitidaParaExclusao,
  resumirReconciliacaoExclusao,
} from "../src/lib/leadsEmLote.ts";

test("prepara a exclusão somente com os leads explicitamente marcados", () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-3", "lead-1", "lead-2"]));

  assert.deepEqual(plano, {
    ids: ["lead-1", "lead-2", "lead-3"],
    fraseDeConfirmacao: "EXCLUIR 3",
  });
});

test("recusa exclusão em lote quando nenhum lead está marcado", () => {
  assert.equal(prepararExclusaoEmLote(new Set()), null);
});

test("exige a frase completa e exata para confirmar a exclusão", () => {
  const fraseEsperada = "EXCLUIR 3";
  assert.equal(confirmarExclusaoEmLote("EXCLUIR 3", fraseEsperada), true);
  assert.equal(confirmarExclusaoEmLote("excluir 3", fraseEsperada), false);
  assert.equal(confirmarExclusaoEmLote("EXCLUIR", fraseEsperada), false);
});

test("não pede a frase quando a primeira confirmação é recusada", () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-1"]));
  assert.ok(plano);
  let pediuFrase = false;

  const confirmado = confirmarExclusaoEmDuasEtapas(
    plano,
    () => false,
    () => {
      pediuFrase = true;
      return plano.fraseDeConfirmacao;
    },
  );

  assert.equal(confirmado, false);
  assert.equal(pediuFrase, false);
});

test("recusa cancelamento ou frase incorreta na segunda confirmação", () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-1"]));
  assert.ok(plano);

  assert.equal(confirmarExclusaoEmDuasEtapas(plano, () => true, () => null), false);
  assert.equal(confirmarExclusaoEmDuasEtapas(plano, () => true, () => "EXCLUIR"), false);
  assert.equal(
    confirmarExclusaoEmDuasEtapas(plano, () => true, (esperada) => esperada),
    true,
  );
});

test("oferece a ação somente a administradores com seleção explícita", () => {
  assert.equal(podeOferecerExclusaoEmLote(true, 2), true);
  assert.equal(podeOferecerExclusaoEmLote(true, 0), false);
  assert.equal(podeOferecerExclusaoEmLote(false, 2), false);
});

test("limita cada exclusão a cem leads", () => {
  assert.equal(quantidadePermitidaParaExclusao(1), true);
  assert.equal(quantidadePermitidaParaExclusao(MAXIMO_LEADS_POR_EXCLUSAO), true);
  assert.equal(quantidadePermitidaParaExclusao(0), false);
  assert.equal(quantidadePermitidaParaExclusao(MAXIMO_LEADS_POR_EXCLUSAO + 1), false);
});

test("envia à RPC somente os IDs explicitamente preparados", async () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-2", "lead-1"]));
  assert.ok(plano);
  let idsRecebidos: string[] = [];

  const resultado = await executarExclusaoEmLote(plano, async (ids) => {
    idsRecebidos = ids;
    return { data: { quantidade: 2 }, error: null };
  });

  assert.deepEqual(idsRecebidos, ["lead-1", "lead-2"]);
  assert.deepEqual(resultado, {
    ok: true,
    ids: ["lead-1", "lead-2"],
    quantidade: 2,
  });
});

test("propaga erro da RPC sem produzir resultado de sucesso", async () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-1"]));
  assert.ok(plano);

  const resultado = await executarExclusaoEmLote(plano, async () => ({
    data: null,
    error: { message: "permissão negada" },
  }));

  assert.deepEqual(resultado, {
    ok: false,
    tipo: "rejeitada",
    erro: "permissão negada",
  });
});

test("classifica status zero como resultado incerto de transporte", async () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-1"]));
  assert.ok(plano);

  const resultado = await executarExclusaoEmLote(plano, async () => ({
    data: null,
    error: { message: "Failed to fetch" },
    status: 0,
  }));

  assert.deepEqual(resultado, {
    ok: false,
    tipo: "incerta",
    erro: "Failed to fetch",
  });
});

test("converte exceção de rede em resultado incerto", async () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-1"]));
  assert.ok(plano);

  const resultado = await executarExclusaoEmLote(plano, async () => {
    throw new Error("rede indisponível");
  });

  assert.deepEqual(resultado, {
    ok: false,
    tipo: "incerta",
    erro: "rede indisponível",
  });
});

test("converte exceção sem objeto Error em mensagem segura", async () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-1"]));
  assert.ok(plano);

  const resultado = await executarExclusaoEmLote(plano, async () => {
    throw "falha sem tipo";
  });

  assert.deepEqual(resultado, {
    ok: false,
    tipo: "incerta",
    erro: "Falha de rede ao excluir os leads.",
  });
});

test("reconcilia todos presentes, todos ausentes e resultado misto", () => {
  const solicitados = ["lead-1", "lead-2", "lead-3"];

  assert.deepEqual(resumirReconciliacaoExclusao(solicitados, solicitados), {
    quantidadePresente: 3,
    quantidadeAusente: 0,
    todosPresentes: true,
    todosAusentes: false,
  });
  assert.deepEqual(resumirReconciliacaoExclusao(solicitados, []), {
    quantidadePresente: 0,
    quantidadeAusente: 3,
    todosPresentes: false,
    todosAusentes: true,
  });
  assert.deepEqual(resumirReconciliacaoExclusao(solicitados, ["lead-2"]), {
    quantidadePresente: 1,
    quantidadeAusente: 2,
    todosPresentes: false,
    todosAusentes: false,
  });
});

test("usa a quantidade selecionada se a resposta não trouxer contagem válida", async () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-1", "lead-2"]));
  assert.ok(plano);

  const resultado = await executarExclusaoEmLote(plano, async () => ({
    data: {},
    error: null,
  }));

  assert.equal(resultado.ok && resultado.quantidade, 2);
});

test("usa a quantidade selecionada se a RPC trouxer contagem negativa", async () => {
  const plano = prepararExclusaoEmLote(new Set(["lead-1", "lead-2"]));
  assert.ok(plano);

  const resultado = await executarExclusaoEmLote(plano, async () => ({
    data: { quantidade: -1 },
    error: null,
  }));

  assert.equal(resultado.ok && resultado.quantidade, 2);
});

test("aplica o sucesso removendo somente os IDs excluídos", () => {
  const estado = aplicarExclusaoEmLoteNoEstado(
    [{ lead_id: "lead-1", nome: "Um" }, { lead_id: "lead-2", nome: "Dois" }],
    { nome: "Segmento", ids: ["lead-1", "lead-2", "lead-3"] },
    0,
    ["lead-2"],
    1,
  );

  assert.deepEqual(estado, {
    leads: [{ lead_id: "lead-1", nome: "Um" }],
    segmento: { nome: "Segmento", ids: ["lead-1", "lead-3"] },
    pagina: 0,
    mensagem: "1 leads excluídos da Ressoar.",
  });
});

test("retrocede apenas quando uma página posterior fica vazia", () => {
  const leads = [{ lead_id: "lead-1" }, { lead_id: "lead-2" }];
  const paginaPosterior = aplicarExclusaoEmLoteNoEstado(
    leads, null, 3, ["lead-1", "lead-2"], 2,
  );
  const paginaParcial = aplicarExclusaoEmLoteNoEstado(
    leads, null, 3, ["lead-1"], 1,
  );
  const primeiraPagina = aplicarExclusaoEmLoteNoEstado(
    leads, null, 0, ["lead-1", "lead-2"], 2,
  );

  assert.equal(paginaPosterior.pagina, 2);
  assert.equal(paginaParcial.pagina, 3);
  assert.equal(primeiraPagina.pagina, 0);
  assert.equal(paginaPosterior.segmento, null);
});
