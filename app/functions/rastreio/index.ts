// Edge Function pública: tracking de abertura (pixel) e clique (redirect).
//   GET /rastreio?t=o&e=<envio_id>                  -> pixel 1x1 + evento open
//   GET /rastreio?t=c&e=<envio_id>&u=<url b64url>   -> evento click + redirect
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PIXEL = Uint8Array.from(atob(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
), (c) => c.charCodeAt(0));

function b64urlDecode(s: string): string | null {
  try {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    // atob dá bytes; e-mails têm URL com acento — decodifica como UTF-8
    const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    // link truncado por cliente de e-mail/antivírus: sem erro na cara do lead
    return null;
  }
}

// Scanner de segurança "clica" em tudo que chega (SafeLinks, Proofpoint…):
// segue o redirect normalmente, mas não vira estatística — senão o robô
// escolhe o vencedor do teste A/B.
function pareceRobo(req: Request): boolean {
  if (req.method === "HEAD") return true;
  const ua = (req.headers.get("user-agent") ?? "").toLowerCase();
  return /bot|crawler|spider|preview|scan|proofpoint|safelinks|urldefense|barracuda|mimecast/
    .test(ua);
}

// destino de cortesia quando o link veio quebrado — o site da marca,
// nunca uma tela de erro de servidor. O endereço é DESTA instalação e vem
// do secret URL_PAINEL (o instalador grava a partir de VITE_OG_URL); sem
// ele, uma página curta e educada — o endereço do projeto no Supabase não
// é lugar para o lead cair. Até 03/09/2026 o domínio estava escrito aqui.
const CASA = (Deno.env.get("URL_PAINEL") ?? "").trim();

function casa(): Response {
  if (CASA) return Response.redirect(CASA, 302);
  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><title>Link expirado</title>" +
      "<p style=\"font-family:sans-serif;margin:40px\">Este link expirou.</p>",
    { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const tipo = url.searchParams.get("t");
  const envioId = url.searchParams.get("e");
  const robo = pareceRobo(req);

  if (!envioId) {
    return tipo === "c" ? casa() : new Response(PIXEL, {
      headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
    });
  }

  const { data: envio } = await supabase
    .from("envios").select("envio_id, lead_fk").eq("envio_id", envioId).maybeSingle();

  if (envio) {
    if (tipo === "o" && !robo) {
      await supabase.from("eventos_email").insert({
        envio_fk: envio.envio_id, lead_fk: envio.lead_fk, tipo: "open",
        occurred_at: new Date().toISOString(),
        payload: { ua: req.headers.get("user-agent") ?? "" },
      });
    } else if (tipo === "c") {
      const u = url.searchParams.get("u");
      const destino = u ? b64urlDecode(u) : null;
      if (!robo) {
        await supabase.from("eventos_email").insert({
          envio_fk: envio.envio_id, lead_fk: envio.lead_fk, tipo: "click",
          url: destino, occurred_at: new Date().toISOString(),
          payload: { ua: req.headers.get("user-agent") ?? "" },
        });
      }
      if (destino && /^https?:\/\//.test(destino)) {
        return Response.redirect(destino, 302);
      }
    }
  }

  // clique sem destino válido (link velho, truncado, envio de teste):
  // o lead cai na casa da marca, nunca num erro seco
  if (tipo === "c") return casa();
  return new Response(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
  });
});
