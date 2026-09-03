import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { avisar, pedirTexto } from "./Dialogo";

// Editor de TEXTO para e-mail — escrever como quem escreve uma mensagem,
// não montar layout. É o mesmo espírito dos editores do Ressoa e do Explora
// Mais, que o Davi aprovou, com o que faltava nos dois: personalização
// inserida no cursor, upload de imagem para o Storage, botão no meio do
// texto e emojis à mão.
//
// Por baixo é um contenteditable com execCommand. Sim, execCommand é
// "velho" — e é exatamente o que Gmail, Ressoa e Explora usam, porque para
// negrito/lista/link em e-mail ele resolve em qualquer navegador sem
// arrastar uma biblioteca de 300 KB junto.

// paleta no espírito do editor do Explora Mais: cores de sobra, mais a roda
// para qualquer tom — e marca-texto em tons pastéis que não brigam com a leitura
const CORES = [
  { cor: "#3c3646", nome: "Tinta" },
  { cor: "#6d6478", nome: "Cinza" },
  { cor: "#1f1a2e", nome: "Quase preto" },
  { cor: "#82308f", nome: "Roxo da marca" },
  { cor: "#a855f7", nome: "Roxo claro" },
  { cor: "#004cff", nome: "Azul" },
  { cor: "#0ea5e9", nome: "Azul céu" },
  { cor: "#0e8a4c", nome: "Verde" },
  { cor: "#34b64c", nome: "Verde vivo" },
  { cor: "#b45309", nome: "Âmbar" },
  { cor: "#f97316", nome: "Laranja" },
  { cor: "#d63031", nome: "Vermelho" },
  { cor: "#e11d8f", nome: "Rosa" },
  { cor: "#8a5a2b", nome: "Marrom" },
];

const MARCAS = [
  { cor: "#fff3a3", nome: "Amarelo" },
  { cor: "#d3f5df", nome: "Verde" },
  { cor: "#dbeafe", nome: "Azul" },
  { cor: "#fde2ef", nome: "Rosa" },
  { cor: "#ffe4c7", nome: "Laranja" },
  { cor: "#efe0f5", nome: "Lilás" },
];

const EMOJIS = ["✨", "💜", "🙌", "🎉", "🔥", "💡", "✅", "❗", "👉", "🗓", "⏰", "🎁", "📣", "🌿", "☀️", "🧘"];

const TAGS = [
  { tag: "{{nome}}", rotulo: "nome" },
  { tag: "{{nome_completo}}", rotulo: "nome completo" },
  { tag: "{{email}}", rotulo: "e-mail" },
];

export default function EditorTexto({ valor, aoMudar, altura = 480, corDestaque = "#82308f" }: {
  valor: string;
  aoMudar: (html: string) => void;
  altura?: number;
  // a cor do botão inserido no texto segue a marca configurada — antes era
  // fixa no código e podia divergir do botão da moldura
  corDestaque?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [mostraEmoji, setMostraEmoji] = useState(false);
  const [mostraCor, setMostraCor] = useState(false);
  const [subindo, setSubindo] = useState(false);

  // o valor inicial entra uma vez; depois o contenteditable é a fonte,
  // senão cada tecla recolocaria o cursor no começo
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== valor && document.activeElement !== ref.current) {
      ref.current.innerHTML = valor || "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avisarMudanca = () => { if (ref.current) aoMudar(ref.current.innerHTML); };

  const cmd = (comando: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(comando, false, arg);
    avisarMudanca();
  };

  const inserirHtml = (html: string) => {
    ref.current?.focus();
    document.execCommand("insertHTML", false, html);
    avisarMudanca();
  };

  async function inserirLink() {
    // guarda a seleção: o diálogo rouba o foco e o cursor se perderia
    const sel = window.getSelection();
    const trecho = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const url = await pedirTexto({
      titulo: "Endereço do link",
      corpo: "Para onde o clique leva. Precisa começar com https://",
      valor: "https://", placeholder: "https://…", confirmarTexto: "Inserir link",
    });
    if (url === null) return;
    if (!/^https:\/\/./.test(url.trim())) {
      await avisar({ titulo: "O link precisa começar com https://",
        corpo: "Sem isso o e-mail não sai com o link. Confira o endereço e tente de novo." });
      return;
    }
    ref.current?.focus();
    if (trecho) { sel?.removeAllRanges(); sel?.addRange(trecho); }
    if (sel && sel.toString()) {
      document.execCommand("createLink", false, url.trim());
      // cor da marca inline: sem ela o e-mail chega com o azul-padrão do cliente
      const a = sel.anchorNode?.parentElement?.closest("a");
      if (a) (a as HTMLElement).style.color = corDestaque;
    } else {
      inserirHtml(`<a href="${url.trim()}" style="color:${corDestaque}">${url.trim()}</a>`);
    }
    avisarMudanca();
  }

  async function subirImagem(ev: React.ChangeEvent<HTMLInputElement>) {
    const arq = ev.target.files?.[0];
    ev.target.value = "";
    if (!arq) return;
    setSubindo(true);
    const nome = `${Date.now()}-${arq.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const { error } = await supabase.storage.from("imagens").upload(nome, arq, {
      contentType: arq.type, upsert: false,
    });
    setSubindo(false);
    if (error) {
      await avisar({ titulo: "Não foi possível enviar a imagem",
        corpo: <>Tente de novo em instantes. Detalhe técnico: <small>{error.message}</small></> });
      return;
    }
    const { data } = supabase.storage.from("imagens").getPublicUrl(nome);
    const alt = (await pedirTexto({
      titulo: "Descreva a imagem em poucas palavras",
      corpo: "A descrição aparece se a imagem não carregar e é lida em voz alta para quem não enxerga. Pode deixar vazio.",
      placeholder: "ex.: Dra. Patrícia no consultório", confirmarTexto: "Usar imagem",
    })) ?? "";
    // width fixo além do CSS: o Outlook (motor Word) ignora max-width e
    // esticaria uma foto de celular para os 4000px originais
    inserirHtml(`<img src="${data.publicUrl}" alt="${alt.replace(/"/g, "&quot;")}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:8px;margin:12px auto" />`);
  }

  async function inserirBotao() {
    const texto = await pedirTexto({
      titulo: "Texto do botão", valor: "Quero participar", confirmarTexto: "Continuar",
    });
    if (!texto) return;
    const url = await pedirTexto({
      titulo: "Link do botão",
      corpo: "Para onde o clique leva. Precisa começar com https://",
      valor: "https://", placeholder: "https://…", confirmarTexto: "Inserir botão",
    });
    if (url === null) return;
    if (!/^https:\/\/./.test(url.trim())) {
      await avisar({ titulo: "O link precisa começar com https://",
        corpo: "Sem isso o botão não entra no e-mail. O texto que você digitou foi mantido — clique de novo em botão para tentar outra vez." });
      return;
    }
    inserirHtml(
      `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" style="padding:16px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" bgcolor="${corDestaque}" style="border-radius:8px">
              <a href="${url.trim()}" style="display:inline-block;padding:13px 30px;font-size:16px;
                 font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${texto}</a>
            </td></tr></table>
        </td></tr></table><p></p>`,
    );
  }

  // colar do Word/Google Docs traz spans com fontes e lixo mso — entra só a
  // estrutura (negrito, itálico, link, listas, parágrafos), sem o figurino
  function limparColagem(ev: React.ClipboardEvent) {
    const html = ev.clipboardData.getData("text/html");
    if (!html) return; // texto puro entra como está
    ev.preventDefault();
    const caixa = document.createElement("div");
    caixa.innerHTML = html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(style|script|meta|link|title|xml)[\s\S]*?(<\/\1>|>)/gi, "");
    const permitidas = new Set(["B", "STRONG", "I", "EM", "U", "S", "A", "P", "BR", "UL", "OL", "LI", "H2", "H3"]);
    const varrer = (no: Element) => {
      [...no.children].forEach((f) => varrer(f));
      if (!permitidas.has(no.tagName)) {
        no.replaceWith(...(no.tagName === "DIV" || no.tagName === "SPAN" || no.tagName === "FONT"
          ? [...no.childNodes]
          : [document.createTextNode(no.textContent ?? "")]));
        return;
      }
      const href = no.tagName === "A" ? no.getAttribute("href") : null;
      [...no.attributes].forEach((a) => no.removeAttribute(a.name));
      if (href && /^https?:\/\//.test(href)) no.setAttribute("href", href);
    };
    [...caixa.children].forEach((f) => varrer(f));
    inserirHtml(caixa.innerHTML);
  }

  const B = ({ onClick, title, children, ativo = false }: {
    onClick: () => void; title: string; children: React.ReactNode; ativo?: boolean;
  }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      style={{
        minWidth: 30, height: 30, padding: "0 7px", borderRadius: 7, cursor: "pointer",
        border: "1px solid transparent", background: ativo ? "var(--marca-fraca)" : "transparent",
        color: "var(--texto)", fontSize: 14, lineHeight: 1, display: "inline-flex",
        alignItems: "center", justifyContent: "center",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--marca-fraca)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = ativo ? "var(--marca-fraca)" : "transparent")}>
      {children}
    </button>
  );

  const Divisoria = () => (
    <span style={{ width: 1, height: 20, background: "var(--borda)", margin: "0 4px", alignSelf: "center" }} />
  );

  return (
    <div style={{ border: "1px solid var(--borda)", borderRadius: 12, overflow: "hidden", background: "var(--cartao, transparent)" }}>
      {/* ---- a barra, na linguagem dos editores que já funcionam ---- */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2,
        padding: "8px 10px", borderBottom: "1px solid var(--borda)", position: "relative",
      }}>
        <B onClick={() => cmd("undo")} title="Desfazer">↩</B>
        <B onClick={() => cmd("redo")} title="Refazer">↪</B>
        <Divisoria />
        <select
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => { cmd("formatBlock", e.target.value); e.target.value = ""; }}
          defaultValue=""
          title="Estilo do parágrafo"
          style={{
            height: 30, borderRadius: 7, border: "1px solid var(--borda)",
            // fundo sólido do tema: transparente fazia o Chrome desenhar o
            // widget claro do Windows dentro do cartão escuro
            background: "var(--cartao, transparent)", color: "var(--texto)",
            fontSize: 13, padding: "0 6px",
          }}>
          <option value="" disabled>Estilo</option>
          <option value="p">Texto normal</option>
          <option value="h2">Título</option>
          <option value="h3">Subtítulo</option>
        </select>
        <Divisoria />
        <B onClick={() => cmd("bold")} title="Negrito"><b>B</b></B>
        <B onClick={() => cmd("italic")} title="Itálico"><i>I</i></B>
        <B onClick={() => cmd("underline")} title="Sublinhado"><u>U</u></B>
        <B onClick={() => cmd("strikeThrough")} title="Riscado"><s>S</s></B>
        <span style={{ position: "relative" }}>
          <B onClick={() => { setMostraCor(!mostraCor); setMostraEmoji(false); }} title="Cor e marca-texto">
            <span style={{ borderBottom: "3px solid #82308f", paddingBottom: 1 }}>A</span>
          </B>
          {mostraCor && (
            <span style={{
              position: "absolute", top: 34, left: -60, zIndex: 30, display: "block",
              padding: 10, borderRadius: 12, background: "var(--cartao, #fff)", width: 216,
              border: "1px solid var(--borda)", boxShadow: "0 6px 18px rgba(0,0,0,.18)",
            }}>
              <span className="sub" style={{ display: "block", margin: "0 0 6px", fontSize: 11 }}>COR DA LETRA</span>
              <span style={{ display: "grid", gridTemplateColumns: "repeat(7, 26px)", gap: 4 }}>
                {CORES.map((c) => (
                  <button key={c.cor} type="button" title={c.nome}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { cmd("foreColor", c.cor); setMostraCor(false); }}
                    style={{
                      width: 22, height: 22, borderRadius: "50%", cursor: "pointer",
                      background: c.cor, border: "2px solid #fff", boxShadow: "0 0 0 1px var(--borda)",
                    }} />
                ))}
                {/* a roda: qualquer cor do mundo, como no Explora */}
                <label title="Escolher qualquer cor" style={{
                  width: 22, height: 22, borderRadius: "50%", cursor: "pointer", overflow: "hidden",
                  background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
                  border: "2px solid #fff", boxShadow: "0 0 0 1px var(--borda)", display: "inline-block",
                }}>
                  <input type="color" style={{ opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
                    onChange={(e) => { cmd("foreColor", e.target.value); setMostraCor(false); }} />
                </label>
              </span>
              <span className="sub" style={{ display: "block", margin: "10px 0 6px", fontSize: 11 }}>MARCA-TEXTO</span>
              <span style={{ display: "grid", gridTemplateColumns: "repeat(7, 26px)", gap: 4 }}>
                {MARCAS.map((c) => (
                  <button key={c.cor} type="button" title={`Destacar de ${c.nome.toLowerCase()}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { cmd("hiliteColor", c.cor); setMostraCor(false); }}
                    style={{
                      width: 22, height: 22, borderRadius: 6, cursor: "pointer",
                      background: c.cor, border: "2px solid #fff", boxShadow: "0 0 0 1px var(--borda)",
                    }} />
                ))}
                <button type="button" title="Tirar o marca-texto"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { cmd("hiliteColor", "transparent"); setMostraCor(false); }}
                  style={{
                    width: 22, height: 22, borderRadius: 6, cursor: "pointer", fontSize: 12,
                    background: "transparent", border: "1px dashed var(--borda)", color: "var(--texto2)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>✕</button>
              </span>
            </span>
          )}
        </span>
        <Divisoria />
        <B onClick={() => cmd("justifyLeft")} title="Alinhar à esquerda">⇤</B>
        <B onClick={() => cmd("justifyCenter")} title="Centralizar">≡</B>
        <B onClick={() => cmd("justifyRight")} title="Alinhar à direita">⇥</B>
        <Divisoria />
        <B onClick={() => cmd("insertUnorderedList")} title="Lista com pontos">•≡</B>
        <B onClick={() => cmd("insertOrderedList")} title="Lista numerada">1.≡</B>
        <Divisoria />
        <B onClick={inserirLink} title="Inserir link">🔗</B>
        <B onClick={() => arquivoRef.current?.click()} title="Inserir imagem">🖼</B>
        <B onClick={inserirBotao} title="Inserir um botão no meio do texto">▭</B>
        <B onClick={() => inserirHtml('<hr style="border:none;border-top:1px solid #e6e2da;margin:18px 0" />')}
          title="Linha divisória">—</B>
        <span style={{ position: "relative" }}>
          <B onClick={() => { setMostraEmoji(!mostraEmoji); setMostraCor(false); }} title="Emoji">😊</B>
          {mostraEmoji && (
            <span style={{
              position: "absolute", top: 34, left: -80, zIndex: 30, display: "grid",
              gridTemplateColumns: "repeat(8, 28px)", gap: 2, padding: 8, borderRadius: 10,
              background: "var(--cartao, #fff)", border: "1px solid var(--borda)",
              boxShadow: "0 6px 18px rgba(0,0,0,.18)",
            }}>
              {EMOJIS.map((e) => (
                <button key={e} type="button" onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => { inserirHtml(e); setMostraEmoji(false); }}
                  style={{ border: "none", background: "transparent", fontSize: 17, cursor: "pointer", padding: 2 }}>
                  {e}
                </button>
              ))}
            </span>
          )}
        </span>
        <Divisoria />
        {TAGS.map((t) => (
          <button key={t.tag} type="button" title={`Insere ${t.rotulo} da pessoa neste ponto do texto`}
            onMouseDown={(e) => e.preventDefault()} onClick={() => inserirHtml(t.tag)}
            style={{
              height: 26, padding: "0 9px", borderRadius: 999, cursor: "pointer",
              border: "1px dashed var(--marca)", background: "transparent",
              color: "var(--marca)", fontSize: 12,
            }}>
            {t.rotulo}
          </button>
        ))}
        <Divisoria />
        <B onClick={() => cmd("removeFormat")} title="Limpar formatação (volta ao texto simples)">🧹</B>
        {subindo && <span className="sub" style={{ margin: "0 0 0 8px" }}>enviando imagem…</span>}
      </div>

      {/* ---- a folha ---- */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onPaste={limparColagem}
        onInput={avisarMudanca}
        onBlur={avisarMudanca}
        data-placeholder="Escreva a mensagem como você falaria com uma pessoa só…"
        style={{
          minHeight: altura, padding: "16px 18px", outline: "none", background: "#fff",
          color: "#3c3646", fontSize: 16, lineHeight: 1.65,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      />
      <style>{`
        [contenteditable][data-placeholder]:empty:before {
          content: attr(data-placeholder); color: #a79fb3; pointer-events: none;
        }
        [contenteditable] h2 { font-size: 22px; line-height: 1.35; margin: 18px 0 8px; color: #1f1a2e; }
        [contenteditable] h3 { font-size: 18px; line-height: 1.4; margin: 14px 0 6px; color: #1f1a2e; }
        [contenteditable] p { margin: 0 0 12px; }
        [contenteditable] a { color: #82308f; }
      `}</style>

      <input ref={arquivoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={subirImagem} />
    </div>
  );
}
