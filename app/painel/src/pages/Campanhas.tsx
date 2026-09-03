import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import EditorEmail from "../components/EditorEmail";
import EditorTexto from "../components/EditorTexto";
import { montarEmailMarca, CORES_PADRAO, type CoresEmail } from "../lib/emailMarca";
import { useNavigate } from "react-router-dom";
import Escolher from "../components/Escolher";
import Ajuda from "../components/Ajuda";
import Dialogos, { avisar, confirmar } from "../components/Dialogo";

// A área de campanhas foi redesenhada em 28/08/2026 depois do veredicto do
// Davi ("uma grandiosa confusão mental profunda"): o formulário único de
// oito seções virou um caminho de quatro passos — nome, mensagem, quem
// recebe, enviar — e o e-mail passou a ser ESCRITO, não montado: um editor
// de texto simples e o modelo da marca veste o resto sozinho. O editor de
// blocos continua existindo atrás de "modo avançado", porque mensagens
// antigas moram lá e sempre há quem queira liberdade total.

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
  scheduled_at?: string | null; started_at?: string | null;
  enviados: number; suprimidos: number; nao_entregues: number;
  aberturas_unicas: number;
  cliques_unicos: number; hard_bounces: number; descadastros: number;
};
type Lista = { lista_id: number; nome: string };

// Duas fotos da mesma lista são iguais? Os campos são rasos e as linhas
// poucas, então o JSON dá conta — e é o que impede a tela de se repintar
// de dez em dez segundos quando nada mudou no banco.
const mesmaFoto = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// hora de relógio de parede, com segundos: é o segundo que muda na tela e
// diz, sem precisar escrever, que a página continua olhando o servidor
const horaDe = (t: number) => new Date(t).toLocaleTimeString("pt-BR");
type Segmento = { segmento_id: string; nome: string; definicao: Record<string, unknown> };

type Relatorio = {
  abriram: { email: string; quando: string }[];
  clicaram: { email: string; url: string; quando: string; vezes: number }[];
  cliques: { url: string; total: number; unicos: number }[];
  bounces: string[];
  descadastros: string[];
};

const STATUS: Record<string, string> = {
  draft: "et-cinza", scheduled: "et-amarela", sending: "et-roxa",
  sent: "et-verde", paused: "et-amarela", cancelled: "et-vermelha",
};
// o banco fala inglês; a tela, não — era a única coluna estrangeira do painel
const STATUS_PT: Record<string, string> = {
  draft: "Rascunho", scheduled: "Agendada", sending: "Enviando",
  sent: "Enviada", paused: "Pausada", cancelled: "Cancelada",
};

// rascunho automático: o assistente sobrevive a F5, queda e clique errado
const CHAVE_RASCUNHO = "ressoar_rascunho_campanha_v1";

// o design salvo diz de que editor a mensagem veio (tipo "texto" reabre no
// editor de texto; qualquer outro é desenho do editor de blocos)
type DesignTexto = {
  tipo: "texto"; titulo: string; saudacao: boolean;
  botaoTexto: string; botaoLink: string; corpo: string;
  faixa?: string; // texto da faixa do topo; ausente = nome da marca, "" = sem faixa
};

// uma mensagem da biblioteca (página Mensagens), pronta para ser aproveitada
type MsgPronta = {
  mensagem_id: string; nome: string; subject: string; preheader: string | null;
  from_name: string; from_email: string; reply_to: string | null;
  html: string; design: unknown | null; origem_ac_id: number | null; created_at: string;
};

// Miniatura da prévia: o e-mail tem 600px de largura e a coluna é mais
// estreita — antes o iframe ficava com barras de rolagem que não rolavam
// (pointer-events desligado para não navegar). Agora o e-mail é ENCOLHIDO
// para caber inteiro na largura, sem barra nenhuma, e o clique abre a
// prévia grande num pop-up com rolagem de verdade.
function MiniPrevia({ html, altura, aoAmpliar }: {
  html: string; altura: number; aoAmpliar?: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [larg, setLarg] = useState(300);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLarg(el.clientWidth || 300));
    ro.observe(el);
    setLarg(el.clientWidth || 300);
    return () => ro.disconnect();
  }, []);
  const fator = Math.min(1, larg / 600) || 0.5;
  return (
    <div ref={caixa} onClick={aoAmpliar} role={aoAmpliar ? "button" : undefined}
      title={aoAmpliar ? "Ver em tamanho real" : undefined}
      style={{
        position: "relative", height: altura, overflow: "hidden",
        cursor: aoAmpliar ? "zoom-in" : "default",
        border: "1px solid var(--borda)", borderRadius: 8, background: "#fff",
      }}>
      <iframe title="prévia" srcDoc={html} sandbox="" scrolling="no"
        style={{
          width: 600, height: altura / fator, border: 0, background: "#fff",
          transform: `scale(${fator})`, transformOrigin: "top left", pointerEvents: "none",
        }} />
      {aoAmpliar && (
        <span style={{
          position: "absolute", right: 8, bottom: 8, fontSize: 12, borderRadius: 999,
          background: "rgba(23,0,32,.78)", color: "#fff", padding: "4px 10px",
        }}>🔍 Ampliar</span>
      )}
    </div>
  );
}

export default function Campanhas() {
  const { podeOperar } = useSessao();
  const [stats, setStats] = useState<Stats[]>([]);
  // relógio da atualização sozinha (o bloco inteiro fica logo abaixo de carregar)
  const [atualizadoEm, setAtualizadoEm] = useState(() => Date.now());
  const [semResposta, setSemResposta] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [listas, setListas] = useState<Lista[]>([]);
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const navegar = useNavigate();
  const [criando, setCriando] = useState(false);
  const [etapa, setEtapa] = useState(1);
  const [tipo, setTipo] = useState("padrao");
  const [nome, setNome] = useState("");

  // ---- a mensagem, no modo texto (o caminho padrão) ----
  const [tituloEmail, setTituloEmail] = useState("");
  // null = seguir o nome da marca (inclusive se ele mudar); "" = sem faixa
  const [faixaTexto, setFaixaTexto] = useState<string | null>(null);
  const [saudacao, setSaudacao] = useState(true);
  const [corpoTexto, setCorpoTexto] = useState("");
  const [botaoTexto, setBotaoTexto] = useState("");
  const [botaoLink, setBotaoLink] = useState("");
  const [corpoTextoB, setCorpoTextoB] = useState("");

  // ---- a mensagem, no modo blocos (avançado / legado) ----
  const [modoMsg, setModoMsg] = useState<"texto" | "blocos">("texto");
  const [html, setHtml] = useState("");
  const [design, setDesign] = useState<unknown>(null);
  const [editando, setEditando] = useState(false);
  const [htmlB, setHtmlB] = useState("");
  const [designB, setDesignB] = useState<unknown>(null);
  const [editandoB, setEditandoB] = useState(false);

  const [assunto, setAssunto] = useState("");
  const [preheader, setPreheader] = useState("");
  const [deNome, setDeNome] = useState("");
  const [deEmail, setDeEmail] = useState("");
  const [respostaIgual, setRespostaIgual] = useState(true);
  const [respostaEmail, setRespostaEmail] = useState("");
  const [assuntoB, setAssuntoB] = useState("");
  const [fatia, setFatia] = useState(30);

  const [rastreiaAbertura, setRastreiaAbertura] = useState(true);
  const [rastreiaClique, setRastreiaClique] = useState(true);
  const [monitoraResposta] = useState(false);
  const [arquivoPublico] = useState(true);
  const [endereco, setEndereco] = useState("");
  const [quantos, setQuantos] = useState<number | null>(null);
  const [tipoAud, setTipoAud] = useState<"listas" | "segmento">("listas");
  const [listasSel, setListasSel] = useState<number[]>([]);
  const [segSel, setSegSel] = useState("");
  const [buscaLista, setBuscaLista] = useState("");
  const [agendarEm, setAgendarEm] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [relDe, setRelDe] = useState<Stats | null>(null);
  const [rel, setRel] = useState<Relatorio | null>(null);

  // identidade que veste o e-mail escrito
  const [nomeMarca, setNomeMarca] = useState("");
  const [cores, setCores] = useState<CoresEmail>(CORES_PADRAO);

  // envio de teste para um endereço livre (não mexe na lista)
  const [testePara, setTestePara] = useState("");
  const [testeMsg, setTesteMsg] = useState<{ tom: "andamento" | "ok" | "erro"; texto: string } | null>(null);
  const [testando, setTestando] = useState(false);
  const [previaAmpla, setPreviaAmpla] = useState<null | "a" | "b">(null);
  const [alturaAmpla, setAlturaAmpla] = useState(1200);
  const [envioPausado, setEnvioPausado] = useState(false);
  const [envioSoPara, setEnvioSoPara] = useState("");
  const [rascunhoGuardado, setRascunhoGuardado] = useState<Record<string, unknown> | null>(null);
  const [placarDe, setPlacarDe] = useState<Stats | null>(null);
  const [placarDados, setPlacarDados] = useState<Record<string, { enviados: number; aberturas: number; cliques: number }> | null>(null);
  const [relErro, setRelErro] = useState(false);
  const [avisoRevisao, setAvisoRevisao] = useState<string[]>([]);
  // editar campanha existente: os ids gravados são atualizados, não duplicados
  const idsCriados = useRef<{ a?: string; b?: string | null; campanha?: string }>({});
  const [, setOrigem] = useState<Stats | null>(null); // campanha aberta p/ edição

  // ---- biblioteca de mensagens prontas -------------------------------
  // Reescrever do zero um e-mail que já existe na biblioteca era o buraco
  // do assistente: dava para escrever ou montar, nunca para aproveitar.
  // O que entra aqui é sempre uma CÓPIA — a campanha nunca escreve por
  // cima da mensagem guardada, que pode estar servindo a automações.
  const [bibliotecaPara, setBibliotecaPara] = useState<null | "a" | "b">(null);
  const [bibliotecaMsgs, setBibliotecaMsgs] = useState<MsgPronta[] | null>(null);
  const [bibliotecaErro, setBibliotecaErro] = useState("");
  const [bibliotecaBusca, setBibliotecaBusca] = useState("");
  const [bibliotecaSel, setBibliotecaSel] = useState<MsgPronta | null>(null);

  useEffect(() => {
    if (!previaAmpla) return;
    const fechar = (e: KeyboardEvent) => { if (e.key === "Escape") setPreviaAmpla(null); };
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [previaAmpla]);

  useEffect(() => {
    if (!bibliotecaPara) return;
    const fechar = (e: KeyboardEvent) => { if (e.key === "Escape") setBibliotecaPara(null); };
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [bibliotecaPara]);

  // ---- rascunho automático -------------------------------------------
  // O assistente vivia só na memória: F5, queda do navegador ou um clique
  // errado descartavam uma hora de escrita. Agora cada mudança espelha no
  // navegador e a volta é oferecida.
  const temConteudo = criando && !!(nome.trim() || corpoTexto.trim() || html || assunto.trim());
  useEffect(() => {
    if (!criando) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({
          v: 1, quando: Date.now(),
          etapa, tipo, nome, assunto, assuntoB, preheader, tituloEmail, saudacao,
          faixaTexto, corpoTexto, corpoTextoB, botaoTexto, botaoLink,
          modoMsg, html, design, htmlB, designB, fatia,
          tipoAud, listasSel, segSel, agendarEm,
          rastreiaAbertura, rastreiaClique, monitoraResposta,
        }));
      } catch { /* armazenamento cheio/bloqueado: segue sem espelho */ }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criando, etapa, tipo, nome, assunto, assuntoB, preheader, tituloEmail, saudacao,
      faixaTexto, corpoTexto, corpoTextoB, botaoTexto, botaoLink, modoMsg, html, design,
      htmlB, designB, fatia, tipoAud, listasSel, segSel, agendarEm,
      rastreiaAbertura, rastreiaClique, monitoraResposta]);

  useEffect(() => {
    try {
      const cru = localStorage.getItem(CHAVE_RASCUNHO);
      if (cru) setRascunhoGuardado(JSON.parse(cru));
    } catch { /* espelho ilegível: ignora */ }
  }, []);

  function retomarRascunho() {
    const r = rascunhoGuardado as Record<string, never> | null;
    if (!r) return;
    setTipo(r.tipo ?? "padrao"); setNome(r.nome ?? ""); setAssunto(r.assunto ?? "");
    setAssuntoB(r.assuntoB ?? ""); setPreheader(r.preheader ?? "");
    setTituloEmail(r.tituloEmail ?? ""); setSaudacao(r.saudacao ?? true);
    setFaixaTexto(r.faixaTexto ?? null); setCorpoTexto(r.corpoTexto ?? "");
    setCorpoTextoB(r.corpoTextoB ?? ""); setBotaoTexto(r.botaoTexto ?? "");
    setBotaoLink(r.botaoLink ?? ""); setModoMsg(r.modoMsg ?? "texto");
    setHtml(r.html ?? ""); setDesign(r.design ?? null);
    setHtmlB(r.htmlB ?? ""); setDesignB(r.designB ?? null);
    setFatia(r.fatia ?? 30); setTipoAud(r.tipoAud ?? "listas");
    setListasSel(r.listasSel ?? []); setSegSel(r.segSel ?? "");
    setAgendarEm(r.agendarEm ?? "");
    setEtapa(r.etapa ?? 2); setCriando(true);
    setRascunhoGuardado(null);
  }

  // fechar a aba com trabalho não gravado merece o aviso do navegador
  useEffect(() => {
    if (!temConteudo) return;
    const guarda = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", guarda);
    return () => window.removeEventListener("beforeunload", guarda);
  }, [temConteudo]);

  async function descartarAssistente() {
    if (temConteudo) {
      const ok = await confirmar({
        titulo: "Descartar esta campanha?",
        corpo: "O texto escrito e as escolhas feitas até aqui serão perdidos.",
        confirmarTexto: "Descartar", cancelarTexto: "Continuar editando", perigo: true,
      });
      if (!ok) return;
    }
    limpar();
  }

  async function carregar() {
    const [s, l, g] = await Promise.all([
      supabase.from("campanha_stats").select("*").order("nome"),
      supabase.from("listas").select("lista_id, nome").order("nome"),
      supabase.from("segmentos").select("*").order("nome"),
    ]);
    // sem resposta do servidor, o que já está na tela fica: rede oscilando
    // não pode esvaziar a lista de campanhas na frente de quem está olhando
    if (s.data) setStats(s.data as Stats[]);
    if (l.data) setListas(l.data);
    if (g.data) setSegmentos(g.data as never);
    setAtualizadoEm(Date.now());

    // remetente e endereço vêm da configuração — datilografar isso a cada
    // campanha é como o remetente errado entra em produção
    const { data: cfg } = await supabase.from("app_config").select("chave, valor");
    const c = Object.fromEntries((cfg ?? []).map((r) => [r.chave, r.valor ?? ""]));
    setDeNome((v) => v || c.from_name_padrao || "");
    setDeEmail((v) => v || c.from_email_padrao || "");
    setRespostaEmail((v) => v || c.reply_to_padrao || "");
    setEndereco(c.endereco_fisico || "");
    setNomeMarca(c.from_name_padrao || "");
    setEnvioPausado((c.envio_pausado || "false") === "true");
    setEnvioSoPara(c.envio_so_para || "");
    setCores({
      destaque: c.email_cor_destaque || CORES_PADRAO.destaque,
      titulo: c.email_cor_titulo || CORES_PADRAO.titulo,
      texto: c.email_cor_texto || CORES_PADRAO.texto,
      fundo: c.email_cor_fundo || CORES_PADRAO.fundo,
    });
  }
  useEffect(() => { carregar(); }, []);

  // ---- a lista se confere sozinha --------------------------------------
  // Campanha grande leva minutos escoando, e até aqui o único jeito de ver
  // o contador subir era o F5. Agora a tabela se reconfere sozinha: de dez
  // em dez segundos enquanto há fila saindo, de minuto em minuto quando
  // está tudo parado, e NUNCA com a aba escondida — em segundo plano o
  // navegador estrangula o relógio e seriam consultas gastas à toa.
  //
  // Só os números vêm nessa ida: remetente, cores e endereço são coisa do
  // formulário, e recarregá-los por baixo de quem está escrevendo um e-mail
  // seria trocar o texto da pessoa no meio da frase.
  const buscando = useRef(false);

  // "quente" é ter coisa saindo agora — ou uma agendada cuja hora já chegou,
  // que a qualquer momento vira "Enviando" sem ninguém tocar em nada. O motor
  // roda a cada minuto, mas abertura e clique pingam a qualquer instante.
  const quente = useMemo(() => stats.some((c) =>
    c.status === "sending" ||
    (c.status === "scheduled" && !!c.scheduled_at &&
      new Date(c.scheduled_at).getTime() <= Date.now() + 120_000)), [stats]);

  async function reconferir(pedidoAMao = false) {
    if (buscando.current) return;            // a volta anterior ainda está no ar
    buscando.current = true;
    if (pedidoAMao) setConferindo(true);
    try {
      const [s, cfg] = await Promise.all([
        supabase.from("campanha_stats").select("*").order("nome"),
        // o freio de entregabilidade pausa o envio sozinho: quando isso
        // acontece, o aviso do topo tem de aparecer aqui na hora
        supabase.from("app_config").select("chave, valor")
          .in("chave", ["envio_pausado", "envio_so_para"]),
      ]);
      if (s.error || !s.data) { setSemResposta(true); return; }
      setSemResposta(false);
      setAtualizadoEm(Date.now());

      const novas = s.data as Stats[];
      setStats((antes) => (mesmaFoto(antes, novas) ? antes : novas));
      // o relatório aberto bebe desta mesma linha: os cartões do topo dele
      // acompanham sem precisar fechar e abrir de novo
      setRelDe((r) => {
        const nova = r && novas.find((c) => c.campanha_id === r.campanha_id);
        return nova && !mesmaFoto(r, nova) ? nova : r;
      });

      if (cfg.data) {
        const c = Object.fromEntries(cfg.data.map((r) => [r.chave, r.valor ?? ""]));
        setEnvioPausado((c.envio_pausado || "false") === "true");
        setEnvioSoPara(c.envio_so_para || "");
      }
    } finally {
      buscando.current = false;
      if (pedidoAMao) setConferindo(false);
    }
  }

  // Placar A/B aberto é uma decisão sendo tomada em cima de números: eles
  // também sobem sozinhos. Erro aqui é engolido de propósito — no clique do
  // botão o aviso faz sentido, no relógio seria um pop-up do nada.
  useEffect(() => {
    if (!placarDe) return;
    const relogio = setInterval(async () => {
      if (document.hidden) return;
      const { data } = await supabase.rpc("placar_ab", { p_campanha: placarDe.campanha_id });
      if (data) setPlacarDados((antes) => (mesmaFoto(antes, data) ? antes : (data as never)));
    }, 15_000);
    return () => clearInterval(relogio);
  }, [placarDe]);

  // o relógio precisa da versão mais nova da função, não da que existia no
  // render em que ele nasceu — senão reconferiria olhando um estado velho
  const reconferirRef = useRef(reconferir);
  useEffect(() => { reconferirRef.current = reconferir; });

  useEffect(() => {
    const bater = () => { if (!document.hidden) reconferirRef.current(); };
    const relogio = setInterval(bater, quente ? 10_000 : 60_000);
    // voltar para a aba não espera o próximo passo: confere na hora
    document.addEventListener("visibilitychange", bater);
    window.addEventListener("focus", bater);
    return () => {
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", bater);
      window.removeEventListener("focus", bater);
    };
  }, [quente]);

  // Conta o público de verdade, no banco — a MESMA conta do disparo:
  // pessoa distinta (quem está em duas listas conta uma vez) e já sem quem
  // está na supressão. Resposta antiga que chega atrasada é descartada,
  // senão a contagem da lista errada aterrissa por último e fica na tela.
  const versaoContagem = useRef(0);
  useEffect(() => {
    const minhaVersao = ++versaoContagem.current;
    (async () => {
      setQuantos(null);
      if (tipoAud === "listas" && !listasSel.length) return;
      if (tipoAud === "segmento" && !segSel) return;
      const { data } = await supabase.rpc("contar_publico", {
        p_listas: tipoAud === "listas" ? listasSel : [],
        p_segmento: tipoAud === "segmento" ? segSel : null,
      });
      if (versaoContagem.current === minhaVersao) setQuantos((data as number) ?? null);
    })();
  }, [tipoAud, listasSel, segSel]);

  // o e-mail montado, sempre em dia com o que está sendo escrito
  const htmlMontado = useMemo(() => {
    if (modoMsg === "blocos") return html;
    if (!corpoTexto.trim()) return "";
    return montarEmailMarca({
      nomeMarca: deNome || nomeMarca || "Sua marca",
      faixa: faixaTexto ?? undefined,
      saudacao, titulo: tituloEmail, corpoHtml: corpoTexto,
      botaoTexto, botaoLink, cores,
    });
  }, [modoMsg, html, corpoTexto, saudacao, tituloEmail, botaoTexto, botaoLink, cores, deNome, nomeMarca, faixaTexto]);

  const htmlMontadoB = useMemo(() => {
    if (modoMsg === "blocos") return htmlB;
    if (!corpoTextoB.trim()) return "";
    return montarEmailMarca({
      nomeMarca: deNome || nomeMarca || "Sua marca",
      faixa: faixaTexto ?? undefined,
      saudacao, titulo: tituloEmail, corpoHtml: corpoTextoB,
      botaoTexto, botaoLink, cores,
    });
  }, [modoMsg, htmlB, corpoTextoB, saudacao, tituloEmail, botaoTexto, botaoLink, cores, deNome, nomeMarca, faixaTexto]);

  function pendencias(): string[] {
    const p: string[] = [];
    if (!nome.trim()) p.push("dê um nome à campanha");
    if (!assunto.trim()) p.push("escreva o assunto");
    if (!deNome.trim() || !deEmail.trim()) p.push("preencha o remetente");
    if (!htmlMontado.trim()) p.push("escreva o e-mail");
    if (modoMsg === "texto" && botaoTexto.trim() && !/^https:\/\/./.test(botaoLink.trim()))
      p.push("o link do botão precisa começar com https:// (sem isso o botão não entra no e-mail)");
    if (tipo === "ab" && !htmlMontadoB.trim()) p.push("escreva a versão B");
    if (tipo === "ab" && !assuntoB.trim()) p.push("escreva o assunto da versão B");
    if (tipoAud === "listas" && !listasSel.length) p.push("escolha ao menos uma lista");
    if (tipoAud === "segmento" && !segSel) p.push("escolha um segmento");
    if (!endereco.trim()) p.push("configure o endereço físico em Configurações");
    if (agendarEm && new Date(agendarEm).getTime() < Date.now() - 60_000)
      p.push("a data do agendamento já passou — escolha um horário no futuro");
    return p;
  }

  // variável digitada errada sai crua na frente do lead — melhor avisar aqui
  function variaveisDesconhecidas(): string[] {
    const conhecidas = /^(nome|nome_completo|email|campo\.[\w-]+)$/;
    const achadas = new Set<string>();
    for (const html of [htmlMontado, htmlMontadoB, assunto, assuntoB, preheader]) {
      for (const m of (html || "").matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
        if (!conhecidas.test(m[1].trim())) achadas.add(`{{${m[1].trim()}}}`);
      }
    }
    return [...achadas];
  }

  async function gravarMensagem(sufixo: string, assuntoM: string, htmlM: string, designM: unknown, idExistente?: string) {
    const corpo = {
      nome: nome.trim() + sufixo,
      subject: assuntoM.trim(),
      preheader: preheader.trim() || null,
      from_name: deNome.trim(),
      from_email: deEmail.trim(),
      reply_to: respostaIgual ? deEmail.trim() : (respostaEmail.trim() || null),
      html: htmlM,
      design: designM,
    };
    // retry após falha (ou edição de campanha aberta) atualiza a mesma
    // mensagem — clicar de novo não pode duplicar nada
    if (idExistente) {
      const { error } = await supabase.from("mensagens").update(corpo).eq("mensagem_id", idExistente);
      if (error) throw new Error(error.message);
      return idExistente;
    }
    const { data, error } = await supabase.from("mensagens").insert(corpo).select("mensagem_id").single();
    if (error) throw new Error(error.message);
    return data.mensagem_id as string;
  }

  function designAtual(): unknown {
    if (modoMsg === "blocos") return design;
    return {
      tipo: "texto", titulo: tituloEmail, saudacao,
      botaoTexto, botaoLink, corpo: corpoTexto,
      ...(faixaTexto !== null ? { faixa: faixaTexto } : {}),
    } satisfies DesignTexto;
  }
  function designAtualB(): unknown {
    if (modoMsg === "blocos") return designB;
    return {
      tipo: "texto", titulo: tituloEmail, saudacao,
      botaoTexto, botaoLink, corpo: corpoTextoB,
      ...(faixaTexto !== null ? { faixa: faixaTexto } : {}),
    } satisfies DesignTexto;
  }

  // ---- aproveitar uma mensagem já pronta -----------------------------

  async function abrirBiblioteca(para: "a" | "b") {
    setBibliotecaPara(para);
    setBibliotecaSel(null); setBibliotecaBusca(""); setBibliotecaErro("");
    if (bibliotecaMsgs) return;                      // já carregada nesta visita
    const { data, error } = await supabase.from("mensagens")
      .select("mensagem_id, nome, subject, preheader, from_name, from_email, reply_to, html, design, origem_ac_id, created_at")
      .order("created_at", { ascending: false }).limit(300);
    if (error) { setBibliotecaErro(error.message); return; }
    setBibliotecaMsgs((data as MsgPronta[]) ?? []);
  }

  // o que já está escrito no destino — para não apagar uma hora de trabalho
  // sem perguntar
  function temEscritoEm(para: "a" | "b") {
    return para === "a"
      ? !!(corpoTexto.trim() || html || assunto.trim())
      : !!(corpoTextoB.trim() || htmlB || assuntoB.trim());
  }

  async function usarMensagem(m: MsgPronta) {
    const para = bibliotecaPara;
    if (!para) return;
    const d = (m.design ?? null) as (DesignTexto & { tipo?: string }) | null;
    const deTexto = !!d && d.tipo === "texto";

    // versão B do modo texto só sabe guardar texto: mensagem de blocos ali
    // viraria um e-mail fantasma (a prévia mostra, o envio manda outra coisa)
    if (para === "b" && modoMsg === "texto" && !deTexto) {
      await avisar({
        titulo: "Essa mensagem foi montada com blocos",
        corpo: <>A versão B desta campanha está no modo texto, e só aceita mensagens escritas
          como texto. Para usar esta, passe a campanha para “Montar com blocos e caixas”.</>,
      });
      return;
    }

    if (temEscritoEm(para) && !(await confirmar({
      titulo: para === "b" ? "Substituir a versão B?" : "Substituir o que já está escrito?",
      corpo: <>O conteúdo atual {para === "b" ? "da versão B " : ""}desta campanha será trocado
        por “{m.nome}”. A mensagem guardada na biblioteca não muda.</>,
      confirmarTexto: "Substituir", perigo: true,
    }))) return;

    if (para === "b") {
      setAssuntoB(m.subject ?? "");
      if (modoMsg === "texto") setCorpoTextoB(d?.corpo ?? "");
      else { setHtmlB(m.html ?? ""); setDesignB(m.design ?? null); }
      setBibliotecaPara(null);
      return;
    }

    setAssunto(m.subject ?? "");
    setPreheader(m.preheader ?? "");
    if (m.from_name?.trim()) setDeNome(m.from_name);
    if (m.from_email?.trim()) setDeEmail(m.from_email);
    if (m.reply_to?.trim() && m.reply_to.trim() !== m.from_email?.trim()) {
      setRespostaIgual(false); setRespostaEmail(m.reply_to.trim());
    } else setRespostaIgual(true);

    if (deTexto) {
      // volta editável no editor de texto, campo por campo — não como um
      // HTML fechado que só o editor de blocos abre
      setModoMsg("texto");
      setTituloEmail(d?.titulo ?? ""); setSaudacao(d?.saudacao ?? true);
      setBotaoTexto(d?.botaoTexto ?? ""); setBotaoLink(d?.botaoLink ?? "");
      setCorpoTexto(d?.corpo ?? ""); setFaixaTexto(d?.faixa ?? null);
      setHtml(""); setDesign(null);
    } else {
      setModoMsg("blocos");
      setHtml(m.html ?? ""); setDesign(m.design ?? null);
    }
    setBibliotecaPara(null);
  }

  async function criar(disparar: boolean) {
    const faltando = pendencias();
    setAvisoRevisao(faltando);
    if (faltando.length) return;

    // a cerimônia do envio: nome, número real e o estado da torneira —
    // tudo antes de qualquer e-mail entrar na fila
    if (disparar) {
      const desconhecidas = variaveisDesconhecidas();
      const pessoas = quantos === null ? "?" : quantos.toLocaleString("pt-BR");
      const ok = await confirmar({
        titulo: agendarEm
          ? "Você preencheu uma data — enviar AGORA mesmo assim?"
          : (tipo === "ab" ? `Disparar o teste A/B de “${nome.trim()}”?` : `Enviar “${nome.trim()}” agora?`),
        corpo: (
          <>
            {agendarEm && <>O agendamento de {new Date(agendarEm).toLocaleString("pt-BR")} será ignorado
              e o envio começa já. Para agendar, use o botão “Salvar e agendar”.<br /><br /></>}
            {tipo === "ab"
              ? <>A fatia de teste ({fatia}%) sai agora, metade com cada versão, para até <b>{pessoas}</b> pessoas do público.</>
              : <>Vai para <b>{pessoas} pessoas</b> — sem repetições e já fora quem saiu ou está bloqueado.</>}
            {desconhecidas.length > 0 && <><br /><br />⚠ Há variáveis que o sistema não conhece e sairiam
              como texto cru: <b>{desconhecidas.join(", ")}</b>.</>}
            {envioPausado && <><br /><br />⏸ <b>O envio geral está pausado</b> em Configurações — os
              e-mails entram na fila e só saem depois de liberar.</>}
          </>
        ),
        confirmarTexto: agendarEm ? "Enviar agora mesmo assim" : "Enviar",
        cancelarTexto: "Voltar",
      });
      if (!ok) return;
    }

    setOcupado(true);
    try {
      const idA = await gravarMensagem(tipo === "ab" ? " · A" : "", assunto, htmlMontado, designAtual(), idsCriados.current.a);
      idsCriados.current.a = idA;
      const idB = tipo === "ab"
        ? await gravarMensagem(" · B", assuntoB, htmlMontadoB, designAtualB(), idsCriados.current.b ?? undefined)
        : null;
      idsCriados.current.b = idB;

      const corpoCampanha = {
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
      };
      let campanhaId = idsCriados.current.campanha;
      if (campanhaId) {
        const { error } = await supabase.from("campanhas").update(corpoCampanha).eq("campanha_id", campanhaId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase.from("campanhas").insert(corpoCampanha).select("campanha_id").single();
        if (error) throw new Error(error.message);
        campanhaId = data.campanha_id as string;
        idsCriados.current.campanha = campanhaId;
      }

      if (disparar) {
        const { data: qtd, error: e2 } = await supabase.rpc("disparar_campanha", { p_campanha: campanhaId });
        if (e2) throw new Error(e2.message);
        await avisar({
          titulo: "Pronto — a campanha está a caminho",
          corpo: tipo === "ab"
            ? <>O teste saiu para <b>{qtd}</b> pessoas, metade com cada versão. Acompanhe o placar na
                lista e depois mande a vencedora para o restante.</>
            : <>{qtd} e-mails entraram na fila de envio — quem saiu da lista ou está bloqueado não
                recebe. O ritmo é de ~100 por minuto.
                {envioPausado && <><br /><br />⏸ Lembrete: o envio geral está pausado; a fila segura
                  tudo até liberar em Configurações.</>}</>,
        });
      } else {
        await avisar({
          titulo: agendarEm ? "Agendada!" : "Rascunho salvo",
          corpo: agendarEm
            ? <>“{nome.trim()}” sai em <b>{new Date(agendarEm).toLocaleString("pt-BR")}</b> (horário de
                Brasília). Dá para editar ou cancelar o agendamento na lista, a qualquer momento antes da hora.</>
            : <>“{nome.trim()}” ficou na lista como rascunho — abra quando quiser para continuar.</>,
        });
      }
      limpar();
      carregar();
    } catch (e) {
      await avisar({ titulo: "Não foi possível concluir",
        corpo: <>Nada foi duplicado — clique de novo para tentar outra vez.
          <br /><small>Detalhe técnico: {(e as Error).message}</small></> });
    }
    setOcupado(false);
  }

  function limpar() {
    setCriando(false); setEtapa(1); setTipo("padrao");
    setNome(""); setListasSel([]); setSegSel(""); setAgendarEm(""); setBuscaLista("");
    setAssunto(""); setPreheader(""); setHtml(""); setDesign(null);
    setAssuntoB(""); setHtmlB(""); setDesignB(null);
    setModoMsg("texto"); setTituloEmail(""); setSaudacao(true); setFaixaTexto(null);
    setCorpoTexto(""); setCorpoTextoB(""); setBotaoTexto(""); setBotaoLink("");
    setTestePara(""); setTesteMsg(null); setAvisoRevisao([]);
    // a biblioteca é relida na próxima campanha: mensagem criada no meio do
    // caminho precisa aparecer
    setBibliotecaPara(null); setBibliotecaSel(null); setBibliotecaMsgs(null);
    idsCriados.current = {}; setOrigem(null);
    try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* sem espelho */ }
    setRascunhoGuardado(null);
  }

  // "Não aparece enviado — fico sem saber se foi ou não" (Davi, 30/08).
  // O teste agora é acompanhado até o fim: pede o envio, espera a resposta
  // REAL do servidor e mostra verde (foi), vermelho (recusado) ou o aviso
  // honesto de que ainda não há confirmação.
  const versaoTeste = useRef(0);
  async function enviarTeste(qual: "a" | "b" = "a") {
    const minha = ++versaoTeste.current;
    const dizer = (tom: "andamento" | "ok" | "erro", texto: string) => {
      if (versaoTeste.current === minha) setTesteMsg({ tom, texto });
    };
    const htmlT = qual === "b" ? htmlMontadoB : htmlMontado;
    const assuntoT = qual === "b" ? assuntoB : assunto;
    const para = testePara.trim();
    if (!htmlT.trim()) { dizer("erro", "Escreva o e-mail antes de testar."); return; }
    setTestando(true);
    dizer("andamento", "Enviando o teste…");
    const { data, error } = await supabase.rpc("enviar_email_teste", {
      p_assunto: assuntoT, p_html: htmlT, p_para: para,
      p_preheader: preheader.trim() || null,
    });
    setTestando(false);
    if (error) {
      dizer("erro", "Não foi possível pedir o envio — tente de novo em instantes. (" + error.message + ")");
      return;
    }
    const r = (data ?? {}) as { ok?: boolean; mensagem?: string; req?: number };
    if (!r.ok) { dizer("erro", r.mensagem || "Não foi possível enviar o teste."); return; }
    if (!r.req) { dizer("ok", r.mensagem || "Teste a caminho de " + para + "."); return; }

    dizer("andamento", "A caminho de " + para + " — confirmando com o servidor…");
    for (let i = 0; i < 8; i++) {
      await new Promise((x) => setTimeout(x, 2500));
      if (versaoTeste.current !== minha) return; // outro teste assumiu o painel
      const { data: res } = await supabase.rpc("resultado_envio_teste", { p_req: r.req });
      const s = (res ?? {}) as { estado?: string; detalhe?: string };
      if (s.estado === "ok") {
        dizer("ok", "Enviado! O servidor aceitou o teste para " + para + ". Confira a caixa de entrada (e o spam).");
        return;
      }
      if (s.estado === "erro") {
        dizer("erro", "O servidor recusou o teste. Motivo: " +
          (s.detalhe || "sem detalhe") + " — corrija e tente de novo.");
        return;
      }
    }
    dizer("ok", "O envio foi pedido, mas o servidor ainda não confirmou — se nada chegar em ~2 minutos, tente de novo.");
  }

  // a prévia mostra o e-mail como ele CHEGA: variáveis com dado de amostra e
  // o rodapé legal que o motor acrescenta em todo envio (em tom apagado)
  function previaAmostra(h: string) {
    if (!h) return h;
    const corpo = h
      .replace(/\{\{\s*nome\s*\}\}/g, "Maria")
      .replace(/\{\{\s*nome_completo\s*\}\}/g, "Maria Exemplo")
      .replace(/\{\{\s*email\s*\}\}/g, "maria@exemplo.com")
      .replace(/%FIRSTNAME%/g, "Maria")
      .replace(/%FULLNAME%/g, "Maria Exemplo");
    const rodape = `<div style="text-align:center;font-size:12px;color:#9a93a5;padding:22px 12px 8px;font-family:sans-serif">${
      endereco ? endereco + " · " : ""}<span style="text-decoration:underline">Não quero mais receber estes e-mails</span></div>` +
      `<div style="text-align:center;font-size:10.5px;color:#b3adbd;font-family:sans-serif;padding-bottom:16px">↑ rodapé posto automaticamente em todo envio</div>`;
    return corpo + rodape;
  }

  async function abrirPlacar(c: Stats) {
    setPlacarDe(c); setPlacarDados(null);
    const { data, error } = await supabase.rpc("placar_ab", { p_campanha: c.campanha_id });
    if (error) {
      setPlacarDe(null);
      await avisar({ titulo: "Não foi possível abrir o placar", corpo: error.message });
      return;
    }
    setPlacarDados((data ?? {}) as never);
  }

  async function mandarVencedor(id: string, qual: string) {
    const ok = await confirmar({
      titulo: `Mandar a versão ${qual} para o restante do público?`,
      corpo: "Quem já recebeu no teste não recebe de novo. Depois disso o teste é encerrado.",
      confirmarTexto: `Mandar a versão ${qual}`,
    });
    if (!ok) return;
    setPlacarDe(null);
    const { data, error } = await supabase.rpc("disparar_vencedor", { p_campanha: id, p_vencedor: qual });
    if (error) await avisar({ titulo: "Não foi possível mandar a vencedora", corpo: error.message });
    else await avisar({ titulo: "Vencedora a caminho",
      corpo: <>{String(data)} e-mails entraram na fila com a versão {qual}.</> });
    carregar();
  }

  async function dispararExistente(c: Stats) {
    // o número real desta campanha, buscado na hora — a pergunta mais séria
    // da ferramenta não sai sem nome e quantidade
    const { data: camp } = await supabase.from("campanhas")
      .select("lista_ids, segmento_fk").eq("campanha_id", c.campanha_id).single();
    const { data: n } = await supabase.rpc("contar_publico", {
      p_listas: camp?.lista_ids ?? [], p_segmento: camp?.segmento_fk ?? null,
    });
    const ok = await confirmar({
      titulo: `Enviar “${c.nome}” agora?`,
      corpo: (
        <>
          Vai para <b>{typeof n === "number" ? n.toLocaleString("pt-BR") : "?"} pessoas</b> — sem
          repetições e já fora quem saiu ou está bloqueado.
          {c.status === "scheduled" && c.scheduled_at && <><br /><br />O agendamento de{" "}
            {new Date(c.scheduled_at).toLocaleString("pt-BR")} deixa de valer: o envio começa já.</>}
          {envioPausado && <><br /><br />⏸ <b>O envio geral está pausado</b> — os e-mails ficam na
            fila até liberar em Configurações.</>}
        </>
      ),
      confirmarTexto: "Enviar agora",
    });
    if (!ok) return;
    const { data: qtd, error } = await supabase.rpc("disparar_campanha", { p_campanha: c.campanha_id });
    if (error) await avisar({ titulo: "Não foi possível enviar", corpo: error.message });
    else await avisar({ titulo: "Campanha a caminho",
      corpo: <>{String(qtd)} e-mails entraram na fila de envio.</> });
    carregar();
  }

  async function cancelarAgendamento(c: Stats) {
    const ok = await confirmar({
      titulo: `Cancelar o agendamento de “${c.nome}”?`,
      corpo: <>Ela estava marcada para {c.scheduled_at
        ? new Date(c.scheduled_at).toLocaleString("pt-BR") : "—"}. Nada é apagado: a campanha
        vira “Cancelada” e pode ser reaberta com o botão Abrir.</>,
      confirmarTexto: "Cancelar agendamento", perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc("cancelar_agendamento", { p_campanha: c.campanha_id });
    if (error) await avisar({ titulo: "Não foi possível cancelar", corpo: error.message });
    carregar();
  }

  // Abrir (editar) ou Duplicar: o assistente renasce a partir do que foi salvo
  async function abrirCampanha(c: Stats, duplicar: boolean) {
    const { data: camp, error } = await supabase.from("campanhas")
      .select("*, a:mensagem_fk(*), b:mensagem_b_fk(*)")
      .eq("campanha_id", c.campanha_id).single();
    if (error || !camp) {
      await avisar({ titulo: "Não foi possível abrir a campanha", corpo: error?.message });
      return;
    }
    limpar();
    const a = camp.a as Record<string, never> | null;
    const b = camp.b as Record<string, never> | null;
    const d = (a?.design ?? null) as (DesignTexto & { tipo?: string }) | null;
    setCriando(true); setEtapa(2);
    setTipo(camp.tipo ?? "padrao");
    setNome(duplicar ? `${camp.nome} (cópia)` : camp.nome);
    setAssunto(a?.subject ?? ""); setPreheader(a?.preheader ?? "");
    setDeNome(a?.from_name ?? deNome); setDeEmail(a?.from_email ?? deEmail);
    if (d && d.tipo === "texto") {
      setModoMsg("texto");
      setTituloEmail(d.titulo ?? ""); setSaudacao(d.saudacao ?? true);
      setBotaoTexto(d.botaoTexto ?? ""); setBotaoLink(d.botaoLink ?? "");
      setCorpoTexto(d.corpo ?? ""); setFaixaTexto(d.faixa ?? null);
    } else {
      setModoMsg("blocos");
      setHtml(a?.html ?? ""); setDesign(a?.design ?? null);
    }
    if (b) {
      setAssuntoB(b.subject ?? "");
      const db = (b.design ?? null) as (DesignTexto & { tipo?: string }) | null;
      if (db && db.tipo === "texto") setCorpoTextoB(db.corpo ?? "");
      else { setHtmlB(b.html ?? ""); setDesignB(b.design ?? null); }
    }
    setFatia(camp.percentual_teste ?? 30);
    setTipoAud(camp.segmento_fk ? "segmento" : "listas");
    setListasSel(camp.lista_ids ?? []); setSegSel(camp.segmento_fk ?? "");
    setAgendarEm(camp.scheduled_at ? new Date(camp.scheduled_at).toISOString().slice(0, 16) : "");
    setRastreiaAbertura(camp.track_opens ?? true); setRastreiaClique(camp.track_clicks ?? true);
    if (!duplicar) {
      idsCriados.current = { a: camp.mensagem_fk, b: camp.mensagem_b_fk ?? null, campanha: camp.campanha_id };
      setOrigem(c);
    }
    window.scrollTo({ top: 0 });
  }

  async function abrirRelatorio(c: Stats) {
    setRelDe(c);
    setRel(null); setRelErro(false);
    // só os eventos que interessam: o "sent" (um por envio) comia o teto de
    // 5.000 linhas e escondia aberturas de campanha grande
    const { data, error } = await supabase.from("eventos_email")
      .select("tipo, url, occurred_at, envios!inner(campanha_fk, tabela_1_leads(email))")
      .eq("envios.campanha_fk", c.campanha_id)
      .in("tipo", ["open", "click", "bounce_hard", "bounce_soft", "unsubscribe"])
      .order("occurred_at", { ascending: false })
      .limit(5000);
    if (error) { setRelErro(true); return; }
    const eventos = (data as any[]) ?? [];
    const abriramMap = new Map<string, string>();
    const cliquesMap = new Map<string, { total: number; emails: Set<string> }>();
    // quem clicou em quê. A chave junta pessoa e link porque quem clica em
    // dois links diferentes são duas linhas — e o mesmo link clicado três
    // vezes é uma linha só, com o contador
    const pessoasMap = new Map<string, { email: string; url: string; quando: string; vezes: number }>();
    const bounces = new Set<string>();
    const desc = new Set<string>();
    for (const e of eventos) {
      const email = e.envios?.tabela_1_leads?.email ?? "?";
      if (e.tipo === "open" && !abriramMap.has(email)) abriramMap.set(email, e.occurred_at);
      if (e.tipo === "click") {
        const url = e.url ?? "(link não identificado)";
        const atual = cliquesMap.get(url) ?? { total: 0, emails: new Set<string>() };
        atual.total++; atual.emails.add(email);
        cliquesMap.set(url, atual);
        const chave = JSON.stringify([email, url]);
        const p = pessoasMap.get(chave);
        // os eventos vêm do mais novo para o mais velho: a última passagem
        // por aqui é o clique mais antigo, o primeiro que a pessoa deu
        if (p) { p.vezes++; p.quando = e.occurred_at; }
        else pessoasMap.set(chave, { email, url, quando: e.occurred_at, vezes: 1 });
      }
      if (e.tipo === "bounce_hard" || e.tipo === "bounce_soft") bounces.add(email);
      if (e.tipo === "unsubscribe") desc.add(email);
    }
    setRel({
      abriram: [...abriramMap.entries()].map(([email, quando]) => ({ email, quando })),
      clicaram: [...pessoasMap.values()].sort((a, b) => b.quando.localeCompare(a.quando)),
      cliques: [...cliquesMap.entries()].map(([url, v]) => ({ url, total: v.total, unicos: v.emails.size }))
        .sort((a, b) => b.total - a.total),
      bounces: [...bounces],
      descadastros: [...desc],
    });
  }

  // ---- pedaços de interface ----

  const Passos = () => (
    <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", margin: "4px 0 20px" }}>
      {[
        { n: 2, rotulo: "Mensagem" },
        { n: 3, rotulo: "Quem recebe" },
        { n: 4, rotulo: "Enviar" },
      ].map((p, i) => (
        <span key={p.n} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {i > 0 && <span style={{ width: 26, height: 1, background: "var(--borda)" }} />}
          <button onClick={() => p.n < etapa && setEtapa(p.n)}
            style={{
              display: "flex", gap: 8, alignItems: "center", border: "none", cursor: p.n < etapa ? "pointer" : "default",
              background: "transparent", color: etapa === p.n ? "var(--marca)" : p.n < etapa ? "var(--texto)" : "var(--texto2)",
              fontWeight: etapa === p.n ? 700 : 400, fontSize: "calc(13px * var(--escala-texto))", padding: 0,
            }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%", display: "inline-flex", alignItems: "center",
              justifyContent: "center", fontSize: 12, fontWeight: 700,
              background: etapa >= p.n ? "var(--marca)" : "var(--borda)",
              color: etapa >= p.n ? "#fff" : "var(--texto2)",
            }}>{p.n < etapa ? "✓" : i + 1}</span>
            {p.rotulo}
          </button>
        </span>
      ))}
    </div>
  );

  const Cartao = ({ titulo, children, sub }: { titulo: string; sub?: string; children: React.ReactNode }) => (
    <div style={{
      border: "1px solid var(--borda)", borderRadius: 12, padding: "18px 20px",
      marginBottom: 16, background: "var(--cartao, transparent)",
    }}>
      <b style={{ display: "block", marginBottom: sub ? 2 : 12 }}>{titulo}</b>
      {sub && <div className="sub" style={{ margin: "0 0 12px" }}>{sub}</div>}
      {children}
    </div>
  );

  const listasFiltradas = listas.filter((l) =>
    l.nome.toLowerCase().includes(buscaLista.trim().toLowerCase()));

  // busca da biblioteca sem acento e sem caixa — quem digita com pressa não
  // põe acento, e o nome guardado quase sempre tem
  const semAcento = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const termoBiblioteca = semAcento(bibliotecaBusca.trim());
  const bibliotecaFiltradas = (bibliotecaMsgs ?? []).filter((m) =>
    !termoBiblioteca || semAcento(`${m.nome ?? ""} ${m.subject ?? ""}`).includes(termoBiblioteca));

  const rodapeNavegacao = (podeAvancar: boolean, aoAvancar: () => void, rotulo = "Continuar →", falta?: string) => (
    <div className="linha" style={{ marginTop: 6, justifyContent: "space-between" }}>
      <button onClick={() => setEtapa(etapa - 1)}>← Voltar</button>
      <div className="linha" style={{ margin: 0, alignItems: "center" }}>
        {!podeAvancar && falta && (
          <span className="sub" style={{ margin: 0 }}>falta: {falta}</span>
        )}
        <button onClick={descartarAssistente}>Descartar</button>
        <button className="primario" disabled={!podeAvancar} onClick={aoAvancar}>{rotulo}</button>
      </div>
    </div>
  );

  // dizer o que falta ao lado do botão apagado — botão mudo ensina errado
  const faltaEtapa2 = !assunto.trim() ? "o assunto"
    : !htmlMontado.trim() ? "escrever o e-mail"
    : tipo === "ab" && !assuntoB.trim() ? "o assunto da versão B"
    : tipo === "ab" && !htmlMontadoB.trim() ? "escrever a versão B"
    : undefined;

  return (
    <div>
      <Dialogos />
      <h1>Campanhas</h1>
      <div className="sub">Envios de uma vez, para listas ou segmentos — quem pediu para sair
        ou teve e-mail devolvido nunca recebe.
        <Ajuda>
          <b>Campanha</b> é o envio de uma vez, para quem estiver na lista naquele momento.
          <b> Automação</b> é o que sai sozinho quando algo acontece com a pessoa, hoje ou
          daqui a seis meses.
          <br /><br />
          Na hora do disparo o público é conferido de novo no banco: quem saiu, teve e-mail
          devolvido ou está na lista de bloqueio não entra, mesmo constando na lista.
        </Ajuda>
      </div>

      {(envioPausado || envioSoPara.trim()) && (
        <div style={{
          margin: "10px 0 4px", padding: "10px 16px", borderRadius: 10,
          border: "1px solid var(--borda)", background: "var(--marca-fraca)",
          fontSize: "calc(13px * var(--escala-texto))",
        }}>
          {envioPausado
            ? <>⏸ <b>O envio geral está pausado</b> — campanhas e automações entram na fila,
                mas nada sai (nem as agendadas) até liberar em Configurações → E-mail.</>
            : <>🧪 <b>Modo ensaio ligado</b> — só saem e-mails para {envioSoPara}; o resto fica
                retido para conferência.</>}
        </div>
      )}

      {rascunhoGuardado && !criando && (
        <div style={{
          margin: "10px 0 4px", padding: "10px 16px", borderRadius: 10,
          border: "1px dashed var(--marca)", display: "flex", gap: 12, alignItems: "center",
          fontSize: "calc(13px * var(--escala-texto))",
        }}>
          <span style={{ flex: 1 }}>
            ✍ Encontrei uma campanha que você não terminou
            {typeof rascunhoGuardado.nome === "string" && rascunhoGuardado.nome
              ? <> (“{String(rascunhoGuardado.nome)}”)</> : null}.
          </span>
          <button className="primario" onClick={retomarRascunho}>Continuar de onde parei</button>
          <button onClick={() => {
            try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* sem espelho */ }
            setRascunhoGuardado(null);
          }}>Descartar</button>
        </div>
      )}

      {editando && (
        <EditorEmail html={html} design={design}
          assunto={assunto} aoMudarAssunto={setAssunto}
          preheader={preheader} aoMudarPreheader={setPreheader}
          onSalvar={(h, d) => { setHtml(h); setDesign(d); setModoMsg("blocos"); setEditando(false); }}
          onFechar={() => setEditando(false)} />
      )}
      {editandoB && (
        <EditorEmail html={htmlB} design={designB}
          assunto={assuntoB} aoMudarAssunto={setAssuntoB}
          preheader={preheader} aoMudarPreheader={setPreheader}
          onSalvar={(h, d) => { setHtmlB(h); setDesignB(d); setEditandoB(false); }}
          onFechar={() => setEditandoB(false)} />
      )}

      {/* ---- escolher uma mensagem pronta da biblioteca ---- */}
      {bibliotecaPara && (
        <div onClick={() => setBibliotecaPara(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(12,4,18,.62)", zIndex: 130,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--cartao, #fff)", borderRadius: 14, width: "min(1000px, 96vw)",
              maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 18px 60px rgba(0,0,0,.45)",
            }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--borda)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <b>Usar uma mensagem pronta{bibliotecaPara === "b" ? " — versão B" : ""}</b>
                <button onClick={() => setBibliotecaPara(null)} title="Fechar (Esc)">✕ Fechar</button>
              </div>
              <div className="sub" style={{ margin: "4px 0 0" }}>
                A campanha leva uma <b>cópia</b>: o que você editar aqui não mexe na mensagem
                guardada, nem no que as automações enviam.
              </div>
            </div>

            <div style={{ padding: "12px 18px 0" }}>
              <input value={bibliotecaBusca} onChange={(e) => setBibliotecaBusca(e.target.value)}
                placeholder="🔎 buscar por nome ou assunto…" style={{ margin: 0 }} autoFocus />
            </div>

            <div style={{
              flex: 1, minHeight: 0, display: "grid", gap: 16, padding: "12px 18px",
              gridTemplateColumns: "minmax(280px, 1fr) minmax(240px, 340px)",
            }}>
              <div style={{ overflow: "auto", border: "1px solid var(--borda)", borderRadius: 10 }}>
                {bibliotecaErro ? (
                  <div className="sub" style={{ padding: 16 }}>
                    Não consegui carregar a biblioteca ({bibliotecaErro}).{" "}
                    <button onClick={() => { setBibliotecaMsgs(null); abrirBiblioteca(bibliotecaPara); }}>
                      Tentar de novo
                    </button>
                  </div>
                ) : !bibliotecaMsgs ? (
                  <div className="sub" style={{ padding: 16 }}>carregando as mensagens…</div>
                ) : bibliotecaFiltradas.length === 0 ? (
                  <div className="sub" style={{ padding: 16 }}>
                    {bibliotecaMsgs.length === 0
                      ? <>A biblioteca ainda está vazia. Toda campanha enviada guarda o e-mail
                          aqui, e em <b>Mensagens</b> dá para escrever uma do zero.</>
                      : "nenhuma mensagem com esse nome ou assunto"}
                  </div>
                ) : bibliotecaFiltradas.map((m) => {
                  const sel = bibliotecaSel?.mensagem_id === m.mensagem_id;
                  const dm = (m.design ?? null) as { tipo?: string } | null;
                  return (
                    <div key={m.mensagem_id} onClick={() => setBibliotecaSel(m)}
                      onDoubleClick={() => usarMensagem(m)}
                      style={{
                        padding: "10px 12px", cursor: "pointer",
                        borderBottom: "1px solid var(--borda)",
                        background: sel ? "var(--marca-fraca)" : "transparent",
                        borderLeft: `3px solid ${sel ? "var(--marca)" : "transparent"}`,
                      }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <b style={{ flex: 1 }}>{m.nome || "(sem nome)"}</b>
                        {m.origem_ac_id
                          ? <span className="etiqueta et-cinza">AC #{m.origem_ac_id}</span>
                          : <span className="etiqueta et-roxa">própria</span>}
                        <span className="etiqueta et-cinza">
                          {dm?.tipo === "texto" ? "texto" : "blocos"}
                        </span>
                      </div>
                      <div className="sub" style={{ margin: "2px 0 0" }}>
                        {m.subject || "(sem assunto)"} · {new Date(m.created_at).toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ overflow: "auto" }}>
                {bibliotecaSel ? (
                  <>
                    <b style={{ display: "block", marginBottom: 6 }}>Como esta chegou</b>
                    <MiniPrevia html={previaAmostra(bibliotecaSel.html)} altura={380} />
                    <div className="sub" style={{ marginTop: 8 }}>
                      De {bibliotecaSel.from_name} &lt;{bibliotecaSel.from_email}&gt;
                      {bibliotecaPara === "a" && <> — o remetente da campanha passa a ser este.</>}
                    </div>
                  </>
                ) : (
                  <div className="sub" style={{ padding: "40px 10px", textAlign: "center" }}>
                    Clique numa mensagem à esquerda para ver como ela chega.
                  </div>
                )}
              </div>
            </div>

            <div className="linha" style={{
              justifyContent: "flex-end", margin: 0, padding: "12px 18px",
              borderTop: "1px solid var(--borda)",
            }}>
              <button onClick={() => setBibliotecaPara(null)}>Cancelar</button>
              <button className="primario" disabled={!bibliotecaSel}
                onClick={() => bibliotecaSel && usarMensagem(bibliotecaSel)}>
                Usar esta mensagem
              </button>
            </div>
          </div>
        </div>
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
              placeholder="Ex.: Black 2026 — convite final" style={{ textAlign: "center" }} />

            <h2 style={{ textAlign: "center", marginTop: 26 }}>Que tipo de campanha?</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {TIPOS.map((t) => {
                const aqui = t.onde === "aqui";
                const sel = aqui && tipo === t.id;
                return (
                  <div key={t.id}
                    onClick={async () => {
                      if (aqui) { setTipo(t.id); return; }
                      // sair daqui leva para Automações e derruba o que foi digitado
                      if (nome.trim() && !(await confirmar({
                        titulo: "Ir para Automações?",
                        corpo: "Este tipo é criado lá. O nome digitado aqui não vai junto.",
                        confirmarTexto: "Ir para Automações",
                      }))) return;
                      navegar(t.onde);
                    }}
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
                    </div>
                    {!aqui && <span className="sub" style={{ margin: 0 }}>abre em Automações →</span>}
                  </div>
                );
              })}
            </div>

            <div className="linha" style={{ marginTop: 18, justifyContent: "flex-end", alignItems: "center" }}>
              {!nome.trim() && <span className="sub" style={{ margin: 0 }}>falta: o nome da campanha</span>}
              <button onClick={descartarAssistente}>Descartar</button>
              <button className="primario" disabled={!nome.trim()} onClick={() => setEtapa(2)}>
                Próximo →
              </button>
            </div>
          </div>
        ) : etapa === 2 ? (
          /* ---------------- etapa 2: a mensagem ---------------- */
          <div>
            <Passos />
            {/* a escrita manda no espaço; a prévia acompanha de lado sem apertar */}
            <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(420px, 1.8fr) minmax(260px, 360px)" }}>
              <div>
                <label>Assunto
                  <Ajuda>
                    Aceita {"{{nome}}"} e os seus campos próprios. Evite MAIÚSCULAS gritadas e
                    excesso de emoji: o filtro de spam pesa contra você.
                  </Ajuda>
                </label>
                <input value={assunto} onChange={(e) => setAssunto(e.target.value)}
                  placeholder="O que aparece na caixa de entrada"
                  style={{ fontSize: "calc(15px * var(--escala-texto))" }} />

                {/* par do assunto na caixa de entrada — merece morar ao lado dele,
                    não dobrado nos ajustes avançados (reclamação de 30/08) */}
                <label>Pré-cabeçalho
                  <Ajuda>
                    A linha cinza que aparece depois do assunto na caixa de entrada.
                    Se ficar vazio, o Gmail mostra o começo do e-mail.
                  </Ajuda>
                </label>
                <input value={preheader} onChange={(e) => setPreheader(e.target.value)}
                  placeholder="a linha cinza que aparece depois do assunto, na caixa de entrada" />

                {/* os jeitos de montar, sempre à vista — um não esconde o outro */}
                <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 4, flexWrap: "wrap", alignItems: "center" }}>
                  <button className={modoMsg === "texto" ? "primario" : ""}
                    onClick={async () => {
                      if (modoMsg === "blocos" && (html || design)) {
                        if (!(await confirmar({
                          titulo: "Voltar a escrever texto?",
                          corpo: "O desenho de blocos desta campanha será descartado.",
                          confirmarTexto: "Voltar ao texto", perigo: true,
                        }))) return;
                        setHtml(""); setDesign(null);
                      }
                      setModoMsg("texto");
                    }}>
                    ✍ Escrever texto
                  </button>
                  <button className={modoMsg === "blocos" ? "primario" : ""}
                    onClick={() => {
                      // o modo só vira "blocos" quando um desenho é salvo — cancelar a
                      // galeria não pode deixar a tela afirmando um e-mail que não existe
                      if (html || design) setModoMsg("blocos");
                      setEditando(true);
                    }}>
                    🧱 Montar com blocos e caixas
                  </button>
                  <span style={{ width: 1, alignSelf: "stretch", background: "var(--borda)", margin: "0 2px" }} />
                  <button onClick={() => abrirBiblioteca("a")}
                    title="Aproveitar um e-mail que já está na biblioteca de Mensagens">
                    📚 Usar uma pronta
                  </button>
                  <span className="sub" style={{ margin: "6px 0 0" }}>
                    {modoMsg === "texto"
                      ? "você escreve, o modelo veste"
                      : "liberdade total, arrastando blocos"}
                  </span>
                </div>

                {modoMsg === "texto" ? (
                  <>
                    <label style={{ marginTop: 14 }}>Escreva a mensagem</label>
                    <div className="sub" style={{ margin: "0 0 8px" }}>
                      Só o texto. A moldura — faixa da marca, assinatura e rodapé com
                      descadastro — o modelo põe sozinho, como mostra a prévia ao lado.
                    </div>
                    <EditorTexto valor={corpoTexto} aoMudar={setCorpoTexto} corDestaque={cores.destaque} />

                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
                      <div>
                        <label>Texto do botão <span className="sub" style={{ margin: 0 }}>(opcional)</span></label>
                        <input value={botaoTexto} onChange={(e) => setBotaoTexto(e.target.value)}
                          placeholder="Quero participar" />
                      </div>
                      <div>
                        <label>Link do botão</label>
                        <input value={botaoLink} onChange={(e) => setBotaoLink(e.target.value)}
                          placeholder="https://…"
                          style={botaoTexto.trim() && botaoLink.trim() && !/^https:\/\/./.test(botaoLink.trim())
                            ? { borderColor: "var(--perigo)" } : undefined} />
                        {botaoTexto.trim() && botaoLink.trim() && !/^https:\/\/./.test(botaoLink.trim()) && (
                          <div style={{ marginTop: 3, fontSize: "calc(12px * var(--escala-texto))", color: "var(--perigo)" }}>
                            precisa começar com https:// — sem isso o botão não entra no e-mail
                          </div>
                        )}
                        {botaoTexto.trim() && !botaoLink.trim() && (
                          <div className="sub" style={{ marginTop: 3 }}>
                            sem link o botão não entra no e-mail
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
                      <div>
                        <label>Título dentro do e-mail <span className="sub" style={{ margin: 0 }}>(opcional)</span></label>
                        <input value={tituloEmail} onChange={(e) => setTituloEmail(e.target.value)}
                          placeholder="Se vazio, o e-mail começa direto no texto" />
                      </div>
                      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 24 }}>
                        <input type="checkbox" checked={saudacao}
                          onChange={(e) => setSaudacao(e.target.checked)} />
                        Começar com “Olá, {"{{nome}}"}!”
                      </label>
                      <div>
                        <label>Faixa colorida do topo</label>
                        <input value={faixaTexto ?? (deNome || nomeMarca || "Sua marca")}
                          onChange={(e) => setFaixaTexto(e.target.value)}
                          placeholder="apague para tirar a faixa" />
                        <div className="sub" style={{ marginTop: 3 }}>
                          A assinatura do fim continua com o nome da marca —{" "}
                          {faixaTexto === null
                            ? "aqui você pode pôr outro texto para não repetir."
                            : <button type="button" onClick={() => setFaixaTexto(null)}
                                style={{
                                  border: 0, background: "none", padding: 0, height: "auto",
                                  color: "var(--marca)", cursor: "pointer", font: "inherit",
                                  textDecoration: "underline",
                                }}>
                                voltar ao padrão
                              </button>}
                        </div>
                      </div>
                    </div>

                    {tipo === "ab" && (
                      <div style={{
                        border: "1px dashed var(--marca)", borderRadius: 12, padding: "14px 16px", marginTop: 18,
                      }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between" }}>
                          <b>Versão B</b>
                          <button onClick={() => abrirBiblioteca("b")}
                            title="Aproveitar um e-mail da biblioteca de Mensagens como versão B">
                            📚 Usar uma pronta
                          </button>
                        </div>
                        <div className="sub" style={{ margin: "2px 0 10px" }}>
                          Mesma moldura, outro assunto e outro texto — o público do teste é
                          dividido ao meio entre as duas.
                        </div>
                        <input value={assuntoB} onChange={(e) => setAssuntoB(e.target.value)}
                          placeholder="Assunto da versão B" />
                        <div style={{ marginTop: 10 }}>
                          <EditorTexto valor={corpoTextoB} aoMudar={setCorpoTextoB} altura={200}
                            corDestaque={cores.destaque} />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{
                    border: "1px solid var(--borda)", borderRadius: 12, padding: 16, marginTop: 14, textAlign: "center",
                  }}>
                    <b>Este e-mail foi montado no editor de blocos.</b>
                    <div className="sub" style={{ margin: "4px 0 12px" }}>
                      A prévia está ao lado. Para mexer nele, abra o editor de blocos; para
                      recomeçar escrevendo texto simples, volte ao modo texto (o desenho de
                      blocos é descartado).
                    </div>
                    <div className="linha" style={{ justifyContent: "center" }}>
                      <button className="primario" onClick={() => setEditando(true)}>Abrir o editor de blocos</button>
                      <button onClick={async () => {
                        if (await confirmar({
                          titulo: "Voltar ao modo texto?",
                          corpo: "O desenho de blocos desta campanha será descartado.",
                          confirmarTexto: "Voltar ao texto", perigo: true,
                        })) {
                          setModoMsg("texto"); setHtml(""); setDesign(null);
                        }
                      }}>Voltar ao modo texto</button>
                    </div>
                    {tipo === "ab" && (
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--borda)" }}>
                        <input value={assuntoB} onChange={(e) => setAssuntoB(e.target.value)}
                          placeholder="Assunto da versão B" />
                        <div className="linha" style={{ justifyContent: "center", marginTop: 8 }}>
                          <button onClick={() => setEditandoB(true)}>
                            {htmlB ? "Editar a versão B (blocos)" : "Montar a versão B (blocos)"}
                          </button>
                          <button onClick={() => abrirBiblioteca("b")}
                            title="Aproveitar um e-mail da biblioteca de Mensagens como versão B">
                            📚 Usar uma pronta
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {tipo === "ab" && (
                  // a fatia pertence ao TESTE, não ao editor — vale igual nos
                  // dois modos, e escondida no modo blocos ela disparava 30%
                  // sem ninguém nunca ter escolhido isso
                  <div style={{ marginTop: 14 }}>
                    <label>Fatia que participa do teste: {fatia}%</label>
                    <input type="range" min={10} max={100} step={5} value={fatia}
                      onChange={(e) => setFatia(Number(e.target.value))} />
                    <div className="sub" style={{ marginTop: 2 }}>
                      Metade da fatia recebe A, metade recebe B. O restante ({100 - fatia}%)
                      espera você olhar o placar e mandar a vencedora.
                    </div>
                  </div>
                )}

                <details style={{ marginTop: 18 }}>
                  <summary style={{ cursor: "pointer", color: "var(--texto2)" }}>
                    Ajustes avançados — remetente
                  </summary>
                  <div style={{ paddingTop: 10 }}>
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                      <div>
                        <label>Do nome</label>
                        <input value={deNome} onChange={(e) => setDeNome(e.target.value)} />
                      </div>
                      <div>
                        <label>Do e-mail</label>
                        <input value={deEmail} onChange={(e) => setDeEmail(e.target.value)} />
                      </div>
                    </div>
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
                  </div>
                </details>

                {rodapeNavegacao(
                  !!assunto.trim() && !!htmlMontado.trim() && (tipo !== "ab" || (!!assuntoB.trim() && !!htmlMontadoB.trim())),
                  () => setEtapa(3),
                  "Continuar →", faltaEtapa2,
                )}
              </div>

              {/* ---- prévia ao vivo + teste ---- */}
              <div>
                <div style={{ position: "sticky", top: 12 }}>
                  <div style={{
                    border: "1px solid var(--borda)", borderRadius: 12, padding: 14,
                    background: "var(--cartao, transparent)",
                  }}>
                    <b style={{ display: "block", marginBottom: 8 }}>Como vai chegar</b>
                    {htmlMontado ? (
                      <MiniPrevia html={previaAmostra(htmlMontado)} altura={tipo === "ab" ? 300 : 430}
                        aoAmpliar={() => setPreviaAmpla("a")} />
                    ) : (
                      <div className="sub" style={{ padding: "40px 10px", textAlign: "center" }}>
                        A prévia aparece aqui assim que você começar a escrever.
                      </div>
                    )}
                    {tipo === "ab" && htmlMontadoB && (
                      <>
                        <b style={{ display: "block", margin: "10px 0 6px" }}>Versão B</b>
                        <MiniPrevia html={previaAmostra(htmlMontadoB)} altura={210}
                          aoAmpliar={() => setPreviaAmpla("b")} />
                      </>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                      <input value={testePara} onChange={(e) => setTestePara(e.target.value)}
                        placeholder="e-mail para receber um teste" style={{ margin: 0, flex: 1 }} />
                      {tipo === "ab" && htmlMontadoB ? (
                        <>
                          <button disabled={testando || !testePara.trim() || !htmlMontado}
                            onClick={() => enviarTeste("a")} title="Envia a versão A para o endereço">
                            {testando ? "…" : "Testar A"}
                          </button>
                          <button disabled={testando || !testePara.trim()}
                            onClick={() => enviarTeste("b")} title="Envia a versão B para o endereço">
                            {testando ? "…" : "Testar B"}
                          </button>
                        </>
                      ) : (
                        <button disabled={testando || !testePara.trim() || !htmlMontado}
                          onClick={() => enviarTeste("a")}>
                          {testando ? "Enviando…" : "Enviar teste"}
                        </button>
                      )}
                    </div>
                    {testeMsg && (
                      <div style={{
                        marginTop: 8, padding: "8px 12px", borderRadius: 8,
                        fontSize: "calc(13px * var(--escala-texto))", lineHeight: 1.5,
                        border: `1px solid ${testeMsg.tom === "ok" ? "var(--verde)"
                          : testeMsg.tom === "erro" ? "var(--perigo)" : "var(--borda)"}`,
                        color: testeMsg.tom === "ok" ? "var(--verde)"
                          : testeMsg.tom === "erro" ? "var(--perigo)" : "var(--texto2)",
                        fontWeight: testeMsg.tom === "andamento" ? 400 : 600,
                      }}>
                        {testeMsg.tom === "ok" ? "✓ " : testeMsg.tom === "erro" ? "✗ " : "🕐 "}
                        {testeMsg.texto}
                      </div>
                    )}
                    <div className="sub" style={{ marginTop: 6, fontSize: "calc(11.5px * var(--escala-texto))" }}>
                      No teste, os links vão diretos ao destino; no envio real eles passam
                      pelo nosso domínio para contar os cliques.
                    </div>
                  </div>
                </div>

                {/* prévia em tamanho real — a rolagem é do cartão, então funciona */}
                {previaAmpla && (
                  <div onClick={() => setPreviaAmpla(null)}
                    style={{
                      position: "fixed", inset: 0, background: "rgba(12,4,18,.62)", zIndex: 120,
                      display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
                    }}>
                    <div onClick={(e) => e.stopPropagation()}
                      style={{
                        background: "var(--cartao, #fff)", borderRadius: 14, width: "min(680px, 96vw)",
                        maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
                        boxShadow: "0 18px 60px rgba(0,0,0,.45)",
                      }}>
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--borda)",
                      }}>
                        <b>Como vai chegar{tipo === "ab" ? (previaAmpla === "b" ? " — versão B" : " — versão A") : ""}</b>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {tipo === "ab" && !!htmlMontadoB && (
                            <>
                              <button className={previaAmpla === "a" ? "primario" : ""}
                                onClick={() => setPreviaAmpla("a")}>A</button>
                              <button className={previaAmpla === "b" ? "primario" : ""}
                                onClick={() => setPreviaAmpla("b")}>B</button>
                            </>
                          )}
                          <button onClick={() => setPreviaAmpla(null)} title="Fechar (Esc)">✕ Fechar</button>
                        </div>
                      </div>
                      <div style={{ overflow: "auto", background: "#eceaf1" }}>
                        <iframe title="prévia em tamanho real" scrolling="no"
                          sandbox="allow-same-origin"
                          srcDoc={previaAmostra(previaAmpla === "b" ? htmlMontadoB : htmlMontado)}
                          onLoad={(e) => {
                            // altura do conteúdo, para o cartão rolar o e-mail inteiro
                            try {
                              const d = e.currentTarget.contentDocument;
                              if (d) setAlturaAmpla(Math.max(400, d.documentElement.scrollHeight + 20));
                            } catch { /* sem medida, fica a altura de reserva */ }
                          }}
                          style={{
                            display: "block", width: 600, maxWidth: "100%", margin: "0 auto",
                            height: alturaAmpla, border: 0, pointerEvents: "none", background: "#fff",
                          }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : etapa === 3 ? (
          /* ---------------- etapa 3: quem recebe ---------------- */
          <div style={{ maxWidth: 860, margin: "0 auto" }}>
            <Passos />
            <Cartao titulo="Quem vai receber"
              sub="Só recebe quem está ativo e fora da supressão — o motor confere na hora do disparo.">
              <div className="linha" style={{ marginBottom: 10 }}>
                <button className={tipoAud === "listas" ? "primario" : ""} onClick={() => setTipoAud("listas")}>Por listas</button>
                <button className={tipoAud === "segmento" ? "primario" : ""} onClick={() => setTipoAud("segmento")}>Por segmento salvo</button>
              </div>

              {tipoAud === "listas" ? (
                <>
                  {listas.length > 8 && (
                    <input value={buscaLista} onChange={(e) => setBuscaLista(e.target.value)}
                      placeholder="🔎 buscar lista pelo nome…" style={{ marginBottom: 10 }} />
                  )}
                  {listasSel.length > 0 && (
                    <div className="sub" style={{ margin: "0 0 8px" }}>
                      {listasSel.length} lista{listasSel.length > 1 ? "s" : ""} selecionada{listasSel.length > 1 ? "s" : ""} —
                      quem estiver em mais de uma recebe uma vez só.
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {listasFiltradas.map((l) => {
                      const sel = listasSel.includes(l.lista_id);
                      return (
                        <button key={l.lista_id}
                          className={sel ? "primario" : ""}
                          onClick={() => setListasSel(sel
                            ? listasSel.filter((x) => x !== l.lista_id)
                            : [...listasSel, l.lista_id])}>
                          {sel ? "✓ " : ""}{l.nome}
                        </button>
                      );
                    })}
                    {!listasFiltradas.length && <span className="sub">nenhuma lista com esse nome</span>}
                  </div>
                </>
              ) : (
                <Escolher valor={segSel} aoMudar={setSegSel}
                  vazio="— escolher segmento (salve em Leads → 💾) —"
                  opcoes={segmentos.map((s) => ({ valor: s.segmento_id, rotulo: s.nome }))} />
              )}

              <div style={{
                marginTop: 14, padding: "12px 16px", borderRadius: 10,
                border: "1px solid var(--borda)", display: "flex", gap: 14, alignItems: "baseline",
              }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: "var(--marca)" }}>
                  {quantos === null ? "—" : quantos.toLocaleString("pt-BR")}
                </span>
                <span className="sub" style={{ margin: 0 }}>
                  pessoas hoje — sem repetições e já fora quem saiu ou está bloqueado.
                  É a mesma conta que o envio usa.
                </span>
              </div>
            </Cartao>

            {rodapeNavegacao(
              tipoAud === "listas" ? listasSel.length > 0 : !!segSel,
              () => setEtapa(4),
            )}
          </div>
        ) : (
          /* ---------------- etapa 4: revisar e enviar ---------------- */
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <Passos />

            <Cartao titulo="Confira antes de soltar">
              <div style={{ display: "grid", gap: 4, fontSize: "calc(13.5px * var(--escala-texto))" }}>
                <div><span className="sub" style={{ margin: 0 }}>Campanha · </span><b>{nome}</b>
                  {tipo === "ab" && <span className="etiqueta et-roxa" style={{ marginLeft: 8 }}>teste A/B · {fatia}%</span>}
                </div>
                <div><span className="sub" style={{ margin: 0 }}>De · </span>{deNome} &lt;{deEmail}&gt;</div>
                <div><span className="sub" style={{ margin: 0 }}>Assunto · </span>{assunto}
                  {tipo === "ab" && <span className="sub"> / B: {assuntoB}</span>}
                </div>
                <div><span className="sub" style={{ margin: 0 }}>Para · </span>
                  <b>{quantos === null ? "—" : quantos.toLocaleString("pt-BR")}</b> pessoas
                  {tipoAud === "listas"
                    ? ` em ${listasSel.length} lista${listasSel.length > 1 ? "s" : ""}`
                    : " do segmento escolhido"}
                </div>
              </div>
              <button style={{ marginTop: 12 }} onClick={() => setEtapa(2)}>← Ajustar a mensagem</button>
            </Cartao>

            {envioPausado && (
              <div style={{
                margin: "0 0 14px", padding: "10px 16px", borderRadius: 10,
                border: "1px solid var(--borda)", background: "var(--marca-fraca)",
                fontSize: "calc(13px * var(--escala-texto))",
              }}>
                ⏸ <b>O envio geral está pausado</b> — dá para enviar ou agendar, mas os e-mails
                ficam segurando na fila até liberar em Configurações → E-mail.
              </div>
            )}

            <Cartao titulo="Quando"
              sub="Deixe vazio para disparar manualmente. Agendado, o público é montado na hora marcada — quem entrar na lista até lá também recebe.">
              <input type="datetime-local" value={agendarEm} onChange={(e) => setAgendarEm(e.target.value)} />
              <div className="sub" style={{ marginTop: 6 }}>
                Horário de Brasília. O envio sai a ~100 e-mails por minuto (6 mil por hora).
              </div>
              {agendarEm && new Date(agendarEm).getTime() < Date.now() - 60_000 && (
                <div style={{ marginTop: 4, fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--perigo)" }}>
                  Essa data já passou — escolha um horário no futuro ou limpe o campo para enviar já.
                </div>
              )}
            </Cartao>

            <details style={{ marginBottom: 16 }}>
              <summary style={{ cursor: "pointer", color: "var(--texto2)" }}>
                Ajustes avançados — monitoramento e arquivo
              </summary>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", paddingTop: 12 }}>
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
              </div>
              {/* "Resposta" e "Arquivo público" saíram daqui de propósito:
                  eram interruptores de recursos que ainda não existem —
                  controle que não controla nada é mentira de interface */}
            </details>

            <div className="sub" style={{ margin: "0 0 16px" }}>
              Rodapé legal de todo e-mail: {endereco || "(configure o endereço em Configurações)"} · com
              link de descadastro automático.
            </div>

            {avisoRevisao.length > 0 && (
              <div style={{
                margin: "0 0 12px", padding: "10px 16px", borderRadius: 10,
                border: "1px solid var(--perigo)", fontSize: "calc(13px * var(--escala-texto))",
              }}>
                <b>Antes de seguir:</b>
                <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                  {avisoRevisao.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </div>
            )}
            {variaveisDesconhecidas().length > 0 && (
              <div className="sub" style={{ margin: "0 0 12px" }}>
                ⚠ Variáveis que o sistema não conhece e sairiam como texto cru:{" "}
                <b>{variaveisDesconhecidas().join(", ")}</b>. As reconhecidas são{" "}
                {"{{nome}}"}, {"{{nome_completo}}"}, {"{{email}}"} e {"{{campo.…}}"}.
              </div>
            )}

            <div className="linha" style={{ justifyContent: "space-between" }}>
              <button onClick={() => setEtapa(3)}>← Voltar</button>
              <div className="linha" style={{ margin: 0 }}>
                <button onClick={descartarAssistente}>Descartar</button>
                {/* com data preenchida, o caminho natural é AGENDAR — o botão
                    principal acompanha, e enviar já vira a exceção com pergunta */}
                <button className={agendarEm ? "primario" : ""} disabled={ocupado}
                  onClick={() => criar(false)}>
                  {ocupado ? "…" : agendarEm ? "Salvar e agendar" : "Salvar rascunho"}
                </button>
                {podeOperar
                  ? <button className={agendarEm ? "" : "primario"} disabled={ocupado}
                      onClick={() => criar(true)}>
                      {ocupado ? "…" : tipo === "ab" ? "Disparar o teste" : "Enviar agora"}
                    </button>
                  : <span className="sub" style={{ margin: 0 }}>Quem envia é a Terapeuta ou a Administradora.</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="caixa">
        {/* Dizer que a tela está viva é parte do trabalho: sem isso, quem
            olha um número parado não sabe se ele parou ou se a tela parou. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap", marginBottom: 12,
        }}>
          <span className="sub" style={{ margin: 0 }}>
            {semResposta
              ? <>⚠ Não consegui falar com o servidor na última tentativa — sigo tentando.
                  Os números abaixo são os de {horaDe(atualizadoEm)}.</>
              : quente
                ? <><span className="pulso-vivo" style={{ color: "var(--verde)" }}>●</span>{" "}
                    Acompanhando ao vivo: os números sobem sozinhos enquanto a fila sai.
                    Conferido às {horaDe(atualizadoEm)}.</>
                : <>Esta tabela se confere sozinha a cada minuto — a última foi
                    às {horaDe(atualizadoEm)}.</>}
          </span>
          <button onClick={() => reconferir(true)} disabled={conferindo}>
            {conferindo ? "Conferindo…" : "Atualizar agora"}
          </button>
        </div>
        <table>
          <thead><tr>
            <th>Campanha</th>
            <th>Status
              <Ajuda>
                <b>Rascunho</b> = nada saiu · <b>Agendada</b> = sai sozinha na hora marcada ·{" "}
                <b>Enviando</b> = a fila está saindo agora · <b>Enviada</b> = tudo entrou na fila ·{" "}
                <b>Pausada</b> / <b>Cancelada</b> = parada.
              </Ajuda>
            </th>
            <th>Quando<Ajuda>Agendada: a hora marcada para sair. Enviada: quando começou a sair. Tudo no horário de Brasília.</Ajuda></th>
            <th>Enviados<Ajuda>Quantos e-mails entraram na fila desta campanha. O “+ bloqueados” ao lado são as pessoas que estavam no público mas foram puladas por estarem na lista de bloqueio — aparecem de propósito: somem da conta, não do relatório. Se o servidor recusar algum envio, aparece “não entregues” em vermelho.</Ajuda></th>
            <th>Aberturas
              <Ajuda>
                Pessoas diferentes que abriram, não o total de aberturas. É medido por uma
                imagem de 1 pixel, então <b>subestima sempre</b>: quem lê com as imagens
                bloqueadas não é contado.
              </Ajuda>
            </th>
            <th>Cliques<Ajuda>Pessoas diferentes que clicaram em algum link. É a métrica mais confiável das três — clique não depende de imagem carregada. O detalhe por link está no Relatório.</Ajuda></th>
            <th>Devolvidos<Ajuda>E-mails que voltaram em definitivo (caixa inexistente, domínio errado). Entram sozinhos na lista de bloqueio para não serem tentados de novo — insistir é o que derruba a reputação do domínio.</Ajuda></th>
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
                <td><span className={`etiqueta ${STATUS[c.status] ?? "et-cinza"}`}>{STATUS_PT[c.status] ?? c.status}</span></td>
                <td style={{ whiteSpace: "nowrap", color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>
                  {c.status === "scheduled" && c.scheduled_at
                    ? new Date(c.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : c.started_at
                      ? new Date(c.started_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                </td>
                <td>{c.enviados}
                  {c.suprimidos > 0 && <span style={{ color: "var(--texto2)" }}> (+{c.suprimidos} bloqueados)</span>}
                  {c.nao_entregues > 0 && <span style={{ color: "var(--perigo)", fontWeight: 700 }}> · {c.nao_entregues} não entregues</span>}
                </td>
                <td>{c.aberturas_unicas}{c.enviados > 0 && c.aberturas_unicas > 0 &&
                  <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * c.aberturas_unicas / c.enviados)}%)</span>}</td>
                <td>{c.cliques_unicos}{c.enviados > 0 && c.cliques_unicos > 0 &&
                  <span style={{ color: "var(--texto2)" }}> ({Math.round(100 * c.cliques_unicos / c.enviados)}%)</span>}</td>
                <td>{c.hard_bounces}</td>
                <td>{c.descadastros}</td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  <button onClick={() => abrirRelatorio(c)}>Relatório</button>{" "}
                  {(c.status === "draft" || c.status === "scheduled" || c.status === "cancelled") &&
                    <button onClick={() => abrirCampanha(c, false)} title="Reabre no assistente para mexer">Abrir</button>}{" "}
                  <button onClick={() => abrirCampanha(c, true)} title="Cria uma cópia para editar">Duplicar</button>{" "}
                  {podeOperar && c.status === "scheduled" &&
                    <button onClick={() => cancelarAgendamento(c)}>Cancelar agendamento</button>}{" "}
                  {podeOperar && (c.status === "draft" || c.status === "scheduled") &&
                    <button onClick={() => dispararExistente(c)}>Enviar agora</button>}
                  {podeOperar && c.tipo === "ab" && !c.vencedor && c.enviados > 0 &&
                    <button onClick={() => abrirPlacar(c)}>Ver placar A/B</button>}
                </td>
              </tr>
            ))}
            {!stats.length && <tr><td colSpan={9} style={{ color: "var(--texto2)" }}>Nenhuma campanha ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ---- placar A/B: a decisão mais cara da ferramenta, num palco digno ---- */}
      {placarDe && (
        <div onClick={() => setPlacarDe(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(12,4,18,.58)", zIndex: 300,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--cartao, #fff)", borderRadius: 14, width: "min(560px, 94vw)",
              padding: "20px 22px", boxShadow: "0 18px 60px rgba(0,0,0,.4)",
            }}>
            <b style={{ fontSize: "calc(15.5px * var(--escala-texto))" }}>Placar do teste · {placarDe.nome}</b>
            {!placarDados && <div className="sub" style={{ margin: "14px 0" }}>carregando…</div>}
            {placarDados && (
              <>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", margin: "14px 0" }}>
                  {(["A", "B"] as const).map((k) => {
                    const v = placarDados[k] ?? { enviados: 0, aberturas: 0, cliques: 0 };
                    const pct = (n: number) => v.enviados ? `${Math.round(n * 100 / v.enviados)}%` : "—";
                    return (
                      <div key={k} style={{ border: "1px solid var(--borda)", borderRadius: 12, padding: "12px 14px" }}>
                        <b>Versão {k}</b>
                        <div className="sub" style={{ margin: "6px 0 0" }}>{v.enviados} enviados</div>
                        <div style={{ marginTop: 6, fontSize: "calc(14px * var(--escala-texto))" }}>
                          <b>{pct(v.aberturas)}</b> abriram · <b>{pct(v.cliques)}</b> clicaram
                        </div>
                        {podeOperar && (
                          <button className="primario" style={{ marginTop: 10, width: "100%" }}
                            onClick={() => mandarVencedor(placarDe.campanha_id, k)}>
                            Mandar a versão {k} ao restante
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="sub" style={{ margin: 0 }}>
                  Poucos envios? A diferença ainda pode ser sorte — o sistema não escolhe por
                  você. O clique costuma valer mais que a abertura.
                </div>
              </>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setPlacarDe(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {relDe && (
        <div className="gaveta" style={{ width: 620 }}>
          <button className="fechar" onClick={() => setRelDe(null)}>✕</button>
          <h2>Relatório · {relDe.nome}</h2>
          <div className="cartoes" style={{ marginTop: 12 }}>
            <div className="cartao"><div className="num">{relDe.enviados}</div><div className="rot">Enviados</div></div>
            <div className="cartao"><div className="num">{relDe.aberturas_unicas}</div><div className="rot">Aberturas</div></div>
            <div className="cartao"><div className="num">{relDe.cliques_unicos}</div><div className="rot">Cliques</div></div>
            {relDe.nao_entregues > 0 && (
              <div className="cartao"><div className="num" style={{ color: "var(--perigo)" }}>{relDe.nao_entregues}</div>
                <div className="rot">Não entregues</div></div>
            )}
          </div>
          {relErro && (
            <div className="sub" style={{ margin: "10px 0" }}>
              Não consegui carregar os eventos agora.{" "}
              <button onClick={() => abrirRelatorio(relDe)}>Tentar de novo</button>
            </div>
          )}
          {!rel && !relErro && <div className="sub">carregando eventos…</div>}
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
                <h2>Quem clicou ({rel.clicaram.length})
                  <Ajuda>
                    Nome por nome, com o link em que a pessoa clicou e a hora. É a lista
                    mais quente que esta tela produz: quem clica levantou a mão. Serve para
                    chamar no WhatsApp, montar público de anúncio ou jogar numa automação
                    de fechamento.
                  </Ajuda>
                </h2>
                {rel.clicaram.slice(0, 100).map((c) => (
                  <div key={c.email + c.url} style={{ padding: "3px 0", fontSize: "calc(13px * var(--escala-texto))" }}>
                    {c.email}
                    {c.vezes > 1 && <span className="etiqueta et-roxa" style={{ marginLeft: 6 }}>{c.vezes}×</span>}
                    <span style={{ color: "var(--texto2)" }}> · {new Date(c.quando).toLocaleString("pt-BR")}</span>
                    <div style={{ color: "var(--texto2)", fontSize: "calc(11.5px * var(--escala-texto))", wordBreak: "break-all" }}>{c.url}</div>
                  </div>
                ))}
                {rel.clicaram.length > 100 && <div className="sub">… e mais {rel.clicaram.length - 100}</div>}
                {!rel.clicaram.length && <span className="sub">ninguém clicou ainda</span>}
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
                  {rel.bounces.map((e) => <div key={e} style={{ fontSize: "calc(13px * var(--escala-texto))" }}><span className="etiqueta et-vermelha">devolvido</span> {e}</div>)}
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
