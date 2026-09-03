// Edge Function pública: descadastro (LGPD/CAN-SPAM).
//   GET  /descadastro?e=<envio_id>  -> página de confirmação
//   POST /descadastro?e=<envio_id>  -> marca status=2 em todas as listas do lead,
//                                      registra evento unsubscribe e supressão global.
//
// A página é a cara da marca — é a última coisa que a pessoa vê antes de
// sair, e "sair com elegância" é o que evita o botão de spam. Reescrita em
// 28/08/2026 depois de um clique real cair numa tela crua ("Ridículo! Um
// lixo!", palavras do dono): agora o link de teste tem resposta digna, o
// botão explica o que faz e quem mudou de ideia sabe que basta fechar.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ROXO = "#82308f";
const AMBAR = "#f7b500";

// o nome que assina a página vem das Configurações; sem ele, neutro
async function nomeMarca(): Promise<string> {
  const { data } = await supabase.from("app_config")
    .select("valor").eq("chave", "from_name_padrao").maybeSingle();
  return data?.valor || "Nossa equipe";
}

// O corpo vai como STREAM: quando é string (e até bytes), o gateway do
// Supabase troca o Content-Type por text/plain ao comprimir a resposta — foi
// assim que um lead viu código-fonte em vez de página. Stream ele repassa
// como está, com os headers intactos.
const emStream = (texto: string) => new Response(texto).body;
const pagina = (titulo: string, corpo: string, marca: string) => new Response(
  emStream(
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${titulo}</title>
  <style>
    body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f6f4f8;
         display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}
    .card{background:#fff;border-radius:14px;max-width:440px;width:100%;overflow:hidden;
          box-shadow:0 4px 24px rgba(42,34,51,.10)}
    .faixa{background:${ROXO};color:#fff;padding:16px 26px;font-family:Georgia,serif;
           font-size:17px;letter-spacing:.3px}
    .miolo{padding:28px 26px 30px;text-align:center}
    h1{font-family:Georgia,serif;font-size:22px;font-weight:normal;color:#1f1a2e;margin:0 0 10px}
    p{font-size:15px;line-height:1.6;color:#3c3646;margin:0 0 12px}
    .fio{height:3px;background:${AMBAR};border-radius:2px;margin:18px 0}
    button{background:${ROXO};color:#fff;border:0;border-radius:8px;padding:13px 26px;
           font-size:15px;font-weight:700;cursor:pointer;width:100%}
    button:hover{filter:brightness(1.08)}
    .mini{font-size:12.5px;color:#8a8296;margin-top:14px}
  </style></head><body>
  <div class="card">
    <div class="faixa">${marca}</div>
    <div class="miolo">${corpo}</div>
  </div></body></html>`),
  { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const envioId = url.searchParams.get("e");
  const marca = await nomeMarca();

  if (!envioId) {
    return pagina("Link incompleto",
      `<h1>Este link veio incompleto</h1>
       <p>Abra o e-mail de novo e use o link "Não quero mais receber estes e-mails" do rodapé.</p>
       <p class="mini">Nada foi alterado no seu cadastro.</p>`, marca);
  }

  // e-mail de TESTE (?e=teste): ensaia o caminho inteiro do lead — mostra a
  // confirmação real e "descadastra" — sem tocar em cadastro nenhum. Antes,
  // o teste caía em "link não está mais ativo", o que só confundia quem
  // estava conferindo o próprio e-mail.
  if (envioId === "teste") {
    if (req.method === "GET") {
      return pagina("Sair da lista",
        `<h1>Quer parar de receber nossos e-mails?</h1>
         <p>Com um clique você sai de todas as nossas listas. Sem perguntas,
            sem espera — vale na hora.</p>
         <form method="POST"><button type="submit">Não quero mais receber</button></form>
         <p class="mini">Mudou de ideia? É só fechar esta página — nada acontece.</p>`, marca);
    }
    return pagina("Pronto",
      `<h1>Pronto — você não receberá mais</h1>
       <p>Seu endereço saiu de todas as nossas listas, valendo já.</p>
       <div class="fio"></div>
       <p class="mini">Este era um e-mail de teste: nenhum cadastro foi alterado.
          No envio de verdade, o lead sai das listas neste clique.</p>`, marca);
  }

  const { data: envio } = await supabase
    .from("envios").select("envio_id, lead_fk").eq("envio_id", envioId).maybeSingle();

  // link de e-mail de teste (ou muito antigo): ninguém para descadastrar —
  // e isso merece uma explicação, não um erro seco
  if (!envio) {
    return pagina("Nada foi alterado",
      `<h1>Este link não está mais ativo</h1>
       <p>Ele veio de um e-mail de teste ou de uma mensagem muito antiga —
          por aqui, nada foi alterado no seu cadastro.</p>
       <div class="fio"></div>
       <p>Se você quer parar de receber nossos e-mails, use o link do rodapé
          da mensagem mais recente que chegou para você.</p>`, marca);
  }

  if (req.method === "GET") {
    return pagina("Sair da lista",
      `<h1>Quer parar de receber nossos e-mails?</h1>
       <p>Com um clique você sai de todas as nossas listas. Sem perguntas,
          sem espera — vale na hora.</p>
       <form method="POST"><button type="submit">Não quero mais receber</button></form>
       <p class="mini">Mudou de ideia? É só fechar esta página — nada acontece.</p>`, marca);
  }

  const { data: lead } = await supabase
    .from("tabela_1_leads").select("lead_id, email").eq("lead_id", envio.lead_fk).maybeSingle();

  if (lead) {
    await supabase.from("lead_listas")
      .update({ status: 2, updated_at: new Date().toISOString() })
      .eq("lead_fk", lead.lead_id);
    if (lead.email) {
      await supabase.from("supressao")
        .upsert({ email: lead.email, motivo: "unsubscribe_global", origem_envio_fk: envio.envio_id },
                { onConflict: "email", ignoreDuplicates: true });
    }
    await supabase.from("eventos_email").insert({
      envio_fk: envio.envio_id, lead_fk: lead.lead_id, tipo: "unsubscribe",
      occurred_at: new Date().toISOString(),
    });
    await supabase.from("eventos_sistema").insert({
      tipo: "lead_descadastrado", lead_fk: lead.lead_id,
      payload: { origem: "link_email", envio: envio.envio_id },
    });
  }

  return pagina("Pronto",
    `<h1>Pronto — você não receberá mais</h1>
     <p>Seu endereço saiu de todas as nossas listas, valendo já.</p>
     <div class="fio"></div>
     <p class="mini">Saiu sem querer? Responda qualquer e-mail nosso pedindo para voltar.</p>`, marca);
});
