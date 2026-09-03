// Worker: em.drapatriciadomingos.com.br — a cara pública dos links de e-mail.
//
// Existe por dois motivos, os dois de 29/08/2026:
//   1. O lead JAMAIS deve ver supabase.co ("ela nunca precisa saber que
//      existe o supabase na vida dela" — Davi). Todo link de descadastro e
//      rastreio agora mora no domínio da marca.
//   2. O gateway do Supabase tem um defeito real: se o navegador menciona
//      QUALQUER Accept-Encoding (até "identity"), ele troca o Content-Type
//      da função por text/plain + nosniff — e o lead vê código-fonte em vez
//      de página. Aqui o cabeçalho é reescrito à força, e o defeito morre.
//
// Só dois caminhos passam; o resto é 404. Isto NÃO é um proxy aberto para
// as functions — abrir tudo daria ao mundo um túnel com o nosso domínio.

const ORIGEM = "https://hkkuhquzpapnitzwpkig.supabase.co/functions/v1";

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const caminho = url.pathname;

    if (!/^\/(descadastro|rastreio)$/.test(caminho)) {
      return new Response("Nada por aqui.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const resp = await fetch(ORIGEM + caminho + url.search, {
      method: req.method,
      headers: {
        "Content-Type": req.headers.get("Content-Type") ?? "application/x-www-form-urlencoded",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
      // o rastreio de clique responde 302 — o redirect é do lead, não nosso
      redirect: "manual",
    });

    // link de rastreio corrompido a ponto de derrubar o runtime lá dentro
    // (percent-encoding quebrado por antivírus/reescritor corporativo):
    // o lead cai na casa da marca, nunca numa tela de erro de servidor
    if (caminho === "/rastreio" && resp.status >= 500) {
      return Response.redirect("https://ressoar.drapatriciadomingos.com.br/", 302);
    }

    const headers = new Headers(resp.headers);
    // o corpo chega até nós já descomprimido; sem tirar estes dois, o
    // navegador tentaria descomprimir de novo e receberia lixo
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("x-content-type-options");
    // cookie de bot-management do Supabase com Domain=supabase.co — inválido
    // no nosso domínio, e nenhum lead precisa dele
    headers.delete("set-cookie");

    if (caminho === "/descadastro") {
      headers.set("Content-Type", "text/html; charset=utf-8");
      // o gateway manda "default-src 'none'; sandbox", que proíbe o <style>
      // da página (ela renderiza crua) e o POST do formulário (sandbox sem
      // allow-forms). Entra no lugar um CSP nosso, justo para o que a página
      // usa: estilo inline e um form que posta nela mesma. Sem script algum.
      headers.set(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; " +
          "base-uri 'none'; frame-ancestors 'none'",
      );
    }

    return new Response(resp.body, { status: resp.status, headers });
  },
};
