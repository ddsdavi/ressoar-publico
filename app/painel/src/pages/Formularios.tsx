import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import Escolher from "../components/Escolher";
import Ajuda from "../components/Ajuda";

// Formulários de captação: monta aqui, publica num endereço próprio.
//
// A lista e a tag de destino ficam guardadas NO FORMULÁRIO, não são
// enviadas pela página. Assim ninguém consegue, chamando o endereço por
// fora, inscrever gente numa lista que o formulário não deveria tocar.

type Campo = { campo: string; rotulo: string; obrigatorio?: boolean };
type Form = {
  formulario_id: string; slug: string; nome: string; titulo: string; subtitulo: string;
  campos: Campo[]; lista_fk: number | null; tag_fk: number | null;
  botao: string; sucesso: string; redirecionar: string | null;
  cor: string; ativo: boolean; envios: number; created_at: string;
};

const PADRAO: Campo[] = [
  { campo: "nome", rotulo: "Seu nome", obrigatorio: true },
  { campo: "email", rotulo: "Seu melhor e-mail", obrigatorio: true },
];

const vazio = {
  slug: "", nome: "", titulo: "", subtitulo: "", campos: PADRAO,
  lista_fk: "", tag_fk: "", botao: "Quero participar",
  sucesso: "Pronto! Confira seu e-mail.", redirecionar: "", cor: "#82308f", ativo: true,
};

export default function Formularios() {
  const { podeOperar } = useSessao();
  const [forms, setForms] = useState<Form[]>([]);
  const [listas, setListas] = useState<{ lista_id: number; nome: string }[]>([]);
  const [tags, setTags] = useState<{ tag_id: number; nome: string }[]>([]);
  const [campos, setCampos] = useState<{ chave: string; rotulo: string }[]>([]);
  const [editando, setEditando] = useState<Form | "novo" | null>(null);
  const [instalando, setInstalando] = useState<Form | null>(null);
  const [modo, setModo] = useState<"html" | "link" | "prompt">("html");
  const [copiado, setCopiado] = useState("");
  const [f, setF] = useState<typeof vazio>(vazio);

  const base = location.origin;
  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/formulario`;

  function copiar(texto: string, qual: string) {
    navigator.clipboard?.writeText(texto);
    setCopiado(qual);
    setTimeout(() => setCopiado(""), 2200);
  }

  async function carregar() {
    const [a, l, t, c] = await Promise.all([
      supabase.from("formularios").select("*").order("created_at", { ascending: false }),
      supabase.from("listas").select("lista_id, nome").order("nome"),
      supabase.from("tags").select("tag_id, nome").order("nome"),
      supabase.from("campos_personalizados").select("chave, rotulo").order("rotulo"),
    ]);
    setForms((a.data as never) ?? []);
    setListas(l.data ?? []);
    setTags((t.data ?? []) as never);
    setCampos((c.data ?? []) as never);
  }
  useEffect(() => { carregar(); }, []);

  function abrir(x: Form | null) {
    setEditando(x ?? "novo");
    setF(x
      ? {
        slug: x.slug, nome: x.nome, titulo: x.titulo, subtitulo: x.subtitulo,
        campos: x.campos ?? PADRAO,
        lista_fk: x.lista_fk ? String(x.lista_fk) : "",
        tag_fk: x.tag_fk ? String(x.tag_fk) : "",
        botao: x.botao, sucesso: x.sucesso, redirecionar: x.redirecionar ?? "",
        cor: x.cor, ativo: x.ativo,
      }
      : vazio);
  }

  const gerarSlug = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

  async function salvar() {
    const slug = gerarSlug(f.slug || f.nome);
    if (!slug || !f.nome.trim()) { alert("Dê um nome ao formulário."); return; }
    if (!f.campos.some((c) => c.campo === "email")) {
      alert("O formulário precisa ter o campo de e-mail — é ele que identifica a pessoa.");
      return;
    }
    const dados = {
      slug, nome: f.nome.trim(), titulo: f.titulo.trim(), subtitulo: f.subtitulo.trim(),
      campos: f.campos,
      lista_fk: f.lista_fk ? Number(f.lista_fk) : null,
      tag_fk: f.tag_fk ? Number(f.tag_fk) : null,
      botao: f.botao.trim() || "Enviar",
      sucesso: f.sucesso.trim(),
      redirecionar: f.redirecionar.trim() || null,
      cor: f.cor, ativo: f.ativo, updated_at: new Date().toISOString(),
    };
    const r = editando === "novo"
      ? await supabase.from("formularios").insert(dados)
      : await supabase.from("formularios").update(dados)
          .eq("formulario_id", (editando as Form).formulario_id);
    if (r.error) {
      alert(r.error.message.includes("duplicate")
        ? `Já existe um formulário com o endereço "${slug}". Mude o nome.`
        : r.error.message);
      return;
    }
    setEditando(null); carregar();
  }

  async function excluir(x: Form) {
    if (!confirm(
      `Excluir o formulário "${x.nome}"?\n\n` +
      (x.envios > 0
        ? `Ele já recebeu ${x.envios} cadastro(s). Os leads NÃO são apagados — só o formulário. ` +
          "Mas o endereço para de funcionar na hora, e quem tiver o link vai ver erro."
        : "Nunca recebeu cadastro."))) return;
    await supabase.from("formularios").delete().eq("formulario_id", x.formulario_id);
    carregar();
  }

  function mudarCampo(i: number, patch: Partial<Campo>) {
    setF({ ...f, campos: f.campos.map((c, x) => (x === i ? { ...c, ...patch } : c)) });
  }

  // ---------- código para instalar no site ----------
  // O formulário embutido HERDA a identidade do site: fonte, cor do texto e
  // fundo vêm do que já está na página (font/color: inherit, fundo
  // transparente). Só o botão usa a cor escolhida aqui. É por isso que este
  // caminho respeita o visual e o iframe não: o iframe é uma página de fora,
  // com a tipografia dela.
  function codigoHtml(x: Form): string {
    const campos = (x.campos ?? []).map((c) => {
      const tipo = c.campo === "email" ? "email" : c.campo === "whatsapp" ? "tel" : "text";
      const auto = c.campo === "email" ? "email" : c.campo === "nome" ? "name" : "tel";
      const nome = ["nome", "email", "whatsapp"].includes(c.campo) ? c.campo : `atr_${c.campo}`;
      return `    <label>${c.rotulo}${c.obrigatorio ? " *" : ""}
      <input type="${tipo}" name="${nome}" autocomplete="${auto}"${c.obrigatorio ? " required" : ""}>
    </label>`;
    }).join("\n");

    return `<!-- Formulário ${x.nome} — Ressoar -->
<form class="ressoar-form" id="ressoar-${x.slug}" novalidate>
${campos}
  <button type="submit">${x.botao}</button>
  <p class="ressoar-erro" hidden></p>
</form>

<style>
  /* Herda a fonte e a cor do seu site — só o botão tem cor própria. */
  .ressoar-form { display: grid; gap: 14px; max-width: 420px; font: inherit; color: inherit; }
  .ressoar-form label { display: grid; gap: 6px; font-size: .875em; font-weight: 600; }
  .ressoar-form input {
    font: inherit; color: inherit; background: transparent;
    padding: 12px 13px; border: 1px solid rgba(128,128,128,.4); border-radius: 9px;
  }
  .ressoar-form input:focus { outline: 2px solid ${x.cor}; outline-offset: 1px; border-color: ${x.cor}; }
  .ressoar-form button {
    font: inherit; font-weight: 700; cursor: pointer; color: #fff;
    background: ${x.cor}; border: 0; border-radius: 9px; padding: 14px;
  }
  .ressoar-form button[disabled] { opacity: .6; cursor: progress; }
  .ressoar-erro { color: #d33; font-size: .85em; margin: 0; }
</style>

<script>
(function () {
  var f = document.getElementById('ressoar-${x.slug}');
  f.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var b = f.querySelector('button'), erro = f.querySelector('.ressoar-erro');
    var rotulo = b.textContent;
    erro.hidden = true; b.disabled = true; b.textContent = 'Enviando…';
    var dados = { form_slug: '${x.slug}', atributos: {} };
    new FormData(f).forEach(function (v, k) {
      if (k.indexOf('atr_') === 0) dados.atributos[k.slice(4)] = v; else dados[k] = v;
    });
    // repassa a origem do visitante (?utm_source=…), se houver
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (k.indexOf('utm_') === 0 || k === 'sck' || k === 'xcod') dados.atributos[k] = v;
    });
    try {
      var r = await fetch('${endpoint}', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.erro || 'Não deu certo. Tente de novo.');
      ${x.redirecionar
        ? `location.href = ${JSON.stringify(x.redirecionar)};`
        : `f.innerHTML = '<p>' + ${JSON.stringify(x.sucesso)} + '</p>';`}
    } catch (e) {
      erro.textContent = e.message; erro.hidden = false;
      b.disabled = false; b.textContent = rotulo;
    }
  });
})();
</script>`;
  }

  function codigoPrompt(x: Form): string {
    const lista = (x.campos ?? []).map((c) =>
      `- ${["nome", "email", "whatsapp"].includes(c.campo) ? c.campo : "atributos." + c.campo}` +
      ` = ${c.rotulo}${c.obrigatorio ? " (obrigatório)" : ""}`).join("\n");
    return `Faça o formulário desta página enviar os cadastros para a nossa plataforma.

Mantenha o visual do formulário exatamente como está. Ao enviar, faça um POST para:
${endpoint}

Corpo em JSON (também aceita form-data/urlencoded), com estes campos:
- form_slug = "${x.slug}"   (valor fixo, campo escondido)
${lista}

Não precisa de chave nem autenticação. Resposta de sucesso: HTTP 200 com
{"ok": true} — ${x.redirecionar ? `redirecione para ${x.redirecionar}` : `mostre a mensagem "${x.sucesso}"`}.
Se vier erro ({"erro": "mensagem"}), mostre essa mensagem, mantenha o que a
pessoa digitou e deixe tentar de novo. Enquanto envia, desabilite o botão e
troque o texto dele para "Enviando…".

Não altere nenhuma outra página, rota, dependência ou arquivo.`;
  }

  return (
    <div>
      <h1>Formulários</h1>
      <div className="sub">
        Página de captação hospedada no seu próprio domínio. Quem preenche entra na base
        na hora, e as automações da lista e da tag escolhidas disparam sozinhas.
        <Ajuda>
          A lista e a tag de destino ficam guardadas <b>no formulário</b>, nunca são
          enviadas pela página. É o que impede alguém de chamar o endereço por fora e
          inscrever gente numa lista que este formulário não deveria tocar — e lista com
          automação manda e-mail de verdade.
          <br /><br />
          O formulário também guarda a origem do visitante (utm_source e afins), e é dela
          que sai o relatório “de onde vem o dinheiro”.
        </Ajuda>
      </div>

      {podeOperar && (
        <div className="caixa">
          <button className="primario" onClick={() => abrir(null)}>+ Novo formulário</button>
        </div>
      )}

      <div className="caixa">
        <table>
          <thead><tr>
            <th>Formulário</th>
            <th>Endereço<Ajuda>O link da página pronta, no seu domínio. Serve para link na bio, anúncio ou mensagem, sem precisar de site nenhum.</Ajuda></th>
            <th>Destino<Ajuda>A lista em que a pessoa entra e a tag que ela ganha ao se inscrever — e, portanto, quais automações vão disparar.</Ajuda></th>
            <th>Cadastros<Ajuda>Quantas inscrições este formulário já recebeu. Zero depois de divulgar costuma ser o formulário desligado, ou o código não instalado na página.</Ajuda></th>
            <th>Status<Ajuda><b>No ar</b> aceita inscrição. <b>Desligado</b> devolve erro para quem tentar — o link não some, mas para de funcionar.</Ajuda></th>
            <th></th>
          </tr></thead>
          <tbody>
            {forms.map((x) => (
              <tr key={x.formulario_id}>
                <td><b>{x.nome}</b>
                  <div style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>
                    {x.titulo}
                  </div>
                </td>
                <td>
                  <a href={`${base}/f/${x.slug}`} target="_blank" rel="noreferrer"
                     style={{ fontSize: "calc(12.5px * var(--escala-texto))" }}>
                    /f/{x.slug}
                  </a>
                </td>
                <td style={{ fontSize: "calc(12.5px * var(--escala-texto))" }}>
                  {listas.find((l) => l.lista_id === x.lista_fk)?.nome ?? "—"}
                  {x.tag_fk && <div style={{ color: "var(--texto2)" }}>
                    tag: {tags.find((t) => t.tag_id === x.tag_fk)?.nome}</div>}
                </td>
                <td>{x.envios}</td>
                <td>
                  <span className={`etiqueta ${x.ativo ? "et-verde" : "et-cinza"}`}>
                    {x.ativo ? "no ar" : "desligado"}
                  </span>
                </td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  <button className="primario" onClick={() => { setInstalando(x); setModo("html"); }}>
                    Instalar no site
                  </button>{" "}
                  {podeOperar && <>
                    <button onClick={() => abrir(x)}>Editar</button>{" "}
                    <button className="perigo" onClick={() => excluir(x)}>Excluir</button>
                  </>}
                </td>
              </tr>
            ))}
            {!forms.length && (
              <tr><td colSpan={6} style={{ color: "var(--texto2)" }}>Nenhum formulário ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {instalando && (
        <div className="editor-tela">
          <div className="barra">
            <h2>Instalar “{instalando.nome}” no seu site</h2>
            <button onClick={() => setInstalando(null)}>Fechar</button>
          </div>
          <div className="corpo">
            <div style={{ maxWidth: 860, margin: "0 auto" }}>
              <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--borda)",
                            marginBottom: 18, flexWrap: "wrap" }}>
                {([
                  ["html", "Colar no meu site"],
                  ["prompt", "Pedir para a IA / programador"],
                  ["link", "Só divulgar o link"],
                ] as const).map(([id, rotulo]) => (
                  <button key={id} onClick={() => setModo(id)}
                    style={{
                      border: "none", background: "transparent", cursor: "pointer",
                      padding: "9px 16px", marginBottom: -1,
                      borderBottom: `2px solid ${modo === id ? "var(--marca)" : "transparent"}`,
                      color: modo === id ? "var(--texto)" : "var(--texto2)",
                      fontWeight: modo === id ? 700 : 400,
                    }}>{rotulo}</button>
                ))}
              </div>

              {modo === "html" && (
                <div className="caixa">
                  <h2>Um bloco de código, em qualquer construtor de site</h2>
                  <div className="sub">
                    Este formulário <b>herda a identidade do seu site</b>: a fonte, a cor do
                    texto e o fundo vêm da página onde ele for colado — só o botão usa a cor
                    que você escolheu. É o caminho que mantém o visual; o link e o iframe
                    trazem a aparência de fora.
                  </div>
                  <div className="sub" style={{ marginTop: 10 }}>
                    <b>WordPress:</b> bloco <i>HTML personalizado</i> (ou widget <i>HTML</i>, no
                    Elementor).<br />
                    <b>Lovable, Framer, Webflow e afins:</b> qualquer bloco de código ou
                    <i> embed</i>. Se o construtor não aceitar código, use a aba ao lado e peça
                    para a IA dele.
                  </div>
                  <button className="primario" style={{ margin: "12px 0" }}
                    onClick={() => copiar(codigoHtml(instalando), "html")}>
                    {copiado === "html" ? "Copiado ✓" : "Copiar o código"}
                  </button>
                  <pre style={{
                    background: "var(--ac-fundo)", border: "1px solid var(--ac-borda-suave)",
                    borderRadius: 8, padding: 14, overflowX: "auto", margin: 0,
                    fontSize: "calc(12px * var(--escala-texto))", lineHeight: 1.55,
                    maxHeight: 460, overflowY: "auto",
                  }}>{codigoHtml(instalando)}</pre>
                </div>
              )}

              {modo === "prompt" && (
                <div className="caixa">
                  <h2>Quando a página já tem um formulário bonito</h2>
                  <div className="sub">
                    Aí o melhor é o formulário continuar exatamente como está e só passar a
                    enviar para cá — visual intacto, sem código novo. Mande o texto abaixo
                    para quem cuida da página (ou cole no chat do Lovable).
                  </div>
                  <button className="primario" style={{ margin: "12px 0" }}
                    onClick={() => copiar(codigoPrompt(instalando), "prompt")}>
                    {copiado === "prompt" ? "Copiado ✓" : "Copiar o pedido"}
                  </button>
                  <pre style={{
                    background: "var(--ac-fundo)", border: "1px solid var(--ac-borda-suave)",
                    borderRadius: 8, padding: 14, overflowX: "auto", margin: 0,
                    fontSize: "calc(12.5px * var(--escala-texto))", lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}>{codigoPrompt(instalando)}</pre>
                </div>
              )}

              {modo === "link" && (
                <div className="caixa">
                  <h2>A página pronta, no seu domínio</h2>
                  <div className="sub">
                    Não precisa de site nenhum: serve para link na bio, anúncio ou mensagem.
                    O visual é o desta plataforma, com a cor que você escolheu — não o do seu
                    site. Para manter a identidade da sua página, use uma das outras abas.
                  </div>
                  <div className="linha" style={{ marginTop: 12 }}>
                    <input readOnly value={`${base}/f/${instalando.slug}`} />
                    <button className="primario" style={{ flex: "0 0 auto" }}
                      onClick={() => copiar(`${base}/f/${instalando.slug}`, "link")}>
                      {copiado === "link" ? "Copiado ✓" : "Copiar"}
                    </button>
                    <a className="botao" style={{ flex: "0 0 auto" }}
                      href={`${base}/f/${instalando.slug}`} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                  </div>
                </div>
              )}

              <div className="aviso">
                Depois de instalar, <b>faça uma inscrição de teste</b> com um e-mail e um
                celular que ainda não estejam na base — com dados que já existem, o sistema
                reconhece a pessoa e não dispara nada, e o teste passa sem provar nada.
              </div>
            </div>
          </div>
        </div>
      )}

      {editando && (
        <div className="editor-tela">
          <div className="barra">
            <h2>{editando === "novo" ? "Novo formulário" : "Editar formulário"}</h2>
            <label style={{ display: "flex", alignItems: "center", gap: 7, margin: 0,
                            flex: "0 0 auto", fontWeight: 400 }}>
              <input type="checkbox" checked={f.ativo}
                onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
              No ar
            </label>
            {editando !== "novo" && (
              <a className="botao" href={`${base}/f/${(editando as Form).slug}`}
                 target="_blank" rel="noreferrer" style={{ flex: "0 0 auto" }}>
                Ver a página
              </a>
            )}
            <button onClick={() => setEditando(null)}>Cancelar</button>
            <button className="primario" onClick={salvar}>Salvar</button>
          </div>

          <div className="corpo">
            <div className="grade">
              <div>
                {/* 1 */}
                <div className="caixa bloco">
                  <h3><span className="numero">1</span> Como se chama</h3>
                  <div className="sub">O nome interno é só seu. O endereço é o link que você divulga.</div>
                  <div className="duas">
                    <div>
                      <label>Nome interno</label>
                      <input value={f.nome} placeholder="Captação Lives Semanais"
                        onChange={(e) => setF({ ...f, nome: e.target.value })} />
                    </div>
                    <div>
                      <label>Endereço da página
                        <Ajuda>
                          O pedaço final do link, sem acento nem espaço. É por ele que o
                          sistema sabe em qual formulário a inscrição caiu.
                          <br /><br />
                          Depois de divulgado, <b>não mude</b>: todo link já publicado em
                          anúncio, bio ou e-mail passa a dar erro na hora.
                        </Ajuda>
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "var(--texto2)", flex: "0 0 auto",
                                       fontSize: "calc(12.5px * var(--escala-texto))" }}>/f/</span>
                        <input value={f.slug} placeholder={gerarSlug(f.nome) || "lives-semanais"}
                          onChange={(e) => setF({ ...f, slug: e.target.value })} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2 — o que a captação FAZ. É a decisão que importa. */}
                <div className="caixa bloco">
                  <h3><span className="numero">2</span> O que acontece com quem se inscrever</h3>
                  <div className="sub">
                    A pessoa entra na base e recebe isto. É aqui que a captação ganha sentido.
                  </div>
                  <div className="duas">
                    <div>
                      <label>Entra na lista</label>
                      <Escolher valor={f.lista_fk} aoMudar={(v) => setF({ ...f, lista_fk: v })} vazio="nenhuma"
                        opcoes={listas.map((l) => ({ valor: l.lista_id, rotulo: l.nome }))} />
                    </div>
                    <div>
                      <label>Ganha a tag</label>
                      <Escolher valor={f.tag_fk} aoMudar={(v) => setF({ ...f, tag_fk: v })} vazio="nenhuma"
                        opcoes={tags.map((t) => ({ valor: t.tag_id, rotulo: t.nome }))} />
                    </div>
                  </div>
                  <div className="aviso" style={{ margin: "12px 0 0" }}>
                    Entrar na lista ou receber a tag <b>dispara as automações ligadas a elas</b> —
                    inclusive as que mandam e-mail. Confira em Automações antes de divulgar o link.
                  </div>
                </div>

                {/* 3 */}
                <div className="caixa bloco">
                  <h3><span className="numero">3</span> O que o formulário pergunta
                    <Ajuda>
                      Cada campo a mais derruba a taxa de preenchimento — peça só o que você
                      vai usar de verdade.
                      <br /><br />
                      Além de nome, e-mail e WhatsApp, a lista de “adicionar campo” traz os
                      seus <b>campos próprios</b>: o que a pessoa responder fica guardado
                      nela e pode virar variável no e-mail ou filtro de segmento.
                    </Ajuda>
                  </h3>
                  <div className="sub">
                    O e-mail é obrigatório — é ele que identifica a pessoa. Para marcar alguém
                    no ManyChat, o WhatsApp também precisa estar aqui.
                  </div>
                  {f.campos.map((c, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                      <input style={{ flex: 1 }} value={c.rotulo}
                        onChange={(e) => mudarCampo(i, { rotulo: e.target.value })} />
                      <span style={{ flex: "0 0 90px", color: "var(--texto2)",
                                     fontSize: "calc(12px * var(--escala-texto))" }}>{c.campo}</span>
                      <label style={{ flex: "0 0 auto", display: "flex", alignItems: "center",
                                      gap: 6, margin: 0, fontWeight: 400 }}>
                        <input type="checkbox" checked={!!c.obrigatorio}
                          onChange={(e) => mudarCampo(i, { obrigatorio: e.target.checked })} />
                        obrigatório
                      </label>
                      <button className="perigo" style={{ flex: "0 0 auto" }}
                        disabled={c.campo === "email"}
                        title={c.campo === "email" ? "o e-mail identifica a pessoa e não pode sair" : "remover"}
                        onClick={() => setF({ ...f, campos: f.campos.filter((_, x) => x !== i) })}>−</button>
                    </div>
                  ))}
                  <Escolher valor="" style={{ marginTop: 4 }} vazio="+ adicionar campo…"
                    aoMudar={(v) => {
                      if (!v) return;
                      const [campo, rotulo] = v.split("|");
                      if (f.campos.some((c) => c.campo === campo)) return;
                      setF({ ...f, campos: [...f.campos, { campo, rotulo }] });
                    }}
                    opcoes={[
                      { valor: "whatsapp|WhatsApp", rotulo: "WhatsApp" },
                      ...campos.map((c) => ({ valor: `${c.chave}|${c.rotulo}`, rotulo: c.rotulo })),
                    ]} />
                </div>

                {/* 4 */}
                <div className="caixa bloco">
                  <h3><span className="numero">4</span> Como a página aparece</h3>
                  <div className="sub">Vá vendo o resultado na prévia ao lado.</div>
                  <label>Título que a pessoa vê</label>
                  <input value={f.titulo} placeholder="Receba os avisos das aulas"
                    onChange={(e) => setF({ ...f, titulo: e.target.value })} />
                  <label>Frase de apoio</label>
                  <input value={f.subtitulo} placeholder="Deixe seu melhor e-mail e avisamos antes de cada encontro."
                    onChange={(e) => setF({ ...f, subtitulo: e.target.value })} />
                  <div className="duas" style={{ gridTemplateColumns: "1fr 120px" }}>
                    <div>
                      <label>Texto do botão</label>
                      <input value={f.botao} onChange={(e) => setF({ ...f, botao: e.target.value })} />
                    </div>
                    <div>
                      <label>Cor</label>
                      <input type="color" value={f.cor} style={{ padding: 3 }}
                        onChange={(e) => setF({ ...f, cor: e.target.value })} />
                    </div>
                  </div>
                </div>

                {/* 5 */}
                <div className="caixa bloco">
                  <h3><span className="numero">5</span> Depois que a pessoa envia</h3>
                  <div className="sub">Ou uma mensagem na própria página, ou uma página de obrigado sua.</div>
                  <label>Mensagem de agradecimento</label>
                  <input value={f.sucesso} onChange={(e) => setF({ ...f, sucesso: e.target.value })} />
                  <label>Ou levar para este endereço (opcional)
                    <Ajuda>
                      Preenchido, ele <b>ganha da mensagem</b>: a pessoa é levada direto para
                      esse link. Use para sua página de obrigado — ou para o grupo de
                      WhatsApp, que é onde a maior parte das inscrições costuma se perder.
                      <br /><br />
                      É também a página que recebe o pixel de conversão do anúncio.
                    </Ajuda>
                  </label>
                  <input value={f.redirecionar} placeholder="https://…"
                    onChange={(e) => setF({ ...f, redirecionar: e.target.value })} />
                </div>
              </div>

              {/* prévia ao vivo */}
              <div className="previa-coluna">
                <div className="previa-cartao">
                  <div className="sub" style={{ margin: "0 0 12px", textAlign: "center" }}>
                    É assim que a pessoa vê
                  </div>
                  <div className="previa-caixa">
                    <h1 style={{ fontSize: "calc(20px * var(--escala-texto))", lineHeight: 1.3,
                                 margin: "0 0 8px" }}>
                      {f.titulo || f.nome || "Título do formulário"}
                    </h1>
                    {f.subtitulo && (
                      <p style={{ margin: "0 0 18px", color: "#6b6577", lineHeight: 1.5,
                                  fontSize: "calc(13.5px * var(--escala-texto))" }}>
                        {f.subtitulo}
                      </p>
                    )}
                    {f.campos.map((c) => (
                      <label key={c.campo}>
                        {c.rotulo}{c.obrigatorio && " *"}
                        <div className="campo-falso">
                          {c.campo === "email" ? "voce@email.com"
                            : c.campo === "whatsapp" ? "(11) 99999-9999" : ""}
                        </div>
                      </label>
                    ))}
                    <div style={{
                      marginTop: 16, height: 46, borderRadius: 9, background: f.cor,
                      color: "#fff", fontWeight: 700, display: "grid", placeItems: "center",
                      fontSize: "calc(15px * var(--escala-texto))",
                    }}>
                      {f.botao || "Enviar"}
                    </div>
                    <div style={{ textAlign: "center", marginTop: 14, color: "#8a8496",
                                  fontSize: "calc(11.5px * var(--escala-texto))" }}>
                      Seus dados não são compartilhados. Você pode sair quando quiser.
                    </div>
                  </div>
                  <div className="sub" style={{ margin: "12px 0 0", textAlign: "center",
                                                wordBreak: "break-all" }}>
                    {base}/f/{gerarSlug(f.slug || f.nome) || "…"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
