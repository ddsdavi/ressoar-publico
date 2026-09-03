// Edge Function: envio pelo Amazon SES.
//   POST /enviar-ses  { para, de_nome, de_email, assunto, html, reply_to,
//                       envio_id, url_descadastro }
//   O SES exige assinatura AWS SigV4, que o Postgres não sabe fazer — por isso
//   o motor (processar_fila_envios) chama esta função em vez de falar direto
//   com a AWS. Trocar de provedor é só mudar `provedor_email` nas Configurações.
//
//   As credenciais da AWS ficam como secrets DESTA função, nunca no banco.
//   Autenticação: header `x-ressoar-segredo`, conferido contra SES_SEGREDO.
const REGIAO = Deno.env.get("AWS_REGIAO") ?? "us-east-1";
const CHAVE_ID = Deno.env.get("AWS_ACCESS_KEY_ID") ?? "";
const CHAVE_SECRETA = Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? "";
const SEGREDO = Deno.env.get("SES_SEGREDO") ?? "";

const HOST = `email.${REGIAO}.amazonaws.com`;
const CAMINHO = "/v2/email/outbound-emails";
const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

const hex = (b: Uint8Array) =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function sha256(texto: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(texto))));
}

async function hmac(chave: Uint8Array, dado: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw", chave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(dado)));
}

// Cabeçalho com acento precisa virar =?UTF-8?B?...?= (RFC 2047), senão o
// assunto chega embaralhado — mesma armadilha do acento no curl do Windows.
function cabecalhoUtf8(texto: string): string {
  // deno-lint-ignore no-control-regex
  return /^[\x00-\x7F]*$/.test(texto)
    ? texto
    : `=?UTF-8?B?${b64(enc.encode(texto))}?=`;
}

// Versão em texto puro derivada do HTML: e-mail só-HTML pontua contra nos
// filtros de spam (regra MIME_HTML_ONLY) e não lê em relógio/assistente.
function htmlParaTexto(html: string): string {
  let t = html;
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "");
  t = t.replace(/<div style="display:none[\s\S]*?<\/div>/gi, ""); // pré-cabeçalho oculto
  t = t.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_tudo, url, texto) => {
    const limpo = texto.replace(/<[^>]+>/g, "").trim();
    const u = url.replace(/&amp;/g, "&");
    if (!limpo) return u;
    return u.startsWith("http") ? `${limpo} ( ${u} )` : limpo;
  });
  t = t.replace(/<(br|\/p|\/h[1-6]|\/tr|\/div|\/li)\b[^>]*>/gi, "\n");
  t = t.replace(/<li\b[^>]*>/gi, "• ");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&middot;/g, "·").replace(/&#847;|&zwnj;/g, "");
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// quebra de linha em campo de cabeçalho é injeção de MIME — nunca passa
const semQuebra = (v: string) => (v ?? "").replace(/[\r\n]+/g, " ").trim();

function montarMime(p: Record<string, string>): string {
  const de = p.de_nome
    ? `${cabecalhoUtf8(semQuebra(p.de_nome))} <${semQuebra(p.de_email)}>`
    : semQuebra(p.de_email);
  const divisa = `=_ressoar_${crypto.randomUUID().slice(0, 8)}`;
  const linhas = [
    `From: ${de}`,
    `To: ${semQuebra(p.para)}`,
    `Subject: ${cabecalhoUtf8(semQuebra(p.assunto))}`,
    p.reply_to ? `Reply-To: ${semQuebra(p.reply_to)}` : "",
    `X-Entity-Ref-ID: ${p.envio_id}`,
    // exigência do Gmail/Yahoo para remetente em massa (fev/2024)
    `List-Unsubscribe: <${p.url_descadastro}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${divisa}"`,
  ].filter(Boolean);
  // corpos em base64 quebrado de 76 em 76 (limite de linha do SMTP)
  const b76 = (s: string) => b64(enc.encode(s)).replace(/(.{76})/g, "$1\r\n");
  const corpo = [
    `--${divisa}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b76(htmlParaTexto(p.html)),
    `--${divisa}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b76(p.html),
    `--${divisa}--`,
  ].join("\r\n");
  // a linha EM BRANCO entre cabeçalhos e corpo é obrigatória no MIME — sem
  // ela o Content-Type da primeira parte vira "cabeçalho duplicado" no SES
  return linhas.join("\r\n") + "\r\n\r\n" + corpo;
}

async function assinar(corpo: string): Promise<Record<string, string>> {
  const agora = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const dia = agora.slice(0, 8);
  const escopo = `${dia}/${REGIAO}/ses/aws4_request`;

  const requisicaoCanonica = [
    "POST", CAMINHO, "",
    "content-type:application/json",
    `host:${HOST}`,
    `x-amz-date:${agora}`,
    "",
    "content-type;host;x-amz-date",
    await sha256(corpo),
  ].join("\n");

  const paraAssinar = [
    "AWS4-HMAC-SHA256", agora, escopo, await sha256(requisicaoCanonica),
  ].join("\n");

  let chave = enc.encode(`AWS4${CHAVE_SECRETA}`);
  for (const parte of [dia, REGIAO, "ses", "aws4_request"]) {
    chave = await hmac(chave, parte);
  }
  const assinatura = hex(await hmac(chave, paraAssinar));

  return {
    "Content-Type": "application/json",
    "X-Amz-Date": agora,
    Authorization: `AWS4-HMAC-SHA256 Credential=${CHAVE_ID}/${escopo}, ` +
      `SignedHeaders=content-type;host;x-amz-date, Signature=${assinatura}`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  // Os dois nomes, de propósito: o motor passou a mandar `x-ressoar-segredo`
  // no renome de 12/08/2026, e função e banco não trocam de versão no mesmo
  // instante. O nome antigo pode sair daqui depois que o banco estiver na
  // versão nova — hoje ele é a rede que evita 401 no meio da virada.
  const segredoRecebido = req.headers.get("x-ressoar-segredo");
  if (!SEGREDO || segredoRecebido !== SEGREDO) {
    return new Response(JSON.stringify({ erro: "nao autorizado" }), { status: 401 });
  }
  if (!CHAVE_ID || !CHAVE_SECRETA) {
    return new Response(JSON.stringify({ erro: "credenciais AWS ausentes" }), { status: 500 });
  }

  const p = await req.json().catch(() => null);
  if (!p?.para || !p?.de_email) {
    return new Response(JSON.stringify({ erro: "faltam para/de_email" }), { status: 400 });
  }

  const corpo = JSON.stringify({
    FromEmailAddress: p.de_nome ? `${cabecalhoUtf8(p.de_nome)} <${p.de_email}>` : p.de_email,
    Destination: { ToAddresses: [p.para] },
    Content: { Raw: { Data: b64(enc.encode(montarMime(p))) } },
  });

  const resp = await fetch(`https://${HOST}${CAMINHO}`, {
    method: "POST", headers: await assinar(corpo), body: corpo,
  });
  const texto = await resp.text();

  if (!resp.ok) {
    console.error("SES recusou", resp.status, texto);
    return new Response(JSON.stringify({ erro: texto, status: resp.status }), { status: 502 });
  }
  return new Response(texto, { headers: { "Content-Type": "application/json" } });
});
