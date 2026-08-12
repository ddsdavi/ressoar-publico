// Edge Function: troca do e-mail de acesso com DUAS TRAVAS.
//   1) senha atual (reautenticação)
//   2) código de 6 dígitos enviado para o E-MAIL ATUAL já cadastrado
// Sem o código que chega no e-mail antigo, nada muda.
//
//   POST { acao: "solicitar", email_novo, senha }  (Authorization: Bearer <token do usuário>)
//   POST { acao: "confirmar", codigo }
//   POST { acao: "cancelar" }
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK = Deno.env.get("RESSOA_EMAIL_WEBHOOK") ?? "";
const SEGREDO = Deno.env.get("RESSOA_EMAIL_SEGREDO") ?? "";

const admin = createClient(URL_SB, SERVICE);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const responde = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: cors });

async function sha256(texto: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function gerarCodigo(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1000000).padStart(6, "0");
}

async function enviarEmail(para: string, assunto: string, html: string) {
  if (!WEBHOOK || !SEGREDO) return { ok: false, motivo: "canal de e-mail não configurado" };
  try {
    const r = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segredo: SEGREDO, para, assunto, html }),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: r.ok };
  } catch {
    return { ok: false, motivo: "falha ao enviar" };
  }
}

// Quem assina a instalação vem do secret MARCA_NOME — não do código: este
// repositório tem espelho público, e nome de pessoa não mora em arquivo
// versionado. Vazio, o e-mail se apresenta só como Ressoar.
const MARCA = (Deno.env.get("MARCA_NOME") ?? "").trim();
const ASSINATURA = MARCA
  ? ` <span style="opacity:.6;font-weight:400;font-size:13px">&nbsp;·&nbsp; ${MARCA}</span>`
  : "";

const molde = (titulo: string, corpo: string) => `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f6fa;font-family:Segoe UI,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden">
  <tr><td style="background:#170020;padding:20px 28px;color:#fff;font-size:18px;font-weight:700">Ressoar${ASSINATURA}</td></tr>
  <tr><td style="padding:30px 28px;color:#1F2129;font-size:15px;line-height:1.7"><h2 style="margin:0 0 14px;font-size:18px;color:#82308F">${titulo}</h2>${corpo}</td></tr>
  <tr><td style="padding:16px 28px;background:#faf8fb;color:#5F667E;font-size:12px">Se não foi você, ignore este e-mail e troque sua senha — nada muda sem o código acima.</td></tr>
</table></td></tr></table></body></html>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responde({ erro: "método inválido" }, 405);

  // ---------------- AÇÕES PÚBLICAS (antes do login): recuperar senha ----------------
  const corpoBruto = await req.clone().json().catch(() => ({}));
  const acaoPublica = String(corpoBruto.acao ?? "");
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "";

  if (acaoPublica === "senha_solicitar") {
    const email = String(corpoBruto.email ?? "").trim().toLowerCase();
    const resposta = { ok: true, mensagem: "Se este e-mail tiver conta no Ressoar, o código chega em instantes." };
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) return responde(resposta);

    const { data: perfil } = await admin.from("usuarios_ressoa")
      .select("user_id, nome").eq("email", email).maybeSingle();
    if (!perfil) return responde(resposta);   // nunca revela se existe

    const umaHora = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("codigos_seguranca")
      .select("*", { count: "exact", head: true })
      .eq("user_id", perfil.user_id).eq("tipo", "outro").gte("created_at", umaHora);
    if ((count ?? 0) >= 5) return responde(resposta);

    await admin.from("codigos_seguranca").update({ cancelado: true })
      .eq("user_id", perfil.user_id).eq("tipo", "outro").is("usado_em", null).eq("cancelado", false);

    const codigo = gerarCodigo();
    await admin.from("codigos_seguranca").insert({
      user_id: perfil.user_id, tipo: "outro",
      codigo_hash: await sha256(codigo + perfil.user_id + "senha"),
      dados: { finalidade: "recuperar_senha" },
      expira_em: new Date(Date.now() + 20 * 60_000).toISOString(),
    });

    const primeiro = (perfil.nome ?? "").trim().split(/\s+/)[0];
    await enviarEmail(email, "Seu código para criar uma nova senha — Ressoar",
      molde("Vamos criar sua nova senha", `
        <p>${primeiro ? "Olá, " + primeiro + "! " : ""}Recebemos um pedido para redefinir a senha da sua conta no Ressoar.</p>
        <p>Digite este código na tela de recuperação:</p>
        <p style="font-size:34px;font-weight:700;letter-spacing:8px;color:#82308F;margin:22px 0">${codigo}</p>
        <p style="color:#5F667E;font-size:13.5px">O código vale por 20 minutos. Sua senha atual continua valendo até você criar a nova.</p>`));

    await admin.from("log_seguranca").insert({
      user_id: perfil.user_id, evento: "senha_codigo_enviado", detalhe: {}, ip,
    });
    return responde(resposta);
  }

  if (acaoPublica === "senha_redefinir") {
    const email = String(corpoBruto.email ?? "").trim().toLowerCase();
    const codigo = String(corpoBruto.codigo ?? "").replace(/\D/g, "");
    const senha = String(corpoBruto.senha ?? "");
    if (senha.length < 8) return responde({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);

    const { data: perfil } = await admin.from("usuarios_ressoa")
      .select("user_id").eq("email", email).maybeSingle();
    if (!perfil) return responde({ erro: "Código inválido ou expirado." }, 400);

    const { data: pedido } = await admin.from("codigos_seguranca")
      .select("*").eq("user_id", perfil.user_id).eq("tipo", "outro")
      .is("usado_em", null).eq("cancelado", false)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!pedido) return responde({ erro: "Nenhum pedido de recuperação em aberto. Peça um novo código." }, 400);
    if (new Date(pedido.expira_em) < new Date()) return responde({ erro: "Código expirado. Peça um novo." }, 400);
    if (pedido.tentativas >= 5) {
      await admin.from("codigos_seguranca").update({ cancelado: true }).eq("id", pedido.id);
      return responde({ erro: "Muitas tentativas erradas. Peça um novo código." }, 429);
    }
    if (await sha256(codigo + perfil.user_id + "senha") !== pedido.codigo_hash) {
      await admin.from("codigos_seguranca").update({ tentativas: pedido.tentativas + 1 }).eq("id", pedido.id);
      return responde({ erro: `Código incorreto. Restam ${4 - pedido.tentativas} tentativas.` }, 400);
    }

    const { error } = await admin.auth.admin.updateUserById(perfil.user_id, { password: senha });
    if (error) return responde({ erro: error.message }, 500);

    await admin.from("codigos_seguranca").update({ usado_em: new Date().toISOString() }).eq("id", pedido.id);
    await admin.from("log_seguranca").insert({
      user_id: perfil.user_id, evento: "senha_redefinida", detalhe: {}, ip,
    });
    await enviarEmail(email, "Sua senha do Ressoar foi alterada",
      molde("Senha alterada", `
        <p>A senha da sua conta no Ressoar acabou de ser alterada.</p>
        <p style="color:#5F667E;font-size:13.5px">Se não foi você, fale imediatamente com um admin.</p>`));
    return responde({ ok: true, mensagem: "Senha criada! Agora é só entrar." });
  }

  // ---------------- daqui pra baixo, exige login ----------------
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return responde({ erro: "Você precisa estar logado." }, 401);

  const { data: usuario, error: errUser } = await admin.auth.getUser(token);
  if (errUser || !usuario?.user) return responde({ erro: "Sessão inválida." }, 401);
  const user = usuario.user;
  const emailAtual = (user.email ?? "").toLowerCase();

  const body = corpoBruto;
  const acao = acaoPublica;

  const registrar = (evento: string, detalhe: Record<string, unknown> = {}) =>
    admin.from("log_seguranca").insert({ user_id: user.id, evento, detalhe, ip });

  // ---------------- 1) SOLICITAR ----------------
  if (acao === "solicitar") {
    const emailNovo = String(body.email_novo ?? "").trim().toLowerCase();
    const senha = String(body.senha ?? "");
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(emailNovo)) {
      return responde({ erro: "Novo e-mail inválido." }, 400);
    }
    if (emailNovo === emailAtual) return responde({ erro: "Esse já é o seu e-mail atual." }, 400);

    // trava 1: senha atual
    const publico = createClient(URL_SB, ANON);
    const { error: errSenha } = await publico.auth.signInWithPassword({ email: emailAtual, password: senha });
    if (errSenha) {
      await registrar("troca_email_senha_incorreta", { email_novo: emailNovo });
      return responde({ erro: "Senha atual incorreta." }, 401);
    }

    // e-mail novo não pode já estar em uso
    const { data: existente } = await admin.from("usuarios_ressoa")
      .select("user_id").eq("email", emailNovo).maybeSingle();
    if (existente) return responde({ erro: "Já existe uma conta com esse e-mail." }, 400);

    // limite: no máximo 3 pedidos por hora
    const umaHora = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("trocas_email")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", umaHora);
    if ((count ?? 0) >= 3) {
      return responde({ erro: "Muitos pedidos de troca. Tente novamente em 1 hora." }, 429);
    }

    await admin.from("trocas_email").update({ cancelado: true })
      .eq("user_id", user.id).is("confirmado_em", null).eq("cancelado", false);

    const codigo = gerarCodigo();
    const { error: errIns } = await admin.from("trocas_email").insert({
      user_id: user.id, email_atual: emailAtual, email_novo: emailNovo,
      codigo_hash: await sha256(codigo + user.id),
      expira_em: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    if (errIns) return responde({ erro: errIns.message }, 500);

    // trava 2: o código vai para o E-MAIL ATUAL
    const envio = await enviarEmail(emailAtual, "Código para trocar seu e-mail — Ressoar",
      molde("Confirme a troca do seu e-mail", `
        <p>Recebemos um pedido para trocar o e-mail de acesso desta conta para <b>${emailNovo}</b>.</p>
        <p>Para autorizar, digite este código no Ressoar:</p>
        <p style="font-size:34px;font-weight:700;letter-spacing:8px;color:#82308F;margin:22px 0">${codigo}</p>
        <p style="color:#5F667E;font-size:13.5px">O código vale por 15 minutos. Enquanto ele não for usado, seu e-mail atual continua valendo.</p>`));

    await registrar("troca_email_codigo_enviado", { email_novo: emailNovo, entregue: envio.ok });
    if (!envio.ok) return responde({ erro: "Não consegui enviar o código agora. Tente de novo em instantes." }, 502);

    const [usuarioParte, dominio] = emailAtual.split("@");
    const mascarado = `${usuarioParte.slice(0, 2)}${"•".repeat(Math.max(1, usuarioParte.length - 2))}@${dominio}`;
    return responde({ ok: true, enviado_para: mascarado, expira_em_minutos: 15 });
  }

  // ---------------- 2) CONFIRMAR ----------------
  if (acao === "confirmar") {
    const codigo = String(body.codigo ?? "").replace(/\D/g, "");
    const { data: pedido } = await admin.from("trocas_email")
      .select("*").eq("user_id", user.id).is("confirmado_em", null).eq("cancelado", false)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!pedido) return responde({ erro: "Nenhum pedido de troca em aberto." }, 400);
    if (new Date(pedido.expira_em) < new Date()) {
      return responde({ erro: "Código expirado. Peça um novo." }, 400);
    }
    if (pedido.tentativas >= 5) {
      await admin.from("trocas_email").update({ cancelado: true }).eq("id", pedido.id);
      await registrar("troca_email_bloqueada_tentativas", {});
      return responde({ erro: "Muitas tentativas erradas. O pedido foi cancelado." }, 429);
    }
    if (await sha256(codigo + user.id) !== pedido.codigo_hash) {
      await admin.from("trocas_email").update({ tentativas: pedido.tentativas + 1 }).eq("id", pedido.id);
      await registrar("troca_email_codigo_errado", { tentativa: pedido.tentativas + 1 });
      return responde({ erro: `Código incorreto. Restam ${4 - pedido.tentativas} tentativas.` }, 400);
    }

    const { error: errUp } = await admin.auth.admin.updateUserById(user.id, {
      email: pedido.email_novo, email_confirm: true,
    });
    if (errUp) return responde({ erro: errUp.message }, 500);

    await admin.from("trocas_email").update({ confirmado_em: new Date().toISOString() }).eq("id", pedido.id);
    await registrar("troca_email_concluida", { de: pedido.email_atual, para: pedido.email_novo });

    // avisa os dois endereços (o antigo é o que detecta invasão)
    await enviarEmail(pedido.email_atual, "Seu e-mail de acesso foi alterado — Ressoar",
      molde("E-mail de acesso alterado", `
        <p>O e-mail de acesso desta conta passou a ser <b>${pedido.email_novo}</b>.</p>
        <p style="color:#5F667E;font-size:13.5px">Se não foi você, fale imediatamente com um admin do Ressoar.</p>`));
    await enviarEmail(pedido.email_novo, "Este é o seu novo e-mail de acesso — Ressoar",
      molde("Novo e-mail confirmado", `
        <p>A partir de agora você entra no Ressoar com <b>${pedido.email_novo}</b>.</p>`));

    return responde({ ok: true, email_novo: pedido.email_novo });
  }

  // ---------------- 3) EXCLUIR A PRÓPRIA CONTA (LGPD art. 18, VI) ----------------
  // Etapa 1: senha + palavra EXCLUIR -> manda código para o e-mail cadastrado.
  // Etapa 2: código -> apaga de verdade. Admins são avisados por e-mail.
  async function checarSePodeExcluir() {
    const { data: perfil } = await admin.from("usuarios_ressoa")
      .select("papel, status, admin_mestre").eq("user_id", user.id).maybeSingle();
    if (perfil?.admin_mestre) {
      return "Esta é uma conta de administração permanente — não pode ser excluída.";
    }
    if (perfil?.papel === "admin" && perfil?.status === "aprovado") {
      const { count } = await admin.from("usuarios_ressoa")
        .select("*", { count: "exact", head: true })
        .eq("papel", "admin").eq("status", "aprovado").neq("user_id", user.id);
      if ((count ?? 0) === 0) {
        return "Você é o último admin ativo — promova outra pessoa antes de excluir sua conta.";
      }
    }
    return null;
  }

  if (acao === "excluir_solicitar") {
    const senha = String(body.senha ?? "");
    if (String(body.confirmacao ?? "").trim().toUpperCase() !== "EXCLUIR") {
      return responde({ erro: "Digite EXCLUIR para confirmar." }, 400);
    }
    const impedimento = await checarSePodeExcluir();
    if (impedimento) return responde({ erro: impedimento }, 403);

    const publico = createClient(URL_SB, ANON);
    const { error: errSenha } = await publico.auth.signInWithPassword({ email: emailAtual, password: senha });
    if (errSenha) {
      await registrar("exclusao_senha_incorreta", {});
      return responde({ erro: "Senha incorreta." }, 401);
    }

    const umaHora = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("codigos_seguranca")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id).eq("tipo", "excluir_conta").gte("created_at", umaHora);
    if ((count ?? 0) >= 3) return responde({ erro: "Muitos pedidos. Tente novamente em 1 hora." }, 429);

    await admin.from("codigos_seguranca").update({ cancelado: true })
      .eq("user_id", user.id).eq("tipo", "excluir_conta").is("usado_em", null).eq("cancelado", false);

    const codigo = gerarCodigo();
    await admin.from("codigos_seguranca").insert({
      user_id: user.id, tipo: "excluir_conta",
      codigo_hash: await sha256(codigo + user.id + "excluir"),
      expira_em: new Date(Date.now() + 15 * 60_000).toISOString(),
    });

    const envio = await enviarEmail(emailAtual, "Código para excluir sua conta — Ressoar",
      molde("Confirme a exclusão da sua conta", `
        <p>Recebemos um pedido para <b>excluir permanentemente</b> sua conta no Ressoar.</p>
        <p>Se foi você, digite este código para concluir:</p>
        <p style="font-size:34px;font-weight:700;letter-spacing:8px;color:#82308F;margin:22px 0">${codigo}</p>
        <p style="color:#D63031;font-size:13.5px"><b>Esta ação é irreversível.</b> Seu cadastro, sua foto e seu histórico serão apagados.</p>
        <p style="color:#5F667E;font-size:13.5px">O código vale por 15 minutos. Se não foi você, ignore este e-mail e troque sua senha imediatamente.</p>`));

    await registrar("exclusao_codigo_enviado", { entregue: envio.ok });
    if (!envio.ok) return responde({ erro: "Não consegui enviar o código agora. Tente de novo em instantes." }, 502);

    const [u0, dom] = emailAtual.split("@");
    return responde({ ok: true, enviado_para: `${u0.slice(0, 2)}${"•".repeat(Math.max(1, u0.length - 2))}@${dom}` });
  }

  if (acao === "excluir_confirmar") {
    const codigo = String(body.codigo ?? "").replace(/\D/g, "");
    const impedimento = await checarSePodeExcluir();
    if (impedimento) return responde({ erro: impedimento }, 403);

    const { data: pedido } = await admin.from("codigos_seguranca")
      .select("*").eq("user_id", user.id).eq("tipo", "excluir_conta")
      .is("usado_em", null).eq("cancelado", false)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!pedido) return responde({ erro: "Nenhum pedido de exclusão em aberto." }, 400);
    if (new Date(pedido.expira_em) < new Date()) return responde({ erro: "Código expirado. Peça um novo." }, 400);
    if (pedido.tentativas >= 5) {
      await admin.from("codigos_seguranca").update({ cancelado: true }).eq("id", pedido.id);
      return responde({ erro: "Muitas tentativas erradas. O pedido foi cancelado." }, 429);
    }
    if (await sha256(codigo + user.id + "excluir") !== pedido.codigo_hash) {
      await admin.from("codigos_seguranca").update({ tentativas: pedido.tentativas + 1 }).eq("id", pedido.id);
      await registrar("exclusao_codigo_errado", { tentativa: pedido.tentativas + 1 });
      return responde({ erro: `Código incorreto. Restam ${4 - pedido.tentativas} tentativas.` }, 400);
    }

    await admin.from("codigos_seguranca").update({ usado_em: new Date().toISOString() }).eq("id", pedido.id);
    await registrar("conta_excluida_pelo_titular", { email: emailAtual });

    // avisa os admins antes de sumir com o registro
    const { data: admins } = await admin.from("usuarios_ressoa")
      .select("email").eq("papel", "admin").eq("status", "aprovado").neq("user_id", user.id);
    for (const a of admins ?? []) {
      await enviarEmail(a.email, "Uma conta foi excluída — Ressoar",
        molde("Conta excluída pelo titular", `
          <p>A pessoa <b>${emailAtual}</b> excluiu a própria conta no Ressoar.</p>
          <p style="color:#5F667E;font-size:13.5px">Aviso automático de segurança.</p>`));
    }
    await enviarEmail(emailAtual, "Sua conta no Ressoar foi excluída",
      molde("Conta excluída", `
        <p>Sua conta no Ressoar foi excluída a seu pedido.</p>
        <p>Apagamos seu cadastro, sua foto e seu histórico de acesso.</p>
        <p style="color:#5F667E;font-size:13.5px">Os dados da operação (leads, campanhas) pertencem à empresa e permanecem no sistema.</p>`));

    await admin.storage.from("avatares").remove([`${user.id}/foto.webp`]).catch(() => {});
    await admin.from("trocas_email").delete().eq("user_id", user.id);
    await admin.from("codigos_seguranca").delete().eq("user_id", user.id);
    await admin.from("log_seguranca").delete().eq("user_id", user.id);

    const { error: errDel } = await admin.auth.admin.deleteUser(user.id);
    if (errDel) return responde({ erro: errDel.message }, 500);

    return responde({ ok: true, mensagem: "Conta excluída." });
  }

  // ---------------- 4) CANCELAR ----------------
  if (acao === "cancelar") {
    await admin.from("trocas_email").update({ cancelado: true })
      .eq("user_id", user.id).is("confirmado_em", null).eq("cancelado", false);
    await registrar("troca_email_cancelada", {});
    return responde({ ok: true });
  }

  return responde({ erro: "Ação inválida." }, 400);
});
