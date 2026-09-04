# Ressoar

Plataforma própria de e-mail marketing, automação e vendas. Substitui o ActiveCampaign
por um sistema que roda em infraestrutura de custo quase zero e que você controla inteiro.

Foi construída para operar a base da Nome do Remetente — 12 mil leads de sua área
— mas nada aqui é específico dela. Serve para qualquer operação de infoproduto.

🔗 **No ar:** https://ressoar.seudominio.com.br

---

## O que ele faz

| | |
|---|---|
| **Leads** | listas, tags, campos próprios, segmentos com E/OU, importação e exportação por CSV |
| **E-mail** | editor visual, campanhas, personalização, rastreio de abertura e clique |
| **Automações** | quadro visual com gatilhos, espera, condições se/então e integrações |
| **Formulários** | construtor com página publicada no seu próprio domínio |
| **Vendas** | recebe a Hotmart em tempo real: produto, valor, status, reembolso |
| **Atribuição** | de qual anúncio veio cada venda, com receita por origem |
| **Lead scoring** | duas réguas por lead: quem está pronto pra **comprar** e pra quem é seguro **enviar** |
| **Telemetria de venda** | quanto cada automação e cada campanha **vendeu em reais**, não só abertura e clique |
| **Recuperação** | boleto e PIX gerados e não pagos, pagamento atrasado, carrinho abandonado |
| **Relatórios** | base, campanhas, tags, campos e de onde vem o dinheiro |
| **Acesso** | três níveis de usuário, com as regras dentro do banco |
| **WhatsApp** | marca a pessoa no ManyChat quando ela compra, e é a tag que dispara a mensagem lá |
| **Planilhas** | conta Google conectada uma vez; automações escrevem linhas com as colunas mapeadas |

O WhatsApp não sai daqui: quem manda é o ManyChat. A Ressoar decide **quem** e **quando**.

---

## As duas réguas do lead scoring

Cada lead carrega **dois números que não se misturam**, porque respondem a perguntas
diferentes:

| Régua | O que enxerga | Para que serve |
|---|---|---|
| **Venda** (0 a 100) | recência da última compra (com decaimento), quantidade, gasto, presença nas lives | ordenar quem está mais perto de comprar — e dizer **o que oferecer** |
| **Engajamento** | abertura, clique, tempo parado | decidir por quem começar a enviar sem machucar a reputação do domínio |

A régua de venda não olha e-mail de propósito: vendas é uma coisa, engajamento é outra.

Duas escolhas de desenho que evitam o defeito clássico de lead scoring:

- **O número é contínuo, não soma de regras binárias.** Regra binária empata milhares de
  pessoas no mesmo valor, e empate não ordena — que é justamente o serviço do número.
- **As faixas são por percentil, não por corte fixo.** "Prontíssimo" é sempre o top 5%;
  a régua se recalibra sozinha conforme a base muda, e nunca satura.

Junto do número vai a **próxima oferta**: o degrau da esteira que faz sentido para aquela
pessoa agora, com o motivo escrito por extenso ("Comprou 3x · R$ 420 · última há 9 dias").
Nenhum score é caixa preta. Cada oferta vira segmento em um clique, e segmento é o que a
campanha mira.

---

## Como se sabe se o e-mail vendeu

Abertura e clique não pagam boleto. A telemetria cruza os envios com as compras aprovadas
e mostra, por automação e por campanha: pessoas, e-mails, aberturas, cliques,
**compradores, receita e receita por e-mail**.

A regra de atribuição é conservadora de propósito: só conta a compra que aconteceu
**depois** do e-mail sair, dentro de uma janela. É isso que impede uma sequência disparada
*por* uma compra de se creditar por ela — sem esse cuidado, a automação "converteria" 100%
no primeiro dia.

---

## O freio de entregabilidade

Domínio que dispara demais, ou para lista velha, é tratado como spam — e o estrago não é
da campanha, é do domínio, por meses.

De hora em hora o sistema olha os últimos 7 dias e, se o bounce passar de 2% ou a
reclamação de spam de 0,1% (os limites que o Gmail publica), **pausa o envio sozinho** e
registra um alerta no painel. A fila não perde nada: espera.

O freio só age a partir de um volume mínimo. Com pouca amostra, um único bounce vira "taxa
alta" e pararia a operação por estatística de nada.

---

## Quanto custa rodar

| Peça | Serviço | Custo |
|---|---|---|
| Banco, login e funções | Supabase | grátis até 500 MB |
| Painel | Cloudflare Pages | grátis |
| E-mail | Resend | grátis até 3.000/mês · depois US$ 20 |
| E-mail (alternativa) | Amazon SES | US$ 0,10 por mil |

Uma base de 12 mil leads com um disparo mensal cabe no plano grátis do Supabase e do
Cloudflare. O e-mail é o único custo real: cerca de **R$ 6 por disparo completo** no SES.

---

## Instalar do zero

Você precisa de [Node 20+](https://nodejs.org), [Python 3.10+](https://python.org), uma
conta [Supabase](https://supabase.com) e uma conta [Cloudflare](https://cloudflare.com).
As duas contas são gratuitas.

```bash
git clone <endereço-do-repositório>
cd ressoar
cp .env.example .env      # preencha as chaves — cada linha diz onde achar
./instalar.sh             # Linux e Mac
```

No Windows, o último comando é `.\instalar.ps1`.

**Um comando faz tudo:** cria as tabelas, instala as funções do banco, agenda as tarefas
automáticas, publica as 11 funções públicas e sobe o painel. No fim ele imprime o endereço
e o que fazer em seguida.

Rodar de novo é seguro — todo arquivo usa `create ... if not exists` ou
`create or replace`. Nada é apagado.

```bash
./instalar.sh --so-banco    # só o banco
./instalar.sh --so-painel   # só o painel e as funções
```

Passo a passo detalhado: **[docs/01-INSTALAR.md](docs/01-INSTALAR.md)**

---

## Documentação

| | |
|---|---|
| **[01 — Instalar](docs/01-INSTALAR.md)** | do zero até o painel no ar |
| **[02 — Arquitetura](docs/02-ARQUITETURA.md)** | como as peças se encaixam, e por quê |
| **[03 — Migrar do ActiveCampaign](docs/03-MIGRAR-DO-ACTIVECAMPAIGN.md)** | trazer contatos, listas, tags e e-mails |
| **[04 — Operação](docs/04-OPERACAO.md)** | o dia a dia: campanhas, segmentos, automações |
| **[05 — Ligar o envio real](docs/05-LIGAR-ENVIO-REAL.md)** | Resend, Amazon SES, DNS e aquecimento de domínio |
| **[06 — Armadilhas conhecidas](docs/06-PROBLEMAS-CONHECIDOS.md)** | cada uma custou horas de depuração |
| **[07 — Vendas e Hotmart](docs/07-VENDAS-E-HOTMART.md)** | receber compra em tempo real e atribuir a venda ao anúncio |
| **[08 — Recuperação e conteúdo](docs/08-RECUPERACAO-E-CONTEUDO.md)** | carrinho abandonado, contador regressivo, módulos salvos e ManyChat |
| **[09 — Onde parei](docs/09-ONDE-PAREI.md)** | **comece por aqui:** estado atual, travas ligadas e o que está pendente |
| **[10 — Criar uma captação](docs/10-CRIAR-UMA-CAPTACAO.md)** | a receita do zero: lista, tag, formulário, ManyChat e planilha |
| **[11 — Duplicar e vender](docs/11-DUPLICAR-E-VENDER.md)** | uma segunda instalação para outra operação: de onde sai a cópia, o que trocar e o que decidir antes de vender |

---

## Como está organizado

```
ressoar/
├─ instalar.sh · instalar.ps1   o instalador de um comando
├─ .env.example                 todas as chaves, com onde achar cada uma
│
├─ supabase/                    o banco, na ordem em que é aplicado
│  ├─ replica_*.sql             tabelas de negócio
│  ├─ motor_v*.sql              o motor: eventos, automações, envio
│  ├─ auth_v*.sql               contas, papéis e segurança
│  ├─ hotmart_*.sql             recebimento de vendas
│  ├─ atribuicao_*.sql          de qual anúncio veio a venda
│  └─ …                         pontuação, formulários, relatórios
│
├─ app/
│  ├─ functions/                11 funções públicas (Deno)
│  │  ├─ formulario/            captação de lead
│  │  ├─ venda/                 webhook da Hotmart
│  │  ├─ rastreio/              pixel de abertura e clique
│  │  ├─ descadastro/           página de saída
│  │  ├─ postback-resend/       retornos do Resend
│  │  ├─ postback-ses/          retornos do Amazon SES
│  │  ├─ enviar-ses/            envio assinado pela AWS
│  │  ├─ conta-email/           códigos de segurança da conta
│  │  ├─ contador/              contador regressivo, desenhado como imagem
│  │  └─ manychat/              ponte com o WhatsApp e o Instagram
│  │
│  └─ painel/                   React + Vite (Cloudflare Pages)
│     └─ src/pages/             uma tela por arquivo
│
├─ scripts/                     migração e manutenção (Python)
│  └─ conferir_instalacao.py    "esta instalação está inteira, e só dela?"
└─ docs/                        a documentação
```

---

## A ideia por trás

**O motor vive dentro do banco.** Não há servidor de aplicação para manter, escalar ou
pagar. Quatro tarefas agendadas rodam a cada minuto dentro do próprio Postgres: leem a
fila de eventos, executam as automações, drenam a fila de e-mails e disparam as campanhas
agendadas.

**A segurança também.** Quem pode ver e fazer o quê é decidido por RLS no banco, não pela
tela. Mesmo que alguém pegue a chave pública e chame a API por fora, continua limitado ao
próprio nível de acesso.

**As travas são estruturais.** Quem está na supressão nunca recebe — a verificação
acontece três vezes, em momentos diferentes, e a última é no instante do envio. Um envio
por campanha por pessoa é garantido por chave única no banco, não por código que pode
falhar.

**Toda sequência tem porta de saída.** Antes de cada e-mail, a automação confere se a
pessoa já fez o que a sequência queria — quem compra no meio do caminho sai sozinho, sem
receber a oferta do que acabou de comprar. Uma observação que custou uma correção: desligar
a automação **não** para quem já está dentro dela, porque o executor decide pelo estado da
*execução*. Para parar de verdade, encerre também as execuções em aberto.

---

## Segurança e dados pessoais

O `.gitignore` bloqueia, e isso não é opcional:

- `.env` e qualquer chave — principalmente a `service_role`
- `activecampaign-export/` — dados pessoais de milhares de pessoas
- `vendas-hotmart/` — nome, e-mail, telefone e valor pago de compradores
- todo e qualquer `.csv`
- `*.local.sql` — migração cujos **valores** são dado pessoal

### Migração com dado pessoal dentro

Algumas tabelas são pequenas mas guardam identificação direta: CPF com nome de cliente,
e-mail da própria equipe. A migração fica dividida em duas:

| Arquivo | Contém | Vai para o Git? |
|---|---|---|
| `assunto_v1.sql` | tabela, políticas e **o porquê** | sim |
| `assunto_dados.local.sql` | só os valores reais | **não** |

Quem reconstrói o banco do zero roda os dois, nessa ordem — está escrito dentro de cada um.
Sem o segundo, a tabela nasce vazia e a regra que ela representa some sem avisar.

### Antes de publicar

```bash
git ls-files | grep -E "\.env$|export/|\.csv$|\.local\.sql$"
```

Não deve retornar nada. E vale varrer as linhas **adicionadas** desde a última publicação,
não só a árvore:

```bash
git diff <última-publicação>..HEAD | grep "^+" |
  grep -nE "[A-Za-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo)\.|[0-9]{10,15}"
```

Telefone estrangeiro não tem o `55` na frente: procurar por `55\d{10,11}` deixa passar o
número de um comprador de fora. Procure qualquer sequência longa de dígitos e olhe uma a
uma — foi assim que 14 telefones reais foram pegos num arquivo de teste em 06/08/2026.

---

## Licença

Uso interno. Não há licença aberta. Uma segunda instalação para outra operação é
licenciada por contrato, instalação a instalação — o roteiro técnico está em
[docs/11-DUPLICAR-E-VENDER.md](docs/11-DUPLICAR-E-VENDER.md).
