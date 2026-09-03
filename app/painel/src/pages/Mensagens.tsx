import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import EditorEmail from "../components/EditorEmail";
import Ajuda from "../components/Ajuda";
import Escolher from "../components/Escolher";
import PreviaEmail from "../components/PreviaEmail";
import TesteEmail from "../components/TesteEmail";
import Dialogos, { avisar, confirmar } from "../components/Dialogo";

type Msg = {
  mensagem_id: string; nome: string; from_name: string; from_email: string;
  subject: string; preheader: string | null; html: string; design: unknown | null;
  origem_ac_id: number | null; created_at: string;
};

// envio avulso: quem recebe, e o que o banco respondeu sobre esse público
type Alvo = "pessoas" | "lista" | "segmento";
type Pessoa = { lead_id: string; nome: string | null; email: string | null };
type Previa = { total: number; sem_email: number; bloqueados: number; vao_receber: number; pausado: boolean };

export default function Mensagens() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Msg | null>(null);
  const [editando, setEditando] = useState(false);
  const [editorVisual, setEditorVisual] = useState(false);
  const [form, setForm] = useState({ nome: "", subject: "", preheader: "", from_name: "", from_email: "", html: "" });
  const [padrao, setPadrao] = useState({ nome: "", email: "" });
  const [formDesign, setFormDesign] = useState<unknown | null>(null);
  const [endereco, setEndereco] = useState("");
  // ---- envio avulso ----
  const [enviarDe, setEnviarDe] = useState<Msg | null>(null);
  const [alvo, setAlvo] = useState<Alvo>("pessoas");
  const [listas, setListas] = useState<{ lista_id: number; nome: string }[]>([]);
  const [segmentos, setSegmentos] = useState<{ segmento_id: string; nome: string }[]>([]);
  const [listaSel, setListaSel] = useState("");
  const [segSel, setSegSel] = useState("");
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const [achados, setAchados] = useState<Pessoa[]>([]);
  const [escolhidas, setEscolhidas] = useState<Pessoa[]>([]);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function carregar() {
    const { data } = await supabase.from("mensagens")
      .select("mensagem_id, nome, from_name, from_email, subject, preheader, html, design, origem_ac_id, created_at")
      .order("created_at", { ascending: false }).limit(300);
    setMsgs((data as never) ?? []);
  }
  useEffect(() => { carregar(); }, []);

  // o remetente novo nasce do que está em Configurações — não de um valor
  // fixo no código, que envelhece e passa a apontar para domínio errado
  useEffect(() => {
    supabase.from("app_config").select("chave, valor")
      .in("chave", ["from_name_padrao", "from_email_padrao", "endereco_fisico"]).then(({ data }) => {
        const c = Object.fromEntries((data ?? []).map((r) => [r.chave, r.valor ?? ""]));
        setPadrao({ nome: c.from_name_padrao ?? "", email: c.from_email_padrao ?? "" });
        setEndereco(c.endereco_fisico ?? "");
      });
  }, []);

  // ------------------------------------------------------------------
  // Envio avulso: este e-mail, agora, sem criar campanha.
  //
  // Quem recebe é resolvido NO BANCO (previa_avulso / enviar_avulso) pela
  // mesma função, para o número que a pessoa confirma ser exatamente o
  // número que vai sair. Contar aqui no navegador daria diferença — e
  // numa ação sem desfazer, diferença é mentira.
  // ------------------------------------------------------------------
  function abrirEnvio(m: Msg) {
    setSel(null); setEditando(false);
    setEnviarDe(m); setAlvo("pessoas");
    setListaSel(""); setSegSel(""); setEscolhidas([]);
    setBuscaPessoa(""); setAchados([]); setPrevia(null);
    if (!listas.length) {
      supabase.from("listas").select("lista_id, nome").order("nome")
        .then(({ data }) => setListas(data ?? []));
      supabase.from("segmentos").select("segmento_id, nome").order("nome")
        .then(({ data }) => setSegmentos((data as never) ?? []));
    }
  }

  async function procurarPessoa(t: string) {
    setBuscaPessoa(t);
    const busca = t.trim();
    if (busca.length < 3) { setAchados([]); return; }
    const { data } = await supabase.from("tabela_1_leads")
      .select("lead_id, nome, email")
      .or(`email.ilike.%${busca}%,nome.ilike.%${busca}%`)
      .not("email", "is", null)
      .limit(8);
    setAchados((data as never) ?? []);
  }

  // a prévia é refeita a cada mudança de público — e zerada antes, para
  // não existir um instante em que o número na tela é do público anterior
  useEffect(() => {
    if (!enviarDe) return;
    const leads = alvo === "pessoas" ? escolhidas.map((p) => p.lead_id) : null;
    const lista = alvo === "lista" && listaSel ? Number(listaSel) : null;
    const seg = alvo === "segmento" && segSel ? segSel : null;
    if (!leads?.length && !lista && !seg) { setPrevia(null); return; }
    let atual = true;
    setPrevia(null);
    supabase.rpc("previa_avulso", { p_leads: leads, p_lista: lista, p_segmento: seg })
      .then(({ data }) => { if (atual) setPrevia((data as never) ?? null); });
    return () => { atual = false; };
  }, [enviarDe, alvo, escolhidas, listaSel, segSel]);

  async function enviarAgora() {
    if (!enviarDe || !previa) return;
    const quantos = previa.vao_receber;
    if (quantos < 1) {
      await avisar({ titulo: "Não há ninguém para receber", corpo: "Escolha outro público." });
      return;
    }
    const nomeAlvo = alvo === "pessoas"
      ? (escolhidas.length === 1 ? escolhidas[0].email : `${escolhidas.length} pessoas escolhidas`)
      : alvo === "lista" ? `a lista “${listas.find((l) => String(l.lista_id) === listaSel)?.nome ?? ""}”`
        : `o segmento “${segmentos.find((s) => s.segmento_id === segSel)?.nome ?? ""}”`;
    const ok = await confirmar({
      titulo: `Enviar “${enviarDe.nome}” para ${quantos === 1 ? "1 pessoa" : `${quantos.toLocaleString("pt-BR")} pessoas`}?`,
      corpo: (
        <>
          Vai para {nomeAlvo}. Não tem como cancelar depois que sai.
          {previa.bloqueados > 0 && <> {previa.bloqueados} pessoa(s) serão puladas por estarem bloqueadas.</>}
          {previa.pausado && <> <b>O envio está pausado agora</b> — os e-mails ficam na fila e saem
            quando alguém religar em Configurações.</>}
        </>
      ),
      confirmarTexto: "Enviar agora", perigo: true,
    });
    if (!ok) return;
    setEnviando(true);
    const { data, error } = await supabase.rpc("enviar_avulso", {
      p_mensagem: enviarDe.mensagem_id,
      p_leads: alvo === "pessoas" ? escolhidas.map((p) => p.lead_id) : null,
      p_lista: alvo === "lista" && listaSel ? Number(listaSel) : null,
      p_segmento: alvo === "segmento" && segSel ? segSel : null,
    });
    setEnviando(false);
    if (error) { await avisar({ titulo: "Não consegui enviar", corpo: error.message }); return; }
    const r = (data ?? {}) as { enfileirados: number; pulados: number; pausado: boolean };
    setEnviarDe(null);
    await avisar({
      titulo: `${r.enfileirados} e-mail(s) na fila`,
      corpo: (
        <>
          {r.pulados > 0 && <>{r.pulados} pessoa(s) foram puladas — sem endereço ou na lista de bloqueio. </>}
          {r.pausado
            ? <>O envio está <b>pausado</b>: eles saem assim que for religado em Configurações.</>
            : <>Saem em instantes, na velocidade do aquecimento. Acompanhe em Contatos › Envios e exclusões.</>}
        </>
      ),
    });
  }

  const filtradas = msgs.filter((m) =>
    !busca.trim() ||
    m.nome?.toLowerCase().includes(busca.toLowerCase()) ||
    m.subject?.toLowerCase().includes(busca.toLowerCase()));

  function abrirEdicao(m: Msg | null) {
    setEditando(true);
    setFormDesign(m?.design ?? null);
    setForm(m
      ? {
        nome: m.nome, subject: m.subject, preheader: m.preheader ?? "",
        from_name: m.from_name, from_email: m.from_email, html: m.html,
      }
      : {
        nome: "", subject: "", preheader: "",
        from_name: padrao.nome, from_email: padrao.email, html: "",
      });
  }

  async function salvar() {
    // diálogo próprio, nunca o confirm() nativo: o nativo congela a página
    // inteira (e qualquer automação/teste que esteja dirigindo o navegador)
    if (sel && !(await confirmar({
      titulo: "Salvar alterações nesta mensagem?",
      corpo: "Campanhas e automações futuras usarão a nova versão. O que já foi enviado não muda.",
      confirmarTexto: "Salvar",
    }))) return;
    const payload = { ...form, design: formDesign ?? null, updated_at: new Date().toISOString() };
    const r = sel
      ? await supabase.from("mensagens").update(payload).eq("mensagem_id", sel.mensagem_id)
      : await supabase.from("mensagens").insert(payload);
    if (r.error) { await avisar({ titulo: "Não foi possível salvar", corpo: r.error.message }); return; }
    setEditando(false); setSel(null); carregar();
  }

  async function duplicar(m: Msg) {
    await supabase.from("mensagens").insert({
      nome: m.nome + " (cópia)", subject: m.subject, from_name: m.from_name,
      from_email: m.from_email, preheader: m.preheader, html: m.html, design: m.design ?? null,
    });
    carregar();
  }

  return (
    <div>
      <Dialogos />
      <h1>Mensagens</h1>
      <div className="sub">{msgs.length} e-mails na biblioteca (importados do ActiveCampaign + novos)
        <Ajuda>
          É daqui que as <b>automações</b> puxam o que enviar — o passo “enviar e-mail”
          escolhe uma mensagem desta lista.
          <br /><br />
          A <b>campanha</b> usa esta lista de outro jeito: em “Usar uma pronta”, no passo da
          mensagem, ela leva uma <i>cópia</i> do e-mail escolhido — o que você mexer lá não
          volta para cá. O que a campanha enviar também é guardado aqui depois.
          <br /><br />
          Editar uma mensagem não mexe no que já foi enviado, mas vale para as próximas vezes
          que uma automação usar essa mensagem.
        </Ajuda>
      </div>
      <div className="caixa linha">
        <input placeholder="Buscar por nome ou assunto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="primario" style={{ flex: "0 0 auto" }} onClick={() => { setSel(null); abrirEdicao(null); }}>+ Nova mensagem</button>
      </div>
      <div className="caixa">
        <table>
          <thead><tr>
            <th>Nome<Ajuda>O nome interno, só para você achar a mensagem depois. Quem recebe nunca vê isto — vê o assunto.</Ajuda></th>
            <th>Assunto<Ajuda>O que aparece na caixa de entrada. Aceita {"{{nome}}"} para chamar cada pessoa pelo primeiro nome.</Ajuda></th>
            <th>Remetente<Ajuda>Nome e endereço que assinam o e-mail. Nasce do que está em Configurações, e pode ser mudado por mensagem.</Ajuda></th>
            <th>Origem<Ajuda><b>AC #</b> veio da migração do ActiveCampaign, com o número original de lá. <b>Própria</b> foi escrita aqui. As duas funcionam igual.</Ajuda></th>
            <th></th>
          </tr></thead>
          <tbody>
            {filtradas.map((m) => (
              <tr key={m.mensagem_id}>
                <td>{m.nome}</td>
                <td>{m.subject}</td>
                <td>{m.from_name} <span style={{ color: "var(--texto2)" }}>&lt;{m.from_email}&gt;</span></td>
                <td>{m.origem_ac_id
                  ? <span className="etiqueta et-cinza">AC #{m.origem_ac_id}</span>
                  : <span className="etiqueta et-roxa">própria</span>}</td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  <button className="primario" onClick={() => abrirEnvio(m)}>Enviar</button>{" "}
                  <button onClick={() => { setSel(m); setEditando(false); }}>Ver</button>{" "}
                  <button onClick={() => { setSel(m); abrirEdicao(m); }}>Editar</button>{" "}
                  <button onClick={() => duplicar(m)}>Duplicar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {enviarDe && (
        <div className="gaveta" style={{ width: 560 }}>
          <button className="fechar" onClick={() => setEnviarDe(null)}>✕</button>
          <h2>Enviar “{enviarDe.nome}”</h2>
          <div className="sub">
            {enviarDe.subject} · de {enviarDe.from_name} &lt;{enviarDe.from_email}&gt;
            <Ajuda>
              Sai agora, sem virar campanha. Serve para o e-mail de uma vez só: responder
              uma dúvida com o material pronto, mandar o link do encontro para quem
              perdeu, reenviar o comprovante.
              <br /><br />
              Quem está bloqueado (devolveu, reclamou de spam ou pediu para sair) continua
              protegido: é pulado aqui igual em campanha. E o e-mail sai com rastreio de
              abertura, de clique e com descadastro no rodapé, como todos os outros — por
              isso aparece depois em <b>Qualidade da conta</b>.
            </Ajuda>
          </div>

          <label style={{ marginTop: 14 }}>Para quem</label>
          <div className="chips" style={{ marginBottom: 10 }}>
            {([["pessoas", "Pessoas escolhidas"], ["lista", "Uma lista"], ["segmento", "Um segmento"]] as [Alvo, string][])
              .map(([id, rot]) => (
                <button key={id} className={"chip-filtro" + (alvo === id ? " on" : "")}
                  onClick={() => { setAlvo(id); setPrevia(null); }}>{rot}</button>
              ))}
          </div>

          {alvo === "pessoas" && (
            <>
              <input value={buscaPessoa} onChange={(e) => procurarPessoa(e.target.value)}
                placeholder="Buscar por e-mail ou nome (mínimo 3 letras)…" />
              {!!achados.length && (
                <div className="caixa" style={{ marginTop: 8, padding: "8px 10px" }}>
                  {achados.map((p) => (
                    <div key={p.lead_id} style={{ padding: "3px 0", fontSize: "calc(13px * var(--escala-texto))" }}>
                      <button className="link-tabela"
                        onClick={() => {
                          if (!escolhidas.some((x) => x.lead_id === p.lead_id)) setEscolhidas([...escolhidas, p]);
                          setBuscaPessoa(""); setAchados([]);
                        }}>
                        {p.nome ? `${p.nome} · ` : ""}{p.email}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!!escolhidas.length && (
                <div style={{ marginTop: 10 }}>
                  {escolhidas.map((p) => (
                    <span key={p.lead_id} className="etiqueta et-roxa">
                      {p.email}{" "}
                      <button className="link-tabela" style={{ padding: 0 }}
                        onClick={() => setEscolhidas(escolhidas.filter((x) => x.lead_id !== p.lead_id))}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {!escolhidas.length && <div className="sub" style={{ marginTop: 6 }}>Ninguém escolhido ainda.</div>}
            </>
          )}

          {alvo === "lista" && (
            <Escolher valor={listaSel} aoMudar={setListaSel}
              vazio="— escolher lista —"
              opcoes={listas.map((l) => ({ valor: l.lista_id, rotulo: l.nome }))} />
          )}

          {alvo === "segmento" && (
            <Escolher valor={segSel} aoMudar={setSegSel}
              vazio="— escolher segmento (salve em Leads → 💾) —"
              opcoes={segmentos.map((s) => ({ valor: s.segmento_id, rotulo: s.nome }))} />
          )}

          {previa && (
            <div className="caixa" style={{ marginTop: 14 }}>
              <b style={{ fontSize: "calc(17px * var(--escala-texto))" }}>
                {previa.vao_receber.toLocaleString("pt-BR")}
              </b>{" "}
              {previa.vao_receber === 1 ? "pessoa vai receber" : "pessoas vão receber"}
              {(previa.bloqueados > 0 || previa.sem_email > 0) && (
                <div className="sub" style={{ marginTop: 4 }}>
                  {previa.bloqueados > 0 && <>{previa.bloqueados} bloqueada(s) na supressão. </>}
                  {previa.sem_email > 0 && <>{previa.sem_email} sem endereço de e-mail. </>}
                  Nenhuma das duas recebe — e as duas aparecem no relatório, para você não
                  achar que sumiram.
                </div>
              )}
              {previa.pausado && (
                <div className="aviso atencao" style={{ marginTop: 10 }}>
                  <b className="titulo">O envio está pausado</b>
                  Dá para mandar: os e-mails ficam esperando na fila e saem quando o envio
                  for religado em <Link to="/config">Configurações</Link>.
                </div>
              )}
            </div>
          )}

          <div className="linha" style={{ marginTop: 14 }}>
            <button className="primario" disabled={!previa || previa.vao_receber < 1 || enviando}
              onClick={enviarAgora}>
              {enviando ? "Enviando…" : "Enviar agora"}
            </button>
            <button onClick={() => setEnviarDe(null)}>Cancelar</button>
          </div>
          <div className="sub" style={{ marginTop: 10 }}>
            Antes de mandar para muita gente, use o <b>teste</b> em “Ver” — ele manda a
            mensagem só para você, do mesmo jeito que ela vai sair.
          </div>
        </div>
      )}

      {(sel || editando) && !editorVisual && (
        <div className="gaveta" style={{ width: 640 }}>
          <button className="fechar" onClick={() => { setSel(null); setEditando(false); }}>✕</button>
          {!editando && sel ? (
            <>
              <h2>{sel.nome}</h2>
              <div className="sub">{sel.subject}</div>
              <PreviaEmail html={sel.html} altura={430} endereco={endereco} titulo={sel.nome} />
              <div style={{ marginTop: 12 }}>
                <TesteEmail preheader={sel.preheader ?? ""}
                  versoes={[{ assunto: sel.subject, html: sel.html }]} />
              </div>
            </>
          ) : (
            <>
              <h2>{sel ? "Editar mensagem" : "Nova mensagem"}</h2>
              <label>Nome interno</label>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              <label>Assunto (aceita {"{{nome}}"})
                <Ajuda>
                  Quem não tem nome cadastrado recebe o assunto sem a variável, nunca com{" "}
                  {"{{nome}}"} escrito no meio.
                  <br /><br />
                  Também valem os seus campos próprios: <code>{"{{campo.cidade}}"}</code>, por
                  exemplo. A lista completa está em <b>Campos</b>.
                </Ajuda>
              </label>
              <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              <label>Texto de prévia
                <Ajuda>
                  O trecho cinza que o Gmail mostra ao lado do assunto, antes de a pessoa
                  abrir. Depois do assunto, é o que mais mexe na taxa de abertura — e a
                  maioria dos e-mails desperdiça esse espaço.
                </Ajuda>
              </label>
              <input value={form.preheader} maxLength={140}
                placeholder="o trecho que aparece ao lado do assunto na caixa de entrada"
                onChange={(e) => setForm({ ...form, preheader: e.target.value })} />
              <div className="sub" style={{ marginTop: 4 }}>
                Depois do assunto, é o que mais mexe na taxa de abertura. Se ficar vazio, o
                cliente de e-mail mostra as primeiras palavras do corpo — quase sempre algo
                sem graça. Ideal entre 40 e 100 caracteres ({form.preheader.length} agora).
              </div>
              <div className="linha">
                <div><label>Nome do remetente</label>
                  <input value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} /></div>
                <div><label>E-mail do remetente</label>
                  <input value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} /></div>
              </div>
              <label>Conteúdo
                <Ajuda>
                  O editor visual monta o e-mail em blocos de arrastar e soltar, com as
                  cores e a fonte definidas em <b>Configurações → Aparência dos e-mails</b>.
                  <br /><br />
                  No envio, o sistema acrescenta sozinho o pixel de abertura, o rastreio dos
                  links, o descadastro e o endereço no rodapé — não precisa escrever nada
                  disso.
                </Ajuda>
              </label>
              <div className="linha" style={{ marginBottom: 8 }}>
                <button className="primario" onClick={() => setEditorVisual(true)}>🎨 Abrir editor visual</button>
              </div>
              {form.html && (
                <>
                  <PreviaEmail html={form.html} altura={280} endereco={endereco}
                    titulo={form.nome || "Prévia"} />
                  <div style={{ marginTop: 10 }}>
                    <TesteEmail preheader={form.preheader}
                      versoes={[{ assunto: form.subject, html: form.html }]} />
                  </div>
                </>
              )}
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--texto2)", cursor: "pointer" }}>editar HTML manualmente</summary>
                <div className="sub" style={{ marginTop: 6 }}>
                  Só para quem sabe HTML de e-mail.
                  <Ajuda>
                    Mexer aqui <b>desfaz o vínculo com o editor visual</b>: os blocos são
                    esquecidos e a mensagem passa a ser só o HTML que estiver escrito. Não dá
                    para voltar atrás depois de salvar.
                    <br /><br />
                    E-mail não é página: use tabelas e estilo na própria tag, porque boa
                    parte dos clientes ignora CSS externo.
                  </Ajuda>
                </div>
                <textarea rows={10} style={{ fontFamily: "monospace", fontSize: "calc(12px * var(--escala-texto))", marginTop: 6 }}
                  value={form.html} onChange={(e) => { setForm({ ...form, html: e.target.value }); setFormDesign(null); }} />
              </details>
              <div className="linha" style={{ marginTop: 14 }}>
                <button className="primario" onClick={salvar}>Salvar</button>
                <button onClick={() => { setEditando(false); setSel(null); }}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}

      {editorVisual && (
        <EditorEmail
          html={form.html}
          design={formDesign}
          onSalvar={(html, design) => { setForm({ ...form, html }); setFormDesign(design); setEditorVisual(false); }}
          onFechar={() => setEditorVisual(false)}
        />
      )}
    </div>
  );
}
