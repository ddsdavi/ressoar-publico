import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

// A página do formulário, vista por quem vai se cadastrar.
//
// Fica FORA da área logada de propósito: quem preenche não tem conta.
// E fica no domínio do Ressoar, não no do Supabase — o domínio de funções
// força text/plain em HTML (proteção contra hospedarem página falsa lá),
// e endereço próprio passa mais confiança em página de captação.

type Campo = { campo: string; rotulo: string; obrigatorio?: boolean };
type Form = {
  slug: string; nome: string; titulo: string; subtitulo: string;
  campos: Campo[]; botao: string; sucesso: string;
  redirecionar: string | null; cor: string;
};

export default function FormularioPublico() {
  const { slug } = useParams();
  const [form, setForm] = useState<Form | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    document.body.dataset.publico = "1";
    supabase.from("formularios")
      .select("slug, nome, titulo, subtitulo, campos, botao, sucesso, redirecionar, cor")
      .eq("slug", slug).eq("ativo", true).maybeSingle()
      .then(({ data }) => {
        if (!data) setErroCarga("Este formulário não está disponível.");
        else setForm(data as Form);
      });
    return () => { delete document.body.dataset.publico; };
  }, [slug]);

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setErro(""); setEnviando(true);

    const atributos: Record<string, string> = {};

    // A origem do visitante vem na URL da landing (?utm_source=…&sck=…&xcod=…).
    // Capturar aqui é o que torna a atribuição honesta: sem isso, só quem
    // COMPRA tem origem, e qualquer taxa de conversão sai 100% — o
    // denominador teria só quem já converteu.
    const url = new URLSearchParams(location.search);
    for (const [k, v] of url.entries()) {
      if (!v) continue;
      if (k === "sck") atributos.hotmart_sck = v;
      else if (k === "xcod") atributos.hotmart_xcod = v;
      else if (k.startsWith("utm_")) atributos["hotmart_" + k.slice(4)] = v;
    }

    const corpo: Record<string, unknown> = { form_slug: form.slug };
    for (const [k, v] of Object.entries(valores)) {
      if (["nome", "email", "whatsapp"].includes(k)) corpo[k] = v;
      else if (v) atributos[k] = v;
    }
    if (Object.keys(atributos).length) corpo.atributos = atributos;

    try {
      const base = import.meta.env.VITE_SUPABASE_URL ?? "";
      const r = await fetch(`${base}/functions/v1/formulario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || "Não deu certo. Tente de novo.");
      if (form.redirecionar) { location.href = form.redirecionar; return; }
      setPronto(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu certo. Tente de novo.");
      setEnviando(false);
    }
  }

  const caixa: React.CSSProperties = {
    maxWidth: 460, margin: "0 auto", background: "var(--ac-superficie, #fff)",
    borderRadius: 14, padding: "28px 24px", boxShadow: "0 2px 14px rgba(36,10,52,.08)",
  };
  const fundo: React.CSSProperties = {
    minHeight: "100vh", padding: "24px 16px", background: "var(--ac-fundo, #f4f1ec)",
  };

  if (erroCarga) {
    return <div style={fundo}><div style={caixa}><p>{erroCarga}</p></div></div>;
  }
  if (!form) {
    return <div style={fundo}><div style={caixa}><p className="sub">Carregando…</p></div></div>;
  }
  if (pronto) {
    return (
      <div style={fundo}>
        <div style={{ ...caixa, textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>✓</div>
          <p style={{ fontSize: "calc(17px * var(--escala-texto))", lineHeight: 1.5 }}>{form.sucesso}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={fundo}>
      <div style={caixa}>
        <h1 style={{ fontSize: "calc(22px * var(--escala-texto))", lineHeight: 1.3, margin: "0 0 8px" }}>
          {form.titulo || form.nome}
        </h1>
        {form.subtitulo && (
          <p style={{ margin: "0 0 22px", color: "var(--ac-texto2)", lineHeight: 1.55 }}>
            {form.subtitulo}
          </p>
        )}

        <form onSubmit={enviar} noValidate>
          {form.campos.map((c) => (
            <div key={c.campo}>
              <label>
                {c.rotulo}{c.obrigatorio && " *"}
              </label>
              <input
                type={c.campo === "email" ? "email" : c.campo === "whatsapp" ? "tel" : "text"}
                required={c.obrigatorio}
                autoComplete={c.campo === "email" ? "email" : c.campo === "nome" ? "name" : "tel"}
                value={valores[c.campo] ?? ""}
                onChange={(e) => setValores({ ...valores, [c.campo]: e.target.value })}
              />
            </div>
          ))}

          <button type="submit" disabled={enviando}
            style={{
              width: "100%", marginTop: 18, height: 48, fontSize: "calc(16px * var(--escala-texto))",
              fontWeight: 700, color: "#fff", background: form.cor, border: 0, borderRadius: 9,
              cursor: enviando ? "progress" : "pointer", opacity: enviando ? 0.6 : 1,
            }}>
            {enviando ? "Enviando…" : form.botao}
          </button>
          {erro && (
            <div style={{ color: "#b3261e", fontSize: "calc(13.5px * var(--escala-texto))", marginTop: 10 }}>
              {erro}
            </div>
          )}
        </form>

        <div style={{
          textAlign: "center", marginTop: 18, color: "var(--ac-texto2)",
          fontSize: "calc(12px * var(--escala-texto))",
        }}>
          Seus dados não são compartilhados. Você pode sair quando quiser.
        </div>
      </div>
    </div>
  );
}
