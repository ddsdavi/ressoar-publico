// Ponte com o ManyChat.
//
// A pessoa é encontrada por um CAMPO PERSONALIZADO que guarda o WhatsApp
// dela — não por campo de sistema. Isso não é preferência: numa conta que
// recebe gente pelo WhatsApp e pelo Instagram, "email" e "phone" chegam
// vazios, e findBySystemField não acha ninguém. O número de verdade fica
// num campo personalizado (aqui chamado WHATSAPP-ID), preenchido por uma
// automação do próprio ManyChat quando a pessoa entra.
//
// O id desse campo muda de conta para conta, então vive em app_config
// (manychat_campo_whatsapp), não no código.
//
// Duas coisas que custaram depuração:
//   - "data" vem como LISTA nas buscas. Ler data.id devolve undefined
//     mesmo quando encontrou.
//   - addTagByName NÃO cria a tag: responde "Tag does not exist" e não faz
//     nada. É preciso criar antes com /page/createTag.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

const MC = "https://api.manychat.com/fb";

type Corpo = {
  lead_id?: string; manychat_id?: string; email?: string; nome?: string;
  whatsapp?: string; tag?: string; tag_id?: number; criar?: boolean;
  subscriber_id?: string | number; registrar?: boolean;
  // operações avulsas usadas pela tela (banidos_verificar também vem do cron)
  acao?: "tags" | "criar_tag" | "excluir_tag" | "procurar" | "criar" | "desmarcar"
       | "banidos_verificar";
};

// ---------------------------------------------------------------------
// Formatação do telefone
// ---------------------------------------------------------------------
// O ManyChat guarda o número num formato só, e a busca é exata: um dígito
// de diferença e a pessoa "não existe". As regras abaixo são as mesmas do
// n8n que já roda em produção — vale mantê-las iguais, porque números
// gravados por lá precisam ser encontrados por aqui.
// DDI 55 x DDD 55: Santa Maria/RS tem o mesmo par de dígitos do código do
// Brasil, e as regras abaixo olham justamente os dois primeiros. O que
// salva é a decisão não sair do prefixo sozinho — ela sai do dígito que vem
// DEPOIS do DDD presumido, junto com o comprimento. Não troque isto por um
// startsWith("55") isolado: 555533334444 voltaria a virar celular.
export function formatarTelefone(bruto: string): string {
  let n = String(bruto ?? "").replace(/\D+/g, "");
  if (!n) return "";

  // (051) — o zero do DDD não faz parte do número
  if ((n.length === 11 || n.length === 12) && n[0] === "0") n = n.slice(1);

  // Celular brasileiro completo. Desde 2017 TODO celular do país tem o
  // nono dígito, e ele é sempre 9 — não existe DDD sem. Treze dígitos sem
  // esse 9 não é estrangeiro, é número torto.
  if (n.length === 13 && n.startsWith("55")) return n[4] === "9" ? n : "";

  // Doze dígitos com DDI: fixo ou celular de antes de 2017. Quem decide é
  // o primeiro dígito depois do DDD — fixo começa em 2,3,4,5; celular, em
  // 6,7,8,9. Enfiar um 9 num fixo inventa o número de outra pessoa.
  if (n.length === 12 && n.startsWith("55")) {
    return "2345".includes(n[4]) ? "" : n.slice(0, 4) + "9" + n.slice(4);
  }

  // estrangeiro já com DDI
  if (n.length >= 12) return n;

  // celular brasileiro sem o DDI
  if (n.length === 11 && n[2] === "9") return "55" + n;

  // 11 dígitos sem esse 9: estrangeiro (EUA, por exemplo)
  if (n.length === 11) return n;

  // dez dígitos, sem DDI: mesma pergunta do fixo
  if (n.length === 10) {
    return "2345".includes(n[2]) ? "" : "55" + n.slice(0, 2) + "9" + n.slice(2);
  }

  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const base = Deno.env.get("SUPABASE_URL")!;
  const cab = { "Content-Type": "application/json", apikey: chave,
                Authorization: `Bearer ${chave}` };

  const seg = await (await fetch(
    `${base}/rest/v1/segredos?chave=in.(manychat_api_key,service_key)&select=chave,valor`,
    { headers: cab })).json();
  const token = (seg ?? []).find((s: { chave: string }) => s.chave === "manychat_api_key")?.valor;
  // A chave de serviço tem DUAS gerações neste projeto: o env da função
  // (sb_secret_…) e o JWT guardado em segredos.service_key, que é o que o
  // pg_cron manda. Aceitar só uma delas já rendeu 403 silencioso na função
  // de planilhas — as duas valem.
  const chaveServicoDb = (seg ?? []).find((s: { chave: string }) => s.chave === "service_key")?.valor ?? "";

  const cfg = await (await fetch(
    `${base}/rest/v1/app_config?chave=like.manychat*&select=chave,valor`,
    { headers: cab })).json();
  const conf = Object.fromEntries(
    (cfg ?? []).map((r: { chave: string; valor: string }) => [r.chave, r.valor ?? ""]));
  const campoWhats = conf.manychat_campo_whatsapp ?? "";

  // ---- banimento ----
  // Números que NUNCA recebem tag. A lista mora em manychat_banidos; a
  // tag de último recurso (ESC WHATSAPP) em app_config. Ver banimento_v1.sql.
  const tagEsc = Number(conf.manychat_tag_esc ?? "0") || 0;
  const banidos = await (await fetch(
    `${base}/rest/v1/manychat_banidos?select=whatsapp,manychat_id,nome`,
    { headers: cab })).json().catch(() => []) as
    { whatsapp: string; manychat_id: string | null; nome: string | null }[];
  const banidoPorFone = (f: string) =>
    !!f && banidos.some((b) => b.whatsapp === f);
  const banidoPorId = (id: string | number | null | undefined) =>
    id != null && String(id) !== "" && banidos.some((b) => b.manychat_id === String(id));

  // As operações destrutivas e a criação manual de contatos só existem na
  // área de admin do painel. A chave anon do frontend é pública, então não
  // basta confiar na rota React: o servidor confere o usuário e o papel.
  const usuarioEhAdmin = async () => {
    const auth = req.headers.get("Authorization") ?? "";
    const tokenUsuario = auth.replace(/^Bearer\s+/i, "").trim();
    if (!tokenUsuario || tokenUsuario === chave) return false;

    const rUsuario = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: chave, Authorization: `Bearer ${tokenUsuario}` },
    });
    if (!rUsuario.ok) return false;
    const usuario = await rUsuario.json();
    if (!usuario?.id) return false;

    const rPerfil = await fetch(
      `${base}/rest/v1/usuarios_ressoar?user_id=eq.${encodeURIComponent(usuario.id)}` +
      `&select=papel,status&limit=1`,
      { headers: cab },
    );
    const perfis = await rPerfil.json();
    return perfis?.[0]?.papel === "admin" && perfis?.[0]?.status === "aprovado";
  };


  const anotar = async (lead: string | undefined, acao: string, tag: string,
                        ok: boolean, detalhe: string) => {
    await fetch(`${base}/rest/v1/manychat_log`, {
      method: "POST", headers: { ...cab, Prefer: "return=minimal" },
      body: JSON.stringify({ lead_fk: lead ?? null, acao, tag, sucesso: ok, detalhe,
                             simulado: false }),
    });
  };

  if (!token) {
    return new Response(JSON.stringify({ erro: "chave do ManyChat não configurada" }),
                        { status: 400, headers: CORS });
  }

  const mc = async (caminho: string, metodo = "GET", corpo?: unknown) => {
    const r = await fetch(`${MC}${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const texto = await r.text();
    let dados: Record<string, unknown> = {};
    try { dados = JSON.parse(texto); } catch { dados = { bruto: texto.slice(0, 300) }; }
    return { ok: r.ok, status: r.status, dados };
  };

  // "data" é lista nas buscas e objeto na criação — aceita os dois
  const primeiro = (d: unknown): number | null => {
    const dados = (d as { data?: unknown })?.data;
    if (Array.isArray(dados)) {
      return dados.length ? Number((dados[0] as { id: number }).id) : null;
    }
    const um = dados as { id?: number } | undefined;
    return um?.id ? Number(um.id) : null;
  };

  // A escada do banimento, na ordem ditada pelo dono: excluir → cancelar a
  // inscrição → tag ESC WHATSAPP. A API pública não tem exclusão (medido:
  // 404), então ela fica apontada para fazer à mão; o descadastro é melhor
  // esforço (a API só escreve opt-in de SMS/e-mail); a tag é a garantia.
  const aplicarEscada = async (id: number): Promise<string> => {
    const acoes: string[] = ["exclusão indisponível na API (fazer à mão)"];
    const info = await mc(`/subscriber/getInfo?subscriber_id=${id}`);
    const dd = (info.dados as { data?: Record<string, unknown> })?.data ?? {};
    const status = String(dd.status ?? "");
    const tagsAtuais = ((dd.tags ?? []) as { id: number }[]).map((t) => Number(t.id));

    if (status === "unsubscribed") {
      acoes.push("já descadastrado");
    } else {
      const r = await mc("/subscriber/updateSubscriber", "POST", {
        subscriber_id: id, has_opt_in_sms: false, has_opt_in_email: false });
      acoes.push(r.ok ? "opt-ins de SMS/e-mail derrubados" : "descadastro recusado pela API");
    }

    if (!tagEsc) {
      acoes.push("SEM tag ESC configurada (manychat_tag_esc)");
    } else if (tagsAtuais.includes(tagEsc)) {
      acoes.push("tag ESC já presente");
    } else {
      const r = await mc("/subscriber/addTag", "POST", { subscriber_id: id, tag_id: tagEsc });
      acoes.push(r.ok ? "tag ESC aplicada"
                      : "tag ESC falhou: " + JSON.stringify(r.dados).slice(0, 120));
    }
    return acoes.join("; ");
  };

  // Procura um banido lá pelos mesmos caminhos da marcação: id guardado,
  // campo personalizado do WhatsApp, campo de sistema.
  const acharBanido = async (b: { whatsapp: string; manychat_id: string | null }) => {
    let id: number | null = b.manychat_id ? Number(b.manychat_id) : null;
    if (!id && campoWhats) {
      id = primeiro((await mc(
        `/subscriber/findByCustomField?field_id=${encodeURIComponent(campoWhats)}` +
        `&field_value=${encodeURIComponent(b.whatsapp)}`)).dados);
    }
    if (!id) {
      id = primeiro((await mc(
        `/subscriber/findBySystemField?phone=${encodeURIComponent(b.whatsapp)}`)).dados);
    }
    return id;
  };

  const gravarVigilancia = async (whatsapp: string, id: number | null, acao: string) => {
    await fetch(`${base}/rest/v1/manychat_banidos?whatsapp=eq.${encodeURIComponent(whatsapp)}`, {
      method: "PATCH", headers: { ...cab, Prefer: "return=minimal" },
      body: JSON.stringify({
        manychat_id: id ? String(id) : undefined,
        ultima_verificacao: new Date().toISOString(),
        ultima_acao: acao,
      }),
    });
  };

  const u = new URL(req.url);

  // ---- conferir a chave (botão "testar" do painel) ----
  if (req.method === "GET" || u.searchParams.get("acao") === "testar") {
    const r = await mc("/page/getTags");
    const tags = (r.dados as { data?: { name: string }[] })?.data ?? [];
    return new Response(JSON.stringify({
      ok: r.ok,
      mensagem: r.ok
        ? `chave válida — ${tags.length} tag(s) na conta` +
          (campoWhats ? "" : ". Falta informar o campo do WhatsApp em Configurações.")
        : "chave recusada pelo ManyChat",
      campo_whatsapp: campoWhats || null,
      tags: tags.map((t) => t.name).slice(0, 50),
    }), { status: r.ok ? 200 : 400, headers: CORS });
  }

  const c = (await req.json().catch(() => ({}))) as Corpo;

  // ---- operações avulsas, para a tela do painel ----
  //
  // São as mesmas chamadas que a automação faz, só que uma de cada vez e
  // com a resposta crua. É o que permite conferir antes de ligar um fluxo
  // que vai mandar WhatsApp para gente de verdade.
  if (c.acao) {
    const fone = formatarTelefone(c.whatsapp ?? "");

    // ---- a vigilância dos banidos (cron de 10 em 10 min, ou o botão) ----
    if (c.acao === "banidos_verificar") {
      const autor = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      const ehMotor = autor === chave || (chaveServicoDb !== "" && autor === chaveServicoDb);
      if (!ehMotor && !(await usuarioEhAdmin())) {
        return new Response(JSON.stringify({ ok: false, erro: "somente o motor ou um admin" }),
                            { status: 403, headers: CORS });
      }
      const resultados: { whatsapp: string; nome: string | null; acao: string }[] = [];
      for (const b of banidos) {
        const id = await acharBanido(b);
        const acao = id
          ? `assinante ${id}: ` + await aplicarEscada(id)
          : "não encontrado no ManyChat";
        await gravarVigilancia(b.whatsapp, id, acao);
        if (id) {
          await anotar(undefined, "banido vigiado", "ESC WHATSAPP", true,
                       `${b.whatsapp} → ${acao}`.slice(0, 400));
        }
        resultados.push({ whatsapp: b.whatsapp, nome: b.nome, acao });
      }
      return new Response(JSON.stringify({ ok: true, verificados: resultados.length, resultados }),
                          { headers: CORS });
    }

    if (c.acao === "tags") {
      const r = await mc("/page/getTags");
      const tags = ((r.dados as { data?: { id: number; name: string }[] })?.data ?? [])
        .sort((a, b) => a.name.localeCompare(b.name));
      return new Response(JSON.stringify({ ok: r.ok, tags }), { headers: CORS });
    }

    if (c.acao === "criar_tag") {
      const nome = (c.tag ?? "").trim();
      if (!nome) {
        return new Response(JSON.stringify({ ok: false, erro: "informe o nome da tag" }),
                            { status: 400, headers: CORS });
      }
      const r = await mc("/page/createTag", "POST", { name: nome });
      const jaExiste = JSON.stringify(r.dados).includes("already exist");
      return new Response(JSON.stringify({
        ok: r.ok || jaExiste,
        mensagem: r.ok ? `tag "${nome}" criada` : jaExiste ? `"${nome}" já existia` : "não deu para criar",
        detalhe: r.ok || jaExiste ? undefined : r.dados,
      }), { headers: CORS });
    }

    if (c.acao === "excluir_tag") {
      if (!(await usuarioEhAdmin())) {
        return new Response(JSON.stringify({ ok: false, erro: "somente admin pode excluir tag" }),
                            { status: 403, headers: CORS });
      }

      const tagId = Number(c.tag_id);
      if (!Number.isInteger(tagId) || tagId <= 0) {
        return new Response(JSON.stringify({ ok: false, erro: "tag inválida" }),
                            { status: 400, headers: CORS });
      }

      // Confere novamente o id e o nome imediatamente antes de apagar. Isso
      // impede que uma lista antiga da tela exclua outra tag por engano.
      const lista = await mc("/page/getTags");
      const tags = ((lista.dados as { data?: { id: number; name: string }[] })?.data ?? []);
      const atual = tags.find((t) => Number(t.id) === tagId);
      if (!atual) {
        return new Response(JSON.stringify({ ok: false, erro: "tag não existe mais" }),
                            { status: 404, headers: CORS });
      }
      if ((c.tag ?? "").trim() !== atual.name) {
        return new Response(JSON.stringify({ ok: false, erro: "a tag mudou; atualize a lista" }),
                            { status: 409, headers: CORS });
      }

      const r = await mc("/page/removeTag", "POST", { tag_id: tagId });
      await anotar(undefined, "apagou tag da conta", atual.name, r.ok,
                   JSON.stringify(r.dados).slice(0, 300));
      return new Response(JSON.stringify({
        ok: r.ok,
        mensagem: r.ok ? `tag "${atual.name}" excluída` : undefined,
        detalhe: r.ok ? undefined : r.dados,
      }), { status: r.ok ? 200 : 400, headers: CORS });
    }

    if (c.acao === "procurar") {
      if (!fone) {
        return new Response(JSON.stringify({ ok: false, erro: "telefone inválido", formatado: null }),
                            { status: 400, headers: CORS });
      }
      if (!campoWhats) {
        return new Response(JSON.stringify({ ok: false, erro: "falta o id do campo do WhatsApp" }),
                            { status: 400, headers: CORS });
      }
      const r = await mc(
        `/subscriber/findByCustomField?field_id=${encodeURIComponent(campoWhats)}` +
        `&field_value=${encodeURIComponent(fone)}`);
      if (!r.ok) {
        return new Response(JSON.stringify({
          ok: false, erro: "não deu para consultar o ManyChat", detalhe: r.dados,
        }), { status: 400, headers: CORS });
      }
      const achados = ((r.dados as { data?: Record<string, unknown>[] })?.data ?? []);
      const p = achados[0];
      return new Response(JSON.stringify({
        ok: true, formatado: fone, existe: !!p,
        assinante: p ? {
          id: p.id, nome: p.name, status: p.status,
          whatsapp: p.whatsapp_phone,
          tags: ((p.tags ?? []) as { name: string }[]).map((t) => t.name),
        } : null,
      }), { headers: CORS });
    }

    if (c.acao === "criar") {
      if (!(await usuarioEhAdmin())) {
        return new Response(JSON.stringify({ ok: false, erro: "somente admin pode criar usuário" }),
                            { status: 403, headers: CORS });
      }
      if (fone && banidoPorFone(fone)) {
        await anotar(c.lead_id, "bloqueado", "", true,
                     "número banido do ManyChat — criação recusada");
        return new Response(JSON.stringify({ ok: false, erro: "esse número está banido do ManyChat" }),
                            { status: 403, headers: CORS });
      }
      if (!fone) {
        return new Response(JSON.stringify({ ok: false, erro: "sem WhatsApp válido não dá para criar" }),
                            { status: 400, headers: CORS });
      }
      if (!campoWhats) {
        return new Response(JSON.stringify({ ok: false, erro: "falta o id do campo do WhatsApp" }),
                            { status: 400, headers: CORS });
      }
      if (!(c.nome ?? "").trim()) {
        return new Response(JSON.stringify({ ok: false, erro: "informe o nome do usuário" }),
                            { status: 400, headers: CORS });
      }

      const existente = await mc(
        `/subscriber/findByCustomField?field_id=${encodeURIComponent(campoWhats)}` +
        `&field_value=${encodeURIComponent(fone)}`);
      if (!existente.ok) {
        return new Response(JSON.stringify({
          ok: false, erro: "não deu para conferir se o WhatsApp já existe", detalhe: existente.dados,
        }), { status: 400, headers: CORS });
      }
      const idExistente = primeiro(existente.dados);
      if (idExistente) {
        return new Response(JSON.stringify({
          ok: true, criado: false, assinante: idExistente, formatado: fone,
          mensagem: "esse WhatsApp já existe no ManyChat",
        }), { headers: CORS });
      }

      const partes = (c.nome ?? "").trim().split(/\s+/);
      const r = await mc("/subscriber/createSubscriber", "POST", {
        first_name: partes[0] || "Contato",
        last_name: partes.slice(1).join(" ") || "",
        whatsapp_phone: fone,
        has_opt_in_sms: true,
        has_opt_in_email: true,
        consent_phrase: "cadastro vindo da Ressoar",
      });
      const id = primeiro(r.dados);
      let campoLigado = false;
      let detalheCampo: unknown;
      if (id) {
        const ligacao = await mc("/subscriber/setCustomField", "POST", {
          subscriber_id: id,
          field_id: Number(campoWhats),
          field_value: fone,
        });
        campoLigado = ligacao.ok;
        detalheCampo = ligacao.dados;
      }
      await anotar(c.lead_id, "criou pela tela", "", !!id,
                   id ? `assinante ${id}` : JSON.stringify(r.dados).slice(0, 300));
      return new Response(JSON.stringify({
        ok: !!id && campoLigado, criado: !!id, assinante: id, formatado: fone,
        detalhe: !id ? r.dados : campoLigado ? undefined : detalheCampo,
        erro: id && !campoLigado ? "usuário criado, mas não deu para ligar o campo do WhatsApp" : undefined,
      }), { status: id && campoLigado ? 200 : 400, headers: CORS });
    }

    if (c.acao === "desmarcar") {
      const r = await mc("/subscriber/removeTagByName", "POST",
                         { subscriber_id: Number(c.manychat_id), tag_name: c.tag });
      await anotar(c.lead_id, "desmarcou", c.tag ?? "", r.ok, JSON.stringify(r.dados).slice(0, 200));
      return new Response(JSON.stringify({ ok: r.ok, detalhe: r.ok ? undefined : r.dados }),
                          { headers: CORS });
    }

    return new Response(JSON.stringify({ erro: "ação desconhecida: " + c.acao }),
                        { status: 400, headers: CORS });
  }

  // ---- o ManyChat nos apresentando alguém (ação External Request) ----
  if (c.subscriber_id || c.registrar) {
    // Banido apareceu lá sozinho (mandou mensagem, foi criado por fora):
    // não registra na Ressoar e trata na hora, sem esperar o cron.
    const foneReg = formatarTelefone(c.whatsapp ?? "");
    const banidoReg = banidos.find((b) =>
      (foneReg && b.whatsapp === foneReg) ||
      (c.subscriber_id != null && b.manychat_id === String(c.subscriber_id)));
    if (banidoReg || banidoPorFone(foneReg)) {
      const alvo = banidoReg ?? banidos.find((b) => b.whatsapp === foneReg)!;
      const id = c.subscriber_id ? Number(c.subscriber_id) : await acharBanido(alvo);
      const acao = id ? `assinante ${id}: ` + await aplicarEscada(id)
                      : "não encontrado no ManyChat";
      await gravarVigilancia(alvo.whatsapp, id ?? null, acao);
      await anotar(undefined, "banido vigiado", "ESC WHATSAPP", true,
                   `${alvo.whatsapp} apareceu pelo External Request → ${acao}`.slice(0, 400));
      return new Response(JSON.stringify({ ok: false, motivo: "número banido" }),
                          { headers: CORS });
    }
    const r = await fetch(`${base}/rest/v1/rpc/manychat_registrar`, {
      method: "POST", headers: cab,
      body: JSON.stringify({
        p_manychat_id: String(c.subscriber_id ?? ""),
        p_email: c.email ?? null,
        p_whatsapp: c.whatsapp ?? null,
        p_nome: c.nome ?? null,
      }),
    });
    const d = await r.json();
    await anotar(d?.lead, "registrou", "", !!d?.ok, JSON.stringify(d).slice(0, 300));
    return new Response(JSON.stringify(d), { status: r.ok ? 200 : 400, headers: CORS });
  }

  if (!c.tag) {
    return new Response(JSON.stringify({ erro: "informe a tag" }), { status: 400, headers: CORS });
  }

  const fone = formatarTelefone(c.whatsapp ?? "");

  // Banido não recebe tag nenhuma — nem é criado. O motor já barra antes
  // (manychat_aplicar), mas a tela e chamadas diretas chegam aqui sem
  // passar por lá; a trava se repete de propósito.
  if (banidoPorFone(fone) || banidoPorId(c.manychat_id)) {
    await anotar(c.lead_id, "bloqueado", c.tag, true,
                 "número banido do ManyChat — nenhuma tag é aplicada");
    return new Response(JSON.stringify({ ok: false, motivo: "número banido" }),
                        { headers: CORS });
  }

  // ---- 1. achar ----
  let id: number | null = c.manychat_id ? Number(c.manychat_id) : null;
  let como = id ? "id guardado" : "";

  if (!id && campoWhats && fone) {
    id = primeiro((await mc(
      `/subscriber/findByCustomField?field_id=${encodeURIComponent(campoWhats)}` +
      `&field_value=${encodeURIComponent(fone)}`)).dados);
    if (id) como = "campo do WhatsApp";
  }

  // último recurso, e quase sempre em vão nesta conta: campo de sistema
  if (!id && c.email) {
    id = primeiro((await mc(
      `/subscriber/findBySystemField?email=${encodeURIComponent(c.email)}`)).dados);
    if (id) como = "e-mail";
  }

  // Quem entrou no ManyChat por fora (pelo próprio WhatsApp, por um fluxo
  // de lá) existe com o número no campo de SISTEMA e nada no personalizado.
  // Sem esta busca a criação era tentada e o ManyChat recusava com "This
  // WhatsApp ID already exists" — dez pessoas ficaram sem a tag da turma
  // em 06/08/2026 assim, e o log só dizia "erro de validação".
  if (!id && fone) {
    id = primeiro((await mc(
      `/subscriber/findBySystemField?phone=${encodeURIComponent(fone)}`)).dados);
    if (id) como = "telefone";
  }

  // ---- 2. criar ----
  // Sem telefone não cria: um assinante de WhatsApp sem número é um
  // registro que nunca vai receber nada e ainda suja a base de lá.
  let criado = false;
  if (!id && c.criar !== false) {
    if (!fone) {
      await anotar(c.lead_id, "criar", c.tag, false, "sem WhatsApp — não dá para criar");
      return new Response(JSON.stringify({ ok: false, motivo: "contato sem WhatsApp" }),
                          { headers: CORS });
    }
    const partes = (c.nome ?? "").trim().split(/\s+/);
    const r = await mc("/subscriber/createSubscriber", "POST", {
      first_name: partes[0] || "Contato",
      last_name: partes.slice(1).join(" ") || "",
      whatsapp_phone: fone,
      has_opt_in_sms: true,
      has_opt_in_email: true,
      consent_phrase: "cadastro vindo da Ressoar",
    });
    id = primeiro(r.dados);
    criado = !!id;
    como = "criado agora";

    // "This WhatsApp ID already exists" quer dizer que ele está lá e as
    // buscas não o acharam. Desistir aqui deixaria a pessoa sem a tag por
    // um motivo que é o oposto do que parece: não é contato faltando, é
    // contato de sobra. Procura de novo pelo número antes de desistir.
    if (!id && JSON.stringify(r.dados).includes("already exists")) {
      id = primeiro((await mc(
        `/subscriber/findBySystemField?phone=${encodeURIComponent(fone)}`)).dados);
      criado = false;
      como = "ja existia (achado pelo numero)";
    }

    if (!id) {
      await anotar(c.lead_id, "criar", c.tag, false, JSON.stringify(r.dados).slice(0, 400));
      return new Response(JSON.stringify({ ok: false, erro: "não deu para criar", detalhe: r.dados }),
                          { status: 400, headers: CORS });
    }

    // Guarda também o número no campo personalizado usado nas próximas
    // buscas. Sem isso, o mesmo contato seria criado novamente no próximo
    // evento porque esta conta não encontra WhatsApp pelo campo de sistema.
    if (campoWhats) {
      const ligacao = await mc("/subscriber/setCustomField", "POST", {
        subscriber_id: id,
        field_id: Number(campoWhats),
        field_value: fone,
      });
      if (!ligacao.ok) {
        await anotar(c.lead_id, "ligar whatsapp", c.tag, false,
                     JSON.stringify(ligacao.dados).slice(0, 400));
      }
    }
  }

  if (!id) {
    await anotar(c.lead_id, "buscar", c.tag, false, "não encontrado e não foi pedido para criar");
    return new Response(JSON.stringify({ ok: false, motivo: "assinante não existe no ManyChat" }),
                        { headers: CORS });
  }

  // ---- 3. marcar ----
  // Tenta aplicar e só cria a tag ao esbarrar no erro: o caso comum é ela
  // já existir, e criar antes gastaria uma chamada em toda marcação.
  let r = await mc("/subscriber/addTagByName", "POST",
                   { subscriber_id: id, tag_name: c.tag });
  if (!r.ok && JSON.stringify(r.dados).includes("Tag does not exist")) {
    await mc("/page/createTag", "POST", { name: c.tag });
    r = await mc("/subscriber/addTagByName", "POST",
                 { subscriber_id: id, tag_name: c.tag });
  }

  // achou uma vez, não procura de novo
  if (r.ok && c.lead_id && !c.manychat_id) {
    await fetch(`${base}/rest/v1/tabela_1_leads?lead_id=eq.${c.lead_id}`, {
      method: "PATCH", headers: { ...cab, Prefer: "return=minimal" },
      body: JSON.stringify({ manychat_id: String(id) }),
    });
  }

  await anotar(c.lead_id, criado ? "criou e marcou" : "marcou", c.tag, r.ok,
               r.ok ? `assinante ${id} (${como})` : JSON.stringify(r.dados).slice(0, 400));

  return new Response(JSON.stringify({ ok: r.ok, assinante: id, criado, como }),
                      { status: r.ok ? 200 : 400, headers: CORS });
});
