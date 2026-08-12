import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import { JOGADAS, ORDEM_JOGADAS, FAIXAS_VENDA } from "../lib/venda";
import Escolher from "../components/Escolher";
import Ajuda from "../components/Ajuda";

// Lead scoring: as DUAS réguas da base, cada uma no seu papel.
// Venda (quem está pronto pra comprar) e Engajamento (pra quem é seguro
// enviar). São eixos separados de propósito — "vendas é uma coisa,
// engajamento com e-mail é outra" — e por isso cada um tem sua aba.

type Jogada = { oferta: string; leads: number };
type MelhorLead = {
  lead_id: string; nome: string | null; email: string | null; whatsapp: string | null;
  pontos_venda: number; faixa: string; proxima_oferta: string; motivo: string | null;
  gasto_total: number;
};
type Faixa = { faixa: string; ordem: number; leads: number };
type Resultado = {
  tipo: string; nome: string; ativa: boolean | null; quando: string | null;
  pessoas: number; emails: number; aberturas: number; cliques: number;
  compradores: number; compras: number; receita: number; receita_por_email: number | null;
};

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("pt-BR");

function Barra({ valor, maximo, cor }: { valor: number; maximo: number; cor?: string }) {
  const pct = maximo > 0 ? Math.max(2, (valor / maximo) * 100) : 0;
  return (
    <div style={{ background: "var(--borda)", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: cor ?? "var(--marca)" }} />
    </div>
  );
}

export default function LeadScoring() {
  const { podePreparar } = useSessao();
  const [params] = useSearchParams();
  const [aba, setAba] = useState<"venda" | "resultado" | "engajamento">("venda");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [janelaDias, setJanelaDias] = useState("90");
  const [jogadas, setJogadas] = useState<Jogada[]>([]);
  const [melhores, setMelhores] = useState<MelhorLead[]>([]);
  const [jogadaSel, setJogadaSel] = useState("");
  const [criandoSeg, setCriandoSeg] = useState("");
  const [msgSeg, setMsgSeg] = useState("");
  const [faixas, setFaixas] = useState<Faixa[]>([]);

  useEffect(() => {
    const p = params.get("aba");
    if (p === "venda" || p === "resultado" || p === "engajamento") setAba(p);
  }, [params]);

  useEffect(() => {
    supabase.rpc("rel_resultado_envios", { p_dias: Number(janelaDias), p_janela: 14 })
      .then(({ data }) => setResultados((data as never) ?? []));
  }, [janelaDias]);

  useEffect(() => {
    supabase.rpc("rel_vendas_jogadas").then(({ data }) => setJogadas((data as never) ?? []));
    supabase.rpc("rel_engajamento").then(({ data }) => setFaixas((data as never) ?? []));
  }, []);

  useEffect(() => {
    supabase.rpc("rel_melhores_leads", { p_oferta: jogadaSel || null, p_limite: 50 })
      .then(({ data }) => setMelhores((data as never) ?? []));
  }, [jogadaSel]);

  // salva a jogada como segmento; a campanha mira o segmento na hora do disparo
  async function criarSegmentoJogada(slug: string) {
    const j = JOGADAS[slug];
    if (!j || criandoSeg) return;
    setCriandoSeg(slug);
    setMsgSeg("");
    const { error } = await supabase.from("segmentos").insert({
      nome: `🎯 ${j.titulo}`,
      definicao: {
        op: "and",
        condicoes: [
          { campo: "proxima_oferta", valor: slug },
          { campo: "alcancavel" },
        ],
      },
    });
    setCriandoSeg("");
    setMsgSeg(error
      ? `Não deu para criar o segmento: ${error.message}`
      : `Segmento "🎯 ${j.titulo}" criado. Ao disparar uma campanha, escolha ele como público — a lista se atualiza sozinha todo dia.`);
  }

  const totalJogada = (slug: string) =>
    Number(jogadas.find((j) => j.oferta === slug)?.leads ?? 0);
  const maxFaixa = Math.max(1, ...faixas.map((f) => Number(f.leads)));

  return (
    <div>
      <h1>Lead scoring</h1>
      <div className="sub">
        As duas réguas da base: quem está pronto pra <b>comprar</b> e pra quem é seguro <b>enviar</b>.
        <Ajuda>
          Cada lead carrega DOIS números, de propósito: vendas é uma coisa, engajamento
          com e-mail é outra.
          <br /><br />
          A <b>pontuação de venda</b> olha só compras (recência, quantidade, gasto) e
          responde “o que oferecer para quem, agora”. A de <b>engajamento</b> olha o
          comportamento com os e-mails e responde “por quem começar a enviar sem
          machucar o domínio”.
        </Ajuda>
      </div>

      <div className="linha" style={{ margin: "14px 0" }}>
        <button data-tour="aba-venda" className={aba === "venda" ? "primario" : ""}
          style={{ flex: "0 0 auto" }} onClick={() => setAba("venda")}>Venda — prontos pra comprar</button>
        <button data-tour="aba-resultado" className={aba === "resultado" ? "primario" : ""}
          style={{ flex: "0 0 auto" }} onClick={() => setAba("resultado")}>Resultado — quanto vendeu</button>
        <button data-tour="aba-engajamento" className={aba === "engajamento" ? "primario" : ""}
          style={{ flex: "0 0 auto" }} onClick={() => setAba("engajamento")}>Engajamento — saúde de envio</button>
      </div>

      {aba === "venda" && (
        <>
          <div className="caixa">
            <h2>Quem está pronto pra comprar
              <Ajuda>
                A pontuação de venda vai de 0 a 100 e olha só comportamento de compra:
                quanto mais recente a última compra, mais pontos (e eles derretem com o
                tempo — em ~1 mês cai pela metade); mais compras e mais gasto somam;
                estar nas Lives soma um pouco. Abertura de e-mail NÃO entra aqui.
                <br /><br />
                As faixas são por percentil: <b>Prontíssimo</b> é sempre o top 5% — nunca
                satura. Recalcula toda madrugada e na hora de cada compra.
              </Ajuda>
            </h2>
            <div className="sub">
              A esteira medida no seu próprio histórico: 79% de quem chegou à Formação
              comprou um produto de entrada antes, e a conversão acontece em 6 a 11 dias.
              Cada jogada abaixo é um pedaço da esteira, com o público contado agora e um
              botão que vira segmento — pronto para receber campanha.
            </div>
          </div>

          {msgSeg && (
            <div className={msgSeg.startsWith("Não deu") ? "aviso" : "aviso sucesso"} role="status">
              {msgSeg}
            </div>
          )}

          <div className="caixa">
            <h2>As jogadas de venda</h2>
            <table style={{ marginTop: 6 }}>
              <thead><tr>
                <th>Jogada
                  <Ajuda>
                    Uma jogada é um pedaço da esteira de vendas: um público + a oferta
                    que faz sentido para ele agora. O ❔ de cada linha conta o porquê,
                    com os números do seu próprio histórico.
                  </Ajuda>
                </th>
                <th>Quem entra</th>
                <th>Leads agora
                  <Ajuda>
                    Contagem ao vivo, só de quem <b>pode receber e-mail</b> (ativo em
                    lista e fora da supressão). Atualiza toda madrugada às 03:44 e na
                    hora em que uma compra chega — a pessoa muda de jogada sozinha.
                  </Ajuda>
                </th>
                <th></th>
              </tr></thead>
              <tbody>
                {ORDEM_JOGADAS.map((slug) => {
                  const j = JOGADAS[slug];
                  const qtd = totalJogada(slug);
                  return (
                    <tr key={slug}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <b>{j.titulo}</b>
                        <Ajuda>{j.porque}</Ajuda>
                      </td>
                      <td style={{ color: "var(--texto2)" }}>{j.quem}</td>
                      <td><b>{n(qtd)}</b></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {podePreparar && slug !== "tratar_reembolso" && slug !== "aquecer_primeiro" && (
                          <button disabled={!!criandoSeg || qtd === 0}
                            onClick={() => criarSegmentoJogada(slug)}>
                            {criandoSeg === slug ? "Criando…" : "Criar segmento"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="sub" style={{ marginTop: 10 }}>
              “Aquecer primeiro” e “Fora de oferta” não têm botão de propósito: campanha de
              venda para esses públicos machuca o domínio — reengaje antes. A jogada nº 1
              já roda sozinha: automação “[RESSOAR] Formação — janela quente”.
            </div>
          </div>

          <div className="caixa">
            <h2>Os melhores leads agora
              <Ajuda>
                Ordenados pela pontuação de venda — contínua, sem empate de milhares.
                O <b>motivo</b> ao lado de cada um explica o número: quantas compras,
                quanto gastou, há quantos dias. Para trabalhar a lista inteira, crie o
                segmento da jogada e dispare uma campanha para ele.
              </Ajuda>
            </h2>
            <div className="linha" style={{ marginTop: 8 }}>
              <Escolher style={{ maxWidth: 320 }} valor={jogadaSel} vazio="Todas as jogadas"
                aoMudar={setJogadaSel}
                opcoes={ORDEM_JOGADAS.map((s) => ({ valor: s, rotulo: JOGADAS[s].titulo }))} />
            </div>
            <table style={{ marginTop: 12 }}>
              <thead><tr>
                <th>#</th>
                <th>Lead</th>
                <th>Faixa
                  <Ajuda>
                    Faixas por <b>percentil</b>, não por número fixo: <b>Prontíssimo</b> é
                    sempre o top 5% da base alcançável, <b>Pronto</b> vem logo atrás,
                    <b> Aquecendo</b> é o meio e <b>Frio</b> o resto. Como é percentual,
                    a régua se recalibra sozinha conforme a base muda — nunca satura.
                  </Ajuda>
                </th>
                <th>Pontos
                  <Ajuda>
                    De 0 a 100, só com comportamento de <b>compra</b>: recência (com
                    decaimento), quantidade, gasto e Lives. Reembolso derruba. Abertura
                    de e-mail não entra — isso é a régua de Engajamento, na outra aba.
                  </Ajuda>
                </th>
                <th>Próxima oferta
                  <Ajuda>
                    O degrau da esteira que faz sentido oferecer para esta pessoa
                    agora, decidido pelo que ela já comprou e há quanto tempo. É o
                    mesmo nome da jogada na tabela de cima.
                  </Ajuda>
                </th>
                <th>Por quê
                  <Ajuda>
                    A explicação do número, por extenso: quantas compras, quanto
                    gastou, há quantos dias foi a última. Nenhum score aqui é caixa
                    preta — se o número parecer estranho, o porquê está do lado.
                  </Ajuda>
                </th>
              </tr></thead>
              <tbody>
                {melhores.map((m, i) => (
                  <tr key={m.lead_id}>
                    <td style={{ color: "var(--texto2)" }}>{i + 1}</td>
                    <td>
                      <b>{m.nome || m.email || "—"}</b>
                      {m.nome && m.email && (
                        <div style={{ fontSize: "calc(12px * var(--escala-texto))", color: "var(--texto2)" }}>
                          {m.email}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`etiqueta ${FAIXAS_VENDA[m.faixa]?.classe ?? "et-cinza"}`}>
                        {FAIXAS_VENDA[m.faixa]?.rotulo ?? m.faixa}
                      </span>
                    </td>
                    <td><b>{m.pontos_venda}</b></td>
                    <td style={{ fontSize: "calc(12px * var(--escala-texto))" }}>
                      {JOGADAS[m.proxima_oferta]?.titulo ?? m.proxima_oferta}
                    </td>
                    <td style={{ fontSize: "calc(12px * var(--escala-texto))", color: "var(--texto2)" }}>
                      {m.motivo}
                    </td>
                  </tr>
                ))}
                {!melhores.length && (
                  <tr><td colSpan={6} className="sub">
                    Nada aqui ainda — a pontuação de venda é calculada toda madrugada.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === "resultado" && (
        <>
          <div className="caixa">
            <h2>Quanto cada e-mail vendeu
              <Ajuda>
                Abertura e clique não pagam boleto. Esta tela cruza os envios com as
                compras aprovadas e responde a pergunta que importa: <b>entrou dinheiro?</b>
                <br /><br />
                A regra é conservadora de propósito: só conta a compra que aconteceu
                <b> depois</b> do e-mail sair, dentro de 14 dias. Por isso a compra que
                <b> dispara</b> a janela quente nunca aparece como resultado dela — seria
                creditar ao e-mail uma venda que já tinha acontecido.
                <br /><br />
                É atribuição de último toque: serve para comparar automações entre si e
                acompanhar a régua evoluindo, não para provar causa e efeito.
              </Ajuda>
            </h2>
            <div className="linha" style={{ marginTop: 8 }}>
              <Escolher style={{ maxWidth: 220 }} valor={janelaDias} aoMudar={setJanelaDias}
                opcoes={[
                  { valor: "7", rotulo: "Últimos 7 dias" },
                  { valor: "30", rotulo: "Últimos 30 dias" },
                  { valor: "90", rotulo: "Últimos 90 dias" },
                  { valor: "365", rotulo: "Último ano" },
                ]} />
            </div>
            <table style={{ marginTop: 12 }}>
              <thead><tr>
                <th>De onde saiu</th>
                <th>Pessoas</th>
                <th>E-mails</th>
                <th>Abriram</th>
                <th>Clicaram</th>
                <th>Compraram
                  <Ajuda>
                    Pessoas que compraram DEPOIS de receber, dentro de 14 dias. Uma pessoa
                    conta uma vez por origem, mesmo tendo recebido três e-mails da mesma
                    sequência.
                  </Ajuda>
                </th>
                <th>Receita</th>
                <th>Por e-mail
                  <Ajuda>
                    Receita dividida pelo número de e-mails enviados. É o número que
                    compara automações de tamanhos diferentes de forma justa — e o que diz
                    qual sequência merece mais atenção.
                  </Ajuda>
                </th>
              </tr></thead>
              <tbody>
                {resultados.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <b>{r.nome}</b>
                      <div style={{ fontSize: "calc(12px * var(--escala-texto))", color: "var(--texto2)" }}>
                        {r.tipo}{r.ativa === false && " · desligada"}
                      </div>
                    </td>
                    <td>{n(r.pessoas)}</td>
                    <td>{n(r.emails)}</td>
                    <td>{n(r.aberturas)}</td>
                    <td>{n(r.cliques)}</td>
                    <td><b>{n(r.compradores)}</b></td>
                    <td><b>{Number(r.receita) > 0
                      ? "R$ " + Number(r.receita).toLocaleString("pt-BR", { minimumFractionDigits: 2 })
                      : "—"}</b></td>
                    <td style={{ color: "var(--texto2)" }}>
                      {Number(r.receita_por_email) > 0
                        ? "R$ " + Number(r.receita_por_email).toLocaleString("pt-BR", { minimumFractionDigits: 2 })
                        : "—"}
                    </td>
                  </tr>
                ))}
                {!resultados.length && (
                  <tr><td colSpan={8} className="sub">
                    Nenhum e-mail saiu no período. Assim que as automações começarem a
                    trabalhar, o resultado delas aparece aqui.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="caixa">
            <h2>As sequências das jogadas
              <Ajuda>
                Cada uma nasce de um gatilho que já existe na operação, e todas conferem —
                antes de cada e-mail — se a pessoa já fez o que a sequência queria. Quem
                compra no meio do caminho sai sozinho, sem receber oferta do que acabou de
                comprar.
              </Ajuda>
            </h2>
            <div className="sub">
              Seis sequências estão montadas e <b>desligadas</b>, esperando a sua revisão:
              <b> janela quente</b> (compra de entrada → Formação, em D+1, D+4, D+8 e D+30),
              <b> pagamento não caiu</b> (boleto ou PIX gerado e não pago),
              <b> carrinho abandonado</b>, <b>aluno → Black / Acompanhamento</b>,
              <b> Lives → Desafio</b> e <b>reativação</b> (comprador parado há mais de 90 dias).
              <br /><br />
              Os textos estão em <b>Mensagens</b> — procure por “Janela quente”, “Pagamento”,
              “Carrinho”, “Aluno”, “Lives” e “Reativação”. Para ligar uma delas depois de
              revisar: <b>Automações → marcar Ativa</b>. Enquanto o envio estiver pausado em
              Configurações, nada sai mesmo com automação ligada.
            </div>
          </div>
        </>
      )}

      {aba === "engajamento" && (
        <div className="caixa">
          <h2>Saúde do engajamento
            <Ajuda>
              A pontuação de cada pessoa sobe quando ela abre, clica e compra, e cai com o
              tempo parado. Aqui você vê como a base se divide entre essas faixas.
              <br /><br />
              Serve para decidir para quem mandar: base grande com quase todo mundo no
              fundo da tabela entrega pior do que base pequena e engajada. Dá para filtrar
              por faixa em Leads → Segmento avançado → “Pontuação do lead”.
              <br /><br />
              <b>Este é o eixo de e-mail.</b> Quem está pronto para COMPRAR é a outra
              aba — os dois números não se misturam de propósito.
            </Ajuda>
          </h2>
          <div className="sub">
            Distribuição da pontuação de engajamento. Enquanto não houver histórico de
            e-mail, ela reflete principalmente há quanto tempo a pessoa entrou — que é a
            ordem certa para o aquecimento.
          </div>
          <table style={{ marginTop: 10 }}>
            <tbody>
              {faixas.map((f) => (
                <tr key={f.faixa}>
                  <td style={{ width: 190 }}>{f.faixa}</td>
                  <td style={{ width: 90 }}>{n(f.leads)}</td>
                  <td><Barra valor={Number(f.leads)} maximo={maxFaixa}
                    cor={f.ordem <= 2 ? "var(--verde, #157347)" : f.ordem === 5 ? "var(--vermelho, #b3261e)" : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
