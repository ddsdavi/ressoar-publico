# Arquitetura

## Visão geral

```
   NAVEGADOR                     SUPABASE                      MUNDO EXTERNO
┌──────────────┐         ┌───────────────────────┐        ┌──────────────────┐
│    Painel    │────────▶│  Postgres + RLS       │        │  Provedor de     │
│ (Cloudflare  │  chave  │  ─────────────────    │───────▶│  envio (SES /    │
│    Pages)    │  anon   │  motor em pg_cron     │        │  Resend)         │
└──────────────┘         │  (roda a cada minuto) │        └────────┬─────────┘
                         └──────────┬────────────┘                 │ postbacks
                                    │                              │
                         ┌──────────▼────────────┐◀────────────────┘
                         │   Edge Functions      │
                         │  rastreio, descadastro│◀── formulários do site
                         │  formulario, postback │◀── n8n / Make / checkout
                         │  conta-email          │
                         └───────────────────────┘
```

**Nada roda em servidor que você administre.** Cloudflare serve arquivos estáticos; Supabase
cuida de banco, login e funções; o motor vive dentro do próprio Postgres.

---

## As camadas do banco

### 1. Negócio (o modelo da a dona da conta)
| Tabela | O que guarda |
|---|---|
| `tabela_1_leads` | a pessoa (e-mail único, WhatsApp único quando existe) |
| `tabela_2_participacoes` | participações em eventos (1 linha por lead × evento) |
| `tabela_3_precheckout` | quem chegou ao pré-checkout |
| `tabela_4_alunos` | pedidos do checkout, com estado, transação, valor e pagamento; só `aprovada` é compra |

### 2. Operação de e-mail
`listas` + `lead_listas` (status 0=não confirmado, 1=ativo, 2=descadastrado, 3=bounce) ·
`tags` + `lead_tags` · `lead_atributos` (campos próprios em JSON) ·
`campos_personalizados` (o cadastro deles) · `segmentos` · `mensagens` · `campanhas` ·
`envios` · `eventos_email` · `supressao` · `formularios`

### 2b. Vendas e atribuição
`tabela_4_alunos` (uma linha por pedido, inclusive boleto, expiração, cancelamento e estorno) ·
`compras_por_lead` (visão: quantas compras, quanto gastou, quantos produtos) ·
`hotmart_eventos` (o corpo cru de tudo que a Hotmart mandou) ·
`hotmart_produtos` (o que cada produto faz ao ser comprado)

As visões, segmentos e gatilhos de comprador filtram `status = 'aprovada'`. Guardar um
pedido não significa afirmar que houve venda.

### 2c. Pontuação
`regras_pontuacao` (quanto vale cada comportamento) · `lead_pontuacao` (a nota, recalculada
toda madrugada). A nota é **recalculada a partir dos fatos**, nunca acumulada num contador
— contador erra quando o evento chega duas vezes, quando a regra muda de valor ou quando
alguém apaga uma tag.

### 3. Motor
`eventos_sistema` (fila de eventos) · `automacoes` + `automacao_passos` +
`automacao_execucoes` · `webhooks_saida` · `app_config`

### 4. Acesso
`usuarios_ressoar` (papel + situação) · `admins_permanentes` · `codigos_seguranca` ·
`trocas_email` · `log_seguranca`

### 5. Arquivo
`ac_*` — cópia bruta do ActiveCampaign, só leitura, para auditoria.

---

## Como o motor funciona

Quatro tarefas agendadas rodam **a cada minuto** dentro do Postgres:

| Tarefa | O que faz |
|---|---|
| `processar_eventos_sistema()` | lê a fila de eventos, casa com os gatilhos das automações e chama os webhooks de saída |
| `executar_automacoes()` | executa os passos: enviar e-mail, esperar, aplicar tag, inscrever em lista, webhook |
| `processar_fila_envios()` | pega os e-mails na fila e entrega ao provedor (ou simula) |
| `processar_campanhas()` | dispara as agendadas e encerra as que terminaram |

Mais duas, fora do ciclo de um minuto: `recalcular_pontuacao()` toda madrugada e
`limpar_exportacoes_vencidas()` uma vez por dia.

**O que enche a fila de eventos:** gatilhos no banco disparam quando alguém entra numa lista,
ganha uma tag ou é criado. Não importa se veio pelo painel, pela API ou por um formulário —
o evento nasce igual.

### Travas de envio (não dá para burlar)
1. E-mail na tabela `supressao` → nunca recebe
2. Status 2 (descadastrado) ou 3 (bounce) na lista → fora da campanha
3. Um envio por campanha por lead (chave única no banco)

A verificação de supressão acontece **três vezes**: ao montar a campanha, ao entrar na
fila e no **instante do envio**. A terceira parece redundante e não é — entre montar a
campanha e o e-mail sair podem passar horas, e nesse intervalo alguém pode ter clicado em
descadastrar.

### O que todo e-mail leva, injetado pelo motor
Personalização (`{{nome}}` e as variáveis herdadas do AC) · texto de prévia · pixel de
abertura · **todos os links reescritos** para registrar clique · rodapé com endereço
físico e link de descadastro · cabeçalho `List-Unsubscribe` de um clique, exigido pelo
Gmail e pelo Yahoo para quem envia em massa.

O link de descadastro fica **de fora** da reescrita de clique, de propósito: passar por ela
quebraria o cancelamento de um clique.

---

## Segurança de acesso

O painel usa a chave **anon** (pública). Quem decide o que cada um vê é o **RLS do Postgres**,
com base na função `papel_atual()`. Consequência prática: mesmo que alguém pegue a chave e
chame a API por fora, continua limitado ao próprio nível.

| Nível | Escreve na operação | Dispara e-mail | Configurações |
|---|---|---|---|
| Assistente | ✅ | 🚫 | 🚫 |
| Terapeuta | ✅ | ✅ | 🚫 |
| Admin | ✅ | ✅ | ✅ |

Funções internas do motor são **revogadas** do usuário logado — só o cron as executa.

---

## O painel

React + Vite, sem framework de UI. Estrutura visual copiada do ActiveCampaign
(topbar escura + rail de ícones + sidebar branca), com as cores da marca da a dona da conta.

| Arquivo | Responsabilidade |
|---|---|
| `lib/sessao.tsx` | sessão, perfil e os poderes (`ehAdmin`, `podeOperar`, `podePreparar`) |
| `lib/papeis.ts` | rótulos e a tabela comparativa de permissões |
| `components/Tour.tsx` | tour guiado (abre no 1º acesso, reabre pelo `?`) |
| `components/EditorEmail.tsx` | editor visual de e-mail (GrapesJS) |
| `components/ControlesAparencia.tsx` | tema e escala de texto (usado na topbar e no login) |
| `pages/*.tsx` | uma tela por arquivo |

**Escala de texto:** a variável `--escala-texto` multiplica todo `font-size`. Nunca use `zoom`.
