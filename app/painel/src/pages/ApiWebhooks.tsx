import { useEffect, useState } from "react";
import { avisar, confirmar } from "../components/Dialogo";
import Ajuda from "../components/Ajuda";
import { supabase } from "../lib/supabase";

const BASE_FUNC = "https://SEU-PROJETO.supabase.co/functions/v1";
const BASE_REST = "https://SEU-PROJETO.supabase.co/rest/v1";

function Codigo({ children }: { children: string }) {
  return (
    <pre style={{
      background: "#1c1917", color: "#e7e5e4", borderRadius: 8, padding: "12px 14px",
      fontSize: "calc(12px * var(--escala-texto))", overflowX: "auto", margin: "8px 0 14px", lineHeight: 1.6,
    }}>
      <code>{children}</code>
      <button style={{ float: "right", fontSize: "calc(11px * var(--escala-texto))", padding: "3px 8px", marginTop: -4 }}
        onClick={() => navigator.clipboard.writeText(children)}>copiar</button>
    </pre>
  );
}

// Cada endereço desta tela é uma ferramenta diferente, e o nome sozinho não
// diz para que serve nem quando usar — reclamação do dono da conta: "é difícil
// saber pra que serve cada ferramenta". Daí o "?" em cada um: a explicação
// mora ao lado do endereço, não numa documentação que ninguém abre.
const SUBABAS = [
  { id: "entrada", rotulo: "Endereços de entrada",
    sub: "Os endereços para colar na Hotmart, num formulário ou em outro sistema.",
    ajuda: (
      <>
        Tudo aqui é endereço que <b>outro sistema chama</b> quando algo acontece
        lá fora: alguém preencheu um formulário, comprou na Hotmart, um e-mail
        voltou. Você cola o endereço no outro sistema uma vez, e a partir dali a
        pessoa entra sozinha na base.
        <br /><br />
        Quase todos são públicos de propósito — quem chama é a Hotmart ou um
        site, e nenhum deles tem onde guardar uma senha sua em segurança.
      </>
    ) },
  { id: "saida", rotulo: "Webhooks de saída",
    sub: "Para onde a Ressoar avisa quando algo acontece — n8n, Boost.space, planilha.",
    ajuda: (
      <>
        O contrário da aba anterior: aqui é a <b>Ressoar que chama</b> outro
        sistema. Toda vez que alguém entra numa lista, ganha uma tag ou compra,
        ela faz um POST no endereço que você cadastrar, levando o contato
        inteiro.
        <br /><br />
        É assim que o n8n, o Boost.space ou uma planilha ficam sabendo sem
        ninguém copiar nada à mão.
      </>
    ) },
  { id: "api", rotulo: "API de dados",
    sub: "Documentação: como ler e escrever nos seus dados de qualquer sistema.",
    ajuda: (
      <>
        Documentação para quem for programar. Tudo que este painel faz, um
        sistema seu pode fazer direto: ler, criar, marcar, disparar.
        <br /><br />
        Diferente das outras duas abas, a chave usada aqui é a de <b>acesso
        total</b> — ela ignora todas as regras de permissão. Serve para script,
        n8n ou servidor seu; <b>nunca</b> para código que roda no navegador de
        quem visita um site.
      </>
    ) },
];

export default function ApiWebhooks({ embutido }: { embutido?: boolean } = {}) {
  const [sub, setSub] = useState("entrada");
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [autoHooks, setAutoHooks] = useState<{ automacao: string; url: string; ativa: boolean }[]>([]);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [novoHook, setNovoHook] = useState({
    nome: "", url: "",
    eventos: "lista_inscrita,tag_adicionada,lead_criado,lead_descadastrado",
  });

  async function carregar() {
    const [w, a, c] = await Promise.all([
      supabase.from("webhooks_saida").select("*").order("created_at"),
      supabase.from("automacao_passos")
        .select("config, automacoes(nome, ativa)").in("tipo", ["webhook", "google_sheets"]),
      supabase.from("app_config").select("chave, valor"),
    ]);
    setWebhooks(w.data ?? []);
    setAutoHooks((a.data ?? [])
      .filter((p: any) => p.config?.url)
      .map((p: any) => ({ automacao: p.automacoes?.nome, url: p.config.url, ativa: p.automacoes?.ativa })));
    setCfg(Object.fromEntries((c.data ?? []).map((r: any) => [r.chave, r.valor ?? ""])));
  }
  useEffect(() => { carregar(); }, []);

  async function criarHook() {
    if (!novoHook.nome || !novoHook.url) { await avisar({ titulo: "Preencha nome e URL." }); return; }
    if (!(await confirmar({ titulo: `Criar webhook de saída para ${novoHook.url}?`, corpo: "Cada evento assinado fará um POST real.", confirmarTexto: "Criar" }))) return;
    await supabase.from("webhooks_saida").insert({
      nome: novoHook.nome, url: novoHook.url,
      eventos: novoHook.eventos.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setNovoHook({ nome: "", url: "", eventos: "lista_inscrita,tag_adicionada,lead_criado,lead_descadastrado" });
    carregar();
  }

  async function alternarHook(w: any) {
    await supabase.from("webhooks_saida").update({ ativo: !w.ativo }).eq("webhook_id", w.webhook_id);
    carregar();
  }

  async function alternarChaveGeral() {
    const novo = cfg.executar_webhooks === "true" ? "false" : "true";
    if (novo === "true" && !(await confirmar({ titulo: "LIGAR os webhooks das automações?", corpo: "A partir de agora, cada gatilho fará POST REAL para n8n/Boost. Antes, confira se algum fluxo do outro lado já faz sozinho a mesma coisa — os dois juntos é a pessoa recebendo tudo em dobro.", confirmarTexto: "Ligar" }))) return;
    await supabase.from("app_config").upsert({ chave: "executar_webhooks", valor: novo, updated_at: new Date().toISOString() });
    carregar();
  }

  return (
    <div>
      {!embutido && <h1>API &amp; Webhooks</h1>}

      {/* Operação e documentação estavam empilhadas na mesma coluna: os
          endereços para colar na Hotmart apareciam depois de quatro blocos
          de exemplo de curl. Quem vem pegar um endereço não quer ler API. */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 18 }}>
        {SUBABAS.map((x) => {
          const ativa = sub === x.id;
          return (
            <button key={x.id} onClick={() => setSub(x.id)}
              style={{
                padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${ativa ? "var(--marca)" : "var(--borda)"}`,
                background: ativa ? "var(--marca)" : "transparent",
                color: ativa ? "#fff" : "var(--texto2)",
                fontSize: "calc(13px * var(--escala-texto))",
              }}>
              {x.rotulo}
            </button>
          );
        })}
      </div>
      <div className="sub" style={{ marginTop: -8, marginBottom: 14 }}>
        {SUBABAS.find((x) => x.id === sub)?.sub}
        <Ajuda>{SUBABAS.find((x) => x.id === sub)?.ajuda}</Ajuda>
      </div>

      {sub === "api" && (
      <div className="caixa">
        <h2>Exemplos prontos
          <Ajuda>
            Tudo que o painel faz, qualquer sistema seu pode fazer por aqui — n8n, Make,
            um site, um checkout. A autenticação é por chave no cabeçalho, a mesma
            <code> service_role</code>. <b>Nunca</b> exponha essa chave em site público:
            ela ignora todas as regras de acesso.
          </Ajuda>
        </h2>
        <div className="sub">Base: <code>{BASE_REST}</code></div>
        <label>Buscar leads (igual ao "list contacts" do AC)
          <Ajuda>
            Lê a base de fora do painel. Dá para filtrar por qualquer coluna e
            escolher quais campos voltam — no exemplo, só quem tem e-mail do
            Gmail, dez de cada vez.
            <br /><br />
            É leitura pura: não muda nada, não dispara automação, não manda
            e-mail. Bom para alimentar um relatório ou conferir um número.
          </Ajuda>
        </label>
        <Codigo>{`curl "${BASE_REST}/tabela_1_leads?select=lead_id,nome,email,whatsapp&email=ilike.*@gmail.com*&limit=10" \\
  -H "apikey: SUA_SERVICE_KEY" -H "Authorization: Bearer SUA_SERVICE_KEY"`}</Codigo>
        <label>Criar/atualizar lead (igual ao "contact sync" do AC)
          <Ajuda>
            Grava a pessoa na base sem precisar saber se ela já existe: o{" "}
            <code>merge-duplicates</code> do cabeçalho manda atualizar quando o
            e-mail já está lá, em vez de criar uma segunda ficha.
            <br /><br />
            Cria o contato, mas <b>não</b> o coloca em lista nem aplica tag — e
            é a lista e a tag que acionam automação. Para captar gente de
            verdade, prefira o endereço de captação da aba de entrada.
          </Ajuda>
        </label>
        <Codigo>{`curl -X POST "${BASE_REST}/tabela_1_leads" \\
  -H "apikey: SUA_SERVICE_KEY" -H "Authorization: Bearer SUA_SERVICE_KEY" \\
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" \\
  -d '{"email": "novo@lead.com", "nome": "Novo Lead", "whatsapp": "5561999998888"}'`}</Codigo>
        <label>Aplicar tag num lead (dispara automações, igual ao AC)
          <Ajuda>
            <b>Aplicar tag não é só etiquetar.</b> Se alguma automação tem essa
            tag como gatilho, ela começa a rodar para essa pessoa no minuto
            seguinte — e e-mail sai de verdade.
            <br /><br />
            Que tags são gatilho de quê está em Contatos → Tags: cada uma mostra
            em quais automações ela liga alguma coisa. Vale conferir antes de
            aplicar em massa por aqui.
          </Ajuda>
        </label>
        <Codigo>{`curl -X POST "${BASE_REST}/lead_tags" \\
  -H "apikey: SUA_SERVICE_KEY" -H "Authorization: Bearer SUA_SERVICE_KEY" \\
  -H "Content-Type: application/json" -H "Prefer: resolution=ignore-duplicates" \\
  -d '{"lead_fk": "UUID_DO_LEAD", "tag_fk": 42}'`}</Codigo>
        <label>Disparar campanha via API
          <Ajuda>
            O mesmo botão "disparar" da página de Campanhas, chamado de fora —
            para agendar por um sistema seu em vez de clicar na hora.
            <br /><br />
            A campanha já tem que existir e estar com mensagem e destinatários
            definidos; isto aqui só manda começar. <b>É irreversível</b>: a fila
            escoa em até um minuto e o e-mail sai para a base real.
          </Ajuda>
        </label>
        <Codigo>{`curl -X POST "${BASE_REST}/rpc/disparar_campanha" \\
  -H "apikey: SUA_SERVICE_KEY" -H "Authorization: Bearer SUA_SERVICE_KEY" \\
  -H "Content-Type: application/json" -d '{"p_campanha": "UUID_DA_CAMPANHA"}'`}</Codigo>
      </div>
      )}

      {sub === "entrada" && (
      <div className="caixa">
        <h2>Endereços para colar<Ajuda>Quase todos são públicos de propósito: quem chama é a Hotmart, um formulário ou o ManyChat, e nenhum deles tem como guardar uma senha sua. A exceção é a captação por API, que escolhe lista e tag no próprio corpo — essa exige a chave de captação.</Ajuda></h2>
        <div style={{ fontSize: "calc(13.5px * var(--escala-texto))", lineHeight: 1.7, marginBottom: 6 }}>
          As portas de entrada do mundo pra sua Ressoar.
        </div>
        <label>Captação com formulário (público — a lista e a tag vêm do cadastro do formulário, nunca do corpo)
          <Ajuda>
            Para uma página de inscrição, uma landing ou um formulário de site.
            Quem chama manda só os dados da pessoa; <b>em qual lista ela entra e
            que tag ganha vem do cadastro do formulário aqui dentro</b> (Contatos
            → Formulários), não do pedido.
            <br /><br />
            É por isso que pode ser público: quem tem o endereço não escolhe o
            destino de ninguém. É por aqui que a página das lives semanais
            inscreve.
          </Ajuda>
        </label>
        <Codigo>{`curl -X POST "${BASE_FUNC}/formulario" \\
  -H "Content-Type: application/json" \\
  -d '{"form_slug": "meu-formulario", "email": "lead@email.com",
       "nome": "Fulana", "whatsapp": "61999998888"}'`}</Codigo>
        <label>Captação por API, sem formulário (escolhe lista e tag no corpo — exige a chave de captação)
          <Ajuda>
            Para um sistema seu que já sabe o destino — um script, o n8n, um
            aplicativo. Aqui <b>quem chama escolhe a lista e a tag</b>, e é
            exatamente por isso que exige a chave de captação no cabeçalho{" "}
            <code>x-api-key</code>: sem ela o pedido é recusado.
            <br /><br />
            Se o destino for sempre o mesmo, prefira o de cima — não precisa de
            chave e ninguém pode desviar a pessoa de lista.
          </Ajuda>
        </label>
        <Codigo>{`curl -X POST "${BASE_FUNC}/formulario" \\
  -H "Content-Type: application/json" -H "x-api-key: SUA_CHAVE_DE_CAPTACAO" \\
  -d '{"email": "lead@email.com", "nome": "Fulana", "whatsapp": "61999998888",
       "lista_id": 17, "tag_id": 45}'`}</Codigo>
        <div style={{ fontSize: "calc(13px * var(--escala-texto))", lineHeight: 1.7, margin: "6px 0 4px" }}>
          A chave de captação se cria em <b>Configurações → API e webhooks</b>. Sem{" "}
          <code>form_slug</code> e sem ela, o POST é recusado — senão qualquer um
          inscreveria qualquer e-mail em qualquer lista, e lista com automação dispara
          e-mail de verdade.
        </div>
        <label>Venda (Hotmart e qualquer outro checkout)
          <Ajuda>
            O endereço que a Hotmart chama a cada movimento de pedido: aprovado,
            boleto gerado, carrinho abandonado, reembolso, chargeback.
            <br /><br />
            <b>Cadastra-se uma vez só e vale para todos os produtos</b> —
            produto novo não exige voltar na Hotmart. O que acontece com a
            pessoa <i>depois</i> de comprar (em que lista entra, que tag ganha,
            se é marcada no ManyChat) se define produto por produto em Contatos
            → Vendas.
          </Ajuda>
        </label>
        <Codigo>{`${BASE_FUNC}/venda`}</Codigo>
        <div style={{ fontSize: "calc(13px * var(--escala-texto))", lineHeight: 1.7, margin: "6px 0 4px" }}>
          Na Hotmart: <b>Ferramentas → Webhook (API e notificações) → Cadastrar Webhook</b>.
          Escolha <b>Todos os produtos</b> e a versão <b>2.0.0</b>, e marque os eventos de compra —
          incluindo <b>reembolsada</b> e <b>chargeback</b>, que são os que tiram do segmento de
          compradores quem pediu o dinheiro de volta.
        </div>
        <div style={{ fontSize: "calc(13px * var(--escala-texto))", lineHeight: 1.7, marginBottom: 6 }}>
          Uma configuração só cobre a conta inteira: o que cada produto faz ao ser comprado
          fica em <b>Contatos → Vendas</b>, então produto novo não exige voltar na Hotmart.
        </div>
        <label>Ou de qualquer outra origem (Kiwify, Eduzz, checkout próprio)
          <Ajuda>
            É o mesmo endereço de cima, chamado à mão em vez de pela Hotmart.
            Serve para checkout que não é Hotmart — Kiwify, Eduzz, um checkout
            próprio — ou para lançar uma venda que entrou por fora.
            <br /><br />
            O campo <code>status</code> é o que decide: só compra{" "}
            <b>aprovada</b> entra em lista e aciona a regra do produto.
          </Ajuda>
        </label>
        <Codigo>{`curl -X POST "${BASE_FUNC}/venda" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "comprador@email.com", "nome": "Fulana", "telefone": "61999998888",
       "produto": "Curso Exemplo", "valor": 197.00,
       "status": "aprovada", "transacao": "ABC123", "data": "2026-08-01"}'`}</Codigo>

        <label>Postback do Resend (resend.com → Webhooks)
          <Ajuda>
            Como a Ressoar fica sabendo o que aconteceu com o e-mail <b>depois</b>{" "}
            que ele saiu: se foi entregue, se voltou (endereço que não existe
            mais) ou se a pessoa marcou como spam.
            <br /><br />
            Sem isso, endereço morto continua recebendo — e insistir em endereço
            morto derruba a entrega da base inteira, inclusive de quem lê. Quem
            volta entra sozinho na supressão e aparece em Envios.
          </Ajuda>
        </label>
        <Codigo>{`${BASE_FUNC}/postback-resend`}</Codigo>
        <label>Postback do Amazon SES (via tópico SNS, quando migrar para a AWS)
          <Ajuda>
            Mesmo papel do de cima, para o dia em que o envio sair do Resend e
            for para a Amazon. <b>Hoje não é usado</b> — fica aqui pronto, para
            não ter que descobrir na hora da troca.
          </Ajuda>
        </label>
        <Codigo>{`${BASE_FUNC}/postback-ses`}</Codigo>
        <label>Tracking e descadastro (o motor injeta sozinho em cada e-mail — só pra referência)
          <Ajuda>
            <b>Não precisa colar em lugar nenhum.</b> O motor põe os três dentro
            de cada e-mail sozinho: o primeiro é o pixel invisível que marca
            abertura, o segundo troca cada link por um que conta o clique, e o
            terceiro é a página de descadastro que a lei exige no rodapé.
            <br /><br />
            Estão aqui só para você reconhecer, se topar com um deles no código
            de um e-mail.
          </Ajuda>
        </label>
        <Codigo>{`${BASE_FUNC}/rastreio?t=o&e=ENVIO_ID        (pixel de abertura)
${BASE_FUNC}/rastreio?t=c&e=ENVIO_ID&u=URL  (clique rastreado)
${BASE_FUNC}/descadastro?e=ENVIO_ID          (página de descadastro)`}</Codigo>
      </div>
      )}

      {sub === "saida" && (
      <div className="caixa">
        <h2>Para onde avisar<Ajuda>Quando um evento acontece aqui, a Ressoar faz um POST nestes endereços. É como o n8n fica sabendo.</Ajuda></h2>
        <div className="sub">
          O motor faz POST com o contato completo em cada evento assinado — mesmo papel dos webhooks que o AC postava pro seu n8n.
        </div>
        <div className="linha" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: "calc(13.5px * var(--escala-texto))" }}>
            Chave-geral dos webhooks das automações:{" "}
            <Ajuda>
              Um interruptor só para <b>todos</b> os webhooks — os globais desta
              tela e os passos de webhook dentro das automações.
              <br /><br />
              <b>Desligada</b>, a automação roda inteira (manda e-mail, aplica
              tag, inscreve em lista) mas o POST não sai: serve para mexer sem
              avisar sistema nenhum lá fora. <b>Ligada</b>, cada gatilho chama
              n8n/Boost.space de verdade.
            </Ajuda>{" "}
            {cfg.executar_webhooks === "true"
              ? <span className="etiqueta et-verde">LIGADA — POSTs reais</span>
              : <span className="etiqueta et-amarela">DESLIGADA (seguro na transição)</span>}
          </div>
          <button style={{ flex: "0 0 auto" }} onClick={alternarChaveGeral}>
            {cfg.executar_webhooks === "true" ? "Desligar" : "Ligar"}
          </button>
        </div>
        <table>
          <thead><tr><th>Nome</th><th>URL</th><th>Eventos</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {webhooks.map((w) => (
              <tr key={w.webhook_id}>
                <td>{w.nome}</td>
                <td style={{ fontSize: "calc(12px * var(--escala-texto))", fontFamily: "monospace" }}>{w.url}</td>
                <td>{(w.eventos ?? []).map((e: string) => <span key={e} className="etiqueta et-roxa">{e}</span>)}</td>
                <td>{w.ativo ? <span className="etiqueta et-verde">ativo</span> : <span className="etiqueta et-cinza">pausado</span>}</td>
                <td className="direita"><button onClick={() => alternarHook(w)}>{w.ativo ? "Pausar" : "Ativar"}</button></td>
              </tr>
            ))}
            {!webhooks.length && <tr><td colSpan={5} style={{ color: "var(--texto2)" }}>Nenhum webhook global configurado (os das automações estão abaixo).</td></tr>}
          </tbody>
        </table>
        <div className="linha" style={{ marginTop: 12 }}>
          <input placeholder="Nome (ex.: n8n geral)" value={novoHook.nome}
            onChange={(e) => setNovoHook({ ...novoHook, nome: e.target.value })} />
          <input placeholder="https://seu-n8n.com.br/webhook/…" value={novoHook.url}
            onChange={(e) => setNovoHook({ ...novoHook, url: e.target.value })} />
          <input placeholder="eventos separados por vírgula" value={novoHook.eventos}
            onChange={(e) => setNovoHook({ ...novoHook, eventos: e.target.value })} />
          <button className="primario" style={{ flex: "0 0 auto" }} onClick={criarHook}>Adicionar</button>
        </div>
        <div style={{ fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--texto2)", marginTop: 10 }}>
          Eventos disponíveis
          <Ajuda>
            São os mesmos nomes que aparecem como gatilho em Automações — um
            webhook assina os que quiser:
            <br /><br />
            <b>Contato</b><br />
            <code>lead_criado</code> — pessoa nova na base, por qualquer porta<br />
            <code>lista_inscrita</code> / <code>lista_descadastrada</code> — entrou ou saiu de uma lista<br />
            <code>lista_status_alterado</code> — mudou de situação dentro da lista<br />
            <code>tag_adicionada</code> — ganhou uma tag<br />
            <code>lead_descadastrado</code> — clicou em "não quero mais receber"
            no rodapé de um e-mail e saiu de tudo
            <br /><br />
            <b>Vendas</b> (vêm do endereço /venda)<br />
            <code>compra_realizada</code> · <code>compra_cancelada</code><br />
            <code>boleto_gerado</code> · <code>carrinho_abandonado</code><br />
            <code>pagamento_atrasado</code> · <code>pagamento_expirou</code>
            <br /><br />
            <b>Comportamento no e-mail</b><br />
            <code>email_aberto</code> · <code>email_clicado</code>
          </Ajuda>
          : <code>lead_criado</code>, <code>lista_inscrita</code>,{" "}
          <code>lista_descadastrada</code>, <code>lista_status_alterado</code>,{" "}
          <code>tag_adicionada</code>, <code>lead_descadastrado</code>,{" "}
          <code>compra_realizada</code>,{" "}
          <code>compra_cancelada</code>, <code>boleto_gerado</code>,{" "}
          <code>carrinho_abandonado</code>, <code>pagamento_atrasado</code>,{" "}
          <code>pagamento_expirou</code>, <code>email_aberto</code>,{" "}
          <code>email_clicado</code>. Payload: {"{ evento, payload, contato: { email, nome, whatsapp, listas, tags, atributos } }"}.
        </div>
      </div>
      )}

      {sub === "saida" && (
      <div className="caixa">
        <h2>Herdados do ActiveCampaign<Ajuda>Endereços que já estavam dentro das automações importadas. Ficam aqui para você conferir o que ainda aponta para fora.</Ajuda></h2>
        <table>
          <thead><tr><th>Automação</th><th>Destino</th><th></th></tr></thead>
          <tbody>
            {autoHooks.map((h, i) => (
              <tr key={i}>
                <td>{h.automacao}</td>
                <td style={{ fontSize: "calc(12px * var(--escala-texto))", fontFamily: "monospace" }}>{h.url}</td>
                <td>{h.ativa ? <span className="etiqueta et-verde">automação ativa</span> : <span className="etiqueta et-cinza">automação inativa</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--texto2)", marginTop: 8 }}>
          Estes POSTs só saem com a chave-geral LIGADA. Desligada, nenhum sai — mesmo com o passo montado na automação.
        </div>
      </div>
      )}
    </div>
  );
}
