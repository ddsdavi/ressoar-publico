// Edge Function pública: registra uma venda no Ressoar.
//
//   POST /venda
//
// Aceita DOIS formatos, de propósito:
//
//   a) o corpo cru do webhook da Hotmart — o n8n só repassa o que recebeu,
//      sem precisar montar nada;
//   b) um formato simples { email, produto, valor, status, ... } para
//      qualquer outra origem (Kiwify, Eduzz, checkout próprio, planilha).
//
// Registra a compra E cuida do contato: acha por WhatsApp, depois por
// e-mail, e cria se não existir. Quem pagou é o contato mais valioso que
// existe — descartar por não estar cadastrado seria absurdo.
//
// Reenviar o mesmo evento não duplica: o código da transação é único e a
// linha existente é atualizada. É assim que um reembolso lançado depois
// corrige a venda que já estava aqui.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ehFimDeGarantia, ehIntencaoDeCompra, statusPedidoHotmart } from "./estados.ts";
import { normWhatsapp } from "./telefone.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// se estiver configurado, exige o token da Hotmart (hottok) ou o nosso
const SEGREDO = Deno.env.get("VENDA_SEGREDO") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hotmart-hottok, x-ressoar-segredo",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// o evento da Hotmart vira o status da compra. Reembolso e chargeback
// PRECISAM chegar: sem eles, quem pediu o dinheiro de volta continuaria
// no segmento de compradores recebendo campanha de quem ficou.
// Os 9 eventos oficiais do webhook de pedidos (versão 2.0.0).
// A classificação fica em estados.ts para ser testada fora da função.

// purchase.status é mais fino que o evento e manda quando existe: ele
// distingue coisas que o nome do evento junta, como reembolso PARCIAL —
// que não é reembolso (a pessoa ficou com parte) nem venda cheia.

// Quando a página monta a URL com uma variável vazia, o parâmetro chega como
// a STRING "undefined" — quatro contatos guardaram isso no xcod. Não informa
// nada e ainda suja a ficha de quem abre o contato.
function semLixo(dados: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dados).filter(([, v]) =>
    !(typeof v === "string" && ["undefined", "null"].includes(v.trim().toLowerCase()))));
}

// a Hotmart manda data como milissegundos desde 1970
function data(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

type Venda = {
  email: string | null; nome: string | null; telefone: string | null;
  transacao: string | null; produto: string; valor: number; moeda: string;
  pagamento: string | null; status: string | null; quando: string | null;
  parcelas: number | null; origem: string;
  evento: string | null; ucode: string | null; oferta: string | null;
  documento: string | null; pais: string | null;
  utms: Record<string, string>;
};

function daHotmart(b: Record<string, any>): Venda | null {
  const d = b.data;
  if (!d?.buyer && !d?.purchase) return null;
  const c = d.purchase ?? {};
  const status = statusPedidoHotmart(b.event, c.status);

  // O DDD vem SEPARADO em checkout_phone_code para compradores
  // brasileiros. Sem juntar, o telefone chega sem DDD e vira outra
  // pessoa na hora de casar com quem já está na base.
  const ddd = String(d.buyer?.checkout_phone_code ?? "").replace(/\D/g, "");
  const fone = String(d.buyer?.checkout_phone ?? "").replace(/\D/g, "");
  const telefone = fone
    ? (ddd && !fone.startsWith(ddd) ? ddd + fone : fone)
    : null;

  // full_price é o que a pessoa REALMENTE pagou, com taxas e juros.
  // price é o valor da oferta. Para saber quanto o cliente gastou, o
  // primeiro é o certo — o segundo subestima compra parcelada.
  const valor = Number(
    c.full_price?.value ?? c.price?.value ?? c.original_offer_price?.value ?? 0);

  // as UTMs da venda: de onde veio o comprador
  const utms: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.origin ?? {})) {
    if (v) utms["hotmart_" + k] = String(v);
  }
  if (c.offer?.coupon_code) utms["hotmart_cupom"] = String(c.offer.coupon_code);

  return {
    email: (d.buyer?.email ?? "").toLowerCase() || null,
    nome: d.buyer?.name
      ?? [d.buyer?.first_name, d.buyer?.last_name].filter(Boolean).join(" ")
      ?? null,
    telefone,
    transacao: c.transaction ?? null,
    produto: d.product?.name ?? "produto sem nome",
    valor,
    moeda: c.full_price?.currency_value ?? c.price?.currency_value ?? "BRL",
    pagamento: c.payment?.type ?? null,
    status,
    quando: data(status === "aprovada"
      ? c.approved_date ?? c.order_date ?? b.creation_date
      : c.order_date ?? b.creation_date),
    parcelas: c.payment?.installments_number ?? null,
    origem: "hotmart",
    evento: b.event ?? null,
    ucode: d.product?.ucode ?? null,
    oferta: c.offer?.name ?? c.offer?.code ?? null,
    documento: d.buyer?.document ?? null,
    pais: d.buyer?.address?.country_iso ?? null,
    utms,
  };
}

function simples(b: Record<string, any>): Venda {
  return {
    email: (b.email ?? "").toLowerCase() || null,
    nome: b.nome ?? null,
    telefone: b.telefone ?? b.whatsapp ?? null,
    transacao: b.transacao ?? b.codigo_transacao ?? null,
    produto: b.produto ?? "produto sem nome",
    valor: Number(b.valor ?? 0),
    moeda: b.moeda ?? "BRL",
    pagamento: b.pagamento ?? null,
    status: b.status ?? "aprovada",
    quando: data(b.data ?? b.quando),
    parcelas: b.parcelas ? Number(b.parcelas) : null,
    origem: b.origem ?? "api",
    evento: b.event ?? null,
    ucode: b.ucode ?? null,
    oferta: b.oferta ?? null,
    documento: b.documento ?? b.cpf ?? null,
    pais: b.pais ?? null,
    utms: {},
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("método inválido", { status: 405, headers: cors });

  // O token vem no cabeçalho X-HOTMART-HOTTOK em quase todos os eventos,
  // e no corpo em alguns. Guardo o que chegar ANTES de decidir exigir:
  // ligar a exigência com o valor errado faria o sistema recusar venda de
  // verdade, o que é pior do que o risco que ela evita.
  const corpoInicial = await req.clone().json().catch(() => ({} as Record<string, any>));
  const tokenRecebido = req.headers.get("x-hotmart-hottok")
    ?? corpoInicial?.hottok
    ?? req.headers.get("x-ressoar-segredo")
    ?? null;

  // Fail-closed (auditoria 25/08/2026): sem o segredo configurado, RECUSA.
  // Antes, SEGREDO vazio pulava toda a verificação e o webhook aceitava
  // qualquer requisição — forja de venda/reembolso e mass-assignment de
  // lista/tag. Em produção VENDA_SEGREDO está setado, então o comportamento
  // não muda; isto só fecha o caso de um deploy sem o segredo.
  if (!SEGREDO) {
    console.error("VENDA_SEGREDO ausente — webhook de venda recusado por segurança");
    return new Response(JSON.stringify({ erro: "webhook não configurado" }), { status: 503, headers: cors });
  }
  if ((tokenRecebido ?? "") !== SEGREDO) {
    return new Response(JSON.stringify({ erro: "não autorizado" }), { status: 401, headers: cors });
  }

  const b = await req.json().catch(() => null);
  if (!b) return new Response(JSON.stringify({ erro: "corpo inválido" }), { status: 400, headers: cors });

  const evento = String(b.event ?? "");

  // Cancelamento de assinatura tem forma própria (data.subscriber) e é
  // valioso demais para descartar: quem cancela recorrência é a pessoa
  // que mais precisa de atenção.
  if (evento === "SUBSCRIPTION_CANCELLATION") {
    const email = b.data?.subscriber?.email ?? null;
    const { data: reg } = await supabase.from("hotmart_eventos").insert({
      hotmart_id: b.id ?? null, evento, email,
      produto: b.data?.product?.name ?? null, corpo: b,
      token_recebido: tokenRecebido,
    }).select("evento_id").single();

    const { data: r } = await supabase.rpc("hotmart_cancelou_assinatura", {
      p_email: email, p_produto: b.data?.product?.name ?? "",
      p_ucode: b.data?.product?.ucode ?? null,
    });
    await supabase.from("hotmart_eventos").update({
      processado: true, situacao: "processado", processado_em: new Date().toISOString(),
      erro: (r as Record<string, string>)?.erro ?? null,
    }).eq("evento_id", reg?.evento_id ?? "");
    return new Response(JSON.stringify({ ok: true, evento, resultado: r }),
      { headers: { ...cors, "Content-Type": "application/json" } });
  }

  // O que não é compra fica REGISTRADO, mas não vira erro. Erro vermelho
  // para coisa normal treina a pessoa a ignorar erro — e aí o erro de
  // verdade passa batido.
  if (evento && !evento.startsWith("PURCHASE")) {
    await supabase.from("hotmart_eventos").insert({
      hotmart_id: b.id ?? null, evento,
      email: b.data?.user?.email ?? b.data?.subscriber?.email ?? null,
      produto: b.data?.product?.name ?? null,
      corpo: b, situacao: "ignorado", token_recebido: tokenRecebido,
      erro: "evento fora do escopo de compra — registrado para consulta",
      processado_em: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ ok: true, evento, tratado: false }),
      { headers: { ...cors, "Content-Type": "application/json" } });
  }

  const v = daHotmart(b) ?? simples(b);

  // Guarda o corpo cru ANTES de processar. Webhook de venda é dinheiro:
  // se algo falhar no meio, a Hotmart não reenvia para sempre, e sem o
  // original não há como reprocessar nem descobrir o que deu errado.
  const { data: reg } = await supabase.from("hotmart_eventos").insert({
    hotmart_id: b.id ?? null,
    evento: b.event ?? null,
    transacao: v.transacao,
    email: v.email,
    produto: v.produto,
    corpo: b,
    token_recebido: tokenRecebido,
  }).select("evento_id").single();
  const registro = reg?.evento_id ?? null;

  const falhar = async (msg: string, code: number) => {
    if (registro) {
      await supabase.from("hotmart_eventos")
        .update({ erro: msg, situacao: "erro", processado_em: new Date().toISOString() })
        .eq("evento_id", registro);
    }
    return new Response(JSON.stringify({ erro: msg }), { status: code, headers: cors });
  };

  // Nunca presumir venda para um estado novo da Hotmart. Guardamos o corpo
  // cru acima e falhamos de forma visivel ate que o novo estado seja mapeado.
  if (!v.status) {
    return await falhar(
      `evento/status Hotmart nao reconhecido: ${evento || "sem evento"}/${String(b.data?.purchase?.status ?? "sem status")}`,
      422,
    );
  }

  if (!v.email && !v.telefone) {
    return await falhar("sem e-mail nem telefone do comprador", 400);
  }

  const fone = normWhatsapp(v.telefone, v.pais);
  // só os dígitos: o checkout manda "123.456.789-00" e a base guarda cru
  const doc = (v.documento ?? "").replace(/\D/g, "") || null;

  // 1) acha o contato: CPF, WhatsApp, e-mail — nessa ordem.
  //
  // O CPF vem em toda compra da Hotmart e é o identificador mais forte
  // que existe aqui: e-mail a pessoa troca, telefone ela troca, CPF não.
  // É ele que permite a mesma pessoa comprar com dois endereços sem
  // virar dois contatos.
  let leadId: string | null = null;
  if (doc && doc.length >= 11) {
    const { data } = await supabase.from("tabela_1_leads")
      .select("lead_id").eq("cpf", doc).maybeSingle();
    if (data) leadId = data.lead_id;
  }
  if (!leadId && fone) {
    const { data } = await supabase.from("tabela_1_leads")
      .select("lead_id").eq("whatsapp", fone).maybeSingle();
    if (data) leadId = data.lead_id;
  }
  if (!leadId && v.email) {
    const { data } = await supabase.from("tabela_1_leads")
      .select("lead_id").ilike("email", v.email).maybeSingle();
    if (data) leadId = data.lead_id;
  }

  // 2) cria se não existir; completa o que faltava se já existir
  let novo = false;
  if (!leadId) {
    const { data, error } = await supabase.from("tabela_1_leads")
      .insert({ email: v.email, nome: v.nome, whatsapp: fone, cpf: doc })
      .select("lead_id").single();

    // Order bump e upsell são vendidos no mesmo checkout, e a Hotmart
    // manda UM webhook por item — os dois chegam no mesmo segundo. Ambos
    // procuram a pessoa, nenhum acha, ambos tentam criar, e o segundo
    // esbarra na chave única do WhatsApp. Desistir aqui perdia o item:
    // oito compras entre 03 e 06/08/2026 ficaram assim.
    //
    // A pessoa existe — quem acabou de criá-la foi o outro item da mesma
    // compra. Procurar de novo devolve o mesmo contato, e cada item segue
    // como a operação distinta que é.
    if (error) {
      if (fone) {
        const { data: r } = await supabase.from("tabela_1_leads")
          .select("lead_id").eq("whatsapp", fone).maybeSingle();
        if (r) leadId = r.lead_id;
      }
      if (!leadId && v.email) {
        const { data: r } = await supabase.from("tabela_1_leads")
          .select("lead_id").ilike("email", v.email).maybeSingle();
        if (r) leadId = r.lead_id;
      }
      if (!leadId) return await falhar(error.message, 500);
    } else {
      leadId = data.lead_id;
      novo = true;
    }
  } else {
    // Completa o que faltava — sem trocar o e-mail principal por conta
    // própria: o endereço antigo pode ser o que a pessoa de fato lê. O
    // da compra fica guardado na compra e em lead_emails.
    const patch: Record<string, unknown> = {};
    if (v.nome) patch.nome = v.nome;
    if (fone) patch.whatsapp = fone;
    if (doc && doc.length >= 11) patch.cpf = doc;
    if (Object.keys(patch).length) {
      await supabase.from("tabela_1_leads").update(patch).eq("lead_id", leadId);
    }
  }

  // 3) grava a compra. Sem código de transação, monta um estável a partir
  // do comprador + produto + data — assim o mesmo evento reenviado ainda
  // cai na mesma linha em vez de virar uma venda nova.
  const transacao = v.transacao ??
    `${v.origem}:${v.email ?? fone}:${v.produto}:${(v.quando ?? "").slice(0, 10)}`;

  // O evento de REEMBOLSO não traz forma de pagamento nem parcelas. Um
  // upsert cru gravaria nulo por cima do que a venda original já tinha —
  // o status ficaria certo e o resto da informação sumiria. Por isso o que
  // chega vazio preserva o que já estava lá.
  const { data: existente } = await supabase.from("tabela_4_alunos")
    .select("forma_de_pagamento, parcelas, data_compra, valor, nome_produto, evento_origem, status, email_compra, whatsapp_compra, documento")
    .eq("codigo_transacao", transacao).maybeSingle();

  // Pedido pago não volta a ser boleto à espera de pagamento. Os eventos
  // da Hotmart não chegam em ordem: um aviso de boleto que falhou é
  // reenviado minutos depois, já com a compra aprovada, e o upsert cru
  // rebaixava a venda para "pendente" — o comprador saía da lista de
  // compradores sem que nada denunciasse. Aconteceu com três compras do
  // Desafio entre 04 e 05/08/2026.
  //
  // Depois de aprovada, só reembolso, chargeback e cancelamento mudam o
  // estado. "Pendente" e "expirada" são passado, e passado não sobrescreve
  // presente.
  const rebaixaria = existente?.status === "aprovada" &&
    (v.status === "pendente" || v.status === "expirada");
  const statusFinal = rebaixaria ? "aprovada" : v.status;

  const { error } = await supabase.from("tabela_4_alunos").upsert({
    lead_fk: leadId,
    codigo_transacao: transacao,
    nome_produto: v.produto || existente?.nome_produto || "produto sem nome",
    valor: v.valor || existente?.valor || 0,
    moeda: v.moeda,
    forma_de_pagamento: v.pagamento ?? existente?.forma_de_pagamento ?? null,
    status: statusFinal,
    data_compra: rebaixaria
      ? existente?.data_compra
      : (v.quando ?? existente?.data_compra ?? new Date().toISOString()),
    parcelas: v.parcelas ?? existente?.parcelas ?? null,
    origem: v.origem,
    evento_origem: rebaixaria
      ? existente?.evento_origem
      : (v.evento ?? existente?.evento_origem ?? null),
    // Com quem ESTA compra falou. Quem compra com um endereço novo é
    // casado pelo WhatsApp com o cadastro antigo — a pessoa certa, e o
    // e-mail da compra se perdia. É para cá que vai a comunicação
    // deste produto.
    email_compra: v.email ?? existente?.email_compra ?? null,
    // e com qual número. Quem tem mais de um celular recebe o WhatsApp
    // deste produto no número com que comprou ESTE produto.
    whatsapp_compra: fone ?? existente?.whatsapp_compra ?? null,
    documento: doc ?? existente?.documento ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "codigo_transacao" });

  if (error) return await falhar(error.message, 500);

  // O endereço da compra passa a ser um e-mail conhecido da pessoa, sem
  // trocar o principal: o antigo pode ser o que ela de fato lê, e trocar
  // por conta própria é decisão de gente.
  if (v.email) {
    await supabase.rpc("registrar_email_do_lead", {
      p_lead: leadId, p_email: v.email, p_origem: "compra", p_nome: v.nome,
    });
  }
  if (fone) {
    await supabase.rpc("registrar_telefone_do_lead", {
      p_lead: leadId, p_whatsapp: fone, p_origem: "compra", p_nome: v.nome,
    });
  }

  // 4) tag opcional, para o disparo da automação de comprador
  if (v.status === "aprovada" && b.tag_id) {
    await supabase.from("lead_tags").upsert(
      { lead_fk: leadId, tag_fk: Number(b.tag_id) },
      { onConflict: "lead_fk,tag_fk", ignoreDuplicates: true });
  }
  if (v.status === "aprovada" && b.lista_id) {
    await supabase.from("lead_listas").upsert(
      { lead_fk: leadId, lista_fk: Number(b.lista_id), status: 1, source: "venda:" + v.origem },
      { onConflict: "lead_fk,lista_fk", ignoreDuplicates: true });
  }

  // 4b) as UTMs da venda viram campos do contato: dá para segmentar
  // depois por origem da compra sem precisar de outra ferramenta.
  if (Object.keys(v.utms).length) {
    const { data: atual } = await supabase.from("lead_atributos")
      .select("dados").eq("lead_fk", leadId).maybeSingle();
    const juntos = semLixo({ ...(atual?.dados ?? {}), ...v.utms });
    // abre xcod e sck em campos separados na hora: guardados comprimidos
    // eles nao servem para segmentar, e ninguem volta para arrumar depois
    const { data: abertos } = await supabase.rpc("extrair_atribuicao", { p_dados: juntos });
    await supabase.from("lead_atributos").upsert({
      lead_fk: leadId,
      dados: { ...juntos, ...((abertos as Record<string, string>) ?? {}) },
      updated_at: new Date().toISOString(),
    });
  }

  // 4c) se foi intencao e nao venda, gera o evento de recuperacao.
  // Só que um aviso de boleto atrasado, chegando depois da aprovação,
  // pediria recuperação de quem já pagou — cobrança de quem não deve.
  if (ehIntencaoDeCompra(evento) && !rebaixaria) {
    await supabase.rpc("registrar_intencao", {
      p_lead: leadId, p_evento: evento, p_produto: v.produto, p_valor: v.valor,
    });
  }

  // 5) o mapa de produtos: "comprou o Desafio" vira, sozinho, "entra na
  // lista de compradores do Desafio e ganha a tag". Produto novo é uma
  // linha na tela, não uma alteração de código.
  //
  // Só a APROVAÇÃO move automação. O aviso de fim de garantia chega dias
  // depois da compra e não repete este trabalho: a pessoa já entrou na
  // lista, já ganhou a tag e já foi marcada no ManyChat quando comprou.
  // A venda acima continua sendo atualizada — é o registro do dinheiro.
  const fimDeGarantia = ehFimDeGarantia(evento, b.data?.purchase?.status);

  // A turma sai da data da COMPRA, nunca da data de hoje. São a mesma
  // coisa quando o aviso chega em tempo real, e coisas muito diferentes
  // quando ele chega atrasado ou quando alguém reprocessa o histórico.
  const { data: mapa, error: mapaErro } = fimDeGarantia
    ? { data: { mapeado: false, motivo: "fim de garantia não move automação" }, error: null }
    : await supabase.rpc("aplicar_mapa_produto", {
      p_lead: leadId, p_produto: v.produto, p_status: v.status, p_ucode: v.ucode,
      p_quando: v.quando ?? existente?.data_compra ?? new Date().toISOString(),
    });

  // A venda já está gravada; o webhook responde ok. Mas se o mapa falhou,
  // o evento NÃO pode ganhar o carimbo de processado: sem o erro à vista
  // em hotmart_pendentes(), a esteira cala sem sujar log nenhum — três
  // dias de compras ficaram sem lista, turma e ManyChat em 08/2026 assim.
  if (registro) {
    await supabase.from("hotmart_eventos")
      .update(mapaErro
        ? { situacao: "erro", processado_em: new Date().toISOString(),
            erro: "venda gravada, mas aplicar_mapa_produto falhou: " + mapaErro.message }
        : { processado: true, situacao: "processado",
            processado_em: new Date().toISOString() })
      .eq("evento_id", registro);
  }

  return new Response(JSON.stringify({
    ok: true, lead_id: leadId, lead_novo: novo,
    produto: v.produto, status: v.status, transacao,
    mapa: mapa ?? { mapeado: false, ...(mapaErro ? { erro: mapaErro.message } : {}) },
  }), { headers: { ...cors, "Content-Type": "application/json" } });
});
