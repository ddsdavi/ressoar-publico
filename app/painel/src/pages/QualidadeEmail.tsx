import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Ajuda from "../components/Ajuda";

// Qualidade da conta de e-mail. A pergunta que esta tela responde não é
// "como foi a campanha" — é "como vai a conta". Quantos e-mails saíram,
// quantos chegaram, quantos voltaram, quem abriu, quem clicou, quem saiu
// e quem marcou spam, tudo junto e no mesmo período.
//
// Os números chegam somados do banco (rpc qualidade_email). Somar linha a
// linha no navegador é a armadilha nº 1 deste projeto: a API corta em
// 1.000 registros e a conta sai errada sem avisar.

type Taxa = number | null;
type Qualidade = {
  dias: number;
  enviados: number; entregues: number; suprimidos: number; erros: number; na_fila: number;
  devolvidos_definitivos: number; devolvidos_temporarios: number;
  adiados: number; falhas_no_provedor: number;
  abriram: number; clicaram: number; descadastraram: number; reclamaram: number;
  taxa_entrega: Taxa; taxa_devolucao: Taxa; taxa_abertura: Taxa; taxa_clique: Taxa;
  taxa_clique_de_quem_abriu: Taxa; taxa_descadastro: Taxa; taxa_reclamacao: Taxa;
  limite_devolucao: number; limite_reclamacao: number;
  pausado: boolean; limite_diario: number; enviados_24h: number; na_supressao: number;
  por_dia: { dia: string; enviados: number; entregues: number; abriram: number; clicaram: number; devolvidos: number }[];
  por_origem: { origem: string; enviados: number; entregues: number; abriram: number; clicaram: number; devolvidos: number }[];
  scoring: {
    calculado_em: string | null;
    regras: { nome: string; tipo: string; pontos: number; dias: number | null; ativa: boolean; pessoas: number | null }[];
    faixas: { ordem: number; faixa: string; leads: number }[];
  };
};

type LinhaMsg = {
  mensagem_id: string; nome: string; subject: string;
  enviados: number; aberturas_unicas: number; cliques_unicos: number; hard_bounces: number;
  por_campanha: number; por_automacao: number; ultimo_envio: string | null;
};
type LinhaAuto = {
  automacao_id: string; nome: string; ativa: boolean;
  enviados: number; aberturas_unicas: number; cliques_unicos: number;
  hard_bounces: number; descadastros: number; ultimo_envio: string | null;
};

// quem abriu e quem clicou, para a gaveta de detalhe
type Pessoas = {
  abriram: { email: string; quando: string }[];
  clicaram: { email: string; url: string; quando: string; vezes: number }[];
  problemas: { email: string; tipo: string }[];
};

const PERIODOS: [number, string][] = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [0, "Desde sempre"]];
const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("pt-BR");
const pct = (x: Taxa) => (x === null || x === undefined ? "—" : `${Number(x).toLocaleString("pt-BR")}%`);
const dataCurta = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—";

const ORIGEM_PT: Record<string, string> = {
  campanha: "Campanhas", automacao: "Automações", avulso: "Envios avulsos",
};

// barra proporcional sem biblioteca de gráfico: menos peso e funciona igual
// no modo escuro
function Barra({ valor, maximo, cor }: { valor: number; maximo: number; cor?: string }) {
  const p = maximo > 0 ? Math.max(valor > 0 ? 2 : 0, (valor / maximo) * 100) : 0;
  return (
    <div style={{ background: "var(--borda)", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${p}%`, height: "100%", background: cor ?? "var(--marca)" }} />
    </div>
  );
}

export default function QualidadeEmail() {
  const [dias, setDias] = useState(30);
  const [q, setQ] = useState<Qualidade | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<"mensagens" | "automacoes">("mensagens");
  const [msgs, setMsgs] = useState<LinhaMsg[]>([]);
  const [autos, setAutos] = useState<LinhaAuto[]>([]);
  // gaveta de detalhe: de quem é e o que apareceu
  const [de, setDe] = useState<{ titulo: string; campo: string; valor: string } | null>(null);
  const [pessoas, setPessoas] = useState<Pessoas | null>(null);

  async function carregar(d: number) {
    setQ(null); setErro("");
    const { data, error } = await supabase.rpc("qualidade_email", { p_dias: d });
    if (error) { setErro(error.message); return; }
    setQ(data as never);
  }
  useEffect(() => { carregar(dias); }, [dias]);

  useEffect(() => {
    supabase.from("mensagem_stats").select("*").order("enviados", { ascending: false })
      .then(({ data }) => setMsgs((data as never) ?? []));
    supabase.from("automacao_stats").select("*").order("enviados", { ascending: false })
      .then(({ data }) => setAutos((data as never) ?? []));
  }, []);

  // Quem abriu e quem clicou naquele e-mail (ou naquela automação). É a
  // mesma consulta do relatório de campanha, só muda a coluna do filtro.
  async function abrirDetalhe(titulo: string, campo: string, valor: string) {
    setDe({ titulo, campo, valor }); setPessoas(null);
    const { data } = await supabase.from("eventos_email")
      .select("tipo, url, occurred_at, envios!inner(mensagem_fk, automacao_fk, tabela_1_leads(email))")
      .eq(`envios.${campo}`, valor)
      .in("tipo", ["open", "click", "bounce_hard", "bounce_soft", "unsubscribe", "complaint"])
      .order("occurred_at", { ascending: false })
      .limit(5000);
    const abriram = new Map<string, string>();
    const clicaram = new Map<string, { email: string; url: string; quando: string; vezes: number }>();
    const problemas = new Map<string, string>();
    for (const e of ((data as any[]) ?? [])) {
      const email = e.envios?.tabela_1_leads?.email ?? "?";
      if (e.tipo === "open" && !abriram.has(email)) abriram.set(email, e.occurred_at);
      if (e.tipo === "click") {
        const url = e.url ?? "(link não identificado)";
        const chave = JSON.stringify([email, url]);
        const p = clicaram.get(chave);
        // os eventos vêm do mais novo para o mais velho: a última passagem
        // por aqui é o clique mais antigo, o primeiro que a pessoa deu
        if (p) { p.vezes++; p.quando = e.occurred_at; }
        else clicaram.set(chave, { email, url, quando: e.occurred_at, vezes: 1 });
      }
      if (["bounce_hard", "bounce_soft", "unsubscribe", "complaint"].includes(e.tipo)) problemas.set(email, e.tipo);
    }
    setPessoas({
      abriram: [...abriram.entries()].map(([email, quando]) => ({ email, quando })),
      clicaram: [...clicaram.values()].sort((a, b) => b.quando.localeCompare(a.quando)),
      problemas: [...problemas.entries()].map(([email, tipo]) => ({ email, tipo })),
    });
  }

  // veredito da conta: os mesmos limites que o freio usa para pausar a fila
  // sozinho. Duas telas com limites diferentes seriam duas verdades.
  const ruim = !!q && (Number(q.taxa_devolucao ?? 0) > q.limite_devolucao
    || Number(q.taxa_reclamacao ?? 0) > q.limite_reclamacao);
  const atencao = !!q && !ruim && (Number(q.taxa_devolucao ?? 0) > q.limite_devolucao / 2
    || Number(q.taxa_reclamacao ?? 0) > q.limite_reclamacao / 2);
  const poucaAmostra = !!q && q.enviados < 50;

  const maxDia = Math.max(1, ...(q?.por_dia ?? []).map((d) => d.enviados));
  const PROBLEMA_PT: Record<string, string> = {
    bounce_hard: "devolvido", bounce_soft: "devolvido (temporário)",
    unsubscribe: "descadastro", complaint: "marcou spam",
  };

  return (
    <div>
      <div className="pagina-topo">
        <div>
          <h1>Qualidade da conta</h1>
          <div className="sub">
            A saúde do seu envio, junta: o que saiu, o que chegou, o que voltou e o que as
            pessoas fizeram com o e-mail — de campanha e de automação no mesmo lugar.
            <Ajuda>
              Campanha tem relatório próprio, e é sobre uma mensagem. Esta tela é sobre a
              <b> conta inteira</b>: é ela que diz se o Gmail ainda confia no seu domínio.
              Dois números decidem isso — <b>devolução</b> acima de 2% e <b>reclamação de
              spam</b> acima de 0,1%. São os mesmos limites que fazem o freio pausar a fila
              sozinho.
            </Ajuda>
          </div>
        </div>
      </div>

      <div className="barra-ferramentas">
        <div className="chips">
          {PERIODOS.map(([d, rot]) => (
            <button key={d} className={"chip-filtro" + (dias === d ? " on" : "")} onClick={() => setDias(d)}>{rot}</button>
          ))}
        </div>
      </div>

      {erro && <div className="aviso grave"><b className="titulo">Não consegui carregar</b>{erro}</div>}
      {!q && !erro && <div className="sub">somando no banco…</div>}

      {q && (
        <>
          {q.pausado && (
            <div className="aviso grave">
              <b className="titulo">O envio está pausado agora</b>
              Nada sai da fila enquanto isso. Em Configurações dá para religar e ver quem
              pausou — se foi o freio, ele explica o motivo.
            </div>
          )}
          {ruim && !poucaAmostra && (
            <div className="aviso grave">
              <b className="titulo">A conta está no vermelho</b>
              {Number(q.taxa_devolucao ?? 0) > q.limite_devolucao &&
                <>Devolução em <b>{pct(q.taxa_devolucao)}</b> (o limite é {q.limite_devolucao}%). </>}
              {Number(q.taxa_reclamacao ?? 0) > q.limite_reclamacao &&
                <>Reclamação de spam em <b>{pct(q.taxa_reclamacao)}</b> (o limite é {q.limite_reclamacao}%). </>}
              Continuar enviando assim é o que faz o Gmail mandar tudo para o lixo. O caminho
              é limpar a base — endereço que devolve não pode ser tentado de novo.
            </div>
          )}
          {atencao && !poucaAmostra && (
            <div className="aviso atencao">
              <b className="titulo">Dá para respirar, mas de olho</b>
              Ainda abaixo do limite que pausa a fila, e já na metade do caminho.
            </div>
          )}
          {!ruim && !atencao && !poucaAmostra && (
            <div className="aviso sucesso">
              <b className="titulo">Conta saudável no período</b>
              Devolução em {pct(q.taxa_devolucao)} e reclamação em {pct(q.taxa_reclamacao)} —
              os dois bem abaixo do que faria o freio agir.
            </div>
          )}
          {poucaAmostra && (
            <div className="aviso info">
              <b className="titulo">Amostra pequena para julgar a conta</b>
              Foram {n(q.enviados)} envios no período. Com pouca coisa, uma devolução vira
              “taxa” e assusta à toa — o próprio freio só age a partir de 50 envios.
            </div>
          )}

          <div className="cartoes">
            <div className="cartao"><div className="num">{n(q.enviados)}</div>
              <div className="rot">Enviados
                <Ajuda>Mensagens que o provedor aceitou. Não conta quem foi pulado por estar bloqueado nem o que deu erro antes de sair.</Ajuda>
              </div></div>
            <div className="cartao"><div className="num">{n(q.entregues)}</div>
              <div className="rot">Entregues · {pct(q.taxa_entrega)}
                <Ajuda>Chegaram na caixa da pessoa. Entregue não quer dizer “caixa de entrada” — pode ter caído no spam e ainda assim contar como entregue.</Ajuda>
              </div></div>
            <div className="cartao"><div className="num">{n(q.abriram)}</div>
              <div className="rot">Abriram · {pct(q.taxa_abertura)}
                <Ajuda>Pessoas diferentes, não total de aberturas. Medido por uma imagem de 1 pixel, então <b>subestima sempre</b>: quem lê com imagem bloqueada não é contado.</Ajuda>
              </div></div>
            <div className="cartao"><div className="num">{n(q.clicaram)}</div>
              <div className="rot">Clicaram · {pct(q.taxa_clique)}
                <Ajuda>Pessoas diferentes que clicaram em algum link. É a métrica mais confiável da tela — clique não depende de imagem carregada. Dos que abriram, {pct(q.taxa_clique_de_quem_abriu)} clicaram.</Ajuda>
              </div></div>
            <div className="cartao">
              <div className="num" style={{ color: Number(q.taxa_devolucao ?? 0) > q.limite_devolucao ? "var(--perigo)" : undefined }}>
                {n(q.devolvidos_definitivos + q.devolvidos_temporarios)}
              </div>
              <div className="rot">Devolvidos · {pct(q.taxa_devolucao)}
                <Ajuda>{n(q.devolvidos_definitivos)} em definitivo (o endereço não existe) e {n(q.devolvidos_temporarios)} temporários (caixa cheia, servidor fora). Só o definitivo entra no bloqueio.</Ajuda>
              </div></div>
            <div className="cartao">
              <div className="num" style={{ color: q.reclamaram > 0 ? "var(--perigo)" : undefined }}>{n(q.reclamaram)}</div>
              <div className="rot">Marcaram spam · {pct(q.taxa_reclamacao)}
                <Ajuda>O mais grave de todos. Acima de 0,1% da base, o Gmail passa a mandar tudo para o lixo — e a conta demora meses para se recuperar.</Ajuda>
              </div></div>
            <div className="cartao"><div className="num">{n(q.descadastraram)}</div>
              <div className="rot">Descadastros · {pct(q.taxa_descadastro)}
                <Ajuda>Um pouco é normal e até saudável: é gente saindo pela porta em vez de clicar em spam. Muito de uma vez costuma dizer que a mensagem não combinou com o público.</Ajuda>
              </div></div>
            <div className="cartao"><div className="num">{n(q.erros + q.falhas_no_provedor + q.adiados)}</div>
              <div className="rot">Deram problema
                <Ajuda>{n(q.erros)} nem saíram (erro antes do provedor), {n(q.falhas_no_provedor)} o provedor recusou e {n(q.adiados)} ficaram adiados para nova tentativa. Problema nosso, não da pessoa — nada disso tira ponto de ninguém.</Ajuda>
              </div></div>
          </div>

          <div className="caixa">
            <h2>De onde saiu
              <Ajuda>
                A mesma conta separada por origem. Automação costuma ter abertura bem maior
                que campanha — é e-mail que a pessoa está esperando, logo depois de fazer
                alguma coisa. Se a campanha estiver muito abaixo, o problema é assunto ou
                lista, não entregabilidade.
              </Ajuda>
            </h2>
            <table>
              <thead><tr>
                <th>Origem</th><th>Enviados</th><th>Entregues</th><th>Abriram</th><th>Clicaram</th><th>Devolvidos</th>
              </tr></thead>
              <tbody>
                {q.por_origem.map((o) => (
                  <tr key={o.origem}>
                    <td>{ORIGEM_PT[o.origem] ?? o.origem}</td>
                    <td>{n(o.enviados)}</td>
                    <td>{n(o.entregues)}</td>
                    <td>{n(o.abriram)}{o.entregues > 0 && <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * o.abriram / o.entregues)}%)</span>}</td>
                    <td>{n(o.clicaram)}{o.entregues > 0 && <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * o.clicaram / o.entregues)}%)</span>}</td>
                    <td>{n(o.devolvidos)}</td>
                  </tr>
                ))}
                {!q.por_origem.length && <tr><td colSpan={6} className="sub">nenhum envio no período</td></tr>}
              </tbody>
            </table>
          </div>

          {q.por_dia.length > 1 && (
            <div className="caixa">
              <h2>Dia a dia
                <Ajuda>
                  Serve para achar o dia em que a coisa virou. Devolução concentrada num dia
                  só costuma ser lista velha ou importação nova; espalhada por todos os dias
                  é problema de base.
                </Ajuda>
              </h2>
              <table>
                <thead><tr><th>Dia</th><th style={{ width: "35%" }}>Enviados</th><th>Entregues</th><th>Abriram</th><th>Clicaram</th><th>Devolvidos</th></tr></thead>
                <tbody>
                  {q.por_dia.map((d) => (
                    <tr key={d.dia}>
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(d.dia + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</td>
                      <td><Barra valor={d.enviados} maximo={maxDia} /><span style={{ color: "var(--texto2)", fontSize: "calc(12px * var(--escala-texto))" }}>{n(d.enviados)}</span></td>
                      <td>{n(d.entregues)}</td>
                      <td>{n(d.abriram)}</td>
                      <td>{n(d.clicaram)}</td>
                      <td style={{ color: d.devolvidos > 0 ? "var(--perigo)" : undefined }}>{n(d.devolvidos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="caixa">
            <div className="abas" style={{ marginBottom: 12 }}>
              <button className={aba === "mensagens" ? "on" : ""} onClick={() => setAba("mensagens")}>
                Por e-mail <span className="cont">{msgs.length}</span>
              </button>
              <button className={aba === "automacoes" ? "on" : ""} onClick={() => setAba("automacoes")}>
                Por automação <span className="cont">{autos.length}</span>
              </button>
            </div>
            <div className="sub" style={{ marginBottom: 10 }}>
              {aba === "mensagens"
                ? "Cada e-mail da biblioteca, somando tudo o que ele já mandou — por campanha e por automação. Clique na linha para ver quem abriu e quem clicou."
                : "Cada automação e o que os e-mails dela produziram. Clique na linha para ver as pessoas."}
              <Ajuda>
                Estes números são de <b>toda a vida</b> do e-mail, não do período escolhido lá
                em cima. Um e-mail de automação vai somando desde que a automação foi ligada —
                é o que faz sentido para decidir se ele funciona.
              </Ajuda>
            </div>
            {aba === "mensagens" ? (
              <table>
                <thead><tr>
                  <th>E-mail</th><th>Onde é usado</th><th>Enviados</th><th>Abriram</th><th>Clicaram</th><th>Último</th>
                </tr></thead>
                <tbody>
                  {msgs.filter((m) => m.enviados > 0).map((m) => (
                    <tr key={m.mensagem_id} style={{ cursor: "pointer" }}
                      onClick={() => abrirDetalhe(m.nome, "mensagem_fk", m.mensagem_id)}>
                      <td>
                        <button className="link-tabela">{m.nome}</button>
                        <div className="sub" style={{ fontSize: "calc(12px * var(--escala-texto))" }}>{m.subject}</div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {m.por_campanha > 0 && <span className="etiqueta et-roxa">campanha</span>}
                        {m.por_automacao > 0 && <span className="etiqueta et-verde">automação</span>}
                      </td>
                      <td>{n(m.enviados)}</td>
                      <td>{n(m.aberturas_unicas)}{m.enviados > 0 && m.aberturas_unicas > 0 &&
                        <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * m.aberturas_unicas / m.enviados)}%)</span>}</td>
                      <td>{n(m.cliques_unicos)}{m.enviados > 0 && m.cliques_unicos > 0 &&
                        <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * m.cliques_unicos / m.enviados)}%)</span>}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--texto2)" }}>{dataCurta(m.ultimo_envio)}</td>
                    </tr>
                  ))}
                  {!msgs.some((m) => m.enviados > 0) && (
                    <tr><td colSpan={6} className="sub">nenhum e-mail enviado ainda</td></tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table>
                <thead><tr>
                  <th>Automação</th><th>Estado</th><th>Enviados</th><th>Abriram</th><th>Clicaram</th><th>Devolvidos</th><th>Último</th>
                </tr></thead>
                <tbody>
                  {autos.filter((a) => a.enviados > 0).map((a) => (
                    <tr key={a.automacao_id} style={{ cursor: "pointer" }}
                      onClick={() => abrirDetalhe(a.nome, "automacao_fk", a.automacao_id)}>
                      <td><button className="link-tabela">{a.nome}</button></td>
                      <td><span className={"etiqueta " + (a.ativa ? "et-verde" : "et-cinza")}>{a.ativa ? "Ativa" : "Desligada"}</span></td>
                      <td>{n(a.enviados)}</td>
                      <td>{n(a.aberturas_unicas)}{a.enviados > 0 && a.aberturas_unicas > 0 &&
                        <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * a.aberturas_unicas / a.enviados)}%)</span>}</td>
                      <td>{n(a.cliques_unicos)}{a.enviados > 0 && a.cliques_unicos > 0 &&
                        <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * a.cliques_unicos / a.enviados)}%)</span>}</td>
                      <td>{n(a.hard_bounces)}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--texto2)" }}>{dataCurta(a.ultimo_envio)}</td>
                    </tr>
                  ))}
                  {!autos.some((a) => a.enviados > 0) && (
                    <tr><td colSpan={7} className="sub">nenhuma automação enviou e-mail ainda</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="caixa">
            <h2>O que isso vale na pontuação dos leads
              <Ajuda>
                Todo evento de e-mail já entra na nota de cada lead — e é por isso que esta
                tela não é só estatística. Abrir e clicar sobem a nota; devolver, sair da
                lista e marcar spam derrubam. A nota é <b>recalculada</b> toda madrugada a
                partir dos fatos, nunca acumulada num contador — assim regra que muda de
                valor não deixa resíduo. Os pesos ficam em <b>Contatos › Lead scoring</b>.
              </Ajuda>
            </h2>
            <table>
              <thead><tr><th>O que a pessoa fez</th><th>Vale</th><th>Pessoas assim hoje</th></tr></thead>
              <tbody>
                {q.scoring.regras.map((r) => (
                  <tr key={r.nome} style={{ opacity: r.ativa ? 1 : 0.5 }}>
                    <td>{r.nome}{!r.ativa && <span className="etiqueta et-cinza" style={{ marginLeft: 6 }}>desligada</span>}</td>
                    <td style={{ whiteSpace: "nowrap", color: r.pontos < 0 ? "var(--perigo)" : "var(--marca)", fontWeight: 600 }}>
                      {r.pontos > 0 ? "+" : ""}{r.pontos}
                    </td>
                    <td>{r.pessoas === null ? "—" : n(r.pessoas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sub" style={{ marginTop: 12 }}>
              Como a base está dividida hoje:{" "}
              {q.scoring.faixas.map((f, i) => (
                <span key={f.faixa}>{i > 0 && " · "}<b>{n(f.leads)}</b> {f.faixa.toLowerCase()}</span>
              ))}
              {q.scoring.calculado_em && <> · recalculado em {new Date(q.scoring.calculado_em).toLocaleString("pt-BR")}</>}
            </div>
          </div>

          <div className="caixa">
            <h2>Fila e bloqueio</h2>
            <div className="sub">
              <b>{n(q.enviados_24h)}</b> e-mails nas últimas 24 horas
              {q.limite_diario > 0 && <> · limite diário de <b>{n(q.limite_diario)}</b></>}
              {" "}· <b>{n(q.na_fila)}</b> esperando na fila · <b>{n(q.suprimidos)}</b> pulados no período por
              estarem bloqueados · <b>{n(q.na_supressao)}</b> endereços na lista de bloqueio.
              <Ajuda>
                O limite diário sobe sozinho conforme o domínio esquenta, e o freio o corta
                pela metade quando a devolução passa do limite. A lista de bloqueio protege a
                conta: quem devolveu ou reclamou nunca mais é tentado.
              </Ajuda>
            </div>
          </div>
        </>
      )}

      {de && (
        <div className="gaveta" style={{ width: 560 }}>
          <button className="fechar" onClick={() => setDe(null)}>✕</button>
          <h2>{de.titulo}</h2>
          {!pessoas && <div className="sub">carregando…</div>}
          {pessoas && (
            <>
              <div className="caixa">
                <h2>Quem clicou ({pessoas.clicaram.length})</h2>
                {pessoas.clicaram.slice(0, 100).map((c) => (
                  <div key={c.email + c.url} style={{ padding: "3px 0", fontSize: "calc(13px * var(--escala-texto))" }}>
                    {c.email}
                    {c.vezes > 1 && <span className="etiqueta et-roxa" style={{ marginLeft: 6 }}>{c.vezes}×</span>}
                    <span style={{ color: "var(--texto2)" }}> · {new Date(c.quando).toLocaleString("pt-BR")}</span>
                    <div style={{ color: "var(--texto2)", fontSize: "calc(11.5px * var(--escala-texto))", wordBreak: "break-all" }}>{c.url}</div>
                  </div>
                ))}
                {!pessoas.clicaram.length && <span className="sub">ninguém clicou ainda</span>}
              </div>
              <div className="caixa">
                <h2>Quem abriu ({pessoas.abriram.length})</h2>
                {pessoas.abriram.slice(0, 100).map((a) => (
                  <div key={a.email} style={{ padding: "3px 0", fontSize: "calc(13px * var(--escala-texto))" }}>
                    {a.email}
                    <span style={{ color: "var(--texto2)" }}> · {new Date(a.quando).toLocaleString("pt-BR")}</span>
                  </div>
                ))}
                {pessoas.abriram.length > 100 && <div className="sub">… e mais {pessoas.abriram.length - 100}</div>}
                {!pessoas.abriram.length && <span className="sub">nenhuma abertura registrada</span>}
              </div>
              {!!pessoas.problemas.length && (
                <div className="caixa">
                  <h2>Problemas ({pessoas.problemas.length})</h2>
                  {pessoas.problemas.map((p) => (
                    <div key={p.email} style={{ fontSize: "calc(13px * var(--escala-texto))" }}>
                      <span className="etiqueta et-vermelha">{PROBLEMA_PT[p.tipo] ?? p.tipo}</span> {p.email}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
