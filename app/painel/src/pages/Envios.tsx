import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Escolher from "../components/Escolher";
import Ajuda from "../components/Ajuda";

type Envio = {
  envio_id: string; status: string; provider: string | null;
  queued_at: string; sent_at: string | null;
  tabela_1_leads: { email: string | null } | null;
  mensagens: { subject: string } | null;
  campanhas: { nome: string } | null;
};

type Suprimido = {
  email: string; nome: string | null; lead_id: string | null; motivo: string;
  campanha: string | null; assunto: string | null; created_at: string;
};

type Alerta = {
  alerta_id: string; titulo: string; detalhe: string | null; gravidade: string;
};

// O banco guarda um código; aqui ele vira gente. Cada motivo tem peso
// diferente: quem reclamou de spam é mais grave que quem só pediu para sair.
const MOTIVO: Record<string, { rotulo: string; cor: string; explica: string }> = {
  hard_bounce: { rotulo: "E-mail não existe", cor: "et-vermelha",
    explica: "O servidor devolveu em definitivo. Insistir aqui derruba a reputação do domínio." },
  complaint: { rotulo: "Marcou como spam", cor: "et-vermelha",
    explica: "Clicou em “isto é spam”. O mais grave de todos: acima de 0,1% da base, o Gmail passa a mandar tudo para o lixo." },
  unsubscribe_global: { rotulo: "Pediu para sair", cor: "et-amarela",
    explica: "Clicou no descadastro. Sai de todas as listas, não só da que recebeu." },
  ac_import: { rotulo: "Bloqueado no ActiveCampaign", cor: "et-cinza",
    explica: "Já estava bloqueado lá e veio assim na migração. Você começou protegido." },
  manual: { rotulo: "Bloqueio manual", cor: "et-roxa",
    explica: "Alguém do time bloqueou à mão por aqui." },
};
const motivoDe = (m: string) =>
  MOTIVO[m] ?? { rotulo: m, cor: "et-cinza", explica: "Origem não identificada." };

const STATUS_ENVIO: Record<string, string> = {
  queued: "et-amarela", sent: "et-roxa", delivered: "et-verde",
  bounced: "et-vermelha", complained: "et-vermelha", failed: "et-vermelha",
  suppressed: "et-cinza",
};

export default function Envios() {
  const [contagens, setContagens] = useState<Record<string, number>>({});
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [suprimidos, setSuprimidos] = useState<Suprimido[]>([]);
  const [buscaSup, setBuscaSup] = useState("");
  const [novoSup, setNovoSup] = useState("");
  const [porMotivo, setPorMotivo] = useState<{ motivo: string; qtd: number }[]>([]);
  const [filtroMotivo, setFiltroMotivo] = useState("");
  const [totalSup, setTotalSup] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [porPagina, setPorPagina] = useState(25);
  const [saude, setSaude] = useState<Record<string, number | boolean> | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);

  useEffect(() => {
    supabase.rpc("saude_envio", { p_dias: 7 }).then(({ data }) => setSaude((data as never) ?? null));
    supabase.from("alertas").select("alerta_id, titulo, detalhe, gravidade")
      .is("visto_em", null).order("criado_em", { ascending: false }).limit(5)
      .then(({ data }) => setAlertas((data as never) ?? []));
  }, []);

  async function marcarVisto(id: string) {
    await supabase.from("alertas").update({ visto_em: new Date().toISOString() })
      .eq("alerta_id", id);
    setAlertas((a) => a.filter((x) => x.alerta_id !== id));
  }

  async function carregar() {
    const conta = async (filtro: (q: any) => any) => {
      const { count } = await filtro(supabase.from("envios").select("*", { count: "exact", head: true }));
      return count ?? 0;
    };
    const [fila, enviados, entregues, bounces, sup] = await Promise.all([
      conta((q: any) => q.eq("status", "queued")),
      conta((q: any) => q.in("status", ["sent", "delivered"])),
      conta((q: any) => q.eq("status", "delivered")),
      conta((q: any) => q.in("status", ["bounced", "complained"])),
      supabase.from("supressao").select("*", { count: "exact", head: true }).then((r) => r.count ?? 0),
    ]);
    setContagens({ fila, enviados, entregues, bounces, sup });

    const { data } = await supabase.from("envios")
      .select("envio_id, status, provider, queued_at, sent_at, tabela_1_leads(email), mensagens(subject), campanhas(nome)")
      .order("queued_at", { ascending: false }).limit(50);
    setEnvios((data as never) ?? []);

    const c = await supabase.from("app_config").select("chave, valor");
    setCfg(Object.fromEntries((c.data ?? []).map((r) => [r.chave, r.valor ?? ""])));
  }

  // Contagem e busca saem PRONTAS do banco. Trazer as linhas para somar aqui
  // daria número errado: a API corta em 1.000 registros.
  async function carregarSupressao() {
    const busca = buscaSup.trim() || null;
    const motivo = filtroMotivo || null;
    const [lista, total, agrupado] = await Promise.all([
      supabase.rpc("supressao_detalhada", {
        p_busca: busca, p_motivo: motivo,
        p_limite: porPagina, p_offset: pagina * porPagina,
      }),
      supabase.rpc("contar_supressao_filtrada", { p_busca: busca, p_motivo: motivo }),
      supabase.rpc("contagem_supressao"),
    ]);
    setSuprimidos((lista.data as never) ?? []);
    setTotalSup(Number(total.data ?? 0));
    setPorMotivo((agrupado.data as never) ?? []);
  }

  useEffect(() => { carregar(); }, []);
  useEffect(() => { setPagina(0); }, [buscaSup, filtroMotivo, porPagina]);
  useEffect(() => {
    const t = setTimeout(carregarSupressao, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaSup, filtroMotivo, pagina, porPagina]);

  async function adicionarSupressao() {
    const email = novoSup.trim().toLowerCase();
    if (!email) return;
    if (!confirm(`Adicionar ${email} à supressão? Este e-mail NUNCA mais receberá disparos.`)) return;
    const { error } = await supabase.from("supressao").insert({ email, motivo: "manual" });
    if (error) alert(error.message);
    setNovoSup("");
    carregarSupressao(); carregar();
  }

  async function removerSupressao(email: string) {
    if (!confirm(`Remover ${email} da supressão? Ele voltará a poder receber e-mails.`)) return;
    await supabase.from("supressao").delete().eq("email", email);
    carregarSupressao(); carregar();
  }

  const provedorReal = cfg.provedor_email === "resend" && cfg.resend_api_key;
  const teto = Number(saude?.limite_diario ?? 0);
  const usados = Number(saude?.enviados_24h ?? 0);
  const bounce = Number(saude?.taxa_bounce ?? 0);
  const spam = Number(saude?.taxa_reclamacao ?? 0);
  const amostraPequena = Number(saude?.enviados ?? 0) < 50;

  return (
    <div>
      <h1>Envios</h1>
      <div className="sub">A fila de e-mails, o histórico e a conexão com o provedor.</div>

      {alertas.map((a) => (
        <div key={a.alerta_id} className="aviso" role="status">
          <b>{a.titulo}</b>
          {a.detalhe && <div style={{ marginTop: 4 }}>{a.detalhe}</div>}
          <button style={{ marginTop: 8 }} onClick={() => marcarVisto(a.alerta_id)}>
            Entendi, pode tirar daqui
          </button>
        </div>
      ))}

      <div className="caixa">
        <h2>Saúde do envio
          <Ajuda>
            Esta operação <b>não trabalha com teto de e-mails por dia</b> — a fila escoa no
            ritmo do motor, 100 por minuto.
            <br /><br />
            O que protege o domínio é o <b>freio</b>: de hora em hora o sistema olha os
            últimos 7 dias e, se o bounce passar de 2% ou a reclamação de spam de 0,1%
            (os limites que o Gmail publica), ele <b>pausa o envio sozinho</b> e registra
            um alerta aqui em cima. Nada se perde: a fila espera.
            <br /><br />
            O freio só age a partir de 50 e-mails no período. Com pouca amostra, um único
            bounce vira “taxa alta” e pararia a operação por estatística de nada.
          </Ajuda>
        </h2>
        <div className="cartoes" style={{ marginTop: 10 }}>
          <div className="cartao">
            <div className="num">{teto > 0 ? `${usados}/${teto}` : usados}</div>
            <div className="rot">{teto > 0 ? "Enviados hoje / teto" : "Enviados nas últimas 24h"}
              <Ajuda>
                Quanto saiu no último dia. {teto > 0
                  ? "Existe um teto configurado: ao bater nele, a fila espera e escoa no dia seguinte."
                  : "Sem teto diário: o que estiver na fila sai no ritmo do motor."}
              </Ajuda>
            </div>
          </div>
          <div className="cartao">
            <div className="num" style={{ color: !amostraPequena && bounce > 2 ? "var(--vermelho, #b3261e)" : undefined }}>
              {bounce}%
            </div>
            <div className="rot">Bounce (7 dias) · limite 2%</div>
          </div>
          <div className="cartao">
            <div className="num" style={{ color: !amostraPequena && spam > 0.1 ? "var(--vermelho, #b3261e)" : undefined }}>
              {spam}%
            </div>
            <div className="rot">Spam (7 dias) · limite 0,1%</div>
          </div>
          <div className="cartao">
            <div className="num">{saude?.pausado ? "PAUSADO" : "OK"}</div>
            <div className="rot">Estado do envio
              <Ajuda>
                Pausado pode ser escolha sua (Configurações → E-mail) ou ação do freio. Nos
                dois casos a fila só espera; nenhum e-mail é descartado.
              </Ajuda>
            </div>
          </div>
        </div>
        {saude?.pausado && (
          <div className="sub" style={{ marginTop: 10 }}>
            <b>O envio está pausado.</b> Nenhum e-mail sai — nem de campanha, nem de
            automação. O que for enfileirado espera aqui até alguém religar em
            Configurações → E-mail.
          </div>
        )}
        {amostraPequena && (
          <div className="sub" style={{ marginTop: 10 }}>
            Os percentuais ainda são de amostra pequena ({saude?.enviados ?? 0} e-mails em 7
            dias) — o freio só age a partir de 50, para que um único bounce não pause a
            operação por estatística de nada.
          </div>
        )}
      </div>

      <div className="cartoes">
        <div className="cartao"><div className="num">{contagens.fila ?? "…"}</div>
          <div className="rot">Na fila agora
            <Ajuda>
              E-mails esperando a vez. O motor escoa <b>100 por minuto</b>, cerca de 6 mil por
              hora — número alto aqui logo depois de uma campanha grande é normal, não é
              travamento. Se não anda, confira a trava “pausar todo envio” em Configurações.
            </Ajuda>
          </div></div>
        <div className="cartao"><div className="num">{contagens.enviados ?? "…"}</div>
          <div className="rot">Enviados
            <Ajuda>Saíram daqui e o provedor aceitou. Aceito não é o mesmo que entregue na caixa da pessoa — isso é o cartão ao lado.</Ajuda>
          </div></div>
        <div className="cartao"><div className="num">{contagens.entregues ?? "…"}</div>
          <div className="rot">Entregues (confirmado)
            <Ajuda>
              O provedor de destino confirmou que recebeu. Essa confirmação chega por
              postback — se o webhook do provedor não estiver apontado para o Ressoar, este
              número fica parado mesmo com tudo funcionando.
            </Ajuda>
          </div></div>
        <div className="cartao"><div className="num">{contagens.bounces ?? "…"}</div>
          <div className="rot">Bounces/reclamações
            <Ajuda>
              E-mails que voltaram e gente que marcou como spam. Os dois entram sozinhos na
              supressão. Reclamação é o mais grave: acima de 0,1% da base, o Gmail passa a
              mandar tudo o que você envia para o lixo.
            </Ajuda>
          </div></div>
        <div className="cartao"><div className="num">{contagens.sup ?? "…"}</div>
          <div className="rot">Supressão (exclusões)
            <Ajuda>
              Quem nunca mais recebe, aconteça o que acontecer — nem por campanha, nem por
              automação, nem por importação. A lista completa está no fim desta página.
            </Ajuda>
          </div></div>
      </div>

      <div className="caixa">
        <h2>Como o e-mail sai daqui
          <Ajuda>
            O caminho completo, do clique em “enviar” até o número no relatório. Vale
            conhecer para saber onde olhar quando algo parecer errado: fila parada é motor
            ou trava; entregue sem abertura é postback; nada saindo é provedor em modo
            simulado.
          </Ajuda>
        </h2>
        <div style={{ fontSize: "calc(13.5px * var(--escala-texto))", lineHeight: 1.8 }}>
          <b>1.</b> Campanha ou automação enfileira o e-mail na tabela <code>envios</code> (com trava de supressão e status).<br />
          <b>2.</b> A cada minuto o motor drena a fila e entrega ao provedor —
          hoje: <span className={`etiqueta ${provedorReal ? "et-verde" : "et-amarela"}`}>
            {provedorReal ? "Resend (envio real)" : "SIMULADO — nenhum e-mail real sai"}</span><br />
          <b>3.</b> No envio real, o HTML ganha automaticamente: pixel de abertura, link de descadastro e endereço no rodapé.<br />
          <b>4.</b> O provedor devolve postbacks (entregue, abriu, clicou, bounce) que viram métricas e alimentam a supressão.
        </div>
        {!provedorReal && (
          <div className="aviso" style={{ marginTop: 12 }}>
            <b>Para ligar o envio real:</b><br />
            ① conta no provedor → ② verificar o <b>subdomínio</b> de envio (nunca o domínio principal:
            se a reputação se estragar, o e-mail humano continua funcionando) → ③ colar a chave em
            <b> Configurações</b> e trocar o provedor → ④ apontar o webhook do provedor para o endpoint
            de postback, senão bounces e reclamações não entram sozinhos no bloqueio.
          </div>
        )}
      </div>

      <div className="caixa">
        <h2>Últimos 50 envios
          <Ajuda>
            O que passou pela fila mais recentemente, campanha e automação misturadas — é a
            tela para conferir se um disparo realmente saiu. O histórico completo de uma
            pessoa fica na ficha dela, em Leads.
          </Ajuda>
        </h2>
        <table>
          <thead><tr>
            <th>Status
              <Ajuda>
                <b>queued</b> = na fila · <b>sent</b> = entregue ao provedor ·{" "}
                <b>delivered</b> = o destino confirmou · <b>bounced</b> / <b>complained</b> =
                voltou ou virou spam · <b>suppressed</b> = a pessoa estava bloqueada e nada
                foi mandado · <b>failed</b> = o provedor recusou.
              </Ajuda>
            </th>
            <th>Para</th><th>Assunto</th>
            <th>Campanha<Ajuda>Vazio com a palavra “automação” quer dizer que o e-mail não veio de um disparo pontual, e sim de um fluxo automático.</Ajuda></th>
            <th>Quando</th>
            <th>Provedor<Ajuda>Quem levou o e-mail: Resend, SES ou simulado. Em modo simulado tudo é marcado como enviado, mas nenhum e-mail real sai.</Ajuda></th>
          </tr></thead>
          <tbody>
            {envios.map((e) => (
              <tr key={e.envio_id}>
                <td><span className={`etiqueta ${STATUS_ENVIO[e.status] ?? "et-cinza"}`}>{e.status}</span></td>
                <td>{e.tabela_1_leads?.email}</td>
                <td>{e.mensagens?.subject}</td>
                <td>{e.campanhas?.nome ?? <span style={{ color: "var(--texto2)" }}>automação</span>}</td>
                <td>{new Date(e.sent_at ?? e.queued_at).toLocaleString("pt-BR")}</td>
                <td>{e.provider ?? "—"}</td>
              </tr>
            ))}
            {!envios.length && <tr><td colSpan={6} style={{ color: "var(--texto2)" }}>Nenhum envio ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="caixa">
        <h2>Quem está bloqueado e por quê</h2>
        <div className="sub">
          Ninguém desta lista recebe disparo, aconteça o que acontecer — nem por campanha,
          nem por automação, nem por importação. Bounces e reclamações entram aqui sozinhos.
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
          <button className={filtroMotivo === "" ? "primario" : ""} onClick={() => setFiltroMotivo("")}>
            Todos ({porMotivo.reduce((s, m) => s + Number(m.qtd), 0)})
          </button>
          {porMotivo.map((m) => (
            <button key={m.motivo} title={motivoDe(m.motivo).explica}
              className={filtroMotivo === m.motivo ? "primario" : ""}
              onClick={() => setFiltroMotivo(m.motivo)}>
              {motivoDe(m.motivo).rotulo} ({m.qtd})
            </button>
          ))}
        </div>

        {filtroMotivo && (
          <div className="aviso" style={{ marginBottom: 12 }}>{motivoDe(filtroMotivo).explica}</div>
        )}

        <div className="linha">
          <input placeholder="Buscar por nome ou e-mail…" value={buscaSup}
            onChange={(e) => setBuscaSup(e.target.value)} />
          <input placeholder="bloquear um e-mail à mão…" value={novoSup}
            onChange={(e) => setNovoSup(e.target.value)} />
          <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center" }}>
            <button onClick={adicionarSupressao}>+ Bloquear</button>
            <Ajuda>
              Para quando alguém pede para sair por fora — no direct, no WhatsApp, por
              telefone. O bloqueio vale para o <b>endereço</b>, não para o cadastro: a pessoa
              continua na base, com o histórico dela, mas nada mais é enviado.
              <br /><br />
              É também o que impede que uma importação futura traga esse endereço de volta
              para a fila.
            </Ajuda>
          </span>
        </div>

        <table style={{ marginTop: 10 }}>
          <thead><tr>
            <th>Pessoa</th>
            <th>Motivo<Ajuda>Cada motivo pesa diferente. Bounce e reclamação de spam entraram sozinhos e é bom que fiquem. “Pediu para sair” é escolha da pessoa. “Bloqueio manual” foi alguém do time.</Ajuda></th>
            <th>Veio de<Ajuda>A campanha ou o assunto do e-mail que levou ao bloqueio. Quando várias saídas apontam para a mesma campanha, o problema costuma ser a mensagem, não a base.</Ajuda></th>
            <th>Desde</th>
            <th><Ajuda>
              <b>Desbloquear</b> devolve a pessoa para a fila. Faz sentido em bloqueio manual
              e em erro de digitação; não faz em bounce nem em reclamação de spam —
              desbloquear quem marcou spam é a maneira mais rápida de destruir a entrega de
              todo mundo.
            </Ajuda></th>
          </tr></thead>
          <tbody>
            {suprimidos.map((s) => (
              <tr key={s.email}>
                <td>
                  {s.lead_id
                    ? <Link to={`/leads?busca=${encodeURIComponent(s.email)}`}><b>{s.nome || "(sem nome)"}</b></Link>
                    : <b style={{ color: "var(--texto2)" }}>não está mais na base</b>}
                  <div style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>{s.email}</div>
                </td>
                <td>
                  <span className={`etiqueta ${motivoDe(s.motivo).cor}`} title={motivoDe(s.motivo).explica}>
                    {motivoDe(s.motivo).rotulo}
                  </span>
                </td>
                <td style={{ fontSize: "calc(12.5px * var(--escala-texto))" }}>
                  {s.campanha ?? s.assunto ?? <span style={{ color: "var(--texto2)" }}>—</span>}
                </td>
                <td>{new Date(s.created_at).toLocaleDateString("pt-BR")}</td>
                <td className="direita">
                  <button className="perigo" onClick={() => removerSupressao(s.email)}>Desbloquear</button>
                </td>
              </tr>
            ))}
            {!suprimidos.length && (
              <tr><td colSpan={5} style={{ color: "var(--texto2)" }}>Ninguém bloqueado com esse filtro.</td></tr>
            )}
          </tbody>
        </table>

        <div className="linha" style={{ marginTop: 10, alignItems: "center" }}>
          <span style={{ color: "var(--texto2)", fontSize: "calc(13px * var(--escala-texto))" }}>
            {totalSup === 0 ? "nenhum" :
              `${pagina * porPagina + 1}–${Math.min((pagina + 1) * porPagina, totalSup)} de ${totalSup}`}
          </span>
          <Escolher style={{ flex: "0 0 auto", width: 150 }} valor={porPagina}
            aoMudar={(v) => setPorPagina(Number(v))}
            opcoes={[10, 25, 50, 75, 100].map((n) => ({ valor: n, rotulo: `${n} por página` }))} />
          <button style={{ flex: "0 0 auto" }} disabled={pagina === 0}
            onClick={() => setPagina((p) => p - 1)}>← anterior</button>
          <button style={{ flex: "0 0 auto" }} disabled={(pagina + 1) * porPagina >= totalSup}
            onClick={() => setPagina((p) => p + 1)}>próxima →</button>
        </div>
      </div>
    </div>
  );
}
