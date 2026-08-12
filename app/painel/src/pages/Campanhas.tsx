import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import EditorEmail from "../components/EditorEmail";
import { useNavigate } from "react-router-dom";
import Escolher from "../components/Escolher";
import Ajuda from "../components/Ajuda";

// Os tipos de campanha. Só entram aqui os que o motor executa de verdade —
// dois deles não são campanha, são automação, e por isso levam para lá em
// vez de fingir que fazem algo. Tipo bonito que não dispara nada é pior que
// tipo nenhum: a pessoa monta, agenda e fica esperando um e-mail que nunca sai.
const TIPOS = [
  {
    id: "padrao", icone: "✉", titulo: "Padrão",
    desc: "Enviar uma campanha de e-mail única",
    onde: "aqui",
  },
  {
    id: "ab", icone: "⚖", titulo: "Teste A/B",
    desc: "Comparar duas versões e mandar a vencedora para o resto da base",
    onde: "aqui",
  },
  {
    id: "automatizado", icone: "⛓", titulo: "Automatizado",
    desc: "Criar sequências de e-mails com esperas e condições",
    onde: "/automacoes",
  },
  {
    id: "autoresposta", icone: "↩", titulo: "Atendimento automático",
    desc: "Um e-mail que sai depois que alguém se inscreve",
    onde: "/automacoes",
    ajuda: "É uma automação com o gatilho \"Inscreve-se em uma lista\" — mesmo motor, e você ainda pode acrescentar passos depois.",
  },
  {
    id: "data", icone: "🎂", titulo: "Com base em data",
    desc: "Envia no aniversário do contato, ou em outra data guardada nele",
    onde: "/automacoes",
    ajuda: "É uma automação com o gatilho \"Chega uma data do contato\", que confere os campos de data uma vez por dia.",
  },
];

type Stats = {
  campanha_id: string; nome: string; status: string;
  tipo?: string; vencedor?: string | null;
  enviados: number; suprimidos: number; aberturas_unicas: number;
  cliques_unicos: number; hard_bounces: number; descadastros: number;
};
type Lista = { lista_id: number; nome: string };
type Segmento = { segmento_id: string; nome: string; definicao: Record<string, unknown> };

type Relatorio = {
  abriram: { email: string; quando: string }[];
  cliques: { url: string; total: number; unicos: number }[];
  bounces: string[];
  descadastros: string[];
};

const STATUS: Record<string, string> = {
  draft: "et-cinza", scheduled: "et-amarela", sending: "et-roxa",
  sent: "et-verde", paused: "et-amarela", cancelled: "et-vermelha",
};

export default function Campanhas() {
  const { podeOperar } = useSessao();
  const [stats, setStats] = useState<Stats[]>([]);
  const [listas, setListas] = useState<Lista[]>([]);
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const navegar = useNavigate();
  const [criando, setCriando] = useState(false);
  const [etapa, setEtapa] = useState(1);
  const [tipo, setTipo] = useState("padrao");
  const [nome, setNome] = useState("");

  // o e-mail é escrito aqui dentro, não escolhido de uma gaveta
  const [assunto, setAssunto] = useState("");
  const [preheader, setPreheader] = useState("");
  const [deNome, setDeNome] = useState("");
  const [deEmail, setDeEmail] = useState("");
  const [respostaIgual, setRespostaIgual] = useState(true);
  const [respostaEmail, setRespostaEmail] = useState("");
  const [html, setHtml] = useState("");
  const [design, setDesign] = useState<unknown>(null);
  const [editando, setEditando] = useState(false);

  // versão B, só no teste A/B
  const [assuntoB, setAssuntoB] = useState("");
  const [htmlB, setHtmlB] = useState("");
  const [designB, setDesignB] = useState<unknown>(null);
  const [editandoB, setEditandoB] = useState(false);
  const [fatia, setFatia] = useState(30);

  const [rastreiaAbertura, setRastreiaAbertura] = useState(true);
  const [rastreiaClique, setRastreiaClique] = useState(true);
  const [monitoraResposta, setMonitoraResposta] = useState(false);
  const [arquivoPublico, setArquivoPublico] = useState(true);
  const [endereco, setEndereco] = useState("");
  const [quantos, setQuantos] = useState<number | null>(null);
  const [tipoAud, setTipoAud] = useState<"listas" | "segmento">("listas");
  const [listasSel, setListasSel] = useState<number[]>([]);
  const [segSel, setSegSel] = useState("");
  const [agendarEm, setAgendarEm] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [relDe, setRelDe] = useState<Stats | null>(null);
  const [rel, setRel] = useState<Relatorio | null>(null);

  async function carregar() {
    const [s, l, g] = await Promise.all([
      supabase.from("campanha_stats").select("*").order("nome"),
      supabase.from("listas").select("lista_id, nome").order("nome"),
      supabase.from("segmentos").select("*").order("nome"),
    ]);
    setStats((s.data as Stats[]) ?? []);
    setListas(l.data ?? []);
    setSegmentos((g.data as never) ?? []);

    // remetente e endereço vêm da configuração — datilografar isso a cada
    // campanha é como o remetente errado entra em produção
    const { data: cfg } = await supabase.from("app_config").select("chave, valor");
    const c = Object.fromEntries((cfg ?? []).map((r) => [r.chave, r.valor ?? ""]));
    setDeNome((v) => v || c.from_name_padrao || "");
    setDeEmail((v) => v || c.from_email_padrao || "");
    setRespostaEmail((v) => v || c.reply_to_padrao || "");
    setEndereco(c.endereco_fisico || "");
  }
  useEffect(() => { carregar(); }, []);

  // Conta o público de verdade, no banco. Somar no navegador não serve:
  // o PostgREST devolve no máximo mil linhas e a conta sairia errada
  // justamente nas listas grandes, que são as que importam.
  useEffect(() => {
    (async () => {
      setQuantos(null);
      if (tipoAud === "listas") {
        if (!listasSel.length) return;
        const { count } = await supabase
          .from("lead_listas")
          .select("lead_fk", { count: "exact", head: true })
          .in("lista_fk", listasSel).eq("status", 1);
        setQuantos(count ?? null);
      } else if (segSel) {
        const seg = segmentos.find((x) => x.segmento_id === segSel);
        if (!seg) return;
        const { data } = await supabase.rpc("contar_segmento", { p_def: seg.definicao });
        setQuantos(data ?? null);
      }
    })();
  }, [tipoAud, listasSel, segSel, segmentos]);

  // Tudo que impede o disparo, numa lista só. Devolver o primeiro erro faria
  // a pessoa corrigir, tentar, tomar o segundo, corrigir, tentar de novo.
  function pendencias(): string[] {
    const p: string[] = [];
    if (!nome.trim()) p.push("dê um nome à campanha");
    if (!assunto.trim()) p.push("escreva o assunto");
    if (!deNome.trim() || !deEmail.trim()) p.push("preencha o remetente");
    if (!html.trim()) p.push("escreva o e-mail no editor");
    if (tipo === "ab" && !htmlB.trim()) p.push("escreva a versão B");
    if (tipo === "ab" && !assuntoB.trim()) p.push("escreva o assunto da versão B");
    if (tipoAud === "listas" && !listasSel.length) p.push("escolha ao menos uma lista");
    if (tipoAud === "segmento" && !segSel) p.push("escolha um segmento");
    if (!endereco.trim()) p.push("configure o endereço físico em Configurações");
    return p;
  }

  async function gravarMensagem(sufixo: string, assuntoM: string, htmlM: string, designM: unknown) {
    const { data, error } = await supabase.from("mensagens").insert({
      nome: nome.trim() + sufixo,
      subject: assuntoM.trim(),
      preheader: preheader.trim() || null,
      from_name: deNome.trim(),
      from_email: deEmail.trim(),
      reply_to: respostaIgual ? deEmail.trim() : (respostaEmail.trim() || null),
      html: htmlM,
      design: designM,
    }).select("mensagem_id").single();
    if (error) throw new Error(error.message);
    return data.mensagem_id as string;
  }

  async function criar(disparar: boolean) {
    const faltando = pendencias();
    if (faltando.length) { alert("Antes de seguir:\n\n· " + faltando.join("\n· ")); return; }
    setOcupado(true);
    try {
      const idA = await gravarMensagem(tipo === "ab" ? " · A" : "", assunto, html, design);
      const idB = tipo === "ab" ? await gravarMensagem(" · B", assuntoB, htmlB, designB) : null;

      const { data, error } = await supabase.from("campanhas").insert({
        nome: nome.trim(),
        tipo,
        mensagem_fk: idA,
        mensagem_b_fk: idB,
        percentual_teste: tipo === "ab" ? fatia : 100,
        lista_ids: tipoAud === "listas" ? listasSel : null,
        segmento_fk: tipoAud === "segmento" ? segSel : null,
        track_opens: rastreiaAbertura,
        track_clicks: rastreiaClique,
        monitorar_resposta: monitoraResposta,
        arquivo_publico: arquivoPublico,
        status: agendarEm && !disparar ? "scheduled" : "draft",
        scheduled_at: agendarEm && !disparar ? new Date(agendarEm).toISOString() : null,
      }).select("campanha_id").single();
      if (error) throw new Error(error.message);

      if (disparar) {
        const { data: qtd, error: e2 } = await supabase.rpc("disparar_campanha", { p_campanha: data.campanha_id });
        if (e2) throw new Error(e2.message);
        alert(tipo === "ab"
          ? `Teste disparado: ${qtd} e-mails, metade com cada versão. Veja o placar na lista e depois mande a vencedora para o restante.`
          : `Campanha disparada: ${qtd} e-mails enfileirados (respeitando supressão e status).`);
      }
      limpar();
      carregar();
    } catch (e) {
      alert((e as Error).message);
    }
    setOcupado(false);
  }

  function limpar() {
    setCriando(false); setEtapa(1); setTipo("padrao");
    setNome(""); setListasSel([]); setSegSel(""); setAgendarEm("");
    setAssunto(""); setPreheader(""); setHtml(""); setDesign(null);
    setAssuntoB(""); setHtmlB(""); setDesignB(null);
  }

  async function abrirPlacar(c: Stats) {
    const { data, error } = await supabase.rpc("placar_ab", { p_campanha: c.campanha_id });
    if (error) { alert(error.message); return; }
    const p = (data ?? {}) as Record<string, { enviados: number; aberturas: number; cliques: number }>;
    if (!p.A && !p.B) { alert("O teste ainda não tem envio registrado."); return; }
    const linha = (k: string) => {
      const v = p[k] ?? { enviados: 0, aberturas: 0, cliques: 0 };
      const pct = (n: number) => v.enviados ? ` (${Math.round(n * 100 / v.enviados)}%)` : "";
      return `Versão ${k}: ${v.enviados} enviados · ${v.aberturas} aberturas${pct(v.aberturas)} · ${v.cliques} cliques${pct(v.cliques)}`;
    };
    const qual = prompt(
      [
        linha("A"),
        linha("B"),
        "",
        "Poucos envios? Então a diferença ainda pode ser sorte — o sistema não escolhe por você.",
        "",
        "Digite A ou B para mandar essa versão ao restante do público, ou cancele.",
      ].join("\n"));
    if (qual && ["A", "B"].includes(qual.trim().toUpperCase())) {
      await mandarVencedor(c.campanha_id, qual.trim().toUpperCase());
    }
  }

  async function mandarVencedor(id: string, qual: string) {
    if (!confirm(`Mandar a versão ${qual} para todo o restante do público?`)) return;
    const { data, error } = await supabase.rpc("disparar_vencedor", { p_campanha: id, p_vencedor: qual });
    if (error) alert(error.message);
    else alert(`${data} e-mails enfileirados com a versão ${qual}.`);
    carregar();
  }

  async function dispararExistente(id: string) {
    if (!confirm("Disparar esta campanha agora?")) return;
    const { data: qtd, error } = await supabase.rpc("disparar_campanha", { p_campanha: id });
    if (error) alert(error.message);
    else alert(`${qtd} e-mails enfileirados.`);
    carregar();
  }

  async function abrirRelatorio(c: Stats) {
    setRelDe(c);
    setRel(null);
    const { data } = await supabase.from("eventos_email")
      .select("tipo, url, occurred_at, envios!inner(campanha_fk, tabela_1_leads(email))")
      .eq("envios.campanha_fk", c.campanha_id)
      .order("occurred_at", { ascending: false })
      .limit(5000);
    const eventos = (data as any[]) ?? [];
    const abriramMap = new Map<string, string>();
    const cliquesMap = new Map<string, { total: number; emails: Set<string> }>();
    const bounces = new Set<string>();
    const desc = new Set<string>();
    for (const e of eventos) {
      const email = e.envios?.tabela_1_leads?.email ?? "?";
      if (e.tipo === "open" && !abriramMap.has(email)) abriramMap.set(email, e.occurred_at);
      if (e.tipo === "click" && e.url) {
        const atual = cliquesMap.get(e.url) ?? { total: 0, emails: new Set<string>() };
        atual.total++; atual.emails.add(email);
        cliquesMap.set(e.url, atual);
      }
      if (e.tipo === "bounce_hard" || e.tipo === "bounce_soft") bounces.add(email);
      if (e.tipo === "unsubscribe") desc.add(email);
    }
    setRel({
      abriram: [...abriramMap.entries()].map(([email, quando]) => ({ email, quando })),
      cliques: [...cliquesMap.entries()].map(([url, v]) => ({ url, total: v.total, unicos: v.emails.size }))
        .sort((a, b) => b.total - a.total),
      bounces: [...bounces],
      descadastros: [...desc],
    });
  }

  return (
    <div>
      <h1>Campanhas</h1>
      <div className="sub">Disparos pontuais para listas ou segmentos — o motor respeita supressão e status, sempre.
        <Ajuda>
          <b>Campanha</b> é o envio de uma vez, para quem estiver na lista naquele momento.
          <b> Automação</b> é o que sai sozinho quando algo acontece com a pessoa, hoje ou
          daqui a seis meses.
          <br /><br />
          Na hora do disparo o público é conferido de novo no banco: quem descadastrou, deu
          bounce ou está na supressão não entra, mesmo constando na lista.
        </Ajuda>
      </div>

      {editando && (
        <EditorEmail html={html} design={design}
          onSalvar={(h, d) => { setHtml(h); setDesign(d); setEditando(false); }}
          onFechar={() => setEditando(false)} />
      )}
      {editandoB && (
        <EditorEmail html={htmlB} design={designB}
          onSalvar={(h, d) => { setHtmlB(h); setDesignB(d); setEditandoB(false); }}
          onFechar={() => setEditandoB(false)} />
      )}

      <div className="caixa">
        {!criando ? (
          <button className="primario" onClick={() => setCriando(true)}>+ Nova campanha</button>
        ) : etapa === 1 ? (
          /* ---------------- etapa 1: nome e tipo ---------------- */
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <h2 style={{ textAlign: "center" }}>Nome da campanha</h2>
            <div className="sub" style={{ textAlign: "center" }}>
              Para você se lembrar do que ela trata. Só você vê isso.
            </div>
            <input value={nome} onChange={(e) => setNome(e.target.value)}
              placeholder="[CASA_H] [ÚLTIMO DIA]" style={{ textAlign: "center" }} />

            <h2 style={{ textAlign: "center", marginTop: 26 }}>Que tipo de campanha?</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {TIPOS.map((t) => {
                const aqui = t.onde === "aqui";
                const sel = aqui && tipo === t.id;
                return (
                  <div key={t.id}
                    onClick={() => aqui ? setTipo(t.id) : navegar(t.onde)}
                    style={{
                      display: "flex", gap: 14, alignItems: "flex-start", cursor: "pointer",
                      border: `2px solid ${sel ? "var(--marca)" : "var(--borda)"}`,
                      background: sel ? "var(--marca-fraca)" : "transparent",
                      borderRadius: 10, padding: "16px 18px",
                    }}>
                    <div style={{ fontSize: 24, lineHeight: 1 }}>{t.icone}</div>
                    <div style={{ flex: 1 }}>
                      <b>{t.titulo}</b>
                      <div className="sub" style={{ margin: "2px 0 0" }}>{t.desc}</div>
                      {t.ajuda && (
                        <div className="sub" style={{ margin: "6px 0 0", fontStyle: "italic" }}>{t.ajuda}</div>
                      )}
                      {sel && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--borda)" }}>
                          <b style={{ fontSize: "calc(13px * var(--escala-texto))" }}>
                            Como você quer montar o e-mail?
                          </b>
                          <div className="sub" style={{ margin: "4px 0 0" }}>
                            No editor visual, começando do zero ou de um modelo pronto.
                          </div>
                        </div>
                      )}
                    </div>
                    {!aqui && <span className="sub" style={{ margin: 0 }}>abre em Automações →</span>}
                  </div>
                );
              })}
            </div>

            <div className="linha" style={{ marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={limpar}>Cancelar</button>
              <button className="primario"
                onClick={() => nome.trim() ? setEtapa(2) : alert("Dê um nome à campanha.")}>
                Próximo →
              </button>
            </div>
          </div>
        ) : (
          /* ---------------- etapa 2: escrever e endereçar ---------------- */
          <div>
            <div className="linha" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0 }}>{nome}</h2>
                <div className="sub" style={{ margin: 0 }}>
                  {TIPOS.find((t) => t.id === tipo)?.titulo}
                </div>
              </div>
              <button onClick={() => setEtapa(1)}>← Voltar</button>
            </div>

            <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(300px, 1fr) minmax(260px, 380px)", marginTop: 16 }}>
              {/* --- remetente e assunto --- */}
              <div>
                <label>Assunto <span style={{ color: "var(--perigo)" }}>*</span>
                  <Ajuda>
                    Aceita {"{{nome}}"} e os seus campos próprios (
                    <code>{"{{campo.cidade}}"}</code>). Quem não tiver o valor recebe o
                    assunto sem a variável, nunca com ela escrita no meio.
                    <br /><br />
                    Evite MAIÚSCULAS gritadas e excesso de emoji: além de cansar, é o tipo de
                    coisa que o filtro de spam pesa contra você.
                  </Ajuda>
                </label>
                <input value={assunto} onChange={(e) => setAssunto(e.target.value)}
                  placeholder="O que aparece na caixa de entrada" />

                <label>Pré-cabeçalho</label>
                <input value={preheader} onChange={(e) => setPreheader(e.target.value)}
                  placeholder="a segunda linha, ao lado do assunto" />
                <div className="sub" style={{ marginTop: 4 }}>
                  Se ficar em branco, o cliente de e-mail mostra a primeira linha do e-mail —
                  que costuma ser "Olá, {'{{nome}}'}".
                </div>

                <label style={{ marginTop: 14 }}>Do nome <span style={{ color: "var(--perigo)" }}>*</span>
                  <Ajuda>
                    O nome que aparece como remetente na caixa de entrada — e o que mais
                    decide se a pessoa abre. Mantenha o mesmo sempre: remetente que muda a
                    cada envio não vira hábito e ainda atrapalha a entrega.
                    <br /><br />
                    Nasce do que está em <b>Configurações</b>. Mudar aqui vale só para esta
                    campanha.
                  </Ajuda>
                </label>
                <input value={deNome} onChange={(e) => setDeNome(e.target.value)} />

                <label>Do e-mail <span style={{ color: "var(--perigo)" }}>*</span></label>
                <input value={deEmail} onChange={(e) => setDeEmail(e.target.value)} />

                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                  <input type="checkbox" checked={respostaIgual}
                    onChange={(e) => setRespostaIgual(e.target.checked)} />
                  Usar este e-mail como endereço para respostas
                </label>
                {!respostaIgual && (
                  <>
                    <label>Responder para</label>
                    <input value={respostaEmail} onChange={(e) => setRespostaEmail(e.target.value)}
                      placeholder="uma caixa que recebe de verdade" />
                  </>
                )}
                {respostaIgual && deEmail.includes(".") && deEmail.split("@")[1]?.split(".").length > 2 && (
                  <div className="aviso" style={{ marginTop: 8 }}>
                    <b>{deEmail.split("@")[1]}</b> parece ser o subdomínio de envio, e subdomínio de
                    envio normalmente não recebe. Se alguém responder, a resposta volta. Desmarque
                    acima e aponte para uma caixa que existe.
                  </div>
                )}
              </div>

              {/* --- o e-mail --- */}
              <div>
                <div style={{
                  border: "1px solid var(--borda)", borderRadius: 10, padding: 16,
                  textAlign: "center", background: "var(--cartao, transparent)",
                }}>
                  {html ? (
                    <>
                      <iframe title="prévia" srcDoc={html} sandbox=""
                        style={{ width: "100%", height: 190, border: "1px solid var(--borda)",
                                 borderRadius: 8, background: "#fff", pointerEvents: "none" }} />
                      <button className="primario" style={{ marginTop: 12 }}
                        onClick={() => setEditando(true)}>Editar o e-mail</button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 40, opacity: 0.35 }}>🖼</div>
                      <div className="sub">Nada escrito ainda.</div>
                      <button className="primario" style={{ marginTop: 10 }}
                        onClick={() => setEditando(true)}>Criar com o editor de e-mails</button>
                    </>
                  )}
                </div>

                {tipo === "ab" && (
                  <div style={{
                    border: "1px solid var(--borda)", borderRadius: 10, padding: 16,
                    textAlign: "center", marginTop: 12,
                  }}>
                    <b>Versão B</b>
                    <input value={assuntoB} onChange={(e) => setAssuntoB(e.target.value)}
                      placeholder="assunto da versão B" style={{ marginTop: 8 }} />
                    {htmlB ? (
                      <>
                        <iframe title="prévia B" srcDoc={htmlB} sandbox=""
                          style={{ width: "100%", height: 150, border: "1px solid var(--borda)",
                                   borderRadius: 8, background: "#fff", pointerEvents: "none", marginTop: 8 }} />
                        <button style={{ marginTop: 10 }} onClick={() => setEditandoB(true)}>Editar a versão B</button>
                      </>
                    ) : (
                      <button style={{ marginTop: 10 }} onClick={() => setEditandoB(true)}>Escrever a versão B</button>
                    )}
                    <label style={{ marginTop: 12 }}>Fatia que participa do teste: {fatia}%
                      <Ajuda>
                        Só essa porcentagem do público recebe agora, metade com cada versão.
                        O restante fica esperando você olhar o placar e mandar a vencedora.
                        <br /><br />
                        Fatia pequena demais não prova nada: com 100 envios de cada lado, 2
                        aberturas de diferença é sorte, não resultado. Em base pequena, prefira
                        30% ou mais.
                      </Ajuda>
                    </label>
                    <input type="range" min={10} max={100} step={5} value={fatia}
                      onChange={(e) => setFatia(Number(e.target.value))} />
                    <div className="sub" style={{ marginTop: 4, textAlign: "left" }}>
                      Essa fatia é dividida ao meio entre as duas versões. O restante
                      ({100 - fatia}%) fica esperando: você olha o placar e manda a vencedora.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* --- destinatários --- */}
            <h2 style={{ marginTop: 26 }}>Quem vai receber
              <Ajuda>
                <b>Por listas</b>: escolha uma ou várias — quem estiver em duas recebe uma vez
                só. <b>Por segmento salvo</b>: usa uma regra montada em Leads, que continua
                valendo para quem entrar depois.
                <br /><br />
                Em qualquer um dos dois, só recebe quem está ativo e fora da supressão.
              </Ajuda>
            </h2>
            <div className="linha" style={{ marginBottom: 8 }}>
              <button className={tipoAud === "listas" ? "primario" : ""} onClick={() => setTipoAud("listas")}>Por listas</button>
              <button className={tipoAud === "segmento" ? "primario" : ""} onClick={() => setTipoAud("segmento")}>Por segmento salvo</button>
            </div>
            {tipoAud === "listas" ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {listas.map((l) => (
                  <button key={l.lista_id}
                    className={listasSel.includes(l.lista_id) ? "primario" : ""}
                    onClick={() => setListasSel(listasSel.includes(l.lista_id)
                      ? listasSel.filter((x) => x !== l.lista_id)
                      : [...listasSel, l.lista_id])}>
                    {l.nome}
                  </button>
                ))}
              </div>
            ) : (
              <Escolher valor={segSel} aoMudar={setSegSel}
                vazio="— escolher segmento (salve em Leads → 💾) —"
                opcoes={segmentos.map((s) => ({ valor: s.segmento_id, rotulo: s.nome }))} />
            )}

            <div style={{
              marginTop: 12, padding: "12px 16px", borderRadius: 8,
              border: "1px solid var(--borda)", display: "flex", gap: 14, alignItems: "baseline",
            }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: "var(--marca)" }}>
                {quantos === null ? "—" : quantos.toLocaleString("pt-BR")}
              </span>
              <span className="sub" style={{ margin: 0 }}>
                pessoas hoje. O número é conferido no banco na hora do disparo — quem
                descadastrou ou está na supressão não entra, mesmo estando na lista.
              </span>
            </div>

            {/* --- agendamento --- */}
            <h2 style={{ marginTop: 26 }}>Quando</h2>
            <label>Agendar para (vazio = disparo manual)
              <Ajuda>
                Horário do seu computador. Agendado, o motor enfileira sozinho na hora
                marcada — e o público é montado <b>naquele momento</b>, não agora: quem entrar
                na lista até lá também recebe.
                <br /><br />
                O escoamento é de 100 e-mails por minuto, cerca de 6 mil por hora. Uma
                campanha de 12 mil pessoas leva uma par de horas para chegar na última.
              </Ajuda>
            </label>
            <input type="datetime-local" value={agendarEm} onChange={(e) => setAgendarEm(e.target.value)} />

            {/* --- monitoramento --- */}
            <h2 style={{ marginTop: 26 }}>Monitoramento
              <Ajuda>
                O que a campanha registra sobre quem recebeu. É daqui que saem os números do
                relatório — desligado, o envio funciona igual, mas você fica sem saber o que
                aconteceu depois.
              </Ajuda>
            </h2>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={rastreiaAbertura}
                  onChange={(e) => setRastreiaAbertura(e.target.checked)} />
                <span>Abertura<br /><span className="sub">Imagem de 1 pixel. Quem bloqueia imagem não conta.</span></span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={rastreiaClique}
                  onChange={(e) => setRastreiaClique(e.target.checked)} />
                <span>Cliques<br /><span className="sub">Os links passam a sair pelo nosso domínio.</span></span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: 0.55 }}>
                <input type="checkbox" checked={monitoraResposta} disabled
                  onChange={(e) => setMonitoraResposta(e.target.checked)} />
                <span>Resposta<br /><span className="sub">Ainda não: exige ler a caixa de entrada, que a Ressoar não faz.</span></span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={arquivoPublico}
                  onChange={(e) => setArquivoPublico(e.target.checked)} />
                <span>Arquivo público<br /><span className="sub">Deixa a campanha visível por link, para quem quiser reler.</span></span>
              </label>
            </div>

            <label style={{ marginTop: 18 }}>Endereço no rodapé <span style={{ color: "var(--perigo)" }}>*</span></label>
            <input value={endereco} readOnly style={{ opacity: 0.75 }} />
            <div className="sub" style={{ marginTop: 4 }}>
              Exigido por lei em e-mail de marketing, e muda em Configurações — não por campanha,
              para não sair endereço diferente em cada disparo.
            </div>

            <div className="linha" style={{ marginTop: 22 }}>
              <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center" }}>
                <button disabled={ocupado} onClick={() => criar(false)}>
                  {agendarEm ? "Salvar e agendar" : "Salvar rascunho"}
                </button>
                <Ajuda>
                  Guarda a campanha sem mandar nada. <b>Rascunho</b> fica esperando alguém
                  apertar Disparar na lista abaixo; <b>agendada</b> sai sozinha na hora
                  marcada.
                  <br /><br />
                  É o caminho de quem prepara: a Assistente monta e deixa pronta, e quem
                  dispara é a Terapeuta ou a Admin.
                </Ajuda>
              </span>
              {podeOperar
                ? <button className="primario" disabled={ocupado} onClick={() => criar(true)}>
                    {ocupado ? "…" : tipo === "ab" ? "Disparar o teste" : "Enviar agora"}
                  </button>
                : <span className="sub" style={{ flex: "0 0 auto", margin: 0 }}>Quem dispara é a Terapeuta ou a Admin.</span>}
              <button onClick={limpar}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      <div className="caixa">
        <table>
          <thead><tr>
            <th>Campanha</th>
            <th>Status
              <Ajuda>
                <b>draft</b> = rascunho, nada saiu · <b>scheduled</b> = agendada ·{" "}
                <b>sending</b> = escoando a fila agora · <b>sent</b> = tudo enfileirado ·{" "}
                <b>paused</b> / <b>cancelled</b> = parada.
              </Ajuda>
            </th>
            <th>Enviados<Ajuda>Quantos e-mails entraram na fila desta campanha. O “+ supr.” ao lado são as pessoas que estavam no público mas foram puladas por estarem bloqueadas — elas aparecem de propósito: somem da conta, não do relatório.</Ajuda></th>
            <th>Aberturas
              <Ajuda>
                Pessoas diferentes que abriram, não o total de aberturas. É medido por uma
                imagem de 1 pixel, então <b>subestima sempre</b>: quem lê com as imagens
                bloqueadas não é contado.
              </Ajuda>
            </th>
            <th>Cliques<Ajuda>Pessoas diferentes que clicaram em algum link. É a métrica mais confiável das três — clique não depende de imagem carregada. O detalhe por link está no Relatório.</Ajuda></th>
            <th>Bounces<Ajuda>E-mails que voltaram em definitivo. Entram sozinhos na supressão para não serem tentados de novo — insistir é o que derruba a reputação do domínio.</Ajuda></th>
            <th>Descadastros
              <Ajuda>
                Quem clicou em sair a partir desta campanha. Um pouco é normal e até
                saudável. Muito de uma vez costuma dizer que a mensagem não combinou com o
                que aquele público esperava.
              </Ajuda>
            </th>
            <th></th>
          </tr></thead>
          <tbody>
            {stats.map((c) => (
              <tr key={c.campanha_id}>
                <td>{c.nome}</td>
                <td><span className={`etiqueta ${STATUS[c.status] ?? "et-cinza"}`}>{c.status}</span></td>
                <td>{c.enviados}{c.suprimidos > 0 && <span style={{ color: "var(--texto2)" }}> (+{c.suprimidos} supr.)</span>}</td>
                <td>{c.aberturas_unicas}{c.enviados > 0 && c.aberturas_unicas > 0 &&
                  <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * c.aberturas_unicas / c.enviados)}%)</span>}</td>
                <td>{c.cliques_unicos}{c.enviados > 0 && c.cliques_unicos > 0 &&
                  <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * c.cliques_unicos / c.enviados)}%)</span>}</td>
                <td>{c.hard_bounces}</td>
                <td>{c.descadastros}</td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  <button onClick={() => abrirRelatorio(c)}>Relatório</button>{" "}
                  {podeOperar && (c.status === "draft" || c.status === "scheduled") &&
                    <button onClick={() => dispararExistente(c.campanha_id)}>Disparar</button>}
                  {podeOperar && c.tipo === "ab" && !c.vencedor && c.enviados > 0 &&
                    <button onClick={() => abrirPlacar(c)}>Ver placar A/B</button>}
                </td>
              </tr>
            ))}
            {!stats.length && <tr><td colSpan={8} style={{ color: "var(--texto2)" }}>Nenhuma campanha ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      {relDe && (
        <div className="gaveta" style={{ width: 620 }}>
          <button className="fechar" onClick={() => setRelDe(null)}>✕</button>
          <h2>Relatório · {relDe.nome}</h2>
          <div className="cartoes" style={{ marginTop: 12 }}>
            <div className="cartao"><div className="num">{relDe.enviados}</div><div className="rot">Enviados</div></div>
            <div className="cartao"><div className="num">{relDe.aberturas_unicas}</div><div className="rot">Aberturas únicas</div></div>
            <div className="cartao"><div className="num">{relDe.cliques_unicos}</div><div className="rot">Cliques únicos</div></div>
          </div>
          {!rel && <div className="sub">carregando eventos…</div>}
          {rel && (
            <>
              <div className="caixa">
                <h2>Cliques por link
                  <Ajuda>
                    Qual link puxou a atenção, e não só quantos cliques houve. Quando um
                    e-mail tem três chamadas e uma leva 90% dos cliques, é essa que deveria
                    estar no topo da próxima vez.
                  </Ajuda>
                </h2>
                {rel.cliques.map((c) => (
                  <div key={c.url} style={{ padding: "4px 0", fontSize: "calc(12.5px * var(--escala-texto))", borderBottom: "1px dashed var(--borda)" }}>
                    <span className="etiqueta et-roxa">{c.unicos} únicos</span> {c.url}
                  </div>
                ))}
                {!rel.cliques.length && <span className="sub">nenhum clique registrado</span>}
              </div>
              <div className="caixa">
                <h2>Quem abriu ({rel.abriram.length})
                  <Ajuda>
                    Nome por nome, com a hora da primeira abertura. Serve para montar um
                    segmento de quem está quente — em Leads, no segmento avançado, existe a
                    condição “abriu e-mail nos últimos N dias”.
                  </Ajuda>
                </h2>
                {rel.abriram.slice(0, 100).map((a) => (
                  <div key={a.email} style={{ padding: "3px 0", fontSize: "calc(13px * var(--escala-texto))" }}>
                    {a.email}
                    <span style={{ color: "var(--texto2)" }}> · {new Date(a.quando).toLocaleString("pt-BR")}</span>
                  </div>
                ))}
                {rel.abriram.length > 100 && <div className="sub">… e mais {rel.abriram.length - 100}</div>}
                {!rel.abriram.length && <span className="sub">nenhuma abertura registrada</span>}
              </div>
              {(rel.bounces.length > 0 || rel.descadastros.length > 0) && (
                <div className="caixa">
                  <h2>Problemas</h2>
                  {rel.bounces.map((e) => <div key={e} style={{ fontSize: "calc(13px * var(--escala-texto))" }}><span className="etiqueta et-vermelha">bounce</span> {e}</div>)}
                  {rel.descadastros.map((e) => <div key={e} style={{ fontSize: "calc(13px * var(--escala-texto))" }}><span className="etiqueta et-amarela">descadastro</span> {e}</div>)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
