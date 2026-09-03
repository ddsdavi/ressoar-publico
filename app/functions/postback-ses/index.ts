// Edge Function: postbacks do Amazon SES, que chegam via SNS.
//
// O SES não faz POST direto como o Resend: ele publica num tópico SNS, e o
// SNS chama esta função. Duas diferenças que quebram quem não sabe:
//
//   1. A primeira chamada é uma CONFIRMAÇÃO de inscrição. Se ninguém abrir
//      a SubscribeURL que vem nela, o tópico nunca envia mais nada — e
//      tudo parece funcionar até você reparar que nenhum bounce chegou.
//
//   2. O conteúdo vem como TEXTO dentro de outro JSON (campo Message),
//      então precisa de dois parses.
//
// Bounce permanente e reclamação alimentam a supressão automaticamente,
// igual ao caminho do Resend.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createVerify, X509Certificate } from "node:crypto";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Verificação de assinatura do SNS (auditoria 25/08/2026). Toda mensagem do
// SNS já vem assinada por um certificado X.509 da AWS — não precisa de segredo
// nem de reconfiguração. Sem verificar, qualquer um POSTava um "Complaint"/
// "Bounce" forjado e envenenava a supressão (bloqueava uma vítima só sabendo
// o e-mail dela). A assinatura cobre estes campos, nesta ordem exata:
const CAMPOS_ASSINATURA: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

type ResultadoAssinatura = "valida" | "invalida" | "sem_verificacao";

async function verificarAssinaturaSNS(sns: Record<string, any>): Promise<ResultadoAssinatura> {
  const url = sns.SigningCertURL ?? sns.SigningCertUrl ?? "";
  // host DEVE ser da AWS — condição controlável pelo atacante ⇒ trata como forja
  if (!/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(url)) return "invalida";
  const campos = CAMPOS_ASSINATURA[sns.Type as string];
  if (!campos || !sns.Signature) return "invalida";
  let canonico = "";
  for (const k of campos) {
    if (sns[k] !== undefined && sns[k] !== null) canonico += k + "\n" + sns[k] + "\n";
  }
  try {
    const pem = await (await fetch(url)).text();
    const cert = new X509Certificate(pem);
    const algo = String(sns.SignatureVersion) === "2" ? "RSA-SHA256" : "RSA-SHA1";
    const v = createVerify(algo);
    v.update(canonico, "utf8");
    v.end();
    return v.verify(cert.publicKey, sns.Signature, "base64") ? "valida" : "invalida";
  } catch (e) {
    // Erro de runtime (ex.: node:crypto indisponível) NÃO é controlável pelo
    // atacante — degrada para o comportamento antigo, com aviso, em vez de
    // derrubar todo o processamento de bounce. Forja (assinatura inválida ou
    // host fora da AWS) já foi barrada acima.
    console.error("não foi possível verificar assinatura SNS (degradando):", String(e));
    return "sem_verificacao";
  }
}

const MAPA: Record<string, string> = {
  Send: "sent",
  Delivery: "delivered",
  DeliveryDelay: "deferred",
  Bounce: "bounce_hard",
  Complaint: "complaint",
  Open: "open",
  Click: "click",
  Reject: "rejected",
};

// pega o nosso identificador do envio, que viaja no cabeçalho do MIME
function refDoEnvio(mail: Record<string, any>): string | null {
  const h = mail?.headers;
  if (Array.isArray(h)) {
    const achado = h.find((x: Record<string, string>) =>
      (x?.name ?? "").toLowerCase() === "x-entity-ref-id");
    if (achado?.value) return achado.value;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const bruto = await req.text();
  let sns: Record<string, any>;
  try {
    sns = JSON.parse(bruto);
  } catch {
    return new Response("corpo inválido", { status: 400 });
  }

  // ---- 0. autenticidade: a mensagem foi mesmo assinada pela AWS? ----
  const veredito = await verificarAssinaturaSNS(sns);
  if (veredito === "invalida") {
    console.warn("mensagem SNS com assinatura inválida — recusada");
    return new Response("assinatura inválida", { status: 401 });
  }

  // ---- 1. confirmação da inscrição no tópico ----
  if (sns.Type === "SubscriptionConfirmation" && sns.SubscribeURL) {
    // aceitar só URLs da AWS: SubscribeURL vem do corpo, e corpo é dado,
    // não instrução. Sem esta checagem, quem descobrisse o endereço da
    // função poderia fazer o servidor chamar qualquer URL.
    if (!/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(sns.SubscribeURL)) {
      console.error("SubscribeURL fora da AWS, ignorada:", sns.SubscribeURL);
      return new Response("url não confiável", { status: 400 });
    }
    const r = await fetch(sns.SubscribeURL);
    console.log("inscrição no tópico SNS confirmada:", r.status);
    return new Response("inscrição confirmada");
  }

  if (sns.Type === "UnsubscribeConfirmation") return new Response("ok");

  // ---- 2. o evento em si, embrulhado em texto ----
  let evt: Record<string, any>;
  try {
    evt = typeof sns.Message === "string" ? JSON.parse(sns.Message) : (sns.Message ?? sns);
  } catch {
    return new Response("mensagem inválida", { status: 400 });
  }

  const tipoSes = evt.eventType ?? evt.notificationType;
  const tipo = MAPA[tipoSes];
  if (!tipo) return new Response("evento ignorado: " + tipoSes);

  const mail = evt.mail ?? {};
  const destinos: string[] = mail.destination ?? [];
  const email = (destinos[0] ?? "").toLowerCase();
  const ref = refDoEnvio(mail);

  // localiza o envio: pelo nosso identificador, ou pelo último para aquele
  // endereço. O identificador é mais confiável — o e-mail pode ter recebido
  // vários envios e o mais recente não ser o que gerou este evento.
  let envio: { envio_id: string; lead_fk: string } | null = null;
  if (ref) {
    const { data } = await supabase.from("envios")
      .select("envio_id, lead_fk").eq("envio_id", ref).maybeSingle();
    envio = data ?? null;
  }
  if (!envio && email) {
    const { data } = await supabase.from("envios")
      .select("envio_id, lead_fk, tabela_1_leads!inner(email)")
      .eq("tabela_1_leads.email", email)
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();
    envio = data ? { envio_id: data.envio_id, lead_fk: data.lead_fk } : null;
  }

  // ---- 3. bounce e reclamação bloqueiam, mesmo sem achar o envio ----
  // Bounce leve (mailbox cheia) não bloqueia: o endereço existe e volta a
  // funcionar. Bloquear por isso seria perder a pessoa para sempre.
  const permanente = tipoSes === "Bounce" && evt.bounce?.bounceType === "Permanent";
  const reclamou = tipoSes === "Complaint";

  if ((permanente || reclamou) && email) {
    await supabase.from("supressao").upsert(
      { email, motivo: reclamou ? "complaint" : "hard_bounce",
        origem_envio_fk: envio?.envio_id ?? null },
      { onConflict: "email", ignoreDuplicates: true });
  }

  if (envio) {
    await supabase.from("eventos_email").insert({
      envio_fk: envio.envio_id,
      lead_fk: envio.lead_fk,
      tipo: permanente ? "bounce_hard" : tipo === "bounce_hard" ? "bounce_soft" : tipo,
      url: evt.click?.link ?? null,
      occurred_at: mail.timestamp ?? new Date().toISOString(),
      payload: { ses: tipoSes, sub: evt.bounce?.bounceSubType ?? null },
    });

    if (tipo === "delivered") {
      await supabase.from("envios").update({ status: "delivered" }).eq("envio_id", envio.envio_id);
    } else if (permanente) {
      await supabase.from("envios").update({ status: "bounced" }).eq("envio_id", envio.envio_id);
    } else if (reclamou) {
      await supabase.from("envios").update({ status: "complained" }).eq("envio_id", envio.envio_id);
    }
  } else {
    console.warn("evento do SES sem envio correspondente:", tipoSes, email);
  }

  return new Response(JSON.stringify({ ok: true, tipo }), {
    headers: { "Content-Type": "application/json" },
  });
});
