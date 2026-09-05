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
//
// Os dois endereços desta instalação vêm do wrangler.toml (bloco [vars]),
// não do código: até 04/09/2026 estavam escritos aqui, e uma cópia da
// plataforma publicava um Worker que servia links apontando para o projeto
// Supabase de outra casa. Ver docs/11-DUPLICAR-E-VENDER.md, passo 9.

export default {
  async fetch(req, env) {
    const ORIGEM = (env && env.ORIGEM_FUNCOES ? env.ORIGEM_FUNCOES : "").replace(/\/$/, "");
    const CASA = (env && env.URL_PAINEL) || "";
    const url = new URL(req.url);
    const caminho = url.pathname;

    // Sem o endereço das funções não há o que servir. Falha curta e
    // explícita: melhor um erro honesto do que um proxy para lugar nenhum.
    if (!ORIGEM) {
      return new Response("Configuração incompleta: falta ORIGEM_FUNCOES.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

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
      return CASA
        ? Response.redirect(CASA, 302)
        : new Response(
            "<!doctype html><meta charset=\"utf-8\"><title>Link expirado</title>" +
              "<p style=\"font-family:sans-serif;margin:40px\">Este link expirou.</p>",
            { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
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
