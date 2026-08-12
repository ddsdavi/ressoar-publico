import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Escolher from "./Escolher";
import Ajuda from "./Ajuda";

// Quadro visual da automação — a mesma leitura do ActiveCampaign: o gatilho
// no topo, os passos descendo ligados por uma linha, e o "+" entre eles.
//
// Só aparece aqui o que o motor do banco realmente executa. Gatilho bonito
// que não dispara nada é pior que gatilho nenhum: a pessoa monta o fluxo,
// ativa, e fica esperando um e-mail que nunca sai. O que ainda não existe
// aparece apagado e dizendo que não está disponível.

export type Passo = { ordem: number; tipo: string; config: Record<string, any> };
// Um gatilho (formato antigo, e o que 20 automações têm no banco) ou vários.
// O motor lê os dois: `gatilhos_de()` normaliza objeto e array.
export type Gatilho = Record<string, any> | Record<string, any>[] | null;

type Item = {
  id: string; rotulo: string; icone: string; categoria: string;
  disponivel: boolean; ajuda?: string;
};

const GATILHOS: Item[] = [
  { id: "lista_inscrita", rotulo: "Inscreve-se em uma lista", icone: "📋", categoria: "Listas e tags", disponivel: true },
  { id: "lista_descadastrada", rotulo: "Descadastra-se de uma lista", icone: "📤", categoria: "Listas e tags", disponivel: true },
  { id: "tag_adicionada", rotulo: "Tag é adicionada", icone: "🏷", categoria: "Listas e tags", disponivel: true },
  { id: "lead_criado", rotulo: "Contato é criado", icone: "👤", categoria: "Listas e tags", disponivel: true },
  { id: "email_aberto", rotulo: "Abre um e-mail", icone: "👁", categoria: "Comportamento", disponivel: true },
  { id: "email_clicado", rotulo: "Clica em um link", icone: "🔗", categoria: "Comportamento", disponivel: true },
  { id: "compra_realizada", rotulo: "Faz uma compra", icone: "💰", categoria: "Vendas", disponivel: true,
    ajuda: "Depende de importar as vendas. Enquanto a tabela de compras estiver vazia, não dispara." },
  { id: "carrinho_abandonado", rotulo: "Abandona o carrinho", icone: "🛒", categoria: "Vendas", disponivel: true,
    ajuda: "A Hotmart avisa quando alguém sai do checkout sem concluir. O e-mail pode citar o produto com %EVENTO.produto%." },
  { id: "boleto_gerado", rotulo: "Gera boleto e não paga", icone: "🧾", categoria: "Vendas", disponivel: true,
    ajuda: "Boleto impresso é intenção declarada. Vale um lembrete antes do vencimento." },
  { id: "pagamento_atrasado", rotulo: "Pagamento atrasa", icone: "⏳", categoria: "Vendas", disponivel: true,
    ajuda: "Assinatura ou parcela em atraso." },
  { id: "pagamento_expirou", rotulo: "Pagamento expira", icone: "❌", categoria: "Vendas", disponivel: true,
    ajuda: "O prazo passou e a compra caiu. Última chance de recuperar." },
  { id: "data_do_contato", rotulo: "Chega uma data do contato", icone: "🎂", categoria: "Datas", disponivel: true,
    ajuda: "Aniversário, data da compra, data da consulta — qualquer campo de data. Conferido uma vez por dia, de madrugada." },
];

const ACOES: Item[] = [
  { id: "enviar_email", rotulo: "Envia um e-mail", icone: "✉", categoria: "E-mail", disponivel: true },
  { id: "esperar", rotulo: "Espera", icone: "⏱", categoria: "Fluxo", disponivel: true },
  { id: "aplicar_tag", rotulo: "Adiciona uma tag", icone: "🏷", categoria: "Contato", disponivel: true },
  { id: "remover_tag", rotulo: "Remove uma tag", icone: "🏷", categoria: "Contato", disponivel: true },
  { id: "inscrever_lista", rotulo: "Inscreve em uma lista", icone: "📋", categoria: "Contato", disponivel: true },
  { id: "desinscrever_lista", rotulo: "Descadastra de uma lista", icone: "📤", categoria: "Contato", disponivel: true },
  { id: "google_sheets", rotulo: "Planilha do Google", icone: "📗", categoria: "Integrações", disponivel: true,
    ajuda: "Escreve a linha direto na planilha, pela conta Google conectada em Configurações. Você cola o link, escolhe a aba e mapeia as colunas." },
  { id: "google_drive", rotulo: "Google Drive", icone: "📁", categoria: "Integrações", disponivel: true,
    ajuda: "Manda o contato para o seu n8n, que cria ou atualiza o arquivo." },
  { id: "webhook", rotulo: "Webhook (qualquer sistema)", icone: "⚡", categoria: "Integrações", disponivel: true },
  { id: "manychat_tag", rotulo: "Marcar no ManyChat", icone: "💬", categoria: "Integrações", disponivel: true,
    ajuda: "Procura a pessoa no ManyChat pelo WhatsApp, cria se não existir, e aplica a tag. É a tag que dispara a mensagem de lá." },
  { id: "condicao", rotulo: "Se / então", icone: "🔀", categoria: "Fluxo", disponivel: true,
    ajuda: "Manda quem atende a condição por um caminho e o resto por outro." },
];

// gatilhos que não precisam de alvo (lista/tag/produto) para estarem prontos
const SEM_ALVO = ["lead_criado", "email_aberto", "email_clicado",
                  "compra_realizada", "lista_descadastrada", "carrinho_abandonado",
                  "boleto_gerado", "pagamento_atrasado", "pagamento_expirou"];

const CONDICOES: [string, string][] = [
  ["tem_tag", "Tem a tag"],
  ["na_lista", "Está ativo na lista"],
  ["abriu_email", "Abriu algum e-mail nos últimos N dias"],
  ["clicou_email", "Clicou em algum link nos últimos N dias"],
  ["comprou", "Já comprou"],
  ["tem_whatsapp", "Tem WhatsApp cadastrado"],
  ["nao_suprimido", "Não está bloqueado"],
];

const DURACOES: [string, string][] = [
  ["15 minutes", "15 minutos"], ["1 hour", "1 hora"], ["4 hours", "4 horas"],
  ["1 day", "1 dia"], ["2 days", "2 dias"], ["7 days", "7 dias"],
];

type Ref = {
  listas: { lista_id: number; nome: string }[];
  tags: { tag_id: number; nome: string }[];
  mensagens: { mensagem_id: string; nome: string; subject: string }[];
  camposData?: string[];
  produtos?: { apelido: string; padrao_nome: string | null }[];
};

// ---------- Planilha do Google: o passo nativo ----------
// O painel fala com a Edge Function google-sheets usando a sessão do
// usuário — só admin passa. O que fica salvo no passo: planilha, aba, a
// lista de colunas do cabeçalho e o mapeamento coluna → campo.
async function chamarGoogleSheets(acao: string, corpo: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-sheets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ acao, ...corpo }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro ?? "não deu para falar com o Google agora");
  return d;
}

const CAMPOS_PLANILHA: [string, string][] = [
  ["", "— não preencher —"],
  ["nome", "Nome"],
  ["email", "E-mail"],
  ["whatsapp", "WhatsApp"],
  ["lead_id", "ID do lead (aqui na Ressoar)"],
  ["manychat_id", "ID no ManyChat"],
  ["data_hora", "Data e hora (São Paulo)"],
  ["__atributo", "Um campo personalizado…"],
];

function EditorPlanilha({ config, aoMudar }: {
  config: Record<string, any>;
  aoMudar: (c: Record<string, any>) => void;
}) {
  const [link, setLink] = useState("");
  const [abas, setAbas] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const colunas: string[] = config.colunas ?? [];
  const mapa: Record<string, string> = config.mapeamento ?? {};

  // pré-adivinha o campo pelo título da coluna — a pessoa só confere
  const adivinhar = (coluna: string): string => {
    const t = coluna.toLowerCase();
    if (t.includes("mail")) return "email";
    if (t.includes("whats") || t.includes("telefone") || t.includes("fone") || t.includes("celular")) return "whatsapp";
    if (t.includes("nome")) return "nome";
    // "ID do Contato" numa planilha alimentada por chatbot é o id de LÁ,
    // não o daqui — foi assim que a planilha das lives sempre foi montada
    if (t.includes("manychat") || t.includes("contato")) return "manychat_id";
    if (t.includes("id")) return "lead_id";
    if (t.includes("data") || t.includes("quando")) return "data_hora";
    return "";
  };

  async function carregarAbas() {
    setOcupado(true); setMsg("Lendo a planilha…");
    try {
      const d = await chamarGoogleSheets("abas", { link });
      setAbas(d.abas ?? []);
      aoMudar({ planilha_id: d.planilha_id, planilha_nome: d.titulo });
      setMsg(d.abas?.length ? "Agora escolha a aba." : "A planilha não tem abas?");
    } catch (e) { setMsg((e as Error).message); }
    setOcupado(false);
  }

  async function escolherAba(aba: string) {
    setOcupado(true); setMsg("Lendo o cabeçalho…");
    try {
      const d = await chamarGoogleSheets("cabecalhos",
        { planilha_id: config.planilha_id, aba });
      const cols: string[] = d.colunas ?? [];
      const mapeamento: Record<string, string> = {};
      for (const c of cols) mapeamento[c] = adivinhar(c);
      aoMudar({ ...config, aba, colunas: cols, mapeamento });
      setMsg(cols.length
        ? "Confira o mapeamento abaixo — o que ficar em branco não é preenchido."
        : "A primeira linha da aba está vazia. Escreva os títulos das colunas lá e carregue de novo.");
    } catch (e) { setMsg((e as Error).message); }
    setOcupado(false);
  }

  function mudarCampo(coluna: string, valor: string) {
    aoMudar({ ...config, mapeamento: { ...mapa, [coluna]: valor } });
  }

  return (
    <>
      {!config.planilha_id && (
        <>
          <label>Link da planilha</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ flex: 1 }} value={link}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              onChange={(e) => setLink(e.target.value)} />
            <button onClick={carregarAbas} disabled={ocupado || !link.trim()}>Carregar</button>
          </div>
          <div className="sub" style={{ marginTop: 6 }}>
            A conta Google conectada em <b>Configurações → Planilhas</b> precisa
            ter acesso de edição a esta planilha.
          </div>
        </>
      )}

      {config.planilha_id && (
        <>
          <div className="sub" style={{ marginBottom: 8 }}>
            Planilha:{" "}
            <a href={`https://docs.google.com/spreadsheets/d/${config.planilha_id}`}
              target="_blank" rel="noopener noreferrer">
              <b>{config.planilha_nome || config.planilha_id}</b>
            </a>{" "}
            <button className="mini" onClick={() => { setAbas([]); setLink("");
              aoMudar({}); }}>trocar</button>
          </div>

          <label>Aba</label>
          <Escolher valor={config.aba ?? ""} desabilitado={ocupado}
            aoMudar={(v) => escolherAba(v)}
            vazio="— escolher —"
            opcoes={(abas.length ? abas : (config.aba ? [config.aba] : [])).map(
              (a) => ({ valor: a, rotulo: a }))} />
          {!abas.length && config.aba && (
            <div className="sub" style={{ marginTop: 4 }}>
              Para ver as outras abas de novo, clique em "trocar" e recarregue a planilha.
            </div>
          )}

          {config.aba && colunas.length > 0 && (
            <>
              <label style={{ marginTop: 12 }}>O que entra em cada coluna</label>
              {colunas.map((c) => {
                const v = mapa[c] ?? "";
                const ehAtributo = v.startsWith("atributo:") || v === "__atributo";
                return (
                  <div key={c} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                    <div style={{ flex: 1, fontWeight: 600 }}>{c}</div>
                    <Escolher style={{ flex: 1 }}
                      valor={ehAtributo ? "__atributo" : v}
                      aoMudar={(x) => mudarCampo(c, x === "__atributo" ? "atributo:" : x)}
                      opcoes={CAMPOS_PLANILHA.map(([valor, rotulo]) => ({ valor, rotulo }))} />
                    {ehAtributo && (
                      <input style={{ flex: 1 }} placeholder="nome do campo, ex.: cidade"
                        value={v.startsWith("atributo:") ? v.slice("atributo:".length) : ""}
                        onChange={(e) => mudarCampo(c, "atributo:" + e.target.value)} />
                    )}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {msg && <div className="sub" style={{ marginTop: 10 }}>{msg}</div>}
    </>
  );
}

// ---------- janela de escolha, no formato do AC ----------
function Seletor({ titulo, itens, onEscolher, onFechar }: {
  titulo: string; itens: Item[];
  onEscolher: (id: string) => void; onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [cat, setCat] = useState("todas");
  const categorias = ["todas", ...new Set(itens.map((i) => i.categoria))];
  const filtrados = itens.filter((i) =>
    (cat === "todas" || i.categoria === cat) &&
    (!busca.trim() || i.rotulo.toLowerCase().includes(busca.toLowerCase())));

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300, background: "rgba(20,16,30,.55)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onFechar}>
      <div className="caixa" style={{ width: 760, maxWidth: "100%", maxHeight: "84vh", margin: 0, display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="linha" style={{ alignItems: "center" }}>
          <h2 style={{ margin: 0, flex: 1 }}>{titulo}</h2>
          <input style={{ flex: "0 0 220px" }} placeholder="Pesquisar…" value={busca}
            onChange={(e) => setBusca(e.target.value)} />
          <button style={{ flex: "0 0 auto" }} onClick={onFechar}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 14, minHeight: 0, flex: 1 }}>
          <div style={{ flex: "0 0 170px", borderRight: "1px solid var(--borda)", paddingRight: 12 }}>
            {categorias.map((c) => (
              <div key={c} onClick={() => setCat(c)}
                style={{
                  padding: "7px 8px", borderRadius: 6, cursor: "pointer", lineHeight: 1.35,
                  fontSize: "calc(13px * var(--escala-texto))",
                  borderLeft: `3px solid ${cat === c ? "var(--marca)" : "transparent"}`,
                  background: cat === c ? "rgba(107,78,168,.09)" : "transparent",
                  color: cat === c ? "var(--texto)" : "var(--texto2)",
                }}>
                {c === "todas" ? "Visualizar tudo" : c}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 12,
                        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", alignContent: "start" }}>
            {filtrados.map((i) => (
              <div key={i.id} title={i.ajuda ?? i.rotulo}
                onClick={() => i.disponivel && onEscolher(i.id)}
                style={{
                  textAlign: "center", padding: "16px 8px", borderRadius: 10,
                  border: "1px solid var(--borda)",
                  cursor: i.disponivel ? "pointer" : "not-allowed",
                  opacity: i.disponivel ? 1 : 0.45,
                }}>
                <div style={{
                  width: 46, height: 46, margin: "0 auto 8px", borderRadius: "50%",
                  background: "rgba(107,78,168,.12)", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 21,
                }}>{i.icone}</div>
                <div style={{ fontSize: "calc(12.5px * var(--escala-texto))", lineHeight: 1.35 }}>
                  {i.rotulo}
                </div>
                {!i.disponivel && (
                  <div style={{ fontSize: "calc(11px * var(--escala-texto))", color: "var(--texto2)", marginTop: 4 }}>
                    ainda não
                  </div>
                )}
              </div>
            ))}
            {!filtrados.length && <div className="sub">nada com esse nome</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Colocar gente dentro da automação sem esperar o gatilho. Serve para
// testar com uma pessoa e para reprocessar quem ficou de fora.
function PainelAdicionar({ onFechar, onAdicionar, listas, tags }: {
  onFechar: () => void;
  onAdicionar: (alvo: { emails?: string; lista?: number; tag?: number }) => Promise<void>;
  listas: { lista_id: number; nome: string }[];
  tags: { tag_id: number; nome: string }[];
}) {
  const [modo, setModo] = useState<"emails" | "lista" | "tag">("emails");
  const [emails, setEmails] = useState("");
  const [lista, setLista] = useState("");
  const [tag, setTag] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    setOcupado(true);
    await onAdicionar(
      modo === "emails" ? { emails }
        : modo === "lista" ? { lista: Number(lista) }
          : { tag: Number(tag) });
    setOcupado(false);
    onFechar();
  }

  return (
    <div className="gaveta" style={{ width: 440 }}>
      <button className="fechar" onClick={onFechar}>✕</button>
      <h2>Adicionar contatos à automação</h2>
      <div className="sub">
        Eles entram no primeiro passo agora, sem esperar o gatilho. Quem já está
        dentro não entra de novo.
      </div>

      <label>Como você quer escolher</label>
      <Escolher valor={modo} aoMudar={(v) => setModo(v as never)}
        opcoes={[
          { valor: "emails", rotulo: "Contatos específicos (para testar)" },
          { valor: "lista", rotulo: "Todos os ativos de uma lista" },
          { valor: "tag", rotulo: "Todos que têm uma tag" },
        ]} />

      {modo === "emails" && (
        <>
          <label>E-mails, um por linha</label>
          <textarea rows={7} value={emails} onChange={(e) => setEmails(e.target.value)}
            placeholder={"fulana@email.com\nbeltrano@email.com"} />
        </>
      )}
      {modo === "lista" && (
        <>
          <label>Lista</label>
          <Escolher valor={lista} aoMudar={setLista} vazio="— escolher —"
            opcoes={listas.map((l) => ({ valor: l.lista_id, rotulo: l.nome }))} />
        </>
      )}
      {modo === "tag" && (
        <>
          <label>Tag</label>
          <Escolher valor={tag} aoMudar={setTag} vazio="— escolher —"
            opcoes={tags.map((t) => ({ valor: t.tag_id, rotulo: t.nome }))} />
        </>
      )}

      <div className="aviso" style={{ marginTop: 12 }}>
        Se a automação manda e-mail, esses contatos vão <b>receber de verdade</b>.
        Para testar sem risco, comece por um endereço só.
      </div>

      <div className="linha" style={{ marginTop: 16 }}>
        <button className="primario" disabled={ocupado} onClick={confirmar}>
          {ocupado ? "Adicionando…" : "Adicionar"}
        </button>
        <button onClick={onFechar}>Cancelar</button>
      </div>
    </div>
  );
}

export default function FluxoAutomacao({
  nome, gatilho, passos, ativa, execucoes, ref: refs, novo, produto,
  onMudar, onSalvar, onFechar, onVerContatos, onAdicionarContatos,
}: {
  nome: string; gatilho: Gatilho; passos: Passo[]; ativa: boolean;
  execucoes: number; ref: Ref; novo: boolean; produto: string;
  onMudar: (p: { nome?: string; gatilho?: Gatilho; passos?: Passo[]; ativa?: boolean;
                 produto?: string }) => void;
  onSalvar: () => void; onFechar: () => void; onVerContatos: () => void;
  onAdicionarContatos: (alvo: { emails?: string; lista?: number; tag?: number }) => Promise<void>;
}) {
  const [seletor, setSeletor] = useState<
    null | { tipo: "gatilho"; indice: number } | { tipo: "acao"; posicao: number }>(null);
  // número = passo; {g: n} = o gatilho de índice n
  const [editando, setEditando] = useState<number | { g: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  // arrastar as caixinhas: qual está sendo levada e onde ela cairia.
  // Passos e gatilhos são zonas separadas — o "tipo" do arrasto viaja no
  // dataTransfer (application/x-ressoa-*), e cada zona só aceita o seu:
  // soltar um gatilho no meio dos passos é recusado pelo próprio navegador.
  const TIPO_PASSO = "application/x-ressoa-passo";
  const TIPO_GATILHO = "application/x-ressoa-gatilho";
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [alvoSolta, setAlvoSolta] = useState<number | null>(null);
  const [arrastandoG, setArrastandoG] = useState<number | null>(null);
  const [alvoG, setAlvoG] = useState<number | null>(null);

  // ---- um gatilho ou vários, sempre lidos como lista ----
  const gats: Record<string, any>[] = Array.isArray(gatilho)
    ? gatilho
    : (gatilho && gatilho.tipo ? [gatilho] : []);

  // Salva UM como objeto e VÁRIOS como array. Assim uma automação de gatilho
  // único continua no banco exatamente como estava — nada de migração.
  const salvarGatilhos = (lista: Record<string, any>[]) =>
    onMudar({ gatilho: lista.length === 0 ? null : lista.length === 1 ? lista[0] : lista });

  const mudarGatilho = (i: number, novo: Record<string, any>) =>
    salvarGatilhos(gats.map((g, x) => (x === i ? novo : g)));

  const removerGatilho = (i: number) => {
    salvarGatilhos(gats.filter((_, x) => x !== i));
    setEditando(null);
  };

  // As tags que existem NA CONTA DO MANYCHAT. São elas que disparam os
  // fluxos de lá — saber se a escolhida existe é a diferença entre montar
  // um fluxo que funciona e um que fica marcando gente com uma tag que
  // ninguém escuta.
  const [tagsMC, setTagsMC] = useState<string[]>([]);
  const [carregandoMC, setCarregandoMC] = useState(false);
  const [criandoMC, setCriandoMC] = useState<string | null>(null);

  const chamarMC = (corpo: Record<string, unknown>) =>
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manychat`, {
      method: "POST",
      headers: { "Content-Type": "application/json",
                 apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "" },
      body: JSON.stringify(corpo),
    }).then((r) => r.json()).catch(() => ({ ok: false }));

  async function carregarTagsMC() {
    setCarregandoMC(true);
    const d = await chamarMC({ acao: "tags" });
    setTagsMC(((d.tags ?? []) as { name: string }[]).map((t) => t.name));
    setCarregandoMC(false);
  }

  // só consulta quando um passo de ManyChat está aberto: a conta tem
  // centenas de tags, e não faz sentido buscar isso ao abrir qualquer fluxo
  useEffect(() => {
    if (typeof editando === "number" && passos[editando]?.tipo === "manychat_tag"
        && !tagsMC.length && !carregandoMC) {
      carregarTagsMC();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando]);

  async function criarTagMC(nome: string) {
    setCriandoMC(nome);
    const d = await chamarMC({ acao: "criar_tag", tag: nome });
    setCriandoMC(null);
    if (d.ok) await carregarTagsMC();
    else alert("Não deu para criar: " + JSON.stringify(d.detalhe ?? d.erro ?? d));
  }
  const [adicionando, setAdicionando] = useState(false);

  const mapL = Object.fromEntries(refs.listas.map((x) => [x.lista_id, x.nome]));
  const mapT = Object.fromEntries(refs.tags.map((x) => [x.tag_id, x.nome]));

  function descreverGatilho(g?: Record<string, any> | null): string {
    if (!g?.tipo) return "Escolha o que inicia esta automação";
    if (g.tipo === "lista_inscrita")
      return g.lista_id
        ? `Contato com inscrição na lista ${mapL[g.lista_id] ?? g.lista_id}`
        : "Contato se inscreve numa lista — falta escolher qual";
    if (g.tipo === "tag_adicionada")
      return g.tag_id
        ? `Contato recebe a tag ${mapT[g.tag_id] ?? g.tag_id}`
        : "Contato recebe uma tag — falta escolher qual";
    if (g.tipo === "lista_descadastrada")
      return g.lista_id
        ? `Contato se descadastra da lista ${mapL[g.lista_id] ?? g.lista_id}`
        : "Contato se descadastra de qualquer lista";
    if (g.tipo === "lead_criado") return "Um contato novo é criado";
    if (g.tipo === "email_aberto") return "Contato abre um e-mail";
    if (g.tipo === "email_clicado") return "Contato clica num link do e-mail";
    if (g.tipo === "compra_realizada")
      return g.produto ? `Contato compra "${g.produto}"` : "Contato faz uma compra";
    if (g.tipo === "data_do_contato")
      return g.campo ? `Chega a data "${g.campo}"` : "Chega uma data do contato — falta o campo";
    return String(g.tipo);
  }

  // um gatilho está completo quando tem tipo e, se precisar de alvo, o alvo
  const gatilhoOk = (g: Record<string, any>) =>
    !!g?.tipo && (SEM_ALVO.includes(g.tipo) || !!g.lista_id || !!g.tag_id
                  || !!g.produto || !!g.campo || !!g.qualquer_lista);

  function descreverPasso(p: Passo): string {
    const c = p.config ?? {};
    switch (p.tipo) {
      case "enviar_email": {
        const m = refs.mensagens.find((x) => x.mensagem_id === c.mensagem_id);
        return m ? `Envia o e-mail ${m.nome}` : "Envia um e-mail — falta escolher qual";
      }
      case "esperar":
        return c.duracao
          ? `Espera ${DURACOES.find(([v]) => v === c.duracao)?.[1] ?? c.duracao}`
          : "Espera — falta escolher quanto tempo";
      case "aplicar_tag": return c.tag_id ? `Adiciona a tag ${mapT[c.tag_id] ?? c.tag_id}` : "Adiciona uma tag — falta escolher";
      case "remover_tag": return c.tag_id ? `Remove a tag ${mapT[c.tag_id] ?? c.tag_id}` : "Remove uma tag — falta escolher";
      case "inscrever_lista": return c.lista_id ? `Inscreve na lista ${mapL[c.lista_id] ?? c.lista_id}` : "Inscreve numa lista — falta escolher";
      case "desinscrever_lista": return c.lista_id ? `Descadastra da lista ${mapL[c.lista_id] ?? c.lista_id}` : "Descadastra de uma lista — falta escolher";
      case "condicao": {
        const cd = c.condicao ?? {};
        const rot = CONDICOES.find(([v]) => v === cd.tipo)?.[1] ?? "condição";
        const alvo = cd.tag_id ? ` "${mapT[cd.tag_id] ?? cd.tag_id}"`
          : cd.lista_id ? ` "${mapL[cd.lista_id] ?? cd.lista_id}"`
            : cd.dias ? ` (${cd.dias} dias)` : "";
        return cd.tipo ? `Se ${rot.toLowerCase()}${alvo}` : "Se / então — falta escolher a condição";
      }
      case "webhook": return c.url ? `Envia os dados para ${c.url}` : "Chama um webhook — falta a URL";
      case "google_sheets": return c.planilha_id
        ? `Escreve na planilha ${c.planilha_nome || "do Google"} · aba ${c.aba || "?"}`
        : c.url ? "Escreve no Google Sheets pelo n8n" : "Planilha do Google — falta configurar";
      case "google_drive": return c.url ? "Envia para o Google Drive" : "Google Drive — falta a URL do n8n";
      default: return p.tipo;
    }
  }

  const completo = (p: Passo) => {
    const c = p.config ?? {};
    if (p.tipo === "enviar_email") return !!c.mensagem_id;
    if (p.tipo === "esperar") return !!c.duracao;
    if (p.tipo === "aplicar_tag" || p.tipo === "remover_tag") return !!c.tag_id;
    if (p.tipo === "inscrever_lista" || p.tipo === "desinscrever_lista") return !!c.lista_id;
    if (p.tipo === "webhook" || p.tipo === "google_drive") return !!c.url;
    if (p.tipo === "google_sheets") return !!(c.url || (c.planilha_id && c.aba && c.colunas?.length));
    if (p.tipo === "manychat_tag") return !!c.tag;
    if (p.tipo === "condicao") return !!c.condicao?.tipo;
    return true;
  };

  const iconeDe = (tipo: string) => ACOES.find((a) => a.id === tipo)?.icone ?? "•";

  function inserirAcao(id: string, posicao: number) {
    const novos = [...passos];
    novos.splice(posicao, 0, { ordem: 0, tipo: id, config: {} });
    onMudar({ passos: novos.map((p, i) => ({ ...p, ordem: i + 1 })) });
    setSeletor(null);
    setEditando(posicao);
  }
  function mudarPasso(i: number, config: Record<string, any>) {
    onMudar({ passos: passos.map((p, x) => (x === i ? { ...p, config } : p)) });
  }
  function removerPasso(i: number) {
    onMudar({ passos: passos.filter((_, x) => x !== i).map((p, x) => ({ ...p, ordem: x + 1 })) });
    setEditando(null);
  }
  // Solta a caixinha na posição de destino. A origem vem do próprio evento,
  // não do estado: entre o "peguei" e o "soltei" pode não ter havido
  // re-render, e aí o estado ainda estaria vazio na hora de reordenar.
  function soltarEm(destino: number, origemDoEvento?: string) {
    const origem = origemDoEvento !== undefined && origemDoEvento !== ""
      ? Number(origemDoEvento)
      : arrastando;
    setArrastando(null);
    setAlvoSolta(null);
    if (origem === null || Number.isNaN(origem) || origem === destino) return;
    if (origem < 0 || origem >= passos.length) return;
    const c = [...passos];
    const [levado] = c.splice(origem, 1);
    c.splice(destino, 0, levado);
    onMudar({ passos: c.map((p, x) => ({ ...p, ordem: x + 1 })) });
    setEditando(null);
  }

  // o mesmo, para os gatilhos
  function soltarGatilhoEm(destino: number, origemDoEvento?: string) {
    const origem = origemDoEvento !== undefined && origemDoEvento !== ""
      ? Number(origemDoEvento)
      : arrastandoG;
    setArrastandoG(null);
    setAlvoG(null);
    if (origem === null || Number.isNaN(origem) || origem === destino) return;
    if (origem < 0 || origem >= gats.length) return;
    const c = [...gats];
    const [levado] = c.splice(origem, 1);
    c.splice(destino, 0, levado);
    salvarGatilhos(c);
    setEditando(null);
  }

  function mover(i: number, dir: -1 | 1) {
    const alvo = i + dir;
    if (alvo < 0 || alvo >= passos.length) return;
    const c = [...passos];
    [c[i], c[alvo]] = [c[alvo], c[i]];
    onMudar({ passos: c.map((p, x) => ({ ...p, ordem: x + 1 })) });
    setEditando(alvo);
  }

  // ⊕ entre os cartões
  const Conector = ({ posicao }: { posicao: number }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: 2, height: 26, background: "var(--borda)" }} />
      <button title="inserir um passo aqui"
        onClick={() => setSeletor({ tipo: "acao", posicao })}
        style={{
          width: 30, height: 30, borderRadius: "50%", padding: 0, lineHeight: 1,
          border: "1px solid var(--borda)", background: "var(--cartao, #fff)",
          cursor: "pointer", fontSize: 17, color: "var(--marca)",
        }}>+</button>
      <div style={{ width: 2, height: 26, background: "var(--borda)" }} />
    </div>
  );

  // qual gatilho a gaveta está editando (-1 = está editando um passo)
  const iG = typeof editando === "object" && editando !== null ? editando.g : -1;
  const gAtual = iG >= 0 ? gats[iG] ?? null : null;

  const cartao = (ok: boolean) => ({
    width: 420, maxWidth: "100%", padding: "14px 18px", borderRadius: 10,
    border: `1px solid ${ok ? "var(--borda)" : "#d8a13a"}`,
    background: "var(--cartao, #fff)", cursor: "pointer",
    display: "flex", gap: 12, alignItems: "center", textAlign: "left" as const,
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column",
      background: "var(--fundo)", overflow: "hidden",
    }}>
      {/* barra de cima */}
      <div style={{
        display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
        padding: "10px 16px", borderBottom: "1px solid var(--borda)", background: "var(--cartao, #fff)",
      }}>
        <button onClick={onFechar} style={{ flex: "0 0 auto" }}>← Automações</button>
        <input value={nome} placeholder="Nome da automação"
          onChange={(e) => onMudar({ nome: e.target.value })}
          style={{ flex: "1 1 220px", minWidth: 160, maxWidth: 380, fontWeight: 700 }} />
        <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <select value={produto} onChange={(e) => onMudar({ produto: e.target.value })}
            style={{ maxWidth: 240 }}>
            <option value="">Fala de: assunto geral</option>
            {(refs.produtos ?? []).map((p) => (
              <option key={p.apelido} value={p.padrao_nome || p.apelido}>
                Fala de: {p.apelido}
              </option>
            ))}
          </select>
          <Ajuda>
            De qual produto esta automação fala. Serve para uma coisa só, e importante:
            <b> escolher para qual e-mail a mensagem vai</b>.
            <br /><br />
            Quem compra nem sempre usa o mesmo endereço do cadastro antigo. Quando você
            marca o produto aqui, a mensagem vai para <b>o e-mail daquela compra</b> — que é
            onde a pessoa espera receber. Sem marcar, vai para o e-mail principal do
            contato, que é o certo para o que não é sobre um produto: uma newsletter, um
            convite de live.
            <br /><br />
            Compra feita pela própria equipe não conta: nesses casos a mensagem volta para o
            e-mail da cliente.
          </Ajuda>
        </span>
        <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center" }}>
          <button onClick={() => setAdicionando(true)}>
            + Adicionar contatos
          </button>
          <Ajuda>
            Coloca gente na automação <b>agora</b>, sem esperar o gatilho. É o que se usa
            quando o fluxo foi criado depois de a lista já existir — o gatilho só pega quem
            entrar de agora em diante.
            <br /><br />
            Se a automação manda e-mail, essas pessoas <b>recebem de verdade</b>. Comece por
            um endereço só.
          </Ajuda>
        </span>
        {execucoes > 0 && (
          <button style={{ flex: "0 0 auto" }} onClick={onVerContatos}>
            Ver contatos ({execucoes})
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", border: "1px solid var(--borda)",
                        borderRadius: 8, overflow: "hidden", flex: "0 0 auto" }}>
            <button onClick={() => onMudar({ ativa: true })}
              style={{ border: 0, borderRadius: 0, whiteSpace: "nowrap",
                       background: ativa ? "var(--ac-verde, #157347)" : "transparent",
                       color: ativa ? "#fff" : "var(--texto2)" }}>
              ● Ativa
            </button>
            <button onClick={() => onMudar({ ativa: false })}
              style={{ border: 0, borderRadius: 0, whiteSpace: "nowrap",
                       background: !ativa ? "var(--marca)" : "transparent",
                       color: !ativa ? "#fff" : "var(--texto2)" }}>
              ● Inativa
            </button>
          </div>
          <Ajuda>
            <b>Ativa</b> quer dizer que o gatilho passa a valer: a partir daí, quem fizer o
            que ele descreve entra no fluxo sozinho. <b>Inativa</b> guarda tudo montado sem
            disparar nada.
            <br /><br />
            Desligar no meio do caminho <b>para</b> quem estava esperando um passo — essas
            pessoas não seguem adiante nem recebem o que faltava.
          </Ajuda>
          <button className="primario" onClick={onSalvar}>Salvar</button>
        </div>
      </div>

      {novo && (
        <div className="aviso" style={{ margin: "12px 16px 0" }}>
          Automação nova nasce <b>inativa</b>. Só passa a disparar quando você marcar Ativa e salvar.
        </div>
      )}

      {/* o quadro */}
      <div style={{ flex: 1, overflow: "auto", padding: "34px 16px 80px",
                    backgroundImage: "radial-gradient(var(--borda) 1px, transparent 1px)",
                    backgroundSize: "22px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
                      zoom: `${zoom}%` }}>
          {/* gatilhos — um ou vários, qualquer um deles inicia a automação */}
          {gats.length === 0 && (
            <div style={cartao(false)} onClick={() => setSeletor({ tipo: "gatilho", indice: 0 })}>
              <div style={{
                width: 38, height: 38, borderRadius: "50%", flex: "0 0 auto",
                background: "rgba(107,78,168,.12)", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 18,
              }}>▶</div>
              <div>
                <div style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>
                  Inicie a automação quando
                </div>
                <b style={{ fontSize: "calc(14px * var(--escala-texto))" }}>
                  Escolha o que inicia esta automação
                </b>
              </div>
            </div>
          )}

          {gats.map((g, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
              onDragOver={(ev) => {
                // só aceita arrasto de GATILHO — passo solto aqui é recusado
                if (!ev.dataTransfer.types.includes(TIPO_GATILHO)) return;
                ev.preventDefault();
                if (alvoG !== i) setAlvoG(i);
              }}
              onDrop={(ev) => {
                if (!ev.dataTransfer.types.includes(TIPO_GATILHO)) return;
                ev.preventDefault();
                soltarGatilhoEm(i, ev.dataTransfer.getData(TIPO_GATILHO));
              }}>
              {alvoG === i && arrastandoG !== null && arrastandoG !== i && (
                <div style={{ width: 420, maxWidth: "100%", height: 3, borderRadius: 3,
                              background: "var(--marca)", margin: "6px 0" }} />
              )}
              {i > 0 && (
                <div style={{
                  margin: "8px 0", padding: "2px 12px", borderRadius: 999,
                  background: "var(--marca-fraca)", color: "var(--marca)",
                  fontSize: "calc(11.5px * var(--escala-texto))", fontWeight: 700,
                }}>OU</div>
              )}
              <div draggable={gats.length > 1}
                onDragStart={(ev) => {
                  setArrastandoG(i);
                  ev.dataTransfer.effectAllowed = "move";
                  ev.dataTransfer.setData(TIPO_GATILHO, String(i));
                  ev.dataTransfer.setData("text/plain", String(i)); // Firefox exige algo aqui
                }}
                onDragEnd={() => { setArrastandoG(null); setAlvoG(null); }}
                style={{
                  ...cartao(gatilhoOk(g)),
                  opacity: arrastandoG === i ? .4 : 1,
                }}
                onClick={() => setEditando({ g: i })}>
                {gats.length > 1 && (
                  <span title="arraste para mudar a ordem"
                    style={{ flex: "0 0 auto", cursor: "grab", color: "var(--texto2)",
                             fontSize: "calc(15px * var(--escala-texto))", lineHeight: 1,
                             letterSpacing: -2, userSelect: "none" }}
                    onClick={(ev) => ev.stopPropagation()}>⠿</span>
                )}
                <div style={{
                  width: 38, height: 38, borderRadius: "50%", flex: "0 0 auto",
                  background: "rgba(107,78,168,.12)", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 18,
                }}>{GATILHOS.find((x) => x.id === g.tipo)?.icone ?? "▶"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>
                    {i === 0 ? "Inicie a automação quando" : "Ou quando"}
                  </div>
                  <b style={{ fontSize: "calc(14px * var(--escala-texto))" }}>{descreverGatilho(g)}</b>
                </div>
                {gats.length > 1 && (
                  <button className="perigo" title="remover este gatilho"
                    style={{ flex: "0 0 auto", padding: "2px 9px" }}
                    onClick={(ev) => { ev.stopPropagation(); removerGatilho(i); }}>−</button>
                )}
              </div>
            </div>
          ))}

          {gats.length > 0 && (
            <button style={{ marginTop: 10 }}
              onClick={() => setSeletor({ tipo: "gatilho", indice: gats.length })}>
              + outro gatilho
            </button>
          )}
          {gats.length > 1 && (
            <div className="sub" style={{ marginTop: 6, textAlign: "center", maxWidth: 420 }}>
              Qualquer um deles inicia a automação. A pessoa entra uma vez só, mesmo
              que dois aconteçam juntos.
            </div>
          )}

          <Conector posicao={0} />

          {/* passos — arrastáveis pela alça, para trocar a ordem */}
          {passos.map((p, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
              onDragOver={(ev) => {
                // só aceita arrasto de PASSO — gatilho solto aqui é recusado
                if (!ev.dataTransfer.types.includes(TIPO_PASSO)) return;
                ev.preventDefault();          // sem isto o navegador recusa a solta
                if (alvoSolta !== i) setAlvoSolta(i);
              }}
              onDrop={(ev) => {
                if (!ev.dataTransfer.types.includes(TIPO_PASSO)) return;
                ev.preventDefault();
                soltarEm(i, ev.dataTransfer.getData(TIPO_PASSO));
              }}>
              {/* linha que mostra onde a caixinha vai cair */}
              {alvoSolta === i && arrastando !== null && arrastando !== i && (
                <div style={{ width: 420, maxWidth: "100%", height: 3, borderRadius: 3,
                              background: "var(--marca)", marginBottom: 6 }} />
              )}
              <div draggable
                onDragStart={(ev) => {
                  setArrastando(i);
                  ev.dataTransfer.effectAllowed = "move";
                  ev.dataTransfer.setData(TIPO_PASSO, String(i));
                  ev.dataTransfer.setData("text/plain", String(i)); // Firefox exige algo aqui
                }}
                onDragEnd={() => { setArrastando(null); setAlvoSolta(null); }}
                style={{
                  ...cartao(completo(p)),
                  opacity: arrastando === i ? .4 : 1,
                  cursor: arrastando === null ? "pointer" : "grabbing",
                }}
                onClick={() => setEditando(i)}>
                <span title="arraste para mudar a ordem"
                  style={{ flex: "0 0 auto", cursor: "grab", color: "var(--texto2)",
                           fontSize: "calc(15px * var(--escala-texto))", lineHeight: 1,
                           letterSpacing: -2, userSelect: "none" }}
                  onClick={(ev) => ev.stopPropagation()}>⠿</span>
                <div style={{
                  width: 38, height: 38, borderRadius: "50%", flex: "0 0 auto",
                  background: "rgba(107,78,168,.12)", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 18,
                }}>{iconeDe(p.tipo)}</div>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: "calc(14px * var(--escala-texto))" }}>{descreverPasso(p)}</b>
                  {!completo(p) && (
                    <div style={{ color: "#a4761c", fontSize: "calc(12px * var(--escala-texto))" }}>
                      falta configurar
                    </div>
                  )}
                </div>
                <span style={{ color: "var(--texto2)", fontSize: "calc(12px * var(--escala-texto))" }}>{i + 1}</span>
              </div>
              <Conector posicao={i + 1} />
            </div>
          ))}

          <div style={{ color: "var(--texto2)", fontSize: "calc(13px * var(--escala-texto))" }}>
            ⃠ A automação é encerrada
          </div>
        </div>
      </div>

      {/* zoom */}
      <div style={{
        position: "absolute", left: 16, bottom: 16, display: "flex", gap: 6, alignItems: "center",
        background: "var(--cartao, #fff)", border: "1px solid var(--borda)", borderRadius: 8, padding: 4,
      }}>
        <button style={{ padding: "2px 9px" }} onClick={() => setZoom((z) => Math.max(50, z - 10))}>−</button>
        <span style={{ fontSize: "calc(12px * var(--escala-texto))", minWidth: 40, textAlign: "center" }}>{zoom}%</span>
        <button style={{ padding: "2px 9px" }} onClick={() => setZoom((z) => Math.min(150, z + 10))}>+</button>
      </div>

      {/* janelas de escolha */}
      {seletor?.tipo === "gatilho" && (
        <Seletor titulo={gats.length ? "Selecione o outro gatilho" : "Selecione o que inicia a automação"}
          itens={GATILHOS}
          onFechar={() => setSeletor(null)}
          onEscolher={(id) => {
            const i = (seletor as { indice: number }).indice;
            const lista = [...gats];
            lista[i] = { tipo: id };
            salvarGatilhos(lista);
            setSeletor(null);
            setEditando({ g: i });
          }} />
      )}
      {seletor?.tipo === "acao" && (
        <Seletor titulo="Selecione a ação" itens={ACOES}
          onFechar={() => setSeletor(null)}
          onEscolher={(id) => inserirAcao(id, (seletor as { posicao: number }).posicao)} />
      )}

      {/* painel lateral de configuração */}
      {editando !== null && (
        <div className="gaveta" style={{ width: 420 }}>
          <button className="fechar" onClick={() => setEditando(null)}>✕</button>

          {iG >= 0 ? (
            <>
              <h2>Gatilho
                <Ajuda>
                  O que faz a pessoa <b>entrar</b> nesta automação. Só vale de agora em diante:
                  ligar a automação não a roda para quem já estava na lista antes — para isso
                  existe o <b>+ Adicionar contatos</b>, lá em cima.
                  <br /><br />
                  Com mais de um gatilho, qualquer um deles inicia o fluxo, e a pessoa entra
                  uma vez só mesmo que dois aconteçam juntos.
                </Ajuda>
              </h2>
              <div className="sub">{descreverGatilho(gAtual)}</div>
              {gAtual?.tipo === "lista_inscrita" && (
                <>
                  <label>Lista</label>
                  <Escolher valor={gAtual.lista_id ?? ""} vazio="— escolher —"
                    aoMudar={(v) => mudarGatilho(iG, { tipo: "lista_inscrita", lista_id: Number(v) })}
                    opcoes={refs.listas.map((l) => ({ valor: l.lista_id, rotulo: l.nome }))} />
                </>
              )}
              {gAtual?.tipo === "tag_adicionada" && (
                <>
                  <label>Tag</label>
                  <Escolher valor={gAtual.tag_id ?? ""} vazio="— escolher —"
                    aoMudar={(v) => mudarGatilho(iG, { tipo: "tag_adicionada", tag_id: Number(v) })}
                    opcoes={refs.tags.map((t) => ({ valor: t.tag_id, rotulo: t.nome }))} />
                </>
              )}
              {gAtual?.tipo === "lista_descadastrada" && (
                <>
                  <label>Lista (vazio = qualquer uma)</label>
                  <Escolher valor={gAtual.lista_id ?? ""} vazio="qualquer lista"
                    aoMudar={(v) => mudarGatilho(iG, {
                      tipo: "lista_descadastrada",
                      ...(v ? { lista_id: Number(v) } : {}) })}
                    opcoes={refs.listas.map((l) => ({ valor: l.lista_id, rotulo: l.nome }))} />
                </>
              )}
              {(gAtual?.tipo === "email_aberto" || gAtual?.tipo === "email_clicado") && (
                <div className="aviso">
                  Dispara na primeira abertura (ou clique) que o contato fizer. O registro já
                  acontece hoje — foi assim que o seu teste apareceu no relatório.
                </div>
              )}
              {["compra_realizada", "carrinho_abandonado", "boleto_gerado",
                "pagamento_atrasado", "pagamento_expirou"].includes(gAtual?.tipo) && gAtual && (
                <>
                  <label>Produto (vazio = qualquer um)</label>
                  <input value={gAtual.produto ?? ""} placeholder="parte do nome do produto"
                    onChange={(e) => mudarGatilho(iG, {
                      tipo: gAtual.tipo,
                      ...(e.target.value ? { produto: e.target.value } : {}) })} />
                  {gAtual?.tipo !== "compra_realizada" && (
                    <div className="aviso" style={{ marginTop: 8 }}>
                      No e-mail deste fluxo você pode escrever <b>%EVENTO.produto%</b> e
                      <b> %EVENTO.valor%</b> — sai o produto que a pessoa deixou para trás,
                      não uma frase genérica.
                    </div>
                  )}
                </>
              )}
              {gAtual?.tipo === "data_do_contato" && (
                <>
                  <label>Campo de data</label>
                  {refs.camposData?.length ? (
                    <Escolher valor={gAtual.campo ?? ""} vazio="— escolher —"
                      aoMudar={(v) => mudarGatilho(iG, { ...gAtual, tipo: "data_do_contato", campo: v })}
                      opcoes={refs.camposData.map((c) => ({ valor: c, rotulo: c }))} />
                  ) : (
                    <div className="aviso">
                      Nenhum campo de data cadastrado ainda. Crie um em <b>Campos</b>
                      (tipo "data") e preencha nos contatos — sem isso este gatilho não
                      tem o que conferir.
                    </div>
                  )}
                  <label>Avisar quantos dias antes</label>
                  <input type="number" min={0} max={60} value={gAtual.dias_antes ?? 0}
                    onChange={(e) => mudarGatilho(iG, { ...gAtual, tipo: "data_do_contato", dias_antes: Number(e.target.value) })} />
                  <div className="sub" style={{ marginTop: 4 }}>
                    0 = no próprio dia. Compara dia e mês, então serve para data que se
                    repete todo ano, e dispara no máximo uma vez por ano por pessoa.
                  </div>
                </>
              )}
              {gAtual?.tipo === "lead_criado" && (
                <div className="aviso">Dispara para todo contato novo, venha de onde vier: painel, importação, formulário ou API.</div>
              )}
              <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                <button onClick={() => setSeletor({ tipo: "gatilho", indice: iG })}>
                  Trocar este gatilho
                </button>
                {gats.length > 1 && (
                  <button className="perigo" onClick={() => removerGatilho(iG)}>Remover</button>
                )}
              </div>
            </>
          ) : typeof editando === "number" ? (
            <>
              <h2>Passo {editando + 1}</h2>
              <div className="sub">{descreverPasso(passos[editando])}</div>

              <div style={{ marginTop: 12 }}>
                {passos[editando].tipo === "enviar_email" && (
                  <>
                    <label>Mensagem
                      <Ajuda>
                        Sai da biblioteca de <b>Mensagens</b>. Editar a mensagem lá muda o que
                        esta automação manda daqui para a frente — o que já foi enviado não
                        muda.
                        <br /><br />
                        Quem está bloqueado na supressão não recebe, mesmo tendo entrado na
                        automação.
                      </Ajuda>
                    </label>
                    <Escolher valor={passos[editando].config.mensagem_id ?? ""} vazio="— escolher —"
                      aoMudar={(v) => mudarPasso(editando as number, { mensagem_id: v })}
                      opcoes={refs.mensagens.map((m) => (
                        { valor: m.mensagem_id, rotulo: m.nome, detalhe: m.subject }))} />
                  </>
                )}
                {passos[editando].tipo === "esperar" && (
                  <>
                    <label>Quanto tempo
                      <Ajuda>
                        Conta a partir do passo anterior, por pessoa — cada uma tem o próprio
                        relógio. A espera continua valendo mesmo que você mexa na automação no
                        meio do caminho.
                        <br /><br />
                        Se a automação for desligada, ninguém que estava esperando segue
                        adiante.
                      </Ajuda>
                    </label>
                    <Escolher valor={passos[editando].config.duracao ?? ""} vazio="— escolher —"
                      aoMudar={(v) => mudarPasso(editando as number, { duracao: v })}
                      opcoes={DURACOES.map(([v, r]) => ({ valor: v, rotulo: r }))} />
                  </>
                )}
                {passos[editando].tipo === "manychat_tag" && (
                  <>
                    <label>Tag no ManyChat</label>
                    <input value={passos[editando].config.tag ?? ""}
                      placeholder="COMPROU_DESAFIO" list="tags-do-manychat"
                      onChange={(e) => mudarPasso(editando as number, { tag: e.target.value })} />
                    <datalist id="tags-do-manychat">
                      {tagsMC.map((t) => <option key={t} value={t} />)}
                    </datalist>

                    {/* Dizer se a tag existe LÁ, na hora de escolher. Sem isso a
                        pessoa monta o fluxo, ativa, e só descobre que digitou o
                        nome errado quando ninguém recebe mensagem nenhuma. */}
                    {(() => {
                      const escrita = (passos[editando as number].config.tag ?? "").trim();
                      if (!escrita) {
                        return (
                          <div className="sub" style={{ marginTop: 4 }}>
                            {carregandoMC
                              ? "consultando as tags da sua conta…"
                              : tagsMC.length
                                ? `${tagsMC.length} tags na sua conta — comece a digitar para ver as opções.`
                                : "Não consegui ler as tags do ManyChat. Confira a chave em Configurações → ManyChat."}
                          </div>
                        );
                      }
                      const existe = tagsMC.some((t) => t.toLowerCase() === escrita.toLowerCase());
                      return existe ? (
                        <div className="sub" style={{ marginTop: 6, color: "var(--marca)" }}>
                          ✓ <b>{escrita}</b> já existe no ManyChat. O passo vai só aplicá-la —
                          e é ela que dispara o fluxo de lá.
                        </div>
                      ) : (
                        <div className="aviso" style={{ marginTop: 8 }}>
                          <b>{escrita}</b> ainda não existe na sua conta do ManyChat.
                          <div className="sub" style={{ margin: "4px 0 8px" }}>
                            Sem existir, nenhuma automação de lá está escutando por ela. O passo
                            cria a tag ao rodar, mas aí ela nasce sem fluxo pendurado — crie
                            agora e ligue o fluxo no ManyChat antes de ativar isto aqui.
                          </div>
                          <button disabled={!!criandoMC} onClick={() => criarTagMC(escrita)}>
                            {criandoMC === escrita ? "criando…" : "Criar agora no ManyChat"}
                          </button>
                        </div>
                      );
                    })()}
                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                      <input type="checkbox"
                        checked={passos[editando].config.criar !== false}
                        onChange={(e) => mudarPasso(editando as number, { criar: e.target.checked })} />
                      Criar o assinante se ele ainda não existir lá
                    </label>
                    <div className="aviso" style={{ marginTop: 10 }}>
                      A busca é pelo WhatsApp, no campo personalizado configurado em
                      <b> Configurações → ManyChat</b>. Sem WhatsApp o passo não cria ninguém —
                      assinante sem número nunca receberia mensagem.
                    </div>
                  </>
                )}
                {(passos[editando].tipo === "aplicar_tag" || passos[editando].tipo === "remover_tag") && (
                  <>
                    <label>Tag</label>
                    <Escolher valor={passos[editando].config.tag_id ?? ""} vazio="— escolher —"
                      aoMudar={(v) => mudarPasso(editando as number, { tag_id: Number(v) })}
                      opcoes={refs.tags.map((t) => ({ valor: t.tag_id, rotulo: t.nome }))} />
                  </>
                )}
                {(passos[editando].tipo === "inscrever_lista" || passos[editando].tipo === "desinscrever_lista") && (
                  <>
                    <label>Lista</label>
                    <Escolher valor={passos[editando].config.lista_id ?? ""} vazio="— escolher —"
                      aoMudar={(v) => mudarPasso(editando as number, { lista_id: Number(v) })}
                      opcoes={refs.listas.map((l) => ({ valor: l.lista_id, rotulo: l.nome }))} />
                  </>
                )}
                {passos[editando].tipo === "condicao" && (() => {
                  const cfg = passos[editando as number].config;
                  const cd = cfg.condicao ?? {};
                  const mudaCond = (patch: Record<string, any>) =>
                    mudarPasso(editando as number, { ...cfg, condicao: { ...cd, ...patch } });
                  return (
                    <>
                      <label>A condição
                        <Ajuda>
                          Um bifurcador: a pergunta é feita <b>naquele momento</b>, para cada
                          pessoa, e o caminho dela muda conforme a resposta.
                          <br /><br />
                          É o que permite “esperou 3 dias — abriu? então oferta; não abriu?
                          então reenvia com outro assunto”, sem precisar de duas automações
                          separadas.
                        </Ajuda>
                      </label>
                      <Escolher valor={cd.tipo ?? ""} vazio="— escolher —"
                        aoMudar={(v) => mudarPasso(editando as number,
                          { ...cfg, condicao: { tipo: v } })}
                        opcoes={CONDICOES.map(([v, r]) => ({ valor: v, rotulo: r }))} />

                      {cd.tipo === "tem_tag" && (
                        <>
                          <label>Tag</label>
                          <Escolher valor={cd.tag_id ?? ""} vazio="— escolher —"
                            aoMudar={(v) => mudaCond({ tag_id: Number(v) })}
                            opcoes={refs.tags.map((t) => ({ valor: t.tag_id, rotulo: t.nome }))} />
                        </>
                      )}
                      {cd.tipo === "na_lista" && (
                        <>
                          <label>Lista</label>
                          <Escolher valor={cd.lista_id ?? ""} vazio="— escolher —"
                            aoMudar={(v) => mudaCond({ lista_id: Number(v) })}
                            opcoes={refs.listas.map((l) => ({ valor: l.lista_id, rotulo: l.nome }))} />
                        </>
                      )}
                      {(cd.tipo === "abriu_email" || cd.tipo === "clicou_email") && (
                        <>
                          <label>Nos últimos quantos dias</label>
                          <input type="number" value={cd.dias ?? 30}
                            onChange={(e) => mudaCond({ dias: Number(e.target.value) })} />
                        </>
                      )}

                      <label>Se for VERDADEIRO, vai para o passo
                        <Ajuda>
                          O número que aparece no canto direito de cada cartão do quadro.
                          Vazio segue para o próximo; <b>0</b> encerra a automação para quem
                          cair naquele caminho.
                          <br /><br />
                          Cuidado ao mandar para trás: um passo que aponta para um anterior
                          vira um laço, e a pessoa fica dando voltas recebendo o mesmo e-mail.
                        </Ajuda>
                      </label>
                      <input type="number" placeholder="vazio = o próximo"
                        value={cfg.ir_se_verdadeiro ?? ""}
                        onChange={(e) => mudarPasso(editando as number,
                          { ...cfg, ir_se_verdadeiro: e.target.value })} />
                      <label>Se for FALSO, vai para o passo</label>
                      <input type="number" placeholder="vazio = o próximo"
                        value={cfg.ir_se_falso ?? ""}
                        onChange={(e) => mudarPasso(editando as number,
                          { ...cfg, ir_se_falso: e.target.value })} />
                      <div className="sub" style={{ marginTop: 6 }}>
                        O número é a posição do passo, mostrada à direita de cada cartão.
                        Deixe vazio para seguir para o passo seguinte, ou escreva <b>0</b> para
                        encerrar a automação naquele caminho.
                      </div>
                    </>
                  );
                })()}
                {passos[editando].tipo === "google_sheets" && (
                  <>
                    {passos[editando].config.url && !passos[editando].config.planilha_id ? (
                      <>
                        <label>URL do fluxo no n8n (modo antigo)</label>
                        <input placeholder="https://seu-n8n.com.br/webhook/…"
                          value={passos[editando].config.url ?? ""}
                          onChange={(e) => mudarPasso(editando as number, { url: e.target.value })} />
                        <div className="sub" style={{ marginTop: 8 }}>
                          Este passo ainda envia para o n8n (e obedece à chave-geral dos
                          webhooks). Para escrever direto na planilha,{" "}
                          <button className="mini" onClick={() =>
                            mudarPasso(editando as number, {})}>trocar para o modo direto</button>.
                        </div>
                      </>
                    ) : (
                      <>
                        <EditorPlanilha config={passos[editando].config}
                          aoMudar={(c) => mudarPasso(editando as number, c)} />
                        <div className="sub" style={{ marginTop: 10 }}>
                          Escreve direto, pela conta conectada em <b>Configurações → Planilhas</b>
                          — não passa pelo n8n nem pela chave-geral dos webhooks.
                        </div>
                      </>
                    )}
                  </>
                )}
                {passos[editando].tipo === "google_drive" && (
                  <>
                    <label>URL do fluxo no n8n</label>
                    <input placeholder="https://seu-n8n.com.br/webhook/…"
                      value={passos[editando].config.url ?? ""}
                      onChange={(e) => mudarPasso(editando as number, { url: e.target.value })} />
                    <div className="aviso" style={{ marginTop: 10 }}>
                      <b>Como funciona:</b> o Ressoar manda o contato completo para o seu n8n, e o
                      n8n escreve no Drive. No n8n: um nó <b>Webhook</b> recebendo POST, ligado a
                      um nó <b>Google Drive</b>. Os campos do contato chegam em <code>contato</code>.
                    </div>
                    <div className="sub" style={{ marginTop: 8 }}>
                      A chave-geral dos webhooks fica em <b>Configurações</b>. Com ela desligada,
                      nenhum POST sai — é a trava contra disparo duplicado.
                    </div>
                  </>
                )}
                {passos[editando].tipo === "webhook" && (
                  <>
                    <label>URL que recebe o POST</label>
                    <input placeholder="https://seu-n8n.com.br/webhook/…"
                      value={passos[editando].config.url ?? ""}
                      onChange={(e) => mudarPasso(editando as number, { url: e.target.value })} />
                    <div className="sub" style={{ marginTop: 6 }}>
                      A chave-geral dos webhooks fica em <b>Configurações</b>. Com ela desligada,
                      nenhum POST sai — é a trava que evita disparo duplicado.
                    </div>
                  </>
                )}
              </div>

              <div className="linha" style={{ marginTop: 18 }}>
                <button onClick={() => mover(editando as number, -1)}>↑ subir</button>
                <button onClick={() => mover(editando as number, 1)}>↓ descer</button>
                <button className="perigo" onClick={() => removerPasso(editando as number)}>remover</button>
              </div>
            </>
          ) : null}
        </div>
      )}
      {adicionando && (
        <PainelAdicionar
          onFechar={() => setAdicionando(false)}
          onAdicionar={onAdicionarContatos}
          listas={refs.listas}
          tags={refs.tags}
        />
      )}

    </div>
  );
}
