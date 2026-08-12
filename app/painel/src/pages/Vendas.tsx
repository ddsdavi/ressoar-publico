import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import Ajuda from "../components/Ajuda";
import Escolher from "../components/Escolher";

// Vendas: o que cada produto faz quando é comprado, e o que a Hotmart
// mandou.
//
// A configuração na Hotmart é UMA só, para todos os produtos. Quem decide
// o que acontece com cada um é esta tela — então produto novo não exige
// voltar lá, nem mexer em código.
//
// A tela é uma LISTA, não uma pilha de cartões. Cada produto ocupa uma
// linha que responde de relance "isto está ligado?" e "o que ele faz?";
// os valores (qual lista, qual tag) abrem sob demanda. Antes eram onze
// cartões altos repetindo os mesmos rótulos, tudo com o mesmo peso: nada
// era comparável e achar um produto era rolar a página inteira.

type Mapa = {
  id: number; padrao_nome: string | null; ucode: string | null; apelido: string | null;
  lista_fk: number | null; tag_fk: number | null; tag_reembolso: number | null; ativo: boolean;
  tag_turma_padrao: string | null; turma_dia_semana: number | null;
  tag_manychat: string | null; tag_manychat_turma: boolean;
  tag_manychat_turma_padrao: string | null;
  turma_hora: number | null; turma_fuso: string | null;
};
type Visto = {
  produto: string; ucode: string | null; eventos: number;
  primeira: string; ultima: string; mapeado: boolean;
};
type Evento = {
  evento_id: string; evento: string | null; email: string | null; produto: string | null;
  transacao: string | null; processado: boolean; situacao: string;
  erro: string | null; recebido_em: string;
};

const vazio = {
  padrao_nome: "", ucode: "", apelido: "",
  lista_fk: "", tag_fk: "", tag_reembolso: "", ativo: true,
  tag_turma_padrao: "", turma_dia_semana: "1", turma_hora: "7",
  tag_manychat: "", tag_manychat_turma: false, tag_manychat_turma_padrao: "",
};

const DIAS: [string, string][] = [
  ["1", "segunda"], ["2", "terça"], ["3", "quarta"], ["4", "quinta"],
  ["5", "sexta"], ["6", "sábado"], ["7", "domingo"],
];

type FiltroRegra = "todas" | "ativas" | "desligadas" | "vazias";
const FILTROS_REGRA: { id: FiltroRegra; rot: string; dica: string }[] = [
  { id: "todas", rot: "Todas", dica: "Todas as regras cadastradas" },
  { id: "ativas", rot: "Ativas", dica: "Valem agora: a próxima compra já passa por elas" },
  { id: "desligadas", rot: "Desligadas", dica: "A compra é registrada, mas nada acontece com quem comprou" },
  { id: "vazias", rot: "Sem efeito", dica: "Existem, mas não colocam em lista, não dão tag nem marcam no ManyChat" },
];

type FiltroEvento = "todos" | "erro" | "pendente" | "processado" | "ignorado";
const FILTROS_EVENTO: { id: FiltroEvento; rot: string; dica: string }[] = [
  { id: "todos", rot: "Todos", dica: "Tudo o que a Hotmart mandou" },
  { id: "erro", rot: "Erros", dica: "Algo falhou no processamento — veja o motivo na própria linha" },
  { id: "pendente", rot: "Pendentes", dica: "Chegaram e ainda não foram processados" },
  { id: "processado", rot: "Processados", dica: "A regra do produto rodou" },
  { id: "ignorado", rot: "Fora do escopo", dica: "Avisos que este endereço não trata — não é falha" },
];

// "há 12 min", "há 3 h", "ontem". Data cheia por extenso fica no title:
// numa lista de duzentas linhas, "06/08/2026 07:14:22" repetido é ruído —
// o que interessa é se foi agora ou faz semanas.
function quando(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

// junta pedaços de frase com vírgula e "e" no último — o resumo da regra
// precisa soar como português, não como lista de campos
function juntar(itens: React.ReactNode[]): React.ReactNode {
  return itens.map((x, i) => (
    <span key={i}>{i > 0 && (i === itens.length - 1 ? " e " : ", ")}{x}</span>
  ));
}

export default function Vendas() {
  const { ehAdmin } = useSessao();
  const [aba, setAba] = useState<"mapa" | "eventos">("mapa");
  const [mapas, setMapas] = useState<Mapa[]>([]);
  const [vistos, setVistos] = useState<Visto[]>([]);
  const [listas, setListas] = useState<{ lista_id: number; nome: string }[]>([]);
  const [tags, setTags] = useState<{ tag_id: number; nome: string }[]>([]);

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroRegra>("todas");
  const [abertas, setAbertas] = useState<Set<number>>(new Set());

  const [eventos, setEventos] = useState<Evento[]>([]);
  const [buscaEv, setBuscaEv] = useState("");
  const [filtroEv, setFiltroEv] = useState<FiltroEvento>("todos");
  const [limite, setLimite] = useState(200);
  const [totalFiltrado, setTotalFiltrado] = useState(0);
  const [contagemEv, setContagemEv] = useState<Record<string, number> | null>(null);
  const [erroAberto, setErroAberto] = useState<Set<string>>(new Set());

  const [editando, setEditando] = useState<Mapa | "novo" | null>(null);
  const [f, setF] = useState<typeof vazio>(vazio);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    const [m, v, l, t, r] = await Promise.all([
      supabase.from("hotmart_produtos").select("*").order("apelido"),
      supabase.rpc("hotmart_produtos_vistos"),
      supabase.from("listas").select("lista_id, nome").order("nome"),
      supabase.from("tags").select("tag_id, nome").order("nome"),
      supabase.rpc("hotmart_resumo"),
    ]);
    setMapas((m.data as never) ?? []);
    setVistos(((v.data as never) ?? []) as Visto[]);
    setListas(l.data ?? []);
    setTags((t.data ?? []) as never);
    // hotmart_resumo() conta por situação no banco inteiro. Se ela não
    // estiver aplicada nesta instância, os números somem — as etiquetas
    // continuam funcionando sem eles, é melhor que mostrar número errado.
    const linhas = (r.data ?? []) as { situacao: string; eventos: number }[];
    setContagemEv(r.error ? null : Object.fromEntries(
      linhas.map((x) => [x.situacao, Number(x.eventos)])));
  }
  useEffect(() => { carregar(); }, []);

  // Os eventos só são buscados quando alguém abre a aba: são centenas de
  // linhas que a tela de regras nunca mostra.
  async function carregarEventos() {
    let q = supabase.from("hotmart_eventos")
      .select("evento_id, evento, email, produto, transacao, processado, situacao, erro, recebido_em",
        { count: "exact" })
      .order("recebido_em", { ascending: false })
      .limit(limite);
    if (filtroEv !== "todos") q = q.eq("situacao", filtroEv);
    const { data, count } = await q;
    setEventos((data as never) ?? []);
    setTotalFiltrado(count ?? 0);
  }
  useEffect(() => {
    if (aba === "eventos") carregarEventos();
  }, [aba, filtroEv, limite]);

  function abrir(x: Mapa | null, pronto?: Visto) {
    setEditando(x ?? "novo");
    setF(x
      ? {
        padrao_nome: x.padrao_nome ?? "", ucode: x.ucode ?? "", apelido: x.apelido ?? "",
        lista_fk: x.lista_fk ? String(x.lista_fk) : "",
        tag_fk: x.tag_fk ? String(x.tag_fk) : "",
        tag_reembolso: x.tag_reembolso ? String(x.tag_reembolso) : "",
        ativo: x.ativo,
        tag_turma_padrao: x.tag_turma_padrao ?? "",
        tag_manychat: x.tag_manychat ?? "",
        tag_manychat_turma: !!x.tag_manychat_turma,
        tag_manychat_turma_padrao: x.tag_manychat_turma_padrao ?? "",
        turma_dia_semana: String(x.turma_dia_semana ?? 1),
        turma_hora: String(x.turma_hora ?? 7),
      }
      : {
        ...vazio,
        padrao_nome: pronto?.produto ?? "",
        ucode: pronto?.ucode ?? "",
        apelido: pronto?.produto ?? "",
      });
  }

  // Esc fecha a gaveta. O Escolher já segura o Esc dele quando está aberto,
  // então escolher uma lista e desistir não fecha o formulário junto.
  useEffect(() => {
    if (!editando) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setEditando(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [editando]);

  const identificada = !!f.padrao_nome.trim() || !!f.ucode.trim();

  async function salvar() {
    if (!identificada || salvando) return;
    setSalvando(true);
    const dados = {
      padrao_nome: f.padrao_nome.trim() || null,
      ucode: f.ucode.trim() || null,
      apelido: f.apelido.trim() || f.padrao_nome.trim(),
      lista_fk: f.lista_fk ? Number(f.lista_fk) : null,
      tag_fk: f.tag_fk ? Number(f.tag_fk) : null,
      tag_reembolso: f.tag_reembolso ? Number(f.tag_reembolso) : null,
      ativo: f.ativo,
      tag_turma_padrao: f.tag_turma_padrao.trim() || null,
      tag_manychat: f.tag_manychat.trim() || null,
      tag_manychat_turma: f.tag_manychat_turma,
      tag_manychat_turma_padrao: f.tag_manychat_turma_padrao.trim() || null,
      turma_dia_semana: f.tag_turma_padrao.trim() ? Number(f.turma_dia_semana) : null,
      turma_hora: f.tag_turma_padrao.trim() ? Number(f.turma_hora) : null,
      turma_fuso: "America/Sao_Paulo",
    };
    const r = editando === "novo"
      ? await supabase.from("hotmart_produtos").insert(dados)
      : await supabase.from("hotmart_produtos").update(dados).eq("id", (editando as Mapa).id);
    setSalvando(false);
    if (r.error) { alert(r.error.message); return; }
    setEditando(null); carregar();
  }

  async function excluir(x: Mapa): Promise<boolean> {
    if (!confirm(`Remover a regra de "${x.apelido}"?\n\nAs compras já registradas não mudam — só as próximas deixam de entrar na lista e receber a tag.`)) return false;
    await supabase.from("hotmart_produtos").delete().eq("id", x.id);
    carregar();
    return true;
  }

  // Ligar e desligar era só dentro do formulário: pausar um produto pedia
  // abrir a gaveta, achar a caixinha no fim e salvar. Aqui é um clique.
  async function alternarAtivo(x: Mapa) {
    const acao = x.ativo ? "DESLIGAR" : "LIGAR";
    if (!confirm(`${acao} a regra de "${x.apelido}"?\n\n` + (x.ativo
      ? "As compras continuam registradas, mas ninguém mais entra em lista, ganha tag ou é marcado no ManyChat por este produto."
      : "A partir de agora, quem comprar este produto passa pela regra — e isso dispara as automações da lista e da tag."))) return;
    await supabase.from("hotmart_produtos").update({ ativo: !x.ativo }).eq("id", x.id);
    carregar();
  }

  function alternarDetalhe(id: number) {
    setAbertas((atual) => {
      const novo = new Set(atual);
      novo.has(id) ? novo.delete(id) : novo.add(id);
      return novo;
    });
  }

  const nomeLista = (id: number | null) => listas.find((l) => l.lista_id === id)?.nome;
  const nomeTag = (id: number | null) => tags.find((t) => t.tag_id === id)?.nome;
  const diaDaSemana = (n: number | null) => DIAS.find(([v]) => v === String(n))?.[1];

  // O que a regra faz, na ordem em que acontece. É esta lista que vira as
  // etiquetas da linha fechada e as caixas do detalhe aberto.
  function efeitosDe(x: Mapa) {
    return [
      nomeLista(x.lista_fk) && {
        chave: "lista", icone: "📋", curto: "lista",
        rotulo: "Entra na lista", valor: nomeLista(x.lista_fk)!,
      },
      nomeTag(x.tag_fk) && {
        chave: "tag", icone: "🏷️", curto: "tag",
        rotulo: "Ganha a tag", valor: nomeTag(x.tag_fk)!,
      },
      x.tag_turma_padrao && {
        chave: "turma", icone: "🎓", curto: "turma",
        rotulo: "Tag da turma", valor: x.tag_turma_padrao,
        nota: `vira toda ${diaDaSemana(x.turma_dia_semana)} às ${x.turma_hora}h`,
      },
      x.tag_manychat && {
        chave: "manychat", icone: "💬", curto: "ManyChat",
        rotulo: "Marca no ManyChat", valor: x.tag_manychat,
      },
      x.tag_manychat_turma && {
        chave: "mc-turma", icone: "💬", curto: "turma no ManyChat",
        rotulo: "E a turma no ManyChat",
        valor: x.tag_manychat_turma_padrao || x.tag_turma_padrao || "(igual à daqui)",
      },
      nomeTag(x.tag_reembolso) && {
        chave: "reembolso", icone: "↩️", curto: "reembolso",
        rotulo: "Se pedir reembolso", valor: nomeTag(x.tag_reembolso)!,
      },
    ].filter(Boolean) as {
      chave: string; icone: string; curto: string;
      rotulo: string; valor: string; nota?: string;
    }[];
  }

  // Quantas compras já chegaram batendo com esta regra. Mesmo critério do
  // banco (código do produto OU nome contendo o padrão), então regra ativa
  // e antiga com zero aqui é sinal de ucode ou nome escrito errado.
  function comprasDaRegra(x: Mapa): number {
    const padrao = (x.padrao_nome ?? "").trim().toLowerCase();
    return vistos.reduce((soma, v) => {
      const bate = (!!x.ucode && v.ucode === x.ucode)
        || (!!padrao && (v.produto ?? "").toLowerCase().includes(padrao));
      return bate ? soma + Number(v.eventos) : soma;
    }, 0);
  }

  const semRegra = vistos.filter((v) => !v.mapeado);

  const contagens = {
    todas: mapas.length,
    ativas: mapas.filter((x) => x.ativo).length,
    desligadas: mapas.filter((x) => !x.ativo).length,
    vazias: mapas.filter((x) => !efeitosDe(x).length).length,
  };

  // A busca varre o que a pessoa procuraria: o apelido, o que reconhece o
  // produto e os nomes de lista e tag que a linha fechada não mostra.
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return mapas.filter((x) => {
      if (filtro === "ativas" && !x.ativo) return false;
      if (filtro === "desligadas" && x.ativo) return false;
      if (filtro === "vazias" && efeitosDe(x).length) return false;
      if (!q) return true;
      const alvo = [
        x.apelido ?? "", x.padrao_nome ?? "", x.ucode ?? "",
        ...efeitosDe(x).map((e) => `${e.rotulo} ${e.valor}`),
      ].join(" ").toLowerCase();
      return alvo.includes(q);
    });
  }, [mapas, busca, filtro, listas, tags]);

  const ativas = visiveis.filter((x) => x.ativo);
  const paradas = visiveis.filter((x) => !x.ativo);
  const emSecoes = filtro === "todas" && !!ativas.length && !!paradas.length;

  const eventosVisiveis = useMemo(() => {
    const q = buscaEv.trim().toLowerCase();
    if (!q) return eventos;
    return eventos.filter((e) => [e.email, e.produto, e.evento, e.transacao, e.erro]
      .join(" ").toLowerCase().includes(q));
  }, [eventos, buscaEv]);

  function Linha({ x }: { x: Mapa }) {
    const efeitos = efeitosDe(x);
    const aberta = abertas.has(x.id);
    const compras = comprasDaRegra(x);
    return (
      <div className={"auto-item" + (x.ativo ? " ligada" : "") + (efeitos.length ? "" : " sem-efeito")}>
        <div className="auto-linha">
          <div className="auto-info">
            <div className="auto-nome">
              {ehAdmin
                ? <button className="link-tabela" onClick={() => abrir(x)}>{x.apelido}</button>
                : <b>{x.apelido}</b>}
              {!efeitos.length && (
                <span className="etiqueta et-amarela" title="Não coloca em lista, não dá tag e não marca no ManyChat — a compra só fica registrada">
                  sem efeito
                </span>
              )}
              {/* quem não é admin não tem o interruptor à direita: sem isto,
                  o estado da regra só apareceria na barrinha colorida */}
              {!ehAdmin && !x.ativo && (
                <span className="etiqueta et-cinza" title="A compra é registrada, mas nada acontece com quem comprou">
                  desligada
                </span>
              )}
            </div>
            <div className="regra-como">
              {x.ucode
                ? <>reconhecido pelo código <code title={x.ucode}>{x.ucode.slice(0, 8)}…</code></>
                : <>reconhecido quando o nome contém “{x.padrao_nome}”</>}
            </div>
          </div>

          <button
            className="auto-passos"
            onClick={() => alternarDetalhe(x.id)}
            title={efeitos.length ? "Ver o que acontece, com nomes" : "Esta regra não faz nada ainda"}
            disabled={!efeitos.length}
          >
            {efeitos.length
              ? efeitos.map((e) => (
                <span className="auto-chip" key={e.chave}>
                  <i>{e.icone}</i> {e.curto}
                </span>
              ))
              : <span className="auto-chip vazio">não faz nada</span>}
            {!!efeitos.length && <span className="seta">{aberta ? "▴" : "▾"}</span>}
          </button>

          <div className="auto-exec" title="Compras já recebidas que batem com esta regra">
            {compras
              ? <><b>{compras}</b> {compras === 1 ? "compra" : "compras"}</>
              : <span className="zero">—</span>}
          </div>

          {/* Excluir não fica na linha: repetido onze vezes em vermelho, ele
              chama mais atenção que o nome do produto e fica a um deslize do
              Editar. Mora dentro da gaveta, junto de quem já abriu a regra. */}
          {ehAdmin && (
            <div className="auto-acoes">
              <button onClick={() => abrir(x)}>Editar</button>
              <label className="interruptor" title={x.ativo ? "Desligar a regra" : "Ligar a regra"}>
                <input type="checkbox" checked={x.ativo} onChange={() => alternarAtivo(x)} />
                <span className="trilho" />
                <span className="rot">{x.ativo ? "Ativa" : "Desligada"}</span>
              </label>
            </div>
          )}
        </div>

        {aberta && !!efeitos.length && (
          <div className="regra-detalhe">
            {efeitos.map((e) => (
              <div className={"efeito" + (e.chave === "reembolso" ? " reembolso" : "")} key={e.chave}>
                <div className="rot"><span aria-hidden="true">{e.icone}</span>{e.rotulo}</div>
                <div className="val">{e.valor}</div>
                {e.nota && <div className="nota">{e.nota}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // O resumo da gaveta: a regra dita em português, mudando enquanto se
  // digita. É o que responde "afinal, o que isto vai fazer?" sem obrigar a
  // reler os quinze campos de cima.
  function resumoDaRegra(): React.ReactNode {
    const nome = f.apelido.trim() || f.padrao_nome.trim();
    const partes: React.ReactNode[] = [];
    if (f.lista_fk) partes.push(<>entra na lista <b>{nomeLista(Number(f.lista_fk))}</b></>);
    if (f.tag_fk) partes.push(<>ganha a tag <b>{nomeTag(Number(f.tag_fk))}</b></>);
    if (f.tag_turma_padrao.trim()) {
      partes.push(<>recebe a tag da próxima turma (<b>{f.tag_turma_padrao.trim()}</b>, que vira
        toda {diaDaSemana(Number(f.turma_dia_semana))} às {f.turma_hora}h)</>);
    }
    if (f.tag_manychat.trim()) partes.push(<>é marcada no ManyChat como <b>{f.tag_manychat.trim()}</b></>);
    if (f.tag_manychat_turma && f.tag_turma_padrao.trim()) {
      partes.push(<>leva a turma para o ManyChat como <b>
        {f.tag_manychat_turma_padrao.trim() || f.tag_turma_padrao.trim()}</b></>);
    }

    return (
      <div className="resumo-regra">
        <span className="rot">Vai ficar assim</span>
        {!f.ativo && <>Enquanto a regra estiver desligada, a compra é registrada e <b>nada acontece</b> com quem comprou.<br /></>}
        {partes.length
          ? <>Quem comprar <b>{nome || "este produto"}</b> {juntar(partes)}.</>
          : <>Quem comprar <b>{nome || "este produto"}</b> apenas fica registrado: não entra em
            lista, não recebe tag e não é marcado no ManyChat.</>}
        {f.tag_reembolso && (
          <> Se pedir reembolso, ganha a tag <b>{nomeTag(Number(f.tag_reembolso))}</b>.</>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="pagina-topo">
        <div>
          {/* sem contagem no título: a aba logo abaixo já mostra o mesmo número */}
          <h1>Produtos e vendas</h1>
          <div className="sub">
            Uma regra por produto: o que acontece com a pessoa quando ela compra.
            <Ajuda>
              A Hotmart avisa a Ressoar a cada compra — isso já funciona e é uma configuração
              só, para todos os produtos (o endereço fica em Configurações → API e webhooks).
              O que muda de produto para produto é o <b>depois</b>: em que lista a pessoa
              entra, que tag ganha, se é marcada no ManyChat. É isso que se define aqui.
              <br /><br />
              Produto sem regra não é perdido: a compra fica registrada em "Eventos
              recebidos". Só não acontece nada com a pessoa.
            </Ajuda>
          </div>
        </div>
        {ehAdmin && (
          <button className="primario" onClick={() => abrir(null)}>+ Nova regra de produto</button>
        )}
      </div>

      <div className="abas">
        <button className={aba === "mapa" ? "on" : ""} onClick={() => setAba("mapa")}>
          Regras dos produtos <span className="cont">{mapas.length}</span>
        </button>
        <button className={aba === "eventos" ? "on" : ""} onClick={() => setAba("eventos")}>
          Eventos recebidos
          {contagemEv && (
            contagemEv.erro
              ? <span className="cont alerta" title={`${contagemEv.erro} evento(s) com erro`}>
                  {contagemEv.erro} com erro
                </span>
              : <span className="cont">
                  {Object.values(contagemEv).reduce((a, b) => a + b, 0)}
                </span>
          )}
        </button>
      </div>

      {aba === "mapa" && (
        <>
          {!!semRegra.length && (
            <div className="aviso atencao">
              <b className="titulo">
                {semRegra.length === 1
                  ? "1 produto já vendeu e ainda não tem regra."
                  : `${semRegra.length} produtos já venderam e ainda não têm regra.`}
              </b>
              As compras estão registradas; só não aconteceu nada com quem comprou. Clique
              para criar a regra já com o nome e o código preenchidos.
              <div className="pendencias">
                {semRegra.slice(0, 6).map((v) => (
                  <button key={v.produto} onClick={() => abrir(null, v)}>
                    <span className="nome">+ {v.produto}</span>
                    <span className="qtd" title={`${v.eventos} evento(s) de compra recebidos`}>
                      {v.eventos}
                    </span>
                  </button>
                ))}
                {semRegra.length > 6 && (
                  <span className="resto">e mais {semRegra.length - 6} — veja em Eventos recebidos.</span>
                )}
              </div>
            </div>
          )}

          <div className="barra-ferramentas">
            <div className="campo-busca">
              <span className="lupa" aria-hidden="true">⌕</span>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por produto, código, lista ou tag…"
              />
              {!!busca && <button className="limpa" onClick={() => setBusca("")} title="Limpar busca">×</button>}
            </div>
            <div className="chips">
              {FILTROS_REGRA.map((x) => (
                <button
                  key={x.id}
                  className={"chip-filtro" + (filtro === x.id ? " on" : "")}
                  onClick={() => setFiltro(x.id)}
                  title={x.dica}
                >
                  {x.rot} <b>{contagens[x.id]}</b>
                </button>
              ))}
              <Ajuda>
                Em cada linha, as etiquetas do meio dizem <b>o que a regra faz</b> — clique
                nelas para ver com quais listas e tags. À direita, <b>compras</b> é quantas já
                chegaram batendo com esta regra: zero numa regra antiga e ativa costuma ser
                código do produto ou nome escrito diferente do que a Hotmart manda.
                <br /><br />
                <b>Sem efeito</b> são as que existem mas não colocam em lista, não dão tag e
                não marcam no ManyChat: a compra fica registrada e nada mais.
              </Ajuda>
            </div>
          </div>

          {!visiveis.length ? (
            <div className="caixa vazio-lista">
              <b>{mapas.length ? "Nada encontrado." : "Nenhuma regra ainda."}</b>
              <div className="sub">
                {mapas.length
                  ? "Nenhuma regra bate com a busca ou o filtro."
                  : "Sem regra, a compra é registrada mas ninguém entra em lista nem recebe tag — e as automações de comprador não disparam."}
              </div>
              {(!!busca || filtro !== "todas")
                ? <button onClick={() => { setBusca(""); setFiltro("todas"); }}>Limpar busca e filtros</button>
                : ehAdmin && <button className="primario" onClick={() => abrir(null)}>+ Criar a primeira regra</button>}
            </div>
          ) : (
            <div className="lista-auto">
              {emSecoes ? (
                <>
                  <div className="secao">Ativas <span>{ativas.length}</span></div>
                  {ativas.map((x) => <Linha x={x} key={x.id} />)}
                  <div className="secao">Desligadas <span>{paradas.length}</span></div>
                  {paradas.map((x) => <Linha x={x} key={x.id} />)}
                </>
              ) : (
                visiveis.map((x) => <Linha x={x} key={x.id} />)
              )}
            </div>
          )}
        </>
      )}

      {aba === "eventos" && (
        <>
          <div className="barra-ferramentas">
            <div className="campo-busca">
              <span className="lupa" aria-hidden="true">⌕</span>
              <input
                value={buscaEv}
                onChange={(e) => setBuscaEv(e.target.value)}
                placeholder="Buscar por e-mail, produto ou transação…"
              />
              {!!buscaEv && <button className="limpa" onClick={() => setBuscaEv("")} title="Limpar busca">×</button>}
            </div>
            <div className="chips">
              {FILTROS_EVENTO.map((x) => (
                <button
                  key={x.id}
                  className={"chip-filtro" + (filtroEv === x.id ? " on" : "")}
                  onClick={() => { setFiltroEv(x.id); setLimite(200); }}
                  title={x.dica}
                >
                  {x.rot}
                  {contagemEv && <b>{x.id === "todos"
                    ? Object.values(contagemEv).reduce((a, b) => a + b, 0)
                    : (contagemEv[x.id] ?? 0)}</b>}
                </button>
              ))}
              <Ajuda>
                O corpo original de cada evento fica guardado no banco. Se algo der errado, dá
                para ver exatamente o que chegou — e reprocessar.
                <br /><br />
                <b>Fora do escopo</b> não é falha: a Hotmart manda muito além de compra (acesso
                à área de membros, envio de produto físico, troca de plano), e esses ficam
                registrados sem ação. <b>Erro</b> com frequência é tag do ManyChat escrita
                diferente ou produto sem regra.
              </Ajuda>
            </div>
          </div>

          {!eventosVisiveis.length ? (
            <div className="caixa vazio-lista">
              <b>Nada aqui.</b>
              <div className="sub">
                {buscaEv
                  ? `Nenhum dos ${eventos.length} eventos carregados bate com “${buscaEv}”.`
                  : filtroEv !== "todos"
                    ? "Nenhum evento nesta situação."
                    : "Nada recebido ainda. Assim que a Hotmart mandar o primeiro evento, ele aparece aqui."}
              </div>
              {(!!buscaEv || filtroEv !== "todos") && (
                <button onClick={() => { setBuscaEv(""); setFiltroEv("todos"); }}>Limpar busca e filtros</button>
              )}
            </div>
          ) : (
            <div className="caixa">
              <table className="tabela-eventos">
                <thead><tr>
                  <th>Quando</th>
                  <th>Evento<Ajuda>O nome que a Hotmart deu ao aviso: compra aprovada, boleto gerado, reembolso, chargeback, acesso à área de membros e por aí vai.</Ajuda></th>
                  <th>Comprador</th><th>Produto</th>
                  <th>Situação
                    <Ajuda>
                      <b>processado</b> = a regra do produto rodou · <b>fora do escopo</b> = evento
                      que este endereço não trata (não é falha) · <b>pendente</b> = ainda vai ser
                      processado · <b>erro</b> = algo falhou, e o motivo aparece embaixo da linha.
                    </Ajuda>
                  </th>
                </tr></thead>
                <tbody>
                  {eventosVisiveis.map((e) => {
                    const temErro = e.situacao === "erro";
                    const mostrando = erroAberto.has(e.evento_id);
                    return (
                      <Fragment key={e.evento_id}>
                      <tr className={temErro ? "tem-erro" : ""}>
                        <td className="quando">
                          <b title={new Date(e.recebido_em).toLocaleString("pt-BR")}>
                            {quando(e.recebido_em)}
                          </b>
                        </td>
                        <td style={{ fontSize: "calc(12.5px * var(--escala-texto))" }}>{e.evento ?? "—"}</td>
                        <td className="col-email" title={e.email ?? ""}>{e.email ?? "—"}</td>
                        <td>{e.produto ?? "—"}</td>
                        <td className="situacao">
                          {temErro ? (
                            // O motivo do erro vivia só no title: em celular
                            // não existe passar o mouse, e era justamente a
                            // informação mais importante da tela.
                            <button className="num-link" onClick={() => setErroAberto((s) => {
                              const n = new Set(s);
                              n.has(e.evento_id) ? n.delete(e.evento_id) : n.add(e.evento_id);
                              return n;
                            })}>
                              <span className="etiqueta et-vermelha">
                                erro {mostrando ? "▴" : "▾"}
                              </span>
                            </button>
                          ) : e.situacao === "processado"
                            ? <span className="etiqueta et-verde">processado</span>
                            : e.situacao === "ignorado"
                              ? <span className="etiqueta et-cinza"
                                  title="A Hotmart manda mais que compra: acesso à área de membros, envio de produto, troca de plano. Fica registrado, mas este endereço não age sobre eles.">
                                  fora do escopo</span>
                              : <span className="etiqueta et-amarela">pendente</span>}
                        </td>
                      </tr>
                      {temErro && mostrando && (
                        <tr className="motivo">
                          <td colSpan={5}>{e.erro || "sem motivo registrado"}</td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              <div className="rodape-lista">
                <span>
                  Mostrando {eventosVisiveis.length}
                  {buscaEv && ` de ${eventos.length} carregados`}
                  {!buscaEv && totalFiltrado > eventos.length && ` de ${totalFiltrado}`}
                  {filtroEv === "todos" ? " eventos" : ` eventos em “${FILTROS_EVENTO.find((x) => x.id === filtroEv)?.rot.toLowerCase()}”`}
                  , do mais recente para o mais antigo.
                </span>
                {!buscaEv && totalFiltrado > eventos.length && (
                  <button onClick={() => setLimite((n) => n + 200)}>Carregar mais 200</button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {editando && (
        <div className="gaveta painel" style={{ width: 560 }}>
          <button className="fechar" onClick={() => setEditando(null)} title="Fechar (Esc)">✕</button>

          <div className="gaveta-cabeca">
            <h2>{editando === "novo" ? "Nova regra de produto" : "Editar regra"}</h2>
            <div className="sub">
              {f.apelido.trim() || f.padrao_nome.trim() || "Diga qual produto é e o que acontece quando alguém compra."}
            </div>
          </div>

          <div className="gaveta-corpo">
            <div className="bloco-campo">
              <h3><span className="selo-num">1</span> Qual produto é</h3>
              <div className="sub">
                Como a Ressoar reconhece a compra quando ela chega da Hotmart.
              </div>

              <label>Nome do produto (como você chama)</label>
              <input value={f.apelido} placeholder="Curso Exemplo"
                onChange={(e) => setF({ ...f, apelido: e.target.value })} />

              <label>Código do produto (ucode)</label>
              <input value={f.ucode} placeholder="vem junto com a venda"
                onChange={(e) => setF({ ...f, ucode: e.target.value })} />
              <div className="sub" style={{ marginTop: 4 }}>
                É o jeito mais seguro de reconhecer: o código não muda quando você renomeia o
                produto na Hotmart. Se não souber, deixe vazio e use o nome abaixo.
              </div>

              <label>Ou parte do nome</label>
              <input value={f.padrao_nome} placeholder="Desafio Casa"
                onChange={(e) => setF({ ...f, padrao_nome: e.target.value })} />
              <div className="sub" style={{ marginTop: 4 }}>
                Basta um pedaço. Se duas regras casarem, ganha a mais específica.
              </div>

              {!identificada && (
                <div className="aviso atencao" style={{ marginTop: 10, marginBottom: 0 }}>
                  Falta o <b>código</b> ou <b>parte do nome</b> — é por um dos dois que o sistema
                  reconhece a compra. Sem isso a regra não tem como valer para ninguém.
                </div>
              )}
            </div>

            <div className="bloco-campo">
              <h3><span className="selo-num">2</span> O que acontece na compra</h3>
              <div className="sub">Vale só para compra aprovada — boleto gerado e não pago não faz nada.</div>

              <label>Entra na lista
                <Ajuda>
                  Entrar na lista <b>dispara as automações</b> ligadas a ela, inclusive as que
                  mandam e-mail. É assim que a sequência de boas-vindas do produto começa
                  sozinha.
                </Ajuda>
              </label>
              <Escolher valor={f.lista_fk} aoMudar={(v) => setF({ ...f, lista_fk: v })} vazio="nenhuma"
                opcoes={listas.map((l) => ({ valor: l.lista_id, rotulo: l.nome }))} />

              <label>E ganha a tag
                <Ajuda>
                  A marca permanente de “comprou este produto”. Diferente da lista, dela a pessoa
                  não se descadastra — então é a tag que serve para montar segmento de comprador
                  meses depois.
                </Ajuda>
              </label>
              <Escolher valor={f.tag_fk} aoMudar={(v) => setF({ ...f, tag_fk: v })} vazio="nenhuma"
                opcoes={tags.map((t) => ({ valor: t.tag_id, rotulo: t.nome }))} />

              <label>Tag de turma (opcional)
                <Ajuda>
                  Para produto que abre turma nova de tempos em tempos. Em vez de você criar a tag
                  de cada turma na mão toda semana, o sistema calcula a data da <b>próxima</b>{" "}
                  turma e cria a tag sozinho na hora da compra.
                  <br /><br />
                  Assim a automação de boas-vindas pode ser uma só, escutando um padrão, em vez de
                  uma automação nova por turma.
                </Ajuda>
              </label>
              <input value={f.tag_turma_padrao} placeholder="CASA_H_{AAAA}_{MM}_{DD}"
                onChange={(e) => setF({ ...f, tag_turma_padrao: e.target.value })} />
              <div className="sub" style={{ marginTop: 4 }}>
                Use <code>{"{AAAA}"}</code>, <code>{"{MM}"}</code> e <code>{"{DD}"}</code> no lugar
                da data. Deixe vazio se o produto não tem turma.
              </div>

              {f.tag_turma_padrao.trim() && (
                <>
                  <div className="linha">
                    <div style={{ flex: 2 }}>
                      <label>A turma vira toda</label>
                      <Escolher valor={f.turma_dia_semana}
                        aoMudar={(v) => setF({ ...f, turma_dia_semana: v })}
                        opcoes={DIAS.map(([v, r]) => ({ valor: v, rotulo: r }))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label>às</label>
                      <Escolher valor={f.turma_hora}
                        aoMudar={(v) => setF({ ...f, turma_hora: v })}
                        opcoes={Array.from({ length: 24 }, (_, h) => (
                          { valor: h, rotulo: `${String(h).padStart(2, "0")}h` }))} />
                    </div>
                  </div>
                  <div className="sub" style={{ marginTop: 4 }}>
                    Horário de Brasília. A virada é no minuto exato: quem comprar às 06:59 ainda
                    entra na turma anterior; às 07:00, já na seguinte.
                  </div>
                </>
              )}
            </div>

            <div className="bloco-campo">
              <h3><span className="selo-num">3</span> 💬 Marcar no ManyChat</h3>
              <div className="sub">
                A pessoa é procurada no ManyChat pelo WhatsApp — e criada lá se ainda não
                existir. A tag é o que dispara a automação de mensagem do lado de lá.
              </div>

              <label>Tag fixa no ManyChat
                <Ajuda>
                  Escreva o nome <b>exatamente</b> como ele está no ManyChat. Nome diferente por
                  um acento ou um sublinhado cria uma tag paralela que nenhum fluxo de lá
                  escuta: a pessoa é marcada e não recebe mensagem nenhuma.
                  <br /><br />
                  Dá para conferir a lista de tags da conta na página <b>ManyChat</b>, e testar
                  a regra inteira por lá antes de confiar nela.
                </Ajuda>
              </label>
              <input value={f.tag_manychat} placeholder="COMPROU_DESAFIO_CASA_H"
                onChange={(e) => setF({ ...f, tag_manychat: e.target.value })} />
              <div className="sub" style={{ marginTop: 4 }}>
                Vazio = não marca ninguém lá. A tag é criada no ManyChat se ainda não existir.
              </div>

              <label style={{ marginTop: 12 }}>
                <input type="checkbox" checked={f.tag_manychat_turma}
                  onChange={(e) => setF({ ...f, tag_manychat_turma: e.target.checked })} />
                <span>Mandar também a tag da turma</span>
              </label>

              {f.tag_manychat_turma && (
                <>
                  <label>Padrão da turma no ManyChat</label>
                  <input value={f.tag_manychat_turma_padrao} placeholder="CASA_H_{AA}_{MM}_{DD}"
                    onChange={(e) => setF({ ...f, tag_manychat_turma_padrao: e.target.value })} />
                  <div className="sub" style={{ marginTop: 4 }}>
                    Vazio = usa o mesmo padrão daqui. Preencha quando o nome for diferente lá —
                    no ManyChat da Patrícia o ano tem <b>dois</b> dígitos
                    (<code>CASA_H_{"{AA}"}_{"{MM}"}_{"{DD}"}</code>), e mandar o de quatro criaria
                    uma tag paralela que nenhuma automação de lá escuta: a pessoa seria marcada e
                    nada aconteceria.
                  </div>
                </>
              )}

              {!f.tag_turma_padrao.trim() && f.tag_manychat_turma && (
                <div className="aviso" style={{ marginTop: 10, marginBottom: 0 }}>
                  Este produto não tem turma configurada no passo 2, então não há tag de turma
                  para mandar. Preencha a "Tag de turma" ou desmarque esta opção.
                </div>
              )}
            </div>

            <div className="bloco-campo">
              <h3><span className="selo-num">4</span> ↩️ Se pedir reembolso</h3>
              <div className="sub">
                O reembolso <b>não apaga</b> a compra do histórico — ela fica registrada com o
                status trocado, e a pessoa sai sozinha dos segmentos de comprador. A tag serve
                para você tratá-la à parte se quiser.
              </div>
              <Escolher valor={f.tag_reembolso} aoMudar={(v) => setF({ ...f, tag_reembolso: v })} vazio="nenhuma"
                opcoes={tags.map((t) => ({ valor: t.tag_id, rotulo: t.nome }))} />
            </div>

            <div className="bloco-campo">
              <h3><span className="selo-num">5</span> Conferir e ligar</h3>

              {resumoDaRegra()}

              <label style={{ marginTop: 14 }}>
                <input type="checkbox" checked={f.ativo}
                  onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
                <span>Regra ativa
                  <Ajuda>
                    Desligada, a compra continua sendo <b>registrada</b> normalmente — só não
                    acontece nada com quem comprou: sem lista, sem tag, sem ManyChat.
                    <br /><br />
                    Serve para pausar um produto sem perder a configuração dele, e para montar a
                    regra com calma antes de deixá-la valendo.
                  </Ajuda>
                </span>
              </label>

              {f.ativo && (
                <div className="aviso info" style={{ marginTop: 12, marginBottom: 0 }}>
                  Entrar na lista e receber a tag <b>disparam as automações</b> ligadas a elas —
                  inclusive as que mandam e-mail. Confira em Automações antes de ativar.
                </div>
              )}
            </div>
          </div>

          <div className="gaveta-pe">
            <button className="primario" onClick={salvar} disabled={!identificada || salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            <button onClick={() => setEditando(null)}>Cancelar</button>
            {!identificada ? (
              <span className="recado">Falta o código ou parte do nome do produto</span>
            ) : editando !== "novo" ? (
              // desistir da exclusão devolve a gaveta como estava: fechar
              // antes de confirmar faria a pessoa perder o que preencheu
              <button className="perigo" style={{ marginLeft: "auto" }}
                onClick={async () => { if (await excluir(editando as Mapa)) setEditando(null); }}>
                Excluir regra
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
