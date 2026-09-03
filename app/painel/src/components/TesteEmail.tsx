// Envio de teste com confirmação real do servidor — o mesmo fluxo aprovado
// em Campanhas ("🕐 confirmando…" → "✓ Enviado!" verde ou "✗ recusou"
// vermelho), empacotado para qualquer tela que tenha um e-mail para testar.
import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Versao = { rotulo?: string; assunto: string; html: string };

export default function TesteEmail({ versoes, preheader }: {
  versoes: Versao[]; preheader?: string;
}) {
  const [para, setPara] = useState("");
  const [andando, setAndando] = useState(false);
  const [msg, setMsg] = useState<{ tom: "andamento" | "ok" | "erro"; texto: string } | null>(null);
  const versao = useRef(0);

  async function enviar(v: Versao) {
    const minha = ++versao.current;
    const dizer = (tom: "andamento" | "ok" | "erro", texto: string) => {
      if (versao.current === minha) setMsg({ tom, texto });
    };
    if (!v.html.trim()) { dizer("erro", "Este e-mail está vazio — escreva algo antes de testar."); return; }
    setAndando(true);
    dizer("andamento", "Enviando o teste…");
    const { data, error } = await supabase.rpc("enviar_email_teste", {
      p_assunto: v.assunto, p_html: v.html, p_para: para.trim(),
      p_preheader: (preheader ?? "").trim() || null,
    });
    setAndando(false);
    if (error) {
      dizer("erro", "Não foi possível pedir o envio — tente de novo em instantes. (" + error.message + ")");
      return;
    }
    const r = (data ?? {}) as { ok?: boolean; mensagem?: string; req?: number };
    if (!r.ok) { dizer("erro", r.mensagem || "Não foi possível enviar o teste."); return; }
    if (!r.req) { dizer("ok", r.mensagem || "Teste a caminho de " + para.trim() + "."); return; }

    dizer("andamento", "A caminho de " + para.trim() + " — confirmando com o servidor…");
    for (let i = 0; i < 8; i++) {
      await new Promise((x) => setTimeout(x, 2500));
      if (versao.current !== minha) return;
      const { data: res } = await supabase.rpc("resultado_envio_teste", { p_req: r.req });
      const s = (res ?? {}) as { estado?: string; detalhe?: string };
      if (s.estado === "ok") {
        dizer("ok", "Enviado! O servidor aceitou o teste para " + para.trim() + ". Confira a caixa de entrada (e o spam).");
        return;
      }
      if (s.estado === "erro") {
        dizer("erro", "O servidor recusou o teste. Motivo: " + (s.detalhe || "sem detalhe") + " — corrija e tente de novo.");
        return;
      }
    }
    dizer("ok", "O envio foi pedido, mas o servidor ainda não confirmou — se nada chegar em ~2 minutos, tente de novo.");
  }

  const podeEnviar = !andando && !!para.trim();

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={para} onChange={(e) => setPara(e.target.value)}
          placeholder="e-mail para receber um teste" style={{ margin: 0, flex: 1 }} />
        {versoes.map((v, i) => (
          <button key={i} disabled={!podeEnviar || !v.html}
            onClick={() => enviar(v)}
            title={v.rotulo ? `Envia a versão ${v.rotulo} para o endereço` : undefined}>
            {andando ? "…" : v.rotulo ? `Testar ${v.rotulo}` : "Enviar teste"}
          </button>
        ))}
      </div>
      {msg && (
        <div style={{
          marginTop: 8, padding: "8px 12px", borderRadius: 8,
          fontSize: "calc(13px * var(--escala-texto))", lineHeight: 1.5,
          border: `1px solid ${msg.tom === "ok" ? "var(--verde)"
            : msg.tom === "erro" ? "var(--perigo)" : "var(--borda)"}`,
          color: msg.tom === "ok" ? "var(--verde)"
            : msg.tom === "erro" ? "var(--perigo)" : "var(--texto2)",
          fontWeight: msg.tom === "andamento" ? 400 : 600,
        }}>
          {msg.tom === "ok" ? "✓ " : msg.tom === "erro" ? "✗ " : "🕐 "}
          {msg.texto}
        </div>
      )}
      <div className="sub" style={{ marginTop: 6, fontSize: "calc(11.5px * var(--escala-texto))" }}>
        No teste, os links vão diretos ao destino; no envio real eles passam pelo nosso
        domínio para contar os cliques.
      </div>
    </div>
  );
}
