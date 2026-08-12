# Vendas e Hotmart

Receber a compra no instante em que ela acontece, e saber de qual anúncio ela veio.

---

## Por que isso vale a pena

Sem essa ligação, "quem comprou" é uma planilha que alguém atualiza de vez em quando.
Com ela, comprar vira um evento do sistema: a pessoa entra na base, ganha a tag, dispara a
automação, sobe na pontuação e aparece no relatório — sozinha, em segundos.

E aparece uma resposta que nenhuma ferramenta de anúncio consegue dar: **quanto dinheiro
cada anúncio trouxe**. O Meta sabe quantos cliques ele deu; ele não sabe quanto vendeu,
porque a venda acontece fora dele.

---

## Ligar a Hotmart

No Ressoar, vá em **Desenvolvedor → API & Webhooks** e copie o endereço de venda. É este,
com o código do seu projeto:

```
https://SEU-PROJETO.supabase.co/functions/v1/venda
```

Na Hotmart: **Ferramentas → Webhook (API e notificações) → Cadastrar Webhook**

| Campo | Valor |
|---|---|
| Nome | `Ressoar` |
| URL | o endereço copiado |
| Versão | **2.0.0** |
| Produtos | **Todos os produtos** |
| Eventos | os nove eventos de pedido listados abaixo |

Três decisões aí merecem explicação.

**A versão precisa ser 2.0.0.** O sistema lê essa especificação. Em outra versão os campos
mudam de nome e nada casa.

**"Todos os produtos", não um por um.** Assim a Hotmart manda tudo e quem decide o que
fazer com cada produto é o Ressoar. Produto novo vira uma linha numa tela, não uma volta à
Hotmart.

**Marque todos os nove eventos de pedido da especificação 2.0.0:**

| Evento Hotmart | Estado no Ressoar | É compra? | Move automação? |
|---|---|---|---|
| `PURCHASE_APPROVED` | aprovada | sim | **sim** |
| `PURCHASE_COMPLETE` | aprovada | sim | **não** |
| `PURCHASE_BILLET_PRINTED` | pendente | não | recuperação |
| `PURCHASE_DELAYED` | pendente | não | recuperação |
| `PURCHASE_EXPIRED` | expirada | não | recuperação |
| `PURCHASE_CANCELED` | cancelada | não | sim |
| `PURCHASE_REFUNDED` | reembolsada | não é mais comprador | sim |
| `PURCHASE_CHARGEBACK` | chargeback | não é mais comprador | sim |
| `PURCHASE_PROTEST` | chargeback/protestada | não é mais comprador | sim |

O `purchase.status` detalha ainda estados como espera, análise, falta de fundos e reembolso
parcial. Ele prevalece sobre o nome genérico do evento. Qualquer estado futuro ainda não
mapeado é guardado no histórico bruto e retorna erro visível; nunca é presumido como venda.

**Por que `PURCHASE_COMPLETE` conta como venda mas não move automação.** Ele avisa que o
prazo de arrependimento venceu sem reembolso: a compra virou definitiva. Isso é controle
interno. Quem manda em e-mail, tag e ManyChat é a **aprovação**, que aconteceu dias antes —
a pessoa já entrou na lista e já foi marcada naquele momento. O prazo nem é fixo: sete dias
é o mínimo do Código de Defesa do Consumidor, e o vendedor pode dar mais.

Tratar esse aviso como entrada de comprador põe quem comprou na semana passada dentro da
turma desta semana, e dispara o WhatsApp da turma errada. Foi o que aconteceu com 21 pessoas
em 06/08/2026, até a correção.

**Aprovada não volta a ser pendente.** Os avisos não chegam em ordem: um aviso de boleto que
falhou é reenviado minutos depois, quando a compra já foi aprovada. Antes ele rebaixava a
venda e o comprador sumia da lista de compradores sem que nada denunciasse. Depois de
aprovada, só reembolso, chargeback e cancelamento mudam o estado.

---

## O hottok

A Hotmart manda um token em toda requisição, no cabeçalho `X-HOTMART-HOTTOK`. Ele é a
garantia de que o pedido veio mesmo dela.

Enquanto ele não estiver configurado, **qualquer um que descubra o endereço pode inventar
vendas** na sua base — e venda falsa contamina segmento, pontuação, relatório e faturamento.

Para configurar, grave o valor como segredo da função:

```bash
cd app
npx supabase secrets set VENDA_SEGREDO=SEU_HOTTOK --project-ref SEU-PROJETO
```

> **Não ative com um valor que você não confirmou.** Se estiver errado, o sistema passa a
> recusar venda de verdade — dano imediato e silencioso, pior do que o risco que a trava
> evita. O caminho seguro: deixe rodar sem o segredo por um tempo, confira em
> `hotmart_eventos.token_recebido` qual valor está realmente chegando, e só então ative.

---

## O que acontece quando um pedido chega

1. **O corpo cru é guardado** em `hotmart_eventos`, antes de qualquer processamento.
   Webhook de venda é dinheiro: se algo falhar no meio, a Hotmart não reenvia para sempre,
   e sem o original não há como reprocessar nem descobrir o que deu errado.
2. **A pessoa é localizada** por CPF, depois WhatsApp, depois e-mail. Se não existir, é
   criada. O CPF vem na compra e é o identificador mais forte que existe aqui: e-mail a
   pessoa troca, telefone ela troca, CPF não.
3. **O pedido é gravado** com produto, valor, forma de pagamento, parcelas, estado, evento
   de origem, a data real — e **com qual e-mail e qual telefone aquela compra foi feita**.
4. **A origem é aberta** em campos utilizáveis (veja abaixo).
5. **Somente se estiver aprovado**, a regra do produto é aplicada: entra na lista e ganha
   a tag.
6. **Somente a transição para aprovado** produz `compra_realizada`. Boleto, atraso e
   expiração produzem eventos próprios de recuperação; cancelamento e estorno também têm
   estados próprios.

Reenviar o mesmo evento **não duplica**: o código da transação é único e a linha existente
é atualizada. É assim que um reembolso lançado depois corrige a venda que já estava lá.

---

## Cada produto fala pelo contato da sua compra

Regra do dono (06/08/2026): **a comunicação de um produto vai para o e-mail e o telefone
com que aquele produto foi comprado** — não para o cadastro antigo.

> "E-mails sempre devem ir para o email da compra, independente do email antigo. Podemos,
> com cpf e telefone, identificar uma pessoa e garantir a ela a possibilidade de ter 2
> emails ou mais na base, mas as comunicações relativas a um produto sempre serão com o
> email da compra desse produto."

Uma pessoa é **uma só** — reconhecida pelo CPF —, e pode ter vários contatos:

| | |
|---|---|
| Produto A, comprado com o e-mail A | comunicação do A vai para o e-mail A |
| Produto B, comprado com o e-mail B | comunicação do B vai para o e-mail B |
| Assunto que não é sobre produto | vai para o contato principal |

O mesmo vale para o telefone: o WhatsApp de um produto vai para o número usado naquela
compra. Isso passou a importar quando cadastros duplicados foram fundidos e dezenas de
pessoas ficaram com mais de um celular conhecido.

**Como o sistema sabe de que produto uma automação fala:** pelo campo **produto** da
automação — a caixinha "Fala de:", ao lado do nome, no editor. Vazio, os e-mails vão para o
contato principal, que é o certo para newsletter e convite de live. Preenchido, vão para o
contato daquela compra.

Duas coisas que o desenho garante:

- **O endereço é escolhido no enfileiramento e gravado no envio.** O relatório mostra para
  onde cada e-mail realmente foi, e uma troca de cadastro depois não reescreve a história.
- **A supressão vale para o endereço que vai receber.** Quem pediu descadastro num e-mail
  não volta a receber só porque comprou com outro.

Compra feita pela própria equipe é exceção: quando o suporte preenche o checkout pela
cliente, o endereço da casa não vira endereço de comunicação dela. Esses endereços ficam em
`emails_da_operacao`.

**Onde isso mora:** `email_para_contato(pessoa, produto)` e `whatsapp_para_contato(pessoa,
produto)`. Todos os contatos conhecidos de uma pessoa ficam em `lead_emails` e
`lead_telefones`, cada um com o nome que veio junto — a mesma pessoa se escreve de mais de
um jeito, e os dois jeitos têm valor.

---

## Regras de produto

**Contatos → Vendas → O que cada produto faz.**

Cada regra diz: comprou este produto → entra nesta lista e ganha esta tag; pediu reembolso
→ ganha esta outra.

O reconhecimento é pelo **`ucode`**, o código que a Hotmart dá ao produto. Ele não muda
quando você renomeia o produto — o nome, sim. Parte do nome funciona como alternativa, e
se duas regras casarem, ganha a mais específica.

**Você não precisa saber os nomes de antemão.** A tela descobre os produtos a partir dos
eventos que já chegaram e oferece um botão "configurar" para cada um que ainda não tem
regra, com nome e código preenchidos.

> **Cuidado ao escolher a lista.** Entrar numa lista dispara as automações ligadas a ela —
> inclusive as que mandam e-mail. Se a lista tiver uma automação de boas-vindas, todos os
> compradores que já estão na base recebem esse e-mail na hora em que você salvar a regra.
> Para configurar sem risco, use **só a tag** e deixe a lista vazia.

---

## De onde veio a venda

A Hotmart manda a origem em dois campos comprimidos:

```
xcod : {"vsrc":"paid_metaads","url":"sualanding.com.br/","r":"instagram.com/","vid":"…"}
sck  : m=paid|s=ig|utm_id=…|co=…
```

Guardados assim eles são inúteis: o construtor de segmentos compara o campo inteiro, não
um pedaço de dentro dele. O sistema abre os dois em campos separados:

| Campo | Exemplo |
|---|---|
| Origem do tráfego | `paid_metaads` |
| Rede | `Instagram` |
| Mídia | `pago` |
| Página de captura | `sualanding.com.br/inscricao-v4` |
| Veio de (referrer) | `instagram.com` |
| ID do anúncio | `120250666388530503` |

Com isso, **Relatórios → De onde vem o dinheiro** mostra receita por origem, por rede, por
página de captura, e o ranking de anúncios por receita.

### O detalhe que torna a conta honesta

Se a origem só existir na compra, qualquer taxa de conversão sai perto de 100% — o
denominador teria apenas quem já converteu. Não é métrica, é ilusão.

Por isso **o formulário também captura a origem na captação**: quando alguém chega na sua
landing por `?utm_source=…&sck=…&xcod=…` e preenche o formulário, a origem fica gravada
nele mesmo que nunca compre. Aí o denominador passa a ser real.

Para funcionar, os links dos seus anúncios precisam levar as UTMs até a landing — que é
como o `xcod` chega até aqui.

---

## Segmentar por compra

No construtor de segmentos (**Leads → Segmento avançado**):

| Condição | Responde |
|---|---|
| Comprou (produto opcional) | quem comprou, ou quem comprou *aquele* produto |
| Quantidade de compras | quem comprou mais de uma vez |
| Total gasto | quem gastou acima de R$ X |
| Pediu reembolso | para excluir do disparo, ou tratar à parte |

Todas contam **só compra aprovada**. Reembolso e chargeback ficam de fora — quem devolveu
o produto não é comprador.

---

## Quem está pronto pra comprar

**Contatos → Lead scoring** (a página tem duas abas: **Venda**, com as jogadas
e o ranking, e **Engajamento**, com a saúde de envio).

A pontuação de venda é um eixo separado do engajamento: vendas é uma coisa,
e-mail é outra. Ela enxerga só comportamento de compra (quando foi a última,
quantas, quanto gastou), participação nas lives e tempo de base — e decai com
o tempo, porque a esteira é rápida: no histórico real, quem chega ao produto
principal compra **6 a 11 dias** depois de um produto de entrada.

Cada lead carrega três coisas:

| O quê | Para quê |
|---|---|
| **Pontos de venda (0–100)** | ordenar — quem está mais perto de comprar aparece primeiro |
| **Faixa** (Prontíssimo · Pronto · Aquecendo · Frio) | falar de grupo: "Prontíssimo" é sempre o top 5% |
| **Próxima oferta** | direção: qual degrau da esteira faz sentido oferecer AGORA |

As **jogadas** da aba são a esteira em forma de lista: janela quente (comprou
entrada há ≤30 dias, sem o produto principal), segunda chamada (30–90 dias),
aluno → prateleira de cima, lives → porta de entrada, novos → porta de
entrada, reativação (comprador parado >90 dias). O botão **Criar segmento**
grava a jogada como segmento vivo — a campanha mira o segmento, e a lista se
atualiza sozinha todo dia (recalcula às 03:44 e no instante de cada compra).

Dois públicos não têm botão de propósito: **Aquecer primeiro** e **Fora de
oferta** (reembolso). Campanha de venda para eles machuca o domínio ou a
relação — reengaje antes.

No construtor de segmentos, o eixo aparece como três condições novas:
**Pontuação de venda** (acima/abaixo de um valor), **Próxima oferta** (a
jogada) e **Comprou … nos últimos N dias** (a janela). "Alcançável" também
existe como condição, e é o que faz o segmento contar igual ao painel.

### A janela quente de forma automática

A jogada nº 1 roda sozinha: a automação **"[RESSOA] Formação — janela
quente"** está **ligada** desde 06/08/2026. Toda compra aprovada entra;
saem na porta quem **já tem a Formação** e quem não tem **compra aprovada
nos últimos 21 dias** (trava contra reprocessamento de eventos antigos —
sem ela, reprocessar as compras mudas de 02–05/08 despejaria compradores
de semanas atrás numa sequência que diz "ontem"). A conferência da
Formação se repete antes de cada e-mail: quem compra no meio sai sozinho,
sem nunca receber oferta do que acabou de comprar.

Os envios acontecem em **D+1, D+4 e D+8** da compra — a janela real de
conversão medida no histórico (6 a 11 dias). Os textos são as mensagens
`[Janela quente 1..3/3]` na página **Mensagens**: link para a página de
inscrição da Formação e promessas retiradas dos e-mails que a própria
conta já enviou (método, certificado MEC/ABRATH, comunidade, mentorias,
2 anos de acesso) — sem prazo falso nem bônus de lançamento, porque a
sequência roda o ano inteiro.

Para **pausar**: Automações → desmarcar Ativa. Para mudar o texto: edite
as mensagens — o próximo envio já sai com a versão nova.

### As outras sequências que rodam sozinhas

| Automação | Entra quem | Sai quem |
|---|---|---|
| Formação — janela quente | comprou um produto de entrada (D+1, D+4, D+8, D+30) | já tem a Formação, ou a compra passou de 21 dias |
| Pagamento não caiu | gerou boleto ou PIX e não pagou (4h e 24h) | pagou |
| Carrinho abandonado | chegou no checkout e não concluiu (2h) | comprou |
| Aluno → Black / Acompanhamento | comprou a Formação (D+7 e D+17) | já tem Black ou Acompanhamento |
| Lives → Desafio | entrou na lista das Lives Semanais (D+2 e D+7) | comprou qualquer coisa |
| Reativar esteira | comprador parado há mais de 90 dias | comprou nos últimos 90 dias |

A reativação não tem gatilho de evento: uma rotina semanal enfileira até
**150 pessoas por vez**, começando pelas de maior pontuação de venda.
Mandar para as 2.500 de uma vez é exatamente o disparo que queima um
domínio.

### Quanto isso vendeu

**Contatos → Lead scoring → Resultado.** Uma linha por automação e por
campanha, com pessoas, e-mails, aberturas, cliques, **compradores,
receita e receita por e-mail**.

Só conta a compra que aconteceu **depois** do e-mail sair, dentro de 14
dias. É por isso que a compra que dispara a janela quente nunca aparece
como resultado dela — creditar ao e-mail uma venda anterior a ele faria
qualquer sequência parecer perfeita.

### Saúde do envio

**Envios → Saúde do envio.** Esta operação **não trabalha com teto de
e-mails por dia** (decisão de 06/08/2026): a fila escoa no ritmo do
motor, 100 por minuto.

O que protege o domínio é o **freio**. De hora em hora o sistema olha os
últimos 7 dias e, se o bounce passar de 2% ou a reclamação de spam de
0,1% — os limites que o Gmail publica —, ele **pausa o envio sozinho** e
registra um alerta na própria página. A fila não perde nada: espera.

O freio só age a partir de 50 e-mails no período. Com pouca amostra, um
único bounce vira "taxa alta" e pararia a operação por estatística de
nada.

Sem teto, o freio deixa de ser rede secundária e passa a ser a única.
Vale olhar esses dois números depois de todo disparo grande.

---

## Outras origens de venda

O mesmo endereço aceita um formato simples, para Kiwify, Eduzz, checkout próprio ou
importação de planilha:

```bash
curl -X POST "https://SEU-PROJETO.supabase.co/functions/v1/venda" \
  -H "Content-Type: application/json" \
  -d '{"email": "comprador@email.com", "nome": "Fulana", "telefone": "61999998888",
       "produto": "Nome do Produto", "valor": 197.00, "status": "aprovada",
       "transacao": "ABC123", "data": "2026-08-01"}'
```

Status aceitos: `aprovada`, `pendente`, `reembolsada`, `parcialmente_reembolsada`,
`chargeback`, `cancelada`, `expirada`.

---

## Eventos que não são compra

A Hotmart manda muito além de venda: acesso à área de membros, módulo concluído, envio de
produto físico, troca de plano, atualização de data de cobrança.

Eles ficam **registrados como "fora do escopo"**, em cinza, com o corpo guardado. Não são
erro — e marcá-los como erro seria pior do que ignorá-los: erro vermelho para coisa normal
treina a pessoa a ignorar erro, e aí o erro de verdade passa batido.

A exceção é **cancelamento de assinatura**, que é tratado: os dados dele vêm em
`data.subscriber` em vez de `data.buyer`, e o sistema encontra a pessoa e aplica a tag de
cancelamento configurada no produto.

---

## Quando algo der errado

**Contatos → Vendas → Eventos recebidos.** Toda requisição aparece ali com o corpo
original guardado.

- **verde**: processado
- **cinza (fora do escopo)**: recebido, mas não é evento de compra
- **vermelho**: erro — passe o mouse para ver o motivo
- **nada aparecendo**: a Hotmart não chegou a chamar; o problema está na configuração lá
