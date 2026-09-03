import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Escolher from "../components/Escolher";
import Ajuda from "../components/Ajuda";

// Relatórios. Tudo chega somado do banco: somar linha a linha no navegador
// é a armadilha nº 1 deste projeto — a API corta em 1.000 registros e a
// conta sai errada sem avisar.

type Resumo = Record<string, number>;
type Cresc = { mes: string; novos: number; acumulado: number };
type TagRel = {
  tag: string; leads: number; percentual: number;
  com_email: number; engajados: number; usada_em_automacao: boolean;
};
type Atrib = {
  valor: string; compradores: number; compras: number;
  receita: number; ticket: number | null; leads: number; conversao: number | null;
};
type Anuncio = {
  anuncio: string; rede: string | null; pagina: string | null;
  compradores: number; receita: number; primeira: string; ultima: string;
};
type ValorCampo = { valor: string; leads: number; percentual: number };
type ResumoDin = {
  compras: number; compras_com_origem: number;
  receita: number; receita_rastreada: number;
};

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("pt-BR");

// Os nomes crus vêm do link (utm/xcod) e da Hotmart. Aqui viram português:
// rótulo de exibição, não dado — o banco continua guardando o valor original.
const TRADUZ_ORIGEM: Record<string, string> = {
  paid_metaads: "Anúncios pagos (Meta)",
  organic_bio: "Bio do Instagram",
  organic_stories: "Stories",
  organic_livesemanal: "Lives semanais",
  organic_apilive: "Live (WhatsApp)",
  hotmart_club_trendrecommenderc: "Recomendação da Hotmart",
  hotmart_club_trendrecommenderocb: "Recomendação da Hotmart (checkout)",
  hotmart_sales_agent: "Time de vendas da Hotmart",
  new_club_sales_page_from_showcase_c: "Vitrine da Hotmart",
};
const traduzOrigem = (v: string) => TRADUZ_ORIGEM[v] ?? v;

// Os lugares de onde os links realmente saem. O valor é o mesmo padrão que
// já está gravado na base (organic_bio, paid_metaads…), para o link novo
// cair na MESMA linha do relatório em vez de criar uma origem paralela.
const ORIGENS_PRONTAS: [string, string][] = [
  ["organic_bio", "Bio do Instagram"],
  ["organic_stories", "Stories"],
  ["organic_livesemanal", "Lives semanais"],
  ["organic_whatsapp", "Grupo de WhatsApp"],
  ["organic_youtube", "YouTube"],
  ["paid_metaads", "Anúncio pago (Meta)"],
  ["organic_email", "E-mail"],
];

// barra proporcional, sem biblioteca de gráfico: menos peso e funciona
// igual no modo escuro
function Barra({ valor, maximo, cor }: { valor: number; maximo: number; cor?: string }) {
  const pct = maximo > 0 ? Math.max(2, (valor / maximo) * 100) : 0;
  return (
    <div style={{ background: "var(--borda)", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: cor ?? "var(--marca)" }} />
    </div>
  );
}

export default function Relatorios() {
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const [aba, setAba] = useState<"base" | "tags" | "campos" | "origem">("base");
  const [periodo, setPeriodo] = useState<"30" | "">("30");
  const [resumoDin, setResumoDin] = useState<ResumoDin | null>(null);
  const [utmUrl, setUtmUrl] = useState("");
  const [utmOrigem, setUtmOrigem] = useState("organic_bio");
  const [utmCampanha, setUtmCampanha] = useState("");
  const [utmCopiado, setUtmCopiado] = useState(false);

  // /relatorios?aba=… abre direto na aba pedida. O lead scoring e o relatório
  // de campanhas moraram aqui um dia — link antigo não quebra, redireciona.
  useEffect(() => {
    const p = params.get("aba");
    if (p === "prontos") { navegar("/leadscoring?aba=venda", { replace: true }); return; }
    if (p === "campanhas") { navegar("/campanhas", { replace: true }); return; }
    if (p && ["base", "origem", "tags", "campos"].includes(p)) {
      setAba(p as typeof aba);
    }
  }, [params, navegar]);
  const [dimensao, setDimensao] = useState("origem_trafego");
  const [atrib, setAtrib] = useState<Atrib[]>([]);
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [resumo, setResumo] = useState<Resumo>({});
  const [cresc, setCresc] = useState<Cresc[]>([]);
  const [tags, setTags] = useState<TagRel[]>([]);
  const [campos, setCampos] = useState<{ chave: string; rotulo: string }[]>([]);
  const [campoSel, setCampoSel] = useState("");
  const [valores, setValores] = useState<ValorCampo[]>([]);

  useEffect(() => {
    supabase.rpc("rel_resumo").then(({ data }) => setResumo((data as never) ?? {}));
    supabase.rpc("rel_crescimento", { p_meses: 18 }).then(({ data }) => setCresc((data as never) ?? []));
    supabase.rpc("rel_tags").then(({ data }) => setTags((data as never) ?? []));
    supabase.from("campos_personalizados").select("chave, rotulo").order("rotulo")
      .then(({ data }) => setCampos((data as never) ?? []));
  }, []);

  // aba do dinheiro: tudo re-busca quando o período muda
  useEffect(() => {
    const dias = periodo === "30" ? 30 : null;
    supabase.rpc("rel_atribuicao", { p_campo: dimensao, p_dias: dias })
      .then(({ data }) => setAtrib(((data as never) ?? []) as Atrib[]));
    supabase.rpc("rel_anuncios", { p_limite: 20, p_dias: dias })
      .then(({ data }) => setAnuncios((data as never) ?? []));
    supabase.rpc("rel_dinheiro_resumo", { p_dias: dias })
      .then(({ data }) => setResumoDin((data as never) ?? null));
  }, [dimensao, periodo]);

  useEffect(() => {
    if (!campoSel) { setValores([]); return; }
    supabase.rpc("rel_campo", { p_chave: campoSel, p_limite: 25 })
      .then(({ data }) => setValores((data as never) ?? []));
  }, [campoSel]);

  const maxCresc = Math.max(1, ...cresc.map((c) => c.novos));
  const maxTag = Math.max(1, ...tags.slice(0, 20).map((t) => Number(t.leads)));
  const maxValor = Math.max(1, ...valores.map((v) => Number(v.leads)));

  const abas: [typeof aba, string][] = [
    ["base", "A base"], ["origem", "De onde vem o dinheiro"],
    ["tags", "Tags"], ["campos", "Campos"],
  ];
  const DIMENSOES: [string, string][] = [
    ["origem_trafego", "Origem do tráfego"],
    ["rede", "Rede"],
    ["midia", "Paga ou orgânica"],
    ["pagina_captura", "Página de captura"],
    ["veio_de", "Referrer"],
  ];
  const maxReceita = Math.max(1, ...atrib.map((a) => Number(a.receita)));
  const maxAnuncio = Math.max(1, ...anuncios.map((a) => Number(a.receita)));
  const reais = (v: number | null) =>
    "R$ " + Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

  // o link rastreado. `sck` é o formato que a Hotmart carrega até a compra —
  // é ele que faz a origem sobreviver do clique até o dinheiro
  const linkUtm = (() => {
    const bruto = utmUrl.trim();
    if (!bruto) return "";
    const base = /^https?:\/\//i.test(bruto) ? bruto : "https://" + bruto;
    const midia = utmOrigem.startsWith("paid") ? "paid" : "organic";
    const camp = utmCampanha.trim().replace(/\s+/g, "-").toLowerCase();
    const p = new URLSearchParams({
      utm_source: utmOrigem,
      utm_medium: midia,
      sck: `m=${midia}|s=${utmOrigem}${camp ? `|co=${camp}` : ""}`,
    });
    if (camp) p.set("utm_campaign", camp);
    return base + (base.includes("?") ? "&" : "?") + p.toString();
  })();

  return (
    <div>
      <h1>Relatórios</h1>
      <div className="sub">Os números da operação, calculados no banco na hora que você abre.</div>

      <div className="cartoes">
        <div className="cartao"><div className="num">{n(resumo.leads)}</div><div className="rot">Leads na base</div></div>
        <div className="cartao"><div className="num">{n(resumo.elegiveis)}</div>
          <div className="rot">Podem receber e-mail
            <Ajuda>
              Quem está ativo em pelo menos uma lista e não está bloqueado. <b>É este o
              tamanho real do seu alcance</b> — não o total de leads.
            </Ajuda>
          </div></div>
        <div className="cartao"><div className="num">{n(resumo.bloqueados)}</div>
          <div className="rot">Bloqueados
            <Ajuda>Estão na supressão: bounce, reclamação de spam, descadastro ou bloqueio manual. Nunca recebem nada.</Ajuda>
          </div></div>
        <div className="cartao"><div className="num">{n(resumo.novos_30d)}</div>
          <div className="rot">Novos em 30 dias
            <Ajuda>O ritmo de entrada da base. Comparado com o mês anterior no “Crescimento da base”, é o que diz se a captação está funcionando.</Ajuda>
          </div></div>
        <div className="cartao"><div className="num">{n(resumo.enviados_30d)}</div>
          <div className="rot">E-mails em 30 dias
            <Ajuda>Volume que saiu no último mês, somando campanha e automação. Serve para acompanhar o consumo do provedor.</Ajuda>
          </div></div>
      </div>

      <div className="linha" style={{ margin: "14px 0" }}>
        {abas.map(([v, r]) => (
          <button key={v} data-tour={`aba-${v}`} className={aba === v ? "primario" : ""}
            style={{ flex: "0 0 auto" }} onClick={() => setAba(v)}>{r}</button>
        ))}
      </div>

      {aba === "base" && (
        <>
          <div className="caixa">
            <h2>Quem pode receber
              <Ajuda>
                A diferença entre os dois números não é perda — é proteção. Mandar para quem
                se descadastrou, deu erro de entrega ou nunca confirmou é exatamente o que
                faz o provedor passar a tratar o seu domínio como spam, e aí nem quem quer
                receber recebe.
              </Ajuda>
            </h2>
            <div className="sub">
              Dos {n(resumo.leads)} leads, {n(resumo.elegiveis)} estão ativos em alguma lista e não
              estão bloqueados. A diferença não é perda: é gente que se descadastrou, deu erro de
              entrega ou nunca confirmou — mandar para eles machuca a reputação do domínio.
            </div>
          </div>

          <div className="caixa">
            <h2>Crescimento da base
              <Ajuda>
                Conta pela data de entrada de cada pessoa. Quem veio da migração aparece no
                mês em que entrou no ActiveCampaign, não no mês da migração — por isso o
                histórico antigo faz sentido.
              </Ajuda>
            </h2>
            <div className="sub">Leads novos por mês, nos últimos 18 meses.</div>
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Mês</th><th>Novos</th><th>Acumulado</th><th></th></tr></thead>
              <tbody>
                {cresc.map((c) => (
                  <tr key={c.mes}>
                    <td>{new Date(c.mes + "T12:00:00").toLocaleDateString("pt-BR",
                      { month: "short", year: "numeric" })}</td>
                    <td>{n(c.novos)}</td>
                    <td style={{ color: "var(--texto2)" }}>{n(c.acumulado)}</td>
                    <td style={{ width: "45%" }}><Barra valor={Number(c.novos)} maximo={maxCresc} /></td>
                  </tr>
                ))}
                {!cresc.length && <tr><td colSpan={4} className="sub">sem dados</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === "origem" && (
        <>
          <div className="caixa">
            <h2>De onde vem o dinheiro
              <Ajuda>
                A pergunta que esta aba responde: <b>das vendas que dá para rastrear,
                de onde veio o dinheiro?</b>
                <br /><br />
                “Rastrear” = a pessoa chegou por um link com identificação (anúncio,
                bio, stories) e isso ficou gravado. Quem compra pelo WhatsApp, digitando
                o site direto ou dentro da própria Hotmart entra <b>sem origem</b> — a
                venda conta no faturamento, só não conta aqui.
              </Ajuda>
            </h2>
            <div className="linha" style={{ marginTop: 4 }}>
              <Escolher style={{ maxWidth: 220 }} valor={periodo}
                aoMudar={(v) => setPeriodo(v as "30" | "")}
                opcoes={[
                  { valor: "30", rotulo: "Últimos 30 dias" },
                  { valor: "", rotulo: "Desde o começo" },
                ]} />
            </div>
            <div className="cartoes" style={{ marginTop: 12 }}>
              <div className="cartao">
                <div className="num">{reais(resumoDin?.receita_rastreada ?? 0)}</div>
                <div className="rot">Receita com origem conhecida</div>
              </div>
              <div className="cartao">
                <div className="num">
                  {n(resumoDin?.compras_com_origem)}
                  <span style={{ fontSize: "calc(15px * var(--escala-texto))", color: "var(--texto2)" }}>
                    {" "}de {n(resumoDin?.compras)}
                  </span>
                </div>
                <div className="rot">Compras rastreadas
                  <Ajuda>
                    O rastreio nasceu junto com a captação daqui — o histórico antigo veio
                    sem origem, e isso não tem conserto retroativo. O que importa: daqui
                    para frente, todo link de anúncio e de bio com UTM faz este número
                    crescer sozinho.
                  </Ajuda>
                </div>
              </div>
              <div className="cartao">
                <div className="num">
                  {resumoDin && resumoDin.compras > 0
                    ? Math.round(100 * resumoDin.compras_com_origem / resumoDin.compras) + "%"
                    : "—"}
                </div>
                <div className="rot">Cobertura do rastreio</div>
              </div>
            </div>
            <div className="sub" style={{ marginTop: 10 }}>
              Leia assim: <b>“{resumoDin ? Math.round(100 * (resumoDin.compras_com_origem) / Math.max(1, resumoDin.compras)) : 0}%
              das compras do período têm origem conhecida”</b>. As tabelas abaixo falam só
              dessa fatia — é a parte em que dá para decidir onde pôr verba. O resto
              comprou sem link rastreado (WhatsApp, boca a boca, área de membros).
            </div>
          </div>

          <div className="caixa">
            <h2>Monte um link rastreado
              <Ajuda>
                O rastreio só existe se o link disser de onde veio. Este montador escreve
                os parâmetros no padrão que o sistema já entende — cole o endereço da sua
                página, escolha de onde o link vai ser publicado e use o resultado.
                <br /><br />
                Vale para tudo: bio do Instagram, stories, grupo de WhatsApp, descrição das
                lives, anúncio. Cada lugar com o seu próprio link é o que faz a cobertura
                subir dos 20% de hoje.
              </Ajuda>
            </h2>
            <div className="linha" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <input style={{ flex: "1 1 260px" }} placeholder="cole a página, ex.: suapagina.com.br/inscricoes"
                value={utmUrl} onChange={(e) => setUtmUrl(e.target.value)} />
              <Escolher style={{ flex: "0 0 200px" }} valor={utmOrigem} aoMudar={setUtmOrigem}
                opcoes={ORIGENS_PRONTAS.map(([v, r]) => ({ valor: v, rotulo: r }))} />
              <input style={{ flex: "0 0 180px" }} placeholder="campanha (opcional)"
                value={utmCampanha} onChange={(e) => setUtmCampanha(e.target.value)} />
            </div>
            {utmUrl.trim() && (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  background: "var(--fundo2, rgba(107,78,168,.08))", padding: "10px 12px",
                  borderRadius: 8, wordBreak: "break-all",
                  fontSize: "calc(13px * var(--escala-texto))",
                }}>{linkUtm}</div>
                <button style={{ marginTop: 8 }}
                  onClick={() => { navigator.clipboard?.writeText(linkUtm); setUtmCopiado(true); }}>
                  {utmCopiado ? "Copiado!" : "Copiar link"}
                </button>
              </div>
            )}
            <div className="sub" style={{ marginTop: 10 }}>
              Depois que a pessoa chega por um link desses e preenche um formulário, a
              origem fica <b>guardada nela para sempre</b> — e aparece aqui quando ela
              comprar, mesmo que a compra aconteça semanas depois.
            </div>
          </div>

          <div className="caixa">
            <h2>O ranking das origens
              <Ajuda>
                Só compra aprovada e em reais. A origem vem do link pelo qual a pessoa
                chegou (utm_source e companhia), guardada na captação e carregada até a
                compra. Troque a dimensão para ver o mesmo dinheiro por rede, página de
                captura ou pago × orgânico.
              </Ajuda>
            </h2>
            <div className="linha" style={{ marginTop: 10 }}>
              <Escolher style={{ maxWidth: 300 }} valor={dimensao} aoMudar={setDimensao}
                opcoes={DIMENSOES.map(([v, r]) => ({ valor: v, rotulo: r }))} />
            </div>
            <table style={{ marginTop: 12 }}>
              <thead><tr>
                <th>Origem</th><th>Receita</th><th>Compradores</th>
                <th>Ticket médio<Ajuda>Receita dividida pelas compras em reais daquela origem. Compare origens: ticket alto = público que compra produto caro.</Ajuda></th>
                <th></th>
              </tr></thead>
              <tbody>
                {atrib.filter((a) => a.valor !== "(sem origem)").map((a, i) => (
                  <tr key={i}>
                    <td><b>{traduzOrigem(a.valor)}</b></td>
                    <td>{reais(a.receita)}</td>
                    <td>{n(a.compradores)}</td>
                    <td style={{ color: "var(--texto2)" }}>
                      {a.ticket ? reais(a.ticket) : "—"}</td>
                    <td style={{ width: "30%" }}>
                      <Barra valor={Number(a.receita)} maximo={maxReceita} /></td>
                  </tr>
                ))}
                {!atrib.filter((a) => a.valor !== "(sem origem)").length && (
                  <tr><td colSpan={5} className="sub">
                    Nenhuma venda rastreada no período — troque para “Desde o começo” ou
                    confira se os links dos anúncios estão saindo com UTM.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="caixa">
            <h2>Anúncios que mais trouxeram dinheiro
              <Ajuda>
                Cada linha é um anúncio identificado no link da venda (o número é o ID do
                anúncio no Meta — o nome dele está no Gerenciador de Anúncios). Anúncio sem
                parâmetro no link não some do Meta; ele só não tem como ser ligado à compra
                aqui, e por isso não entra nesta lista.
              </Ajuda>
            </h2>
            <div className="sub">
              É por aqui que se decide onde colocar mais verba: o Meta mostra clique,
              isto mostra <b>dinheiro</b>.
            </div>
            <table style={{ marginTop: 10 }}>
              <thead><tr>
                <th>Anúncio</th><th>Rede</th><th>Página</th>
                <th>Compradores</th><th>Receita</th><th>Período</th><th></th>
              </tr></thead>
              <tbody>
                {anuncios.filter((a) => a.anuncio !== "(sem anúncio)").map((a, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: "calc(12px * var(--escala-texto))" }}>{a.anuncio}</td>
                    <td>{a.rede ?? "—"}</td>
                    <td style={{ fontSize: "calc(12px * var(--escala-texto))", color: "var(--texto2)" }}>
                      {a.pagina ?? "—"}</td>
                    <td>{n(a.compradores)}</td>
                    <td><b>{reais(a.receita)}</b></td>
                    <td style={{ fontSize: "calc(12px * var(--escala-texto))", color: "var(--texto2)" }}>
                      {a.primeira && new Date(a.primeira + "T12:00").toLocaleDateString("pt-BR")}
                      {a.ultima && a.ultima !== a.primeira && " a " + new Date(a.ultima + "T12:00").toLocaleDateString("pt-BR")}
                    </td>
                    <td style={{ width: "18%" }}>
                      <Barra valor={Number(a.receita)} maximo={maxAnuncio} /></td>
                  </tr>
                ))}
                {!anuncios.filter((a) => a.anuncio !== "(sem anúncio)").length && (
                  <tr><td colSpan={7} className="sub">
                    Nenhuma venda com anúncio identificado no período. Para aparecer aqui,
                    o link do anúncio precisa carregar as UTMs até a página de captura.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === "tags" && (
        <div className="caixa">
          <h2>Estatísticas de tag
            <Ajuda>
              Serve para dois usos: achar tag inchada (metade da base numa tag só não segmenta
              nada) e achar tag morta — pouca gente, sem automação, sobrando de um lançamento
              antigo.
              <br /><br />
              <b>Engajados</b> são os que estão com pontuação 20 ou mais dentro daquela tag.
            </Ajuda>
          </h2>
          <div className="sub">
            Quantos leads em cada tag e quantos deles estão engajados (pontuação 20 ou mais).
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr>
              <th>Tag</th><th>Leads</th><th>% da base</th><th>Engajados</th><th>Automação</th><th></th>
            </tr></thead>
            <tbody>
              {tags.map((t) => (
                <tr key={t.tag}>
                  <td>{t.tag}</td>
                  <td>{n(t.leads)}</td>
                  <td style={{ color: "var(--texto2)" }}>{t.percentual ?? 0}%</td>
                  <td>{n(t.engajados)}</td>
                  <td>{t.usada_em_automacao
                    ? <span className="etiqueta et-roxa">sim</span>
                    : <span style={{ color: "var(--texto2)" }}>—</span>}</td>
                  <td style={{ width: "28%" }}><Barra valor={Number(t.leads)} maximo={maxTag} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === "campos" && (
        <div className="caixa">
          <h2>Análise de campo
            <Ajuda>
              Mostra os 25 valores mais comuns de um campo. É como se descobre que “Instagram”,
              “instagram” e “IG” são a mesma resposta escrita de três jeitos — e que aquele
              campo deveria virar <b>lista de opções</b> em Campos, para parar de acontecer.
            </Ajuda>
          </h2>
          <div className="sub">Quais valores aparecem num campo próprio e com que frequência.</div>
          <Escolher style={{ marginTop: 10, maxWidth: 380 }} valor={campoSel}
            aoMudar={setCampoSel} vazio="— escolher o campo —"
            opcoes={campos.map((c) => ({ valor: c.chave, rotulo: c.rotulo }))} />

          {campoSel && (
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Valor</th><th>Leads</th><th>%</th><th></th></tr></thead>
              <tbody>
                {valores.map((v, i) => (
                  <tr key={i}>
                    <td style={{ wordBreak: "break-word" }}>{v.valor}</td>
                    <td>{n(v.leads)}</td>
                    <td style={{ color: "var(--texto2)" }}>{v.percentual}%</td>
                    <td style={{ width: "35%" }}><Barra valor={Number(v.leads)} maximo={maxValor} /></td>
                  </tr>
                ))}
                {!valores.length && (
                  <tr><td colSpan={4} className="sub">Nenhum lead tem valor nesse campo.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
