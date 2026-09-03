import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSessao } from "../lib/sessao";
import { TITULO } from "../lib/marca";
import ControlesAparencia from "../components/ControlesAparencia";
import "../landing.css";

// A página que um visitante vê na raiz do domínio. Quem está logado nem passa
// por aqui (a raiz segue direto para o painel); quem chega de fora — quase
// sempre alguém que recebeu um e-mail e veio olhar o domínio do link — encontra
// a explicação do que é a Ressoar e a porta de entrada da equipe.
//
// A página não nomeia ninguém da operação: fala de "esta operação" e pronto.
// O crédito de quem construiu (no rodapé e no FAQ) é a única assinatura.

const INSTAGRAM_CRIADOR = "https://www.instagram.com/davidamascenos";
// O botão de conversa da faixa final abre o WhatsApp já com a primeira
// mensagem escrita — quem chega diz de onde veio sem digitar nada.
const WHATSAPP_CRIADOR =
  "https://wa.me/5561999701605?text=" +
  encodeURIComponent("Olá! Vi a página da Ressoar e quero saber mais.");

function Logo({ tamanho = 24 }: { tamanho?: number }) {
  // O desenho vive na metade direita do quadrado 32×32 original (x de ~11 a
  // ~31); o viewBox corta o vazio da esquerda para o símbolo — e a palavra ao
  // lado — encostarem na margem, alinhados com o que estiver embaixo.
  return (
    <svg width={(tamanho * 21) / 32} height={tamanho} viewBox="10.8 0 21 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="4" fill="currentColor" />
      <path d="M16 6a10 10 0 0 1 0 20M16 2a14 14 0 0 1 0 28"
        stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Ondas() {
  return (
    <div className="lp-ondas" aria-hidden="true">
      <span /><span /><span /><span />
    </div>
  );
}

const EVENTOS_MOTOR = [
  { hora: "22:45", evento: "lista_inscrita", cor: "", quem: "ana@exemplo.com" },
  { hora: "22:46", evento: "tag_adicionada", cor: "", quem: "bruno@exemplo.com" },
  { hora: "22:48", evento: "compra_aprovada", cor: "lp-motor-evento--verde", quem: "clara@exemplo.com" },
  { hora: "22:51", evento: "lead_criado", cor: "", quem: "diego@exemplo.com" },
  { hora: "22:53", evento: "pagamento_atrasado", cor: "lp-motor-evento--ambar", quem: "elisa@exemplo.com" },
];

const PASSOS = [
  ["O lead chega", "Por um formulário, uma importação, o WhatsApp ou uma compra — e entra na base com a origem registrada na ficha."],
  ["O motor reage", "A automação certa acorda na hora: dá as boas-vindas, aplica a tag, avisa um webhook, atualiza a planilha."],
  ["A campanha sai", "O disparo respeita lista, supressão e descadastro — e sai do motor próprio, no domínio da própria operação."],
  ["O resultado volta", "Abertura, clique, resposta e venda voltam para a ficha do lead, para o lead scoring e para os relatórios."],
] as const;

const PERGUNTAS: Array<[string, ReactNode]> = [
  ["O que é a Ressoar?",
    "A plataforma de e-mail marketing em casa própria: base de leads, listas, tags, campanhas, automações, formulários, lead scoring, vendas e relatórios — tudo no banco de quem usa. Nasceu dentro de uma operação real e se instala sob medida para cada operação que a adota."],
  ["Por que sair de uma plataforma alugada?",
    "Três motivos: o aluguel por contato subia junto com a base; os dados moravam na plataforma dos outros; e cada aprimoramento dependia do que a ferramenta deixava fazer. Na casa própria, o custo é o de infraestrutura, o banco é da operação e as funções nascem do tamanho exato da necessidade."],
  ["O que a Ressoar tem que o aluguel não tinha?",
    "O que a operação sempre quis e não dava para pedir: disparo imediato pela API oficial do WhatsApp via ManyChat — ou outra ferramenta similar, à escolha — sem n8n nem intermediário; a venda da Hotmart (ou similar) como evento nativo do motor, do carrinho abandonado à compra aprovada; atribuição de campanha fechada dentro de casa; envio a preço de custo na infraestrutura própria — e nenhuma função alugada que ninguém usa."],
  ["A Ressoar se integra com outras ferramentas?",
    "Sim — por desenho. Webhooks e API conectam a plataforma ao que cada operação já usa: ManyChat ou similar no WhatsApp, Hotmart ou similar nas vendas, planilhas e o que mais fizer sentido. A integração se adapta à operação de quem usa — sob medida, não por catálogo fechado."],
  ["Como foi a migração?",
    "Por inteiro e sem apagar a luz: a conta real foi varrida e estudada, os leads vieram com o histórico de listas, tags e campos, as automações atravessaram a mudança ligadas e o envio só trocou de motor quando a casa nova já respondia. Zero minutos fora do ar."],
  ["Por que recebi um e-mail enviado por aqui?",
    "Porque o seu endereço entrou na base por um cadastro seu — um formulário preenchido, uma inscrição em evento ou uma compra. A origem fica registrada na sua ficha, e todo e-mail sai com o caminho de saída no rodapé."],
  ["O que acontece quando clico em descadastrar?",
    "O motor registra a saída na hora: você entra na lista de não-envio, as campanhas param de te enxergar e as automações também. Não tem etapa manual nem espera — e ninguém pergunta o porquê."],
  ["Posso pedir acesso ao painel?",
    "O painel é da equipe da operação, e o cadastro aberto fica fechado: conta nova é criada e liberada por quem administra. Se você é da equipe, peça o acesso a um admin."],
  ["Quem construiu a Ressoar?",
    <>Davi Damasceno (<a href={INSTAGRAM_CRIADOR} target="_blank" rel="noreferrer">@davidamascenos</a>),
      sob medida para a operação que a usa — função por função, a partir de uma
      varredura completa de uma operação real.</>],
];

export default function Landing() {
  const { sessao } = useSessao();

  useEffect(() => {
    document.title = "Ressoar — e-mail marketing em casa própria";
    const html = document.documentElement;
    const rolagemAntes = html.style.scrollBehavior;
    html.style.scrollBehavior = "smooth";
    // enquanto a landing vive, a página corta rolagem lateral (ver landing.css)
    html.classList.add("lp-pagina");
    return () => {
      document.title = TITULO;
      html.style.scrollBehavior = rolagemAntes;
      html.classList.remove("lp-pagina");
    };
  }, []);

  // A porta certa muda com a sessão: visitante vai para a tela de entrada,
  // quem já está logado volta direto para a área de trabalho.
  const portaRotulo = sessao ? "Abrir minha área" : "Entrar na minha área";
  const portaDestino = sessao ? "/" : "/entrar";

  return (
    <div className="lp">
      <header className="lp-topo">
        <div className="lp-envelope lp-topo-linha">
          <a className="lp-logo" href="#inicio"><Logo /> <span className="lp-logo-nome">Ressoar</span></a>
          <nav aria-label="Seções da página">
            <a href="#plataforma">A plataforma</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#recebeu">Recebeu um e-mail?</a>
            <a href="#perguntas">Perguntas</a>
          </nav>
          <div className="lp-topo-acoes">
            <ControlesAparencia />
            <Link className="lp-botao lp-botao--primario lp-botao--topo" to={portaDestino}>
              {sessao ? "Minha área" : "Entrar"}
            </Link>
          </div>
        </div>
      </header>

      <section className="lp-heroi" id="inicio">
        <Ondas />
        <div className="lp-envelope lp-heroi-grade">
          <div>
            <span className="lp-pilula"><i />E-mail marketing em casa própria</span>
            {/* o nowrap impede a quebra feia no hífen ("e-" / "mail") */}
            <h1>A casa própria do <em><span style={{ whiteSpace: "nowrap" }}>e-mail</span> marketing</em>.</h1>
            <p className="lp-heroi-sub">
              A Ressoar é onde a sua operação guarda a base, escreve as
              campanhas e deixa as automações de plantão — leads, listas, tags,
              envios e vendas num lugar só, na sua infraestrutura, longe do
              aluguel por contato.
            </p>
            <p className="lp-heroi-nota">
              Nascida de uma operação real — cada função varrida, estudada e
              reconstruída peça por peça.
            </p>
            <a className="lp-heroi-atalho" href="#recebeu">
              Recebeu um e-mail enviado pela Ressoar? Veja o que isso significa ↓
            </a>
          </div>

          <div className="lp-motor" role="img"
            aria-label="Mini-tela do painel mostrando os últimos eventos do motor sendo processados">
            <div className="lp-motor-topo">
              <span style={{ color: "#C77FD6", display: "flex" }}><Logo tamanho={16} /></span>
              Últimos eventos do motor
              <span className="lp-motor-led"><i />no ar</span>
            </div>
            <div className="lp-motor-corpo">
              {EVENTOS_MOTOR.map((e) => (
                <div className="lp-motor-linha" key={e.hora}>
                  <span className="lp-motor-hora">{e.hora}</span>
                  <span className={`lp-motor-evento ${e.cor}`}>{e.evento}</span>
                  <span className="lp-motor-quem">{e.quem}</span>
                  <span className="lp-motor-ok">✓ sim</span>
                </div>
              ))}
              <div className="lp-motor-espera">aguardando o próximo evento<i /></div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-numeros">
        <div className="lp-envelope">
          <div className="lp-centro">
            <h2 className="lp-titulo-secao">Por que trocar o aluguel por uma casa própria?</h2>
            <p className="lp-sub-secao">
              A primeira Ressoar nasceu assim: uma operação inteira morava numa
              plataforma alugada, e a mudança trouxe tudo — deixando lá o que
              era o problema.
            </p>
          </div>
          <div className="lp-stats">
            <div className="lp-stat lp-stat--lilas">
              <b>24<sup>/7</sup></b>
              <span>de motor de plantão: inscrição, tag e compra respondidas na hora, sem ninguém precisar estar acordado.</span>
            </div>
            <div className="lp-stat lp-stat--ambar">
              <b>0<sup>&thinsp;min</sup></b>
              <span>fora do ar na mudança: as automações atravessaram a troca de plataforma ligadas.</span>
            </div>
            <div className="lp-stat lp-stat--noite">
              <b>R$&thinsp;0</b>
              <span>de mensalidade por contato. O envio sai a preço de custo, pela infraestrutura da própria operação.</span>
            </div>
            <div className="lp-stat lp-stat--verde">
              <b>100<sup>%</sup></b>
              <span>dos dados em casa: banco próprio, auditável e exportável — sem pedir licença a ninguém.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-plataforma" id="plataforma">
        <div className="lp-envelope">
          <div className="lp-centro">
            <h2 className="lp-titulo-secao">Toda a operação de e-mail, num lugar só.</h2>
            <p className="lp-sub-secao">
              Campanhas, automações, segmentação, base, lead scoring, vendas,
              formulários e WhatsApp — as telas abaixo são as mesmas em que uma
              operação de verdade trabalha todo dia.
            </p>
          </div>

          <div className="lp-recursos">
            <article className="lp-recurso">
              <div className="lp-recurso-texto">
                <span className="lp-recurso-rotulo">Campanhas e mensagens</span>
                <h3>Escreva uma vez, dispare com critério.</h3>
                <p>
                  A biblioteca guarda cada e-mail completo — remetente, assunto e
                  HTML — pronto para reusar. A campanha escolhe a audiência por
                  lista, tag ou segmento, respeita a supressão e agenda o
                  disparo. Quem já saiu da base nunca mais recebe.
                </p>
              </div>
              <div className="lp-tela" aria-hidden="true">
                <div className="lp-tela-topo"><i /><i /><i /><span>Nova campanha</span></div>
                <div className="lp-tela-corpo">
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-titulo">Convite da aula ao vivo</div>
                    <div className="lp-tela-mudo">Assunto: “Amanhã, 20h — o link é este”</div>
                  </div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">Audiência</div>
                    <span className="lp-tag">Lista · Aula ao vivo</span>
                    <span className="lp-tag lp-tag--verde">Tag · Confirmados</span>
                    <span className="lp-tag lp-tag--cinza">– supressão</span>
                  </div>
                  <div className="lp-tela-botao">Agendar o disparo</div>
                </div>
              </div>
            </article>

            <article className="lp-recurso">
              <div className="lp-recurso-texto">
                <span className="lp-recurso-rotulo">Automações</span>
                <h3>O motor escuta os eventos e responde sozinho.</h3>
                <p>
                  Entrou na lista, ganhou a tag, comprou, atrasou o pagamento:
                  cada evento acorda a automação certa, que envia o e-mail,
                  marca o lead, avisa um webhook ou atualiza a planilha — de
                  madrugada, no feriado, sem ninguém no meio. As automações que
                  nasceram antes da mudança atravessaram a troca e continuam no ar.
                </p>
              </div>
              <div className="lp-tela" aria-hidden="true">
                <div className="lp-tela-topo"><i /><i /><i /><span>Automação · Boas-vindas</span></div>
                <div className="lp-tela-corpo">
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-passo"><i>⚡</i>
                      <div><div className="lp-tela-titulo">Gatilho: entrou na lista</div>
                        <div className="lp-tela-mudo">Aula ao vivo</div></div>
                    </div>
                  </div>
                  <div className="lp-tela-seta">↓</div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-passo"><i>1</i>
                      <div><div className="lp-tela-titulo">Enviar e-mail de boas-vindas</div></div>
                    </div>
                  </div>
                  <div className="lp-tela-seta">↓</div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-passo"><i>2</i>
                      <div><div className="lp-tela-titulo">Aplicar a tag “Confirmados”</div>
                        <div className="lp-tela-mudo">e avisar o webhook da planilha</div></div>
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <article className="lp-recurso">
              <div className="lp-recurso-texto">
                <span className="lp-recurso-rotulo">Segmentação e personalização</span>
                <h3>Cada mensagem para quem ela faz sentido.</h3>
                <p>
                  A audiência se desenha combinando lista, tag e segmento — o
                  que o lead é e o que ele fez. E cada e-mail preenche os campos
                  da ficha na hora do envio: quem recebe lê o próprio nome e o
                  próprio contexto, não um modelo genérico.
                </p>
              </div>
              <div className="lp-tela" aria-hidden="true">
                <div className="lp-tela-topo"><i /><i /><i /><span>Segmento · Quentes da aula</span></div>
                <div className="lp-tela-corpo">
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">Condições</div>
                    <span className="lp-tag">Lista · Aula ao vivo</span>
                    <span className="lp-tag lp-tag--verde">Tag · Confirmados</span>
                    <span className="lp-tag lp-tag--cinza">sem compra ainda</span>
                  </div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">No editor</div>
                    <div className="lp-tela-titulo">“Oi, {"{{nome}}"} — sua vaga está guardada.”</div>
                  </div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">Na caixa de entrada</div>
                    <div className="lp-tela-titulo">“Oi, Maria — sua vaga está guardada.”</div>
                  </div>
                </div>
              </div>
            </article>

            <article className="lp-recurso">
              <div className="lp-recurso-texto">
                <span className="lp-recurso-rotulo">Base de leads</span>
                <h3>Cada contato com a ficha completa.</h3>
                <p>
                  Por onde chegou, em que listas está, que tags carrega, o que
                  abriu, onde clicou, quanto comprou. Campos personalizados
                  guardam qualquer detalhe — e a ficha inteira é da operação,
                  exportável quando quiser.
                </p>
              </div>
              <div className="lp-tela" aria-hidden="true">
                <div className="lp-tela-topo"><i /><i /><i /><span>Ficha do lead</span></div>
                <div className="lp-tela-corpo">
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-linha">
                      <span className="lp-tela-avatar">ME</span>
                      <div><div className="lp-tela-titulo">Maria Exemplo</div>
                        <div className="lp-tela-mudo">maria@exemplo.com · chegou pelo formulário</div></div>
                    </div>
                  </div>
                  <div className="lp-tela-caixa">
                    <span className="lp-tag">Aula ao vivo</span>
                    <span className="lp-tag lp-tag--verde">Aluna</span>
                    <span className="lp-tag lp-tag--cinza">+ 3 tags</span>
                  </div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">Engajamento</div>
                    <div className="lp-tela-medidor">
                      <div className="lp-tela-barra"><i style={{ width: "72%" }} /></div>
                      <b>72</b>
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <article className="lp-recurso">
              <div className="lp-recurso-texto">
                <span className="lp-recurso-rotulo">Lead scoring</span>
                <h3>Duas réguas para saber quem está pronto.</h3>
                <p>
                  Cada gesto do lead vira ponto: abriu, clicou, respondeu,
                  comprou. São duas réguas separadas — engajamento e compras —
                  para achar quem está quente sem confundir curioso com
                  comprador. E a régua é de quem usa: cada operação configura do
                  seu jeito o que pontua, quanto vale cada gesto e a partir de
                  quando o lead esquenta.
                </p>
              </div>
              <div className="lp-tela" aria-hidden="true">
                <div className="lp-tela-topo"><i /><i /><i /><span>Lead scoring · Duas réguas</span></div>
                <div className="lp-tela-corpo">
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">O que pontua — regra sua</div>
                    <span className="lp-tag">abriu +5</span>
                    <span className="lp-tag">clicou +10</span>
                    <span className="lp-tag lp-tag--verde">comprou +50</span>
                  </div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">Engajamento</div>
                    <div className="lp-tela-medidor">
                      <div className="lp-tela-barra"><i style={{ width: "72%" }} /></div>
                      <b>72</b>
                    </div>
                    <div className="lp-tela-mudo" style={{ marginTop: 8 }}>Compras</div>
                    <div className="lp-tela-medidor">
                      <div className="lp-tela-barra"><i style={{ width: "50%" }} /></div>
                      <b>50</b>
                    </div>
                  </div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">Quando esquenta</div>
                    <div className="lp-tela-titulo">Acima de 60, entra no segmento “Quentes”</div>
                  </div>
                </div>
              </div>
            </article>

            <article className="lp-recurso">
              <div className="lp-recurso-texto">
                <span className="lp-recurso-rotulo">Vendas e atribuição</span>
                <h3>A venda chega com a campanha que a trouxe.</h3>
                <p>
                  A ponte direta com a Hotmart — sem ferramenta intermediária —
                  acompanha o ciclo completo do lead: compra aprovada, pagamento
                  atrasado, carrinho abandonado. Cada evento entra no motor e a
                  cadeia anda sozinha: tag, sequência, WhatsApp avisado e o
                  relatório fechando a conta ao lado da campanha que fez a
                  venda. E vale para ferramentas similares à Hotmart — quem usa
                  escolhe onde gerencia as próprias vendas.
                </p>
              </div>
              <div className="lp-tela" aria-hidden="true">
                <div className="lp-tela-topo"><i /><i /><i /><span>Ponte Hotmart</span></div>
                <div className="lp-tela-corpo">
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-titulo">compra_aprovada</div>
                    <div className="lp-tela-mudo">maria@exemplo.com · Hotmart · há 2 minutos</div>
                  </div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">O motor respondeu</div>
                    <span className="lp-tag lp-tag--verde">tag · Aluna</span>
                    <span className="lp-tag">sequência de boas-vindas</span>
                  </div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">Atribuição</div>
                    <div className="lp-tela-titulo">Campanha “Convite da aula ao vivo”</div>
                  </div>
                </div>
              </div>
            </article>

            <article className="lp-recurso">
              <div className="lp-recurso-texto">
                <span className="lp-recurso-rotulo">Formulários</span>
                <h3>Captação que grava direto na base.</h3>
                <p>
                  Cada formulário ganha uma página pública própria, sem login:
                  quem preenche entra na lista combinada, recebe a tag de origem
                  e carrega as UTMs da campanha junto — o primeiro passo do
                  funil já nasce medido.
                </p>
              </div>
              <div className="lp-tela" aria-hidden="true">
                <div className="lp-tela-topo"><i /><i /><i /><span>/f/aula-ao-vivo</span></div>
                <div className="lp-tela-corpo">
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-titulo">Garanta sua vaga</div>
                    <div className="lp-tela-mudo">Aula ao vivo, quinta às 20h</div>
                  </div>
                  <div className="lp-tela-campo">Seu nome</div>
                  <div className="lp-tela-campo">Seu melhor e-mail</div>
                  <div className="lp-tela-botao">Quero participar</div>
                </div>
              </div>
            </article>

            <article className="lp-recurso">
              <div className="lp-recurso-texto">
                <span className="lp-recurso-rotulo">WhatsApp direto</span>
                <h3>Os dois canais, a mesma base.</h3>
                <p>
                  A Ressoar fala direto com a API do ManyChat, sem n8n nem
                  ferramenta intermediária: o lead se inscreveu, o disparo em
                  massa sai imediatamente pela API oficial do WhatsApp. Os dois
                  canais enxergam a mesma base — e a ponte não é exclusiva: o
                  mesmo desenho se conecta a outras ferramentas de disparo pela
                  API oficial, à escolha de quem usa.
                </p>
              </div>
              <div className="lp-tela" aria-hidden="true">
                <div className="lp-tela-topo"><i /><i /><i /><span>Ponte ManyChat</span></div>
                <div className="lp-tela-corpo">
                  <div className="lp-tela-zap">Oi, Maria! Sua vaga na aula de quinta está confirmada. 👋</div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">Aplicada no ManyChat</div>
                    <span className="lp-tag lp-tag--verde">AULA — INSCRITOS</span>
                  </div>
                  <div className="lp-tela-caixa">
                    <div className="lp-tela-mudo">Mesma base do e-mail</div>
                    <div className="lp-tela-titulo">Etiquetados na hora, um a um</div>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-origem">
        <Ondas />
        <div className="lp-envelope lp-origem-grade">
          <div>
            <div className="lp-eyebrow">Onde tudo começou</div>
            <h2>Primeiro veio o aluguel. Depois, a casa.</h2>
            <p>
              A Ressoar nasceu dentro de uma operação real, que cresceu numa
              plataforma alugada: formulários, listas, automações e campanhas —
              tudo morava lá. Funcionava, mas a régua do aluguel subia junto
              com a base: <b> quanto mais gente chegava, mais caro ficava manter
              a conversa</b>.
            </p>
            <p>
              Em vez de trocar de aluguel, essa operação construiu a própria casa.
              A conta foi varrida e estudada por inteiro, e cada função foi
              reconstruída sob medida: os leads vieram com o histórico, as
              automações atravessaram a mudança ligadas e <b>nada saiu do ar no
              caminho</b>.
            </p>
            <p>
              A Ressoar é essa casa — e o nome diz o que ela faz: pega o que a
              sua operação tem a dizer e faz ressoar. Cada e-mail no seu
              horário, cada resposta no seu gatilho, cada dado de volta para
              casa.
            </p>
          </div>
          <div className="lp-marcos">
            <h3>A mudança, em quatro marcos</h3>
            <div className="lp-marco"><i />
              <div><b>Varredura da conta real</b>
                <span>Listas, tags, automações, campanhas e formulários da plataforma antiga mapeados um a um.</span></div>
            </div>
            <div className="lp-marco"><i />
              <div><b>A base muda de casa</b>
                <span>A base inteira migrada com histórico, participações e campos — nada ficou para trás.</span></div>
            </div>
            <div className="lp-marco"><i />
              <div><b>O motor próprio assume</b>
                <span>Eventos, automações, campanhas e rastreio de abertura e clique rodando na infraestrutura da operação.</span></div>
            </div>
            <div className="lp-marco"><i />
              <div><b>O envio vira coisa nossa</b>
                <span>Disparo no domínio próprio, com aquecimento medido, supressão automática e telemetria de entrega.</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-passos-secao" id="como-funciona">
        <div className="lp-envelope">
          <div className="lp-centro">
            <h2 className="lp-titulo-secao">Da chegada do lead ao relatório, o caminho é curto.</h2>
            <p className="lp-sub-secao">Quatro passos, sempre os mesmos — para um lead ou para a base inteira.</p>
          </div>
          <div className="lp-passos">
            {PASSOS.map(([titulo, texto], i) => (
              <div className="lp-passo-cartao" key={titulo}>
                <div className="lp-passo-num">{i + 1}</div>
                <h3>{titulo}</h3>
                <p>{texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-recebeu" id="recebeu">
        <div className="lp-envelope">
          <div className="lp-centro">
            <h2 className="lp-titulo-secao">Recebeu um e-mail enviado pela Ressoar?</h2>
            <p className="lp-sub-secao">
              Então este domínio apareceu para você num link. A Ressoar é a
              ferramenta; quem escreve e assina os e-mails é a operação dona
              desta conta — e o combinado com quem recebe é este:
            </p>
          </div>
          <div className="lp-recebeu-grade">
            <div className="lp-recebeu-cartao">
              <div className="lp-icone">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
              </div>
              <h3>Por que recebi?</h3>
              <p>
                Seu e-mail entrou na base por um cadastro seu: um formulário
                preenchido, uma inscrição em evento ou uma compra. A origem fica
                registrada — ninguém entra na base por lista comprada.
              </p>
            </div>
            <div className="lp-recebeu-cartao">
              <div className="lp-icone">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16M13 5l7 7-7 7" /></svg>
              </div>
              <h3>Como paro de receber?</h3>
              <p>
                Todo e-mail sai com um link de descadastro no rodapé. Um clique
                e o motor registra a saída na hora: campanhas e automações param
                de te enxergar, sem etapa manual e sem espera.
              </p>
            </div>
            <div className="lp-recebeu-cartao">
              <div className="lp-icone">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l7 3v6c0 4.4-3 8.2-7 9-4-.8-7-4.6-7-9V6l7-3Z" /></svg>
              </div>
              <h3>Onde ficam meus dados?</h3>
              <p>
                No banco da própria operação — não numa plataforma alugada. Seu
                endereço não é vendido nem emprestado, e sai das réguas de envio
                assim que você pedir.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-faq" id="perguntas">
        <div className="lp-envelope">
          <div className="lp-centro">
            <h2 className="lp-titulo-secao">Perguntas que todo mundo faz</h2>
            <p className="lp-sub-secao">O essencial sobre a Ressoar, sem rodeio.</p>
          </div>
          <div className="lp-faq-lista">
            {PERGUNTAS.map(([pergunta, resposta]) => (
              <details key={pergunta}>
                <summary>{pergunta}<i>+</i></summary>
                <p>{resposta}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final">
        <Ondas />
        <div className="lp-envelope lp-final-conteudo">
          <h2>Quer uma casa própria como esta para a sua operação?</h2>
          <p>
            A Ressoar se instala sob medida: a sua base no seu banco, o envio a
            preço de custo, as integrações do seu jeito — e a régua do aluguel
            fica no passado.
          </p>
          <div className="lp-final-acoes">
            <a className="lp-botao lp-botao--primario" href={WHATSAPP_CRIADOR}
              target="_blank" rel="noreferrer">Falar com quem constrói</a>
            <Link className="lp-botao lp-botao--vazado" to={portaDestino}>{portaRotulo}</Link>
          </div>
        </div>
      </section>

      <footer className="lp-rodape">
        <div className="lp-envelope">
          <div className="lp-rodape-grade">
            <div className="lp-rodape-marca">
              <span className="lp-logo"><Logo /> Ressoar</span>
              <p>
                E-mail marketing em casa própria: base, campanhas, automações e
                vendas num lugar só, na infraestrutura da própria operação.
              </p>
            </div>
            <div>
              <h4>A página</h4>
              <ul>
                <li><a href="#plataforma">A plataforma</a></li>
                <li><a href="#como-funciona">Como funciona</a></li>
                <li><a href="#perguntas">Perguntas</a></li>
              </ul>
            </div>
            <div>
              <h4>Acesso</h4>
              <ul>
                <li><Link to={portaDestino}>{portaRotulo}</Link></li>
                <li><a href="#recebeu">Recebeu um e-mail?</a></li>
              </ul>
            </div>
          </div>
          <div className="lp-rodape-fim">
            <span className="lp-aviso-curto">
              A Ressoar envia e-mails apenas para quem entrou na base por
              cadastro próprio. Todo e-mail sai com descadastro em um clique.
            </span>
            <div className="lp-credito">
              <div className="lp-credito-linha">
                <span>Criado por Davi Damasceno</span>
                <span className="lp-credito-canais">
                <a href={INSTAGRAM_CRIADOR} target="_blank" rel="noreferrer">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" aria-hidden="true">
                    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
                    <circle cx="12" cy="12" r="4.5" />
                    <circle cx="17.4" cy="6.6" r="1.2" fill="currentColor" stroke="none" />
                  </svg>
                  @davidamascenos
                </a>
                <span className="lp-credito-sep">·</span>
                <a href={WHATSAPP_CRIADOR} target="_blank" rel="noreferrer">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" aria-hidden="true">
                    <path d="M12 3a9 9 0 0 0-7.74 13.6L3 21l4.4-1.26A9 9 0 1 0 12 3Z" />
                    <path d="M9.2 8.4c-.3-.3-.7-.3-1 0l-.6.6c-.3.3-.4.8-.2 1.2 1 2.4 3 4.4 5.4 5.4.4.2.9.1 1.2-.2l.6-.6c.3-.3.3-.7 0-1l-1.4-1.1c-.2-.2-.6-.2-.8 0l-.5.4a7 7 0 0 1-2.4-2.4l.4-.5c.2-.2.2-.6 0-.8L9.2 8.4Z"
                      fill="currentColor" stroke="none" />
                  </svg>
                  WhatsApp
                </a>
                </span>
              </div>
              <span className="lp-direitos">© {new Date().getFullYear()} · Todos os direitos reservados.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
