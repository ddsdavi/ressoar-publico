import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSessao } from "../lib/sessao";

type Passo = {
  id: string;
  // elemento destacado. Aceita uma lista: o primeiro que existir na tela vence
  // — com a barra da seção encolhida o link não está lá, e aí o ícone do rail
  // serve de plano B. Sem nenhum deles, o balão fica centralizado.
  sel?: string | string[];
  rota?: string;         // navega antes de mostrar
  emoji: string;
  titulo: string;
  texto?: string;
  itens?: { nome: string; descricao: string }[];   // lista com destaque (ex.: papéis)
  dica?: string;
  soAdmin?: boolean;
};

// A ordem é a da própria plataforma, de cima para baixo no rail: Visão geral,
// Contatos, Email, Produtos, Automações, Admin, Configurações. Quem terminar o
// passeio sabe onde procurar cada coisa porque andou pelo mesmo caminho que vai
// andar depois.
const PASSOS: Passo[] = [
  {
    id: "boas-vindas", emoji: "💜", titulo: "Boas-vindas ao Ressoar!",
    texto: "Esta é a plataforma que conversa com a sua base — no lugar do ActiveCampaign, e com os dados na sua mão. Vou te mostrar tela por tela: dá uns 3 minutinhos.",
    dica: "Pode sair quando quiser no ✕ e voltar depois pelo ❓ lá em cima. As setas ← → do teclado andam, e as bolinhas do rodapé pulam direto para um assunto.",
  },
  {
    id: "rail", sel: ".ac-rail", emoji: "🧭", titulo: "O caminho de tudo",
    texto: "Estas barras à esquerda organizam a plataforma: Visão geral, Contatos, Email, Produtos, Automações e — para quem é Admin — Admin e Configurações.",
    dica: "A barra branca ao lado mostra as páginas da área escolhida. A setinha ‹ encolhe essa barra quando você quiser mais espaço para a tabela; a escolha fica guardada para a próxima visita.",
  },
  {
    id: "papeis", emoji: "👥", titulo: "Quem faz o que por aqui",
    itens: [
      { nome: "Assistente", descricao: "PREPARA: cria leads, listas, tags e monta a campanha em rascunho. Não dispara e-mail, não mexe em automação e não exporta a base." },
      { nome: "Terapeuta", descricao: "PREPARA E DISPARA: faz tudo da operação, liga automação e é quem envia a campanha de verdade." },
      { nome: "Admin", descricao: "tudo isso + configurações, integrações, API/webhooks e liberação de usuários." },
    ],
    dica: "A lógica: quem prepara não precisa ser quem aperta enviar — disparo para milhares de pessoas não tem desfazer. E as regras valem no banco: ninguém contorna o próprio nível, nem por fora do sistema.",
  },

  /* ---------------- Visão geral ---------------- */
  {
    id: "inicio", rota: "/", sel: [".ac-sidebar a[href='/']", ".ac-rail a[href='/']"],
    emoji: "📊", titulo: "Visão geral",
    texto: "A primeira tela responde “está tudo andando?”: o tamanho da base, quantas inscrições estão ativas, quantos e-mails já saíram e quantas automações estão ligadas agora.",
    dica: "A tabela de baixo é o motor trabalhando. Evento com “na fila” só quer dizer que ainda não chegou a vez dele — o motor roda a cada minuto.",
  },

  /* ---------------- Contatos ---------------- */
  {
    id: "leads", rota: "/leads", sel: [".ac-sidebar a[href='/leads']", ".ac-rail a[href='/leads']"],
    emoji: "🌱", titulo: "Leads",
    texto: "Toda a base fica aqui. Filtre por lista, tag, status e WhatsApp, e clique em qualquer pessoa para ver a linha do tempo dela: listas, tags, e-mails recebidos, aberturas, cliques, compras e as anotações do time.",
    dica: "A coluna Pontos é o engajamento de cada pessoa. Serve para separar quem acompanha de quem nunca abriu — mandar sempre para todo mundo é o que estraga a reputação do domínio.",
  },
  {
    id: "segmentos", rota: "/leads", emoji: "🧩", titulo: "Segmentos e ações em massa",
    texto: "Os filtros de cima podem virar um segmento salvo (💾) e ser usados direto na campanha. O 🧩 Segmento avançado combina quantas condições quiser — comprou, não comprou, abriu nos últimos 30 dias, tem tal campo preenchido.",
    dica: "A ação em massa vale para quem estiver marcado; sem ninguém marcado, ela vale para o filtro inteiro. A confirmação sempre diz qual dos dois está em jogo — é a diferença entre 3 pessoas e 11 mil.",
  },
  {
    id: "listas-tags", rota: "/listas", sel: [".ac-sidebar a[href='/listas']", ".ac-rail a[href='/leads']"],
    emoji: "🗂️", titulo: "Listas e Tags",
    texto: "Listas são os públicos e eventos — é para elas que a campanha vai. Tags são marcadores que você aplica nas pessoas. Clique no nome ou na quantidade para ver os leads de cada uma.",
    dica: "Entrar numa lista ou ganhar uma tag é justamente o que dispara as automações. Em Tags existe o Mesclar, que junta duplicatas como CADASTRADOS e CADASTRADO sem quebrar as automações que usavam a antiga.",
  },
  {
    id: "campos", rota: "/campos", sel: [".ac-sidebar a[href='/campos']", ".ac-rail a[href='/leads']"],
    emoji: "🧾", titulo: "Campos",
    texto: "É a informação extra que cada contato carrega: origem do cadastro, UTM, respostas de formulário, datas. Aqui você dá nome legível a cada uma delas.",
    dica: "Todo campo vira variável no e-mail ({{campo.origem}}) e vira filtro no segmento avançado. Campo vazio naquela pessoa sai vazio, nunca aparece cru no texto.",
  },
  {
    id: "formularios", rota: "/formularios", sel: [".ac-sidebar a[href='/formularios']", ".ac-rail a[href='/leads']"],
    emoji: "📝", titulo: "Formulários",
    texto: "Captação hospedada aqui mesmo. Você escolhe em que lista a pessoa entra e que tag ela ganha, e publica: ou como página pronta (/f/nome), ou colando um bloco de código no seu site.",
    dica: "A lista e a tag ficam guardadas no formulário, nunca vêm da página — assim ninguém consegue, chamando o endereço por fora, inscrever gente numa lista que não deveria tocar.",
  },
  {
    id: "envios", rota: "/envios", sel: [".ac-sidebar a[href='/envios']", ".ac-rail a[href='/leads']"],
    emoji: "📬", titulo: "Envios e exclusões",
    texto: "A fila de e-mails, o que foi entregue e a lista de supressão — quem nunca mais recebe disparo. Bounces e reclamações de spam entram aqui sozinhos.",
    dica: "Isso não é burocracia: acima de 0,1% de reclamação de spam, o Gmail começa a mandar tudo o que você envia direto para o lixo. A supressão é o que protege o seu domínio.",
  },
  {
    id: "dados", rota: "/dados", sel: [".ac-sidebar a[href='/dados']", ".ac-rail a[href='/leads']"],
    emoji: "📦", titulo: "Importações e exportações",
    texto: "Tudo o que entrou e saiu da base, com autor, data e resultado. Importação mostra quantos entraram, quantos foram atualizados e quantas linhas caíram fora.",
    dica: "Exportar é levar dado pessoal de milhares de pessoas para fora do sistema — por isso fica registrado, e o arquivo gerado expira em 7 dias.",
  },
  {
    id: "relatorios", rota: "/relatorios", sel: [".ac-sidebar a[href='/relatorios']", ".ac-rail a[href='/leads']"],
    emoji: "📈", titulo: "Relatórios",
    texto: "Os números da operação, calculados no banco na hora: crescimento da base, de onde vem o dinheiro, estatística por tag e por campo.",
    dica: "Na aba “De onde vem o dinheiro”, o primeiro número é a cobertura: quantas compras têm origem conhecida. O ranking fala só dessa fatia — o Meta mostra clique, isto mostra quanto cada origem trouxe em reais.",
  },
  {
    id: "prontos", rota: "/leadscoring?aba=venda", sel: [".ac-sidebar a[href='/leadscoring']", "[data-tour='aba-venda']"],
    emoji: "🎯", titulo: "Lead scoring",
    texto: "Vendas é uma coisa, engajamento com e-mail é outra — então cada lead tem DOIS números, e esta página mostra as duas réguas. A de venda (0 a 100) olha só compras: quanto mais recente e maior o gasto, mais alto, e ela derrete com o tempo. Junto vai a próxima oferta: o degrau da esteira que faz sentido oferecer agora. A régua de engajamento (a outra aba) diz por quem começar a enviar.",
    itens: [
      { nome: "Faixas por percentil", descricao: "Prontíssimo é sempre o top 5% da base alcançável — a régua se recalibra sozinha e nunca satura." },
      { nome: "Jogadas", descricao: "públicos prontos da esteira (janela quente, segunda chamada, aluno → Black…), contados ao vivo, com botão que vira segmento." },
      { nome: "Melhores leads", descricao: "o top 50 ranqueado, cada um com o PORQUÊ do número — nenhum score é caixa preta." },
    ],
    dica: "A conta é do seu próprio histórico: 79% de quem chegou à Formação comprou um produto de entrada antes, e converte em 6 a 11 dias. Crie o segmento da jogada e dispare a campanha para ele — a lista se atualiza sozinha a cada compra.",
  },

  /* ---------------- Email ---------------- */
  {
    id: "campanhas", rota: "/campanhas", sel: [".ac-sidebar a[href='/campanhas']", ".ac-rail a[href='/campanhas']"],
    emoji: "📣", titulo: "Campanhas",
    texto: "O disparo pontual: você escreve o e-mail ali mesmo, escolhe quem recebe (listas ou um segmento salvo) e envia ou agenda. O contador mostra o tamanho do público antes de qualquer coisa sair.",
    dica: "Tem teste A/B: manda duas versões para uma fatia da base, você olha o placar e só depois manda a vencedora para o restante. Assistente monta e deixa em rascunho; quem dispara é a Terapeuta ou a Admin. Os resultados de todas as campanhas ficam na tabela do fim desta mesma página.",
  },
  {
    id: "mensagens", rota: "/mensagens", sel: [".ac-sidebar a[href='/mensagens']", ".ac-rail a[href='/campanhas']"],
    emoji: "✉️", titulo: "Mensagens",
    texto: "A biblioteca de e-mails — inclusive os que vieram do ActiveCampaign. É de onde as automações puxam o que enviar, e tem editor visual de arrastar e soltar para criar novos sem saber nada de código.",
    dica: "Use {{nome}} no assunto ou no texto para chamar cada pessoa pelo primeiro nome. O “texto de prévia” é o que aparece ao lado do assunto na caixa de entrada — depois do assunto, é o que mais mexe na abertura.",
  },

  /* ---------------- Produtos ---------------- */
  {
    id: "vendas", rota: "/vendas", sel: [".ac-sidebar a[href='/vendas']", ".ac-rail a[href='/vendas']"],
    emoji: "🛒", titulo: "Produtos e vendas",
    texto: "A Hotmart avisa o Ressoar a cada compra — é uma configuração só, para a conta inteira. O que muda de produto para produto é o depois: em que lista a pessoa entra, que tag ganha, se é marcada no ManyChat.",
    dica: "Produto sem regra não se perde: a compra fica registrada em “Eventos recebidos”, só não acontece nada com quem comprou. E reembolso não apaga a venda — ela fica com o status trocado e a pessoa sai sozinha dos segmentos de comprador.",
  },

  /* ---------------- Automações ---------------- */
  {
    id: "automacoes", rota: "/automacoes", sel: [".ac-sidebar a[href='/automacoes']", ".ac-rail a[href='/automacoes']"],
    emoji: "⚙️", titulo: "Automações",
    texto: "O que acontece sozinho: alguém entra numa lista ou ganha uma tag, e a plataforma envia e-mail, aplica tag, espera dias, marca a pessoa no ManyChat, escreve numa planilha ou avisa outro sistema.",
    dica: "Cada fluxo se monta arrastando caixinhas. Automação nova nasce desligada de propósito — só passa a disparar quando você marcar Ativa e salvar.",
  },
  {
    id: "manychat", rota: "/manychat", sel: [".ac-sidebar a[href='/manychat']", ".ac-rail a[href='/automacoes']"],
    emoji: "💬", titulo: "ManyChat",
    texto: "A ponte com o WhatsApp e o Instagram. Aqui você procura uma pessoa pelo número, vê as tags dela dos dois lados e testa a regra de um produto inteira, passo a passo, sem precisar de uma compra real.",
    dica: "Lá a pessoa é encontrada pelo WhatsApp, não pelo e-mail — quem chega pelo direct costuma não ter e-mail nenhum. E a tag precisa existir no ManyChat antes: é ela que dispara o fluxo de lá.",
    soAdmin: true,
  },

  /* ---------------- Admin ---------------- */
  {
    id: "usuarios", rota: "/usuarios", sel: [".ac-sidebar a[href='/usuarios']", ".ac-rail a[href='/usuarios']"],
    emoji: "🛡️", titulo: "Usuários e segurança",
    texto: "Quem está cadastrado, quem acabou de se inscrever e o nível de cada pessoa. Tem uma tabela mostrando exatamente o que cada nível pode fazer, e ao lado fica o registro de segurança das contas.",
    dica: "Cadastro novo nasce como Assistente e pendente: ninguém entra antes de você liberar. Contas marcadas com 🔒 permanente não podem ser rebaixadas nem excluídas por ninguém.",
    soAdmin: true,
  },
  {
    id: "config", rota: "/config", sel: [".ac-sidebar a[href='/config']", ".ac-rail a[href='/config']"],
    emoji: "🔧", titulo: "Configurações",
    texto: "Quatro abas: E-mail (provedor, remetente, aparência das mensagens e as travas de envio), ManyChat, Planilhas do Google e API e webhooks.",
    dica: "É onde ficam os dois botões de pânico: “pausar todo envio”, que segura a fila sem perder nada, e o “só enviar para”, que faz a campanha inteira chegar apenas nos endereços que você listar. O 🔒 na aba avisa quando essa trava está ligada.",
    soAdmin: true,
  },

  /* ---------------- pessoal ---------------- */
  {
    id: "aparencia", sel: ".escala-grupo", emoji: "🔠", titulo: "A tela do seu jeito",
    texto: "Cinco tamanhos de letra — o número mostra em qual você está, e só o texto cresce: o resto da tela continua no lugar. Ao lado, o ☀ / 🌙 escolhe entre claro, escuro ou o mesmo do seu aparelho.",
    dica: "A plataforma lembra das duas escolhas no próximo acesso, neste computador.",
  },
  {
    id: "conta", sel: ".menu-conta", emoji: "👤", titulo: "Sua conta",
    texto: "Aqui ficam sua foto, seu nome, seu e-mail e sua senha — e é por aqui que você sai da plataforma.",
    dica: "Trocar de e-mail exige a sua senha e um código enviado para o e-mail atual. Sem esse código, o acesso não muda de dono.",
  },
  {
    id: "fim", emoji: "🚀", titulo: "Pronto para começar!",
    texto: "É isso. Ao longo das telas, todo ❔ redondo abre a explicação daquele campo — clique sem medo, ele não muda nada.",
    dica: "Para rever este passeio inteiro, é só clicar no ❓ lá em cima, a qualquer momento.",
  },
];

export default function Tour({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { ehAdmin } = useSessao();
  const navegar = useNavigate();
  const [i, setI] = useState(0);
  const [alvo, setAlvo] = useState<DOMRect | null>(null);
  const balao = useRef<HTMLDivElement>(null);
  // altura real do balão. Um chute fixo funcionava enquanto os textos eram
  // curtos; com passo de lista longa ele saía pela borda de baixo.
  const [altura, setAltura] = useState(300);

  const passos = PASSOS.filter((p) => !p.soAdmin || ehAdmin);
  const passo = passos[i];

  // "Existe no DOM" não basta. Com a barra da seção encolhida ela vira
  // width:0 + overflow:hidden e recebe `inert` — os links continuam medindo
  // alguma coisa, e o destaque ia parar num retângulo vazio ao lado do rail.
  const visivel = (el: Element) => {
    if (el.closest("[inert]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    return r.bottom > 0 && r.top < window.innerHeight
      && r.right > 0 && r.left < window.innerWidth;
  };

  const medir = useCallback(() => {
    if (!passo?.sel) { setAlvo(null); return; }
    const seletores = Array.isArray(passo.sel) ? passo.sel : [passo.sel];
    for (const s of seletores) {
      const el = document.querySelector(s);
      if (el && visivel(el)) { setAlvo(el.getBoundingClientRect()); return; }
    }
    setAlvo(null);
  }, [passo]);

  useEffect(() => {
    if (!aberto || !passo) return;
    if (passo.rota) navegar(passo.rota);
    // remede algumas vezes: a página pode terminar de montar depois da navegação
    const t = setTimeout(medir, 120);
    const t2 = setTimeout(medir, 420);
    const t3 = setTimeout(medir, 900);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      clearTimeout(t); clearTimeout(t2); clearTimeout(t3);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [aberto, i, passo, medir, navegar]);

  useLayoutEffect(() => {
    const h = balao.current?.offsetHeight;
    if (h && Math.abs(h - altura) > 4) setAltura(h);
  });

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowRight") avancar();
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  if (!aberto || !passo) return null;

  function fechar() {
    localStorage.setItem("ressoa-tour-visto", "1");
    setI(0);
    aoFechar();
  }
  function avancar() {
    if (i + 1 >= passos.length) fechar();
    else setI(i + 1);
  }

  const p = 10;
  const recorte = alvo
    ? `polygon(0 0,100% 0,100% 100%,0 100%,0 0,
        ${alvo.left - p}px ${alvo.top - p}px,
        ${alvo.right + p}px ${alvo.top - p}px,
        ${alvo.right + p}px ${alvo.bottom + p}px,
        ${alvo.left - p}px ${alvo.bottom + p}px,
        ${alvo.left - p}px ${alvo.top - p}px)`
    : undefined;

  // posiciona o balão perto do alvo — e NUNCA deixa sair da tela
  const vw = window.innerWidth, vh = window.innerHeight;
  const larguraBalao = Math.min(460, vw - 32);
  const margem = 16, folga = 18;
  let estilo: React.CSSProperties;

  if (!alvo) {
    estilo = { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  } else {
    const espacoAbaixo = vh - alvo.bottom;
    const espacoAcima = alvo.top;
    const espacoDireita = vw - alvo.right;
    const espacoEsquerda = alvo.left;
    let topo: number, esq: number;

    if (espacoAbaixo >= altura + folga) {
      // cabe embaixo do alvo
      topo = alvo.bottom + folga;
      esq = alvo.left + alvo.width / 2 - larguraBalao / 2;
    } else if (espacoAcima >= altura + folga) {
      // cabe acima do alvo
      topo = alvo.top - folga - altura;
      esq = alvo.left + alvo.width / 2 - larguraBalao / 2;
    } else if (espacoDireita >= larguraBalao + folga) {
      // alvo alto (ex.: a barra lateral): põe ao lado direito
      esq = alvo.right + folga;
      topo = alvo.top + alvo.height / 2 - altura / 2;
    } else if (espacoEsquerda >= larguraBalao + folga) {
      esq = alvo.left - folga - larguraBalao;
      topo = alvo.top + alvo.height / 2 - altura / 2;
    } else {
      // sem espaço em lugar nenhum: centraliza
      esq = (vw - larguraBalao) / 2;
      topo = (vh - altura) / 2;
    }

    // trava dentro da tela, sempre
    esq = Math.max(margem, Math.min(esq, vw - larguraBalao - margem));
    topo = Math.max(margem, Math.min(topo, Math.max(margem, vh - altura - margem)));
    estilo = { top: topo, left: esq };
  }

  return (
    <div className="tour">
      <div className="tour-mascara" style={recorte ? { clipPath: recorte } : undefined} onClick={fechar} />
      {alvo && (
        <div className="tour-brilho" style={{
          top: alvo.top - p, left: alvo.left - p,
          width: alvo.width + p * 2, height: alvo.height + p * 2,
        }} />
      )}
      <div className="tour-balao" ref={balao} style={{ ...estilo, width: larguraBalao }}>
        <div className="tour-topo">
          <span className="tour-emoji">{passo.emoji}</span>
          <b>{passo.titulo}</b>
          <button className="tour-x" onClick={fechar} title="Fechar">✕</button>
        </div>
        {passo.texto && <p>{passo.texto}</p>}
        {passo.itens && (
          <ul className="tour-itens">
            {passo.itens.map((it) => (
              <li key={it.nome}>
                <b>{it.nome}</b> {it.descricao}
              </li>
            ))}
          </ul>
        )}
        {passo.dica && <div className="tour-dica">💡 {passo.dica}</div>}
        <div className="tour-rodape">
          <div className="tour-pontos">
            {passos.map((x, n) => (
              <span key={x.id} title={x.titulo} className={n === i ? "on" : n < i ? "feito" : ""}
                onClick={() => setI(n)} />
            ))}
          </div>
          <div className="tour-botoes">
            {i > 0 && <button onClick={() => setI(i - 1)}>Voltar</button>}
            <button className="primario" onClick={avancar}>
              {i + 1 >= passos.length ? "Começar a usar" : "Avançar"}
            </button>
          </div>
        </div>
        <div className="tour-contador">{i + 1} de {passos.length}</div>
      </div>
    </div>
  );
}

export function tourJaVisto() {
  return localStorage.getItem("ressoa-tour-visto") === "1";
}
