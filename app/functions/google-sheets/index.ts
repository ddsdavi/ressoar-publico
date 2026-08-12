// Ponte com o Google Planilhas.
//
// A conta é conectada UMA vez (OAuth do Google; os tokens ficam em
// public.segredos, que o navegador não lê). Depois, qualquer automação pode
// ter um passo "Planilha do Google": o painel lê as abas e o cabeçalho pelo
// link da planilha, a pessoa mapeia coluna ↔ campo, e o motor manda o
// contato para cá — esta função escreve a linha.
//
// Por que existe um "app" no Google Cloud: toda integração com planilhas
// passa por um cadastro OAuth. O ManyChat tem o dele; este é o nosso. O
// escopo pedido é só "spreadsheets" (conteúdo de planilhas) + o e-mail da
// conta, para mostrar quem está conectado. Não pedimos o Drive de
// propósito: listar todos os arquivos da conta é escopo restrito, que o
// Google só libera com auditoria — por isso a planilha entra pelo LINK.
//
// As credenciais desse cadastro (client id e secret) são configuração de
// INSTALAÇÃO, não de uso: moram nos secrets desta função, ao lado das chaves
// da AWS. Quando a tela do Google diz "Prosseguir para Ressoa" — o cadastro
// no Google ainda tem o nome antigo, e trocá-lo é opcional —, é esse
// cadastro falando. Ninguém no painel precisa saber que ele existe — do
// mesmo jeito que ninguém digita o client id do ManyChat para usar ManyChat.
//
// Armadilha conhecida: app OAuth com status "Em teste" tem refresh token
// que MORRE em 7 dias. O consentimento precisa estar "Em produção" (mesmo
// sem verificação — a tela de aviso aparece uma vez e pronto).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const ESCOPOS = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const base = Deno.env.get("SUPABASE_URL")!;
  const cab = { "Content-Type": "application/json", apikey: chave,
                Authorization: `Bearer ${chave}` };
  const urlRetorno = `${base}/functions/v1/google-sheets/callback`;

  // ---------- segredos: ler, gravar, apagar ----------
  const segredos = async (chaves: string[]): Promise<Record<string, string>> => {
    const r = await fetch(
      `${base}/rest/v1/segredos?chave=in.(${chaves.join(",")})&select=chave,valor`,
      { headers: cab });
    const linhas = await r.json();
    return Object.fromEntries((linhas ?? []).map(
      (l: { chave: string; valor: string }) => [l.chave, l.valor]));
  };
  const gravar = async (chave_: string, valor: string) => {
    await fetch(`${base}/rest/v1/segredos?on_conflict=chave`, {
      method: "POST",
      headers: { ...cab, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ chave: chave_, valor }),
    });
  };
  const apagar = async (chaves: string[]) => {
    await fetch(`${base}/rest/v1/segredos?chave=in.(${chaves.join(",")})`,
      { method: "DELETE", headers: cab });
  };

  // As chaves do nosso cadastro no Google. Vêm dos secrets da função; a
  // leitura em public.segredos fica de reserva só para não quebrar quem já
  // tinha digitado as chaves na tela antiga de Configurações.
  const credenciais = async (): Promise<{ id: string; secret: string }> => {
    const id = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
    const secret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
    if (id && secret) return { id, secret };
    const s = await segredos(["google_client_id", "google_client_secret"]);
    return { id: id || (s.google_client_id ?? ""),
             secret: secret || (s.google_client_secret ?? "") };
  };

  const anotar = async (lead: string | null, planilha: string, aba: string,
                        ok: boolean, detalhe: string) => {
    await fetch(`${base}/rest/v1/google_sheets_log`, {
      method: "POST", headers: { ...cab, Prefer: "return=minimal" },
      body: JSON.stringify({ lead_fk: lead, planilha, aba, sucesso: ok,
                             detalhe: detalhe.slice(0, 500) }),
    }).catch(() => {});
  };

  // O mesmo crivo da função do ManyChat: a chave anon do frontend é pública,
  // então o servidor confere usuário e papel — não a rota do React.
  const usuarioEhAdmin = async () => {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === chave) return false;
    const rU = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: chave, Authorization: `Bearer ${token}` } });
    if (!rU.ok) return false;
    const u = await rU.json();
    if (!u?.id) return false;
    const rP = await fetch(
      `${base}/rest/v1/usuarios_ressoar?user_id=eq.${encodeURIComponent(u.id)}&select=papel,status&limit=1`,
      { headers: cab });
    const p = await rP.json();
    return p?.[0]?.papel === "admin" && p?.[0]?.status === "aprovado";
  };

  // Projetos novos do Supabase têm dois jogos de chave: o env desta função
  // recebe o formato novo (sb_secret_…), mas o motor manda a service key
  // guardada em segredos — que pode ser o JWT antigo. Os dois valem; recusar
  // o do motor é quebrar o passo de planilha em produção, em silêncio.
  const ehMotor = async () => {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return false;
    if (token === chave) return true;
    const s = await segredos(["service_key"]);
    return !!s.service_key && token === s.service_key;
  };

  // ---------- access token válido, renovando quando preciso ----------
  const tokenDeAcesso = async (): Promise<string> => {
    const s = await segredos(["google_refresh_token", "google_access_token",
                              "google_access_expira"]);
    if (!s.google_refresh_token) throw new Error("conta Google não conectada");
    const expira = Date.parse(s.google_access_expira ?? "") || 0;
    if (s.google_access_token && expira > Date.now() + 60_000) {
      return s.google_access_token;
    }
    const app = await credenciais();
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: app.id, client_secret: app.secret,
        refresh_token: s.google_refresh_token, grant_type: "refresh_token",
      }),
    });
    const d = await r.json();
    if (!r.ok || !d.access_token) {
      // refresh token morto (revogado, ou app OAuth ainda "Em teste")
      if (d.error === "invalid_grant") {
        await apagar(["google_refresh_token", "google_access_token",
                      "google_access_expira", "google_conta_email"]);
        throw new Error("a conexão com o Google expirou — conecte a conta de novo em Configurações");
      }
      throw new Error("Google recusou renovar o acesso: " + JSON.stringify(d).slice(0, 200));
    }
    await gravar("google_access_token", d.access_token);
    await gravar("google_access_expira",
      new Date(Date.now() + (d.expires_in ?? 3600) * 1000 - 60_000).toISOString());
    return d.access_token;
  };

  const idDaPlanilha = (linkOuId: string): string => {
    const m = String(linkOuId).match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    return m ? m[1] : String(linkOuId).trim();
  };

  const u = new URL(req.url);

  // ================== volta do consentimento do Google ==================
  if (req.method === "GET" && u.pathname.endsWith("/callback")) {
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state") ?? "";
    const s = await segredos(["google_oauth_state"]);
    const partes = (s.google_oauth_state ?? "||").split("|");
    const [estadoGuardado, quando] = partes;
    const origem = partes[2] ?? ""; // estado gravado no formato antigo não tem origem

    // Esta rota não desenha nada, e não é escolha de estilo: o Supabase se
    // recusa a servir HTML de *.supabase.co — troca o content-type por
    // text/plain e crava nosniff, contra phishing. Página bonita aqui vira
    // código-fonte na cara da pessoa, e script nenhum roda. Então devolvemos
    // o navegador para o painel, que é HTML de verdade, e ele conta o final.
    const voltar = (resultado: string) => {
      if (!origem.startsWith("https://")) {
        return new Response(
          resultado === "ok"
            ? "Conta Google conectada. Pode fechar esta aba e voltar ao Ressoar."
            : "Nao deu para conectar (" + resultado + "). Volte ao painel e tente de novo.",
          { status: resultado === "ok" ? 200 : 400,
            headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      return Response.redirect(
        `${origem}/config?google=${encodeURIComponent(resultado)}`, 302);
    };

    if (!code || !state || state !== estadoGuardado ||
        Date.now() - (Number(quando) || 0) > 15 * 60_000) {
      return voltar("pedido_nao_confere");
    }
    const app = await credenciais();
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: app.id, client_secret: app.secret,
        code, grant_type: "authorization_code", redirect_uri: urlRetorno,
      }),
    });
    const d = await r.json();
    if (!r.ok || !d.refresh_token) return voltar("google_negou_o_acesso");
    let conta = "";
    try {
      const rInfo = await fetch(USERINFO_URL,
        { headers: { Authorization: `Bearer ${d.access_token}` } });
      conta = (await rInfo.json())?.email ?? "";
    } catch { /* e-mail é cosmético */ }

    await gravar("google_refresh_token", d.refresh_token);
    await gravar("google_access_token", d.access_token);
    await gravar("google_access_expira",
      new Date(Date.now() + (d.expires_in ?? 3600) * 1000 - 60_000).toISOString());
    if (conta) await gravar("google_conta_email", conta);
    await apagar(["google_oauth_state"]);

    return voltar("ok");
  }

  // ================== demais ações (POST com JSON) ==================
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ erro: "use POST" }), { status: 405, headers: CORS });
  }
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { /* corpo vazio é aceitável */ }
  const acao = String(corpo.acao ?? u.searchParams.get("acao") ?? "");

  const erro = (msg: string, status = 400) =>
    new Response(JSON.stringify({ erro: msg }), { status, headers: CORS });
  const ok = (dados: Record<string, unknown>) =>
    new Response(JSON.stringify(dados), { headers: CORS });

  try {
    // ---- o motor escrevendo a linha (chega com a service key) ----
    if (acao === "acrescentar") {
      if (!(await ehMotor())) return erro("só o motor chama esta ação", 403);
      const planilha = String(corpo.planilha_id ?? "");
      const aba = String(corpo.aba ?? "");
      const colunas = (corpo.colunas as string[]) ?? [];
      const mapa = (corpo.mapeamento as Record<string, string>) ?? {};
      const contato = (corpo.contato as Record<string, unknown>) ?? {};
      const lead = (contato.lead_id as string) ?? null;
      if (!planilha || !aba || !colunas.length) {
        await anotar(lead, planilha, aba, false, "config incompleta (planilha/aba/colunas)");
        return erro("config incompleta");
      }
      const valorDe = (campo: string | undefined): string => {
        if (!campo) return "";
        if (campo === "nome") return String(contato.nome ?? "");
        if (campo === "email") return String(contato.email ?? "");
        if (campo === "whatsapp") return String(contato.whatsapp ?? "");
        if (campo === "lead_id") return String(contato.lead_id ?? "");
        // o identificador da pessoa NO MANYCHAT — é o que a planilha das
        // lives sempre guardou na coluna "ID do Contato"
        if (campo === "manychat_id") return String(contato.manychat_id ?? "");
        if (campo === "data_hora") {
          return new Intl.DateTimeFormat("pt-BR", {
            timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
            year: "numeric", hour: "2-digit", minute: "2-digit",
          }).format(new Date()).replace(",", "");
        }
        if (campo.startsWith("atributo:")) {
          const atributos = (contato.atributos as Record<string, unknown>) ?? {};
          return String(atributos[campo.slice("atributo:".length)] ?? "");
        }
        return "";
      };
      const linha = colunas.map((c) => valorDe(mapa[c]));
      const token = await tokenDeAcesso();
      const faixa = encodeURIComponent(`'${aba}'!A1`);
      const anexar = () => fetch(
        `${SHEETS}/${planilha}/values/${faixa}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: [linha] }),
          signal: AbortSignal.timeout(15000) });

      let r = await anexar();
      let d = await r.json();

      // Aba que não existe não é erro: é segunda-feira. A planilha dos
      // compradores do Desafio tem uma aba por turma, e apontá-la era um
      // ritual manual de toda segunda — que falhou junto com o da tag
      // (11/08/2026). Aqui a aba nasce sozinha, com o cabeçalho, e a
      // linha entra em seguida.
      let abaCriada = false;
      if (!r.ok && JSON.stringify(d).includes("Unable to parse range")) {
        const rCria = await fetch(`${SHEETS}/${planilha}:batchUpdate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: aba } } }] }),
          signal: AbortSignal.timeout(15000) });
        if (rCria.ok) {
          abaCriada = true;
          await fetch(
            `${SHEETS}/${planilha}/values/${faixa}?valueInputOption=USER_ENTERED`,
            { method: "PUT",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ values: [colunas] }),
              signal: AbortSignal.timeout(15000) });
          r = await anexar();
          d = await r.json();
        } else {
          const dCria = await rCria.json().catch(() => ({}));
          await anotar(lead, planilha, aba, false,
            "aba não existe e não deu para criar: " + JSON.stringify(dCria).slice(0, 300));
          return erro("não deu para criar a aba: " + JSON.stringify(dCria).slice(0, 200), 502);
        }
      }

      await anotar(lead, planilha, aba, r.ok,
        (abaCriada ? "aba criada com cabeçalho; " : "") +
        (r.ok ? `linha adicionada (${(d.updates?.updatedRange ?? "?")})` : JSON.stringify(d)));
      if (!r.ok) return erro("Google recusou: " + JSON.stringify(d).slice(0, 300), 502);
      return ok({ ok: true, faixa: d.updates?.updatedRange ?? null, aba_criada: abaCriada });
    }

    // ---- daqui para baixo, só admin logado ----
    if (!(await usuarioEhAdmin())) return erro("só admin", 403);

    if (acao === "conectar") {
      const app = await credenciais();
      if (!app.id || !app.secret) {
        return erro("a ponte com o Google não foi ligada neste servidor: faltam " +
          "os secrets GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET da função google-sheets");
      }
      // De onde o painel chamou — é para lá que o Google devolve a pessoa.
      // Só https, e só o que o próprio painel mandou nesta chamada de admin.
      const origem = String(corpo.origem ?? "");
      const estado = crypto.randomUUID();
      await gravar("google_oauth_state", `${estado}|${Date.now()}|` +
        (/^https:\/\/[^|\s]+$/.test(origem) ? origem : ""));
      const url = `${AUTH_URL}?` + new URLSearchParams({
        client_id: app.id, redirect_uri: urlRetorno,
        response_type: "code", scope: ESCOPOS, access_type: "offline",
        prompt: "consent", state: estado,
      });
      return ok({ url, url_retorno: urlRetorno });
    }

    if (acao === "status") {
      const app = await credenciais();
      const s = await segredos(["google_refresh_token", "google_conta_email"]);
      return ok({
        app_configurado: !!(app.id && app.secret),
        conectada: !!s.google_refresh_token,
        conta: s.google_conta_email ?? null,
        url_retorno: urlRetorno,
      });
    }

    if (acao === "desconectar") {
      const s = await segredos(["google_refresh_token"]);
      if (s.google_refresh_token) {
        await fetch(`${REVOKE_URL}?token=${encodeURIComponent(s.google_refresh_token)}`,
          { method: "POST" }).catch(() => {});
      }
      await apagar(["google_refresh_token", "google_access_token",
                    "google_access_expira", "google_conta_email"]);
      return ok({ ok: true });
    }

    if (acao === "abas") {
      const id = idDaPlanilha(String(corpo.link ?? ""));
      if (!id) return erro("cole o link da planilha");
      const token = await tokenDeAcesso();
      const r = await fetch(
        `${SHEETS}/${id}?fields=properties.title,sheets(properties(title))`,
        { headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      if (!r.ok) {
        return erro(r.status === 404
          ? "planilha não encontrada — confira o link e se a conta conectada tem acesso a ela"
          : "Google recusou: " + JSON.stringify(d).slice(0, 200), 502);
      }
      return ok({
        planilha_id: id,
        titulo: d.properties?.title ?? "",
        abas: (d.sheets ?? []).map((s2: { properties: { title: string } }) => s2.properties.title),
      });
    }

    if (acao === "cabecalhos") {
      const id = String(corpo.planilha_id ?? "");
      const aba = String(corpo.aba ?? "");
      if (!id || !aba) return erro("faltou planilha_id ou aba");
      const token = await tokenDeAcesso();
      const faixa = encodeURIComponent(`'${aba}'!1:1`);
      const r = await fetch(`${SHEETS}/${id}/values/${faixa}`,
        { headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      if (!r.ok) return erro("Google recusou: " + JSON.stringify(d).slice(0, 200), 502);
      const colunas = ((d.values?.[0] ?? []) as unknown[]).map(String)
        .filter((c) => c.trim() !== "");
      return ok({ colunas });
    }

    return erro("ação desconhecida: " + acao);
  } catch (e) {
    return erro((e as Error).message, 500);
  }
});
