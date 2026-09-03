// Edge Function pública: formulários de captação (substitui os do AC).
//
//   GET  /formulario?f=slug   → devolve a página do formulário, pronta para
//                               usar como link ou dentro de um <iframe>
//   POST /formulario          → recebe o cadastro
//
// Segurança, em dois caminhos:
//   - com `form_slug`, a lista e a tag são lidas do BANCO, nunca do que
//     chegou na requisição — por isso esse caminho pode ser público;
//   - sem `form_slug` (a chamada por API), lista_id e tag_id vêm do corpo:
//     quem chama decide onde a pessoa entra, inclusive numa lista que
//     dispara automação com e-mail real. Esse caminho exige a chave
//     `formulario_api_key` do cofre (public.segredos), no cabeçalho
//     `x-api-key` ou no campo `api_key` do corpo.
import { createClient } from "npm:@supabase/supabase-js@2";
import { selecionarPassosManyChatImediatos } from "./imediato.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(
  supabaseUrl,
  serviceRoleKey,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Campo = { campo: string; rotulo: string; obrigatorio?: boolean; tipo?: string };

// Quando a página monta a URL com uma variável vazia, o parâmetro chega como
// a STRING "undefined" — quatro contatos guardaram isso no xcod. Não informa
// nada e ainda suja a ficha de quem abre o contato.
function semLixo(dados: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dados).filter(([, v]) =>
    !(typeof v === "string" && ["undefined", "null"].includes(v.trim().toLowerCase()))));
}

function normWhatsapp(p: string | null | undefined): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length < 10) return null;
  const resto = d.startsWith("55") ? d.slice(2) : d;
  if (new Set(resto.split("")).size <= 1) return null; // número fake
  return d;
}

async function aplicarManyChatImediato(
  listaId: number,
  lead: { leadId: string; email: string; nome: string | null; whatsapp: string | null },
): Promise<{ ok: true; aplicadas: number } | { ok: false; erro: string }> {
  const { data: automacoes, error: erroAutomacoes } = await supabase
    .from("automacoes")
    .select("automacao_id, ativa, gatilho")
    .eq("ativa", true);
  if (erroAutomacoes) return { ok: false, erro: erroAutomacoes.message };
  if (!automacoes?.length) return { ok: true, aplicadas: 0 };

  const ids = automacoes.map((automacao) => automacao.automacao_id);
  const { data: passos, error: erroPassos } = await supabase
    .from("automacao_passos")
    .select("automacao_fk, ordem, tipo, config")
    .in("automacao_fk", ids);
  if (erroPassos) return { ok: false, erro: erroPassos.message };

  const imediatos = selecionarPassosManyChatImediatos(
    listaId,
    automacoes,
    passos ?? [],
  );

  const chamadas = new Set<string>();
  for (const passo of imediatos) {
    const chave = `${passo.tag}\u0000${passo.criar}`;
    if (chamadas.has(chave)) continue;
    chamadas.add(chave);

    const resposta = await fetch(`${supabaseUrl}/functions/v1/manychat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        lead_id: lead.leadId,
        email: lead.email,
        nome: lead.nome,
        whatsapp: lead.whatsapp,
        tag: passo.tag,
        criar: passo.criar,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok || dados?.ok !== true) {
      return {
        ok: false,
        erro: String(dados?.erro ?? dados?.motivo ?? "o ManyChat não confirmou a operação"),
      };
    }
  }

  // O passo ManyChat já terminou. A execução só entra no motor se houver
  // algo depois dele; fluxos de um passo ficam concluídos agora mesmo.
  const agora = new Date().toISOString();
  const execucoes = imediatos.map((passo) => passo.proximoPasso == null ? {
    automacao_fk: passo.automacaoId,
    lead_fk: lead.leadId,
    passo_atual: passo.passoManyChat + 1,
    status: "concluida",
    agendado_para: agora,
    finalizado_em: agora,
    contexto: { manychat_imediato: true },
  } : {
    automacao_fk: passo.automacaoId,
    lead_fk: lead.leadId,
    passo_atual: passo.proximoPasso,
    status: "em_andamento",
    agendado_para: agora,
    contexto: { manychat_imediato: true },
  });
  if (execucoes.length) {
    const { error } = await supabase.from("automacao_execucoes").insert(execucoes);
    if (error) console.error("ManyChat confirmado; histórico da automação falhou:", error.message);
  }

  return { ok: true, aplicadas: imediatos.length };
}

const escapar = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function paginaDoFormulario(f: Record<string, any>, base: string): string {
  const campos = (f.campos as Campo[] ?? []).map((c) => {
    const tipo = c.campo === "email" ? "email" : c.campo === "whatsapp" ? "tel" : "text";
    const nome = ["nome", "email", "whatsapp"].includes(c.campo) ? c.campo : `atr_${c.campo}`;
    return `<label>${escapar(c.rotulo)}${c.obrigatorio ? ' <span aria-hidden="true">*</span>' : ""}
      <input type="${tipo}" name="${escapar(nome)}" ${c.obrigatorio ? "required" : ""}
             autocomplete="${c.campo === "email" ? "email" : c.campo === "nome" ? "name" : "tel"}" /></label>`;
  }).join("\n");

  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(f.titulo || f.nome)}</title>
<style>
  :root { --cor: ${escapar(f.cor || "#6b4ea8")}; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px; background:#f4f1ec; color:#241f2e;
         font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
  .caixa { max-width:460px; margin:0 auto; background:#fff; border-radius:14px;
           padding:28px 24px; box-shadow:0 2px 14px rgba(36,10,52,.08); }
  h1 { font-size:22px; line-height:1.3; margin:0 0 8px; }
  p.sub { margin:0 0 22px; color:#6b6577; font-size:15px; line-height:1.55; }
  label { display:block; font-size:13px; font-weight:600; color:#4a4458; margin:0 0 14px; }
  input { width:100%; margin-top:5px; padding:12px 13px; font-size:16px;
          border:1px solid #ddd7e6; border-radius:9px; background:#fff; color:inherit; }
  input:focus { outline:2px solid var(--cor); outline-offset:1px; border-color:var(--cor); }
  button { width:100%; margin-top:6px; padding:14px; font-size:16px; font-weight:700;
           color:#fff; background:var(--cor); border:0; border-radius:9px; cursor:pointer; }
  button:disabled { opacity:.6; cursor:progress; }
  .ok { text-align:center; padding:18px 0; font-size:17px; line-height:1.5; }
  .erro { color:#b3261e; font-size:14px; margin-top:10px; min-height:20px; }
  .rodape { text-align:center; margin-top:18px; font-size:12px; color:#8a8496; }
  @media (prefers-color-scheme: dark) {
    body { background:#141018; color:#eee9f3; }
    .caixa { background:#1e1926; box-shadow:none; }
    p.sub { color:#a49db3; } label { color:#c8c1d6; }
    input { background:#171320; border-color:#39304a; color:#eee9f3; }
  }
</style></head><body>
<div class="caixa" id="caixa">
  <h1>${escapar(f.titulo || f.nome)}</h1>
  ${f.subtitulo ? `<p class="sub">${escapar(f.subtitulo)}</p>` : ""}
  <form id="f" novalidate>
    ${campos}
    <button type="submit" id="b">${escapar(f.botao)}</button>
    <div class="erro" id="e"></div>
  </form>
  <div class="rodape">Seus dados não são compartilhados. Você pode sair quando quiser.</div>
</div>
<script>
const slug = ${JSON.stringify(f.slug)};
const sucesso = ${JSON.stringify(f.sucesso)};
const destino = ${JSON.stringify(f.redirecionar || null)};
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const b = document.getElementById('b'), e = document.getElementById('e');
  e.textContent = ''; b.disabled = true;
  const dados = { form_slug: slug, atributos: {} };
  for (const [k, v] of new FormData(ev.target).entries()) {
    if (k.startsWith('atr_')) dados.atributos[k.slice(4)] = v; else dados[k] = v;
  }
  try {
    const r = await fetch(${JSON.stringify(base)}, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || 'Não deu certo. Tente de novo.');
    if (destino) { location.href = destino; return; }
    document.getElementById('caixa').innerHTML =
      '<div class="ok">' + sucesso.replace(/</g,'&lt;') + '</div>';
  } catch (err) {
    e.textContent = err.message; b.disabled = false;
  }
});
</script></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);

  // ---------- servir a página ----------
  if (req.method === "GET") {
    const slug = url.searchParams.get("f");
    if (!slug) return new Response("informe ?f=slug", { status: 400, headers: cors });
    const { data: f } = await supabase.from("formularios")
      .select("*").eq("slug", slug).eq("ativo", true).maybeSingle();
    if (!f) return new Response("formulário não encontrado", { status: 404, headers: cors });
    return new Response(paginaDoFormulario(f, url.origin + url.pathname), {
      headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (req.method !== "POST") return new Response("método inválido", { status: 405, headers: cors });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    const form = await req.formData().catch(() => null);
    if (!form) return new Response(JSON.stringify({ erro: "corpo inválido" }), { status: 400, headers: cors });
    body = Object.fromEntries(form.entries());
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return new Response(JSON.stringify({ erro: "Confira o e-mail digitado." }), { status: 400, headers: cors });
  }
  const nome = body.nome ? String(body.nome).trim() : null;
  const whatsapp = normWhatsapp(body.whatsapp as string | undefined);

  // destino: com slug, manda o banco. Sem slug, é a chamada por API.
  let listaId = body.lista_id ? Number(body.lista_id) : null;
  let tagId = body.tag_id ? Number(body.tag_id) : null;
  let redirect = body.redirect ? String(body.redirect) : null;
  const slug = body.form_slug ? String(body.form_slug) : null;

  if (slug) {
    const { data: f } = await supabase.from("formularios")
      .select("formulario_id, lista_fk, tag_fk, redirecionar, ativo")
      .eq("slug", slug).maybeSingle();
    if (!f || !f.ativo) {
      return new Response(JSON.stringify({ erro: "formulário indisponível" }), { status: 404, headers: cors });
    }
    listaId = f.lista_fk;
    tagId = f.tag_fk;
    redirect = f.redirecionar ?? null;
    await supabase.rpc("incrementar_envios_formulario", { p_slug: slug }).then(() => {}, () => {});
  } else {
    // Chamada por API: só passa com a chave do cofre — trocável na tela de
    // Configurações, sem redeploy. Sem chave guardada, o caminho fica
    // fechado de propósito: trava que falha aberta é enfeite.
    const { data: seg } = await supabase.from("segredos")
      .select("valor").eq("chave", "formulario_api_key").maybeSingle();
    const esperada = (seg?.valor ?? "").trim();
    const recebida = (req.headers.get("x-api-key") ?? String(body.api_key ?? "")).trim();
    if (!esperada) {
      return new Response(JSON.stringify({ erro: "chamada por API desligada: nenhuma chave configurada" }),
        { status: 503, headers: cors });
    }
    if (recebida !== esperada) {
      return new Response(JSON.stringify({ erro: "chave da API ausente ou incorreta" }),
        { status: 401, headers: cors });
    }
  }

  // 1) localiza por whatsapp, depois por e-mail
  let leadId: string | null = null;
  if (whatsapp) {
    const { data } = await supabase.from("tabela_1_leads")
      .select("lead_id").eq("whatsapp", whatsapp).maybeSingle();
    if (data) leadId = data.lead_id;
  }
  if (!leadId) {
    const { data } = await supabase.from("tabela_1_leads")
      .select("lead_id").ilike("email", email).maybeSingle();
    if (data) leadId = data.lead_id;
  }

  // 2) cria ou atualiza
  if (!leadId) {
    const { data, error } = await supabase.from("tabela_1_leads")
      .insert({ email, nome, whatsapp }).select("lead_id").single();
    if (error) return new Response(JSON.stringify({ erro: error.message }), { status: 500, headers: cors });
    leadId = data.lead_id;
  } else {
    const patch: Record<string, unknown> = {};
    if (nome) patch.nome = nome;
    if (whatsapp) patch.whatsapp = whatsapp;
    if (Object.keys(patch).length) {
      await supabase.from("tabela_1_leads").update(patch).eq("lead_id", leadId);
    }
  }

  // 3) lista, tag e campos (os triggers do banco disparam as automações)
  if (!leadId) {
    return new Response(JSON.stringify({ erro: "não foi possível identificar o cadastro" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (listaId) {
    await supabase.from("lead_listas").upsert(
      { lead_fk: leadId, lista_fk: listaId, status: 1, source: "form:" + (slug ?? "api") },
      { onConflict: "lead_fk,lista_fk", ignoreDuplicates: true });
  }
  if (tagId) {
    await supabase.from("lead_tags").upsert(
      { lead_fk: leadId, tag_fk: tagId },
      { onConflict: "lead_fk,tag_fk", ignoreDuplicates: true });
  }
  if (body.atributos && typeof body.atributos === "object" &&
      Object.keys(body.atributos as object).length) {
    const { data: atual } = await supabase.from("lead_atributos")
      .select("dados").eq("lead_fk", leadId).maybeSingle();
    const juntos = semLixo({ ...(atual?.dados ?? {}), ...(body.atributos as object) });
    // mesma abertura de origem que a venda faz: assim o lead já nasce com
    // origem identificada, e a taxa de conversão passa a ter denominador
    const { data: abertos } = await supabase.rpc("extrair_atribuicao", { p_dados: juntos });
    await supabase.from("lead_atributos").upsert({
      lead_fk: leadId,
      dados: { ...juntos, ...((abertos as Record<string, string>) ?? {}) },
      updated_at: new Date().toISOString(),
    });
  }

  // Uma automação composta exclusivamente por manychat_tag roda dentro
  // desta mesma requisição. Primeiro preservamos todos os dados na Ressoar;
  // depois esperamos a confirmação externa. O cron fica só como retentativa.
  if (listaId) {
    const manychat = await aplicarManyChatImediato(listaId, {
      leadId, email, nome, whatsapp,
    });
    if (!manychat.ok) {
      return new Response(JSON.stringify({
        erro: "Cadastro recebido na Ressoar, mas o ManyChat não confirmou: " + manychat.erro,
        lead_id: leadId,
      }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }
  }

  if (redirect && /^https?:\/\//.test(redirect)) return Response.redirect(redirect, 302);
  return new Response(JSON.stringify({ ok: true, lead_id: leadId }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
