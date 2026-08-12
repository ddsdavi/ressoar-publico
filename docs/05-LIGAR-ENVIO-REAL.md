# Ligar o envio real

O sistema nasce em **modo simulado**: enfileira, personaliza, marca como enviado e gera
métricas — mas **nenhum e-mail sai**. É proposital: dá para testar a operação inteira sem
risco de queimar o domínio.

O Ressoar fala com dois provedores: **Resend** e **Amazon SES**. Trocar de um para o outro é
mudar uma opção em *Configurações* — nada mais no sistema muda.

---

# Parte 1 — Resend (começar aqui, de graça)

Plano grátis: **3.000 e-mails/mês, 100/dia, 1 domínio**. Sem cartão. Permite marketing.

## 1. Criar a conta
[resend.com/signup](https://resend.com/signup) → e-mail e senha, ou entrar com o GitHub.

## 2. Verificar o domínio
**Domains → Add Domain.** Use um **subdomínio**, nunca o domínio raiz:

```
mkt.seudominio.com.br
```

Por quê: se a reputação do subdomínio se estragar, o e-mail humano do domínio raiz continua
intacto. Separar é barato agora e caríssimo depois.

O Resend mostra 3 registros DNS. Vá no **Cloudflare → DNS → Add record** e crie os três
exatamente como aparecem (2 CNAME de DKIM + 1 TXT de SPF). Deixe o **proxy desligado**
(nuvem cinza) — registro de e-mail não pode passar pelo proxy da Cloudflare.

Volte no Resend e clique em **Verify**. Costuma levar de 5 minutos a 1 hora.

Depois que verificar, crie também o DMARC no Cloudflare — registro **TXT**, nome
`_dmarc.mkt`, valor:

```
v=DMARC1; p=none; rua=mailto:dmarc@seudominio.com.br; pct=100; fo=1
```

## 3. Criar a chave da API
**API Keys → Create API Key** → permissão *Sending access* → copie (só aparece uma vez).

## 4. Ligar no painel
No Ressoar, **Configurações**:

| Campo | Valor |
|---|---|
| Provedor | `Resend` |
| Chave da API do Resend | `re_...` |
| Nome do remetente padrão | Nome do Remetente |
| E-mail do remetente padrão | `contato@mkt.seudominio.com.br` |
| URL base do tracking | `https://SEU-PROJETO.supabase.co/functions/v1` |

**Salvar.** Pronto — o próximo envio da fila sai de verdade.

## 5. Postbacks (bounces e reclamações)
No Resend, **Webhooks → Add Webhook**:

```
https://SEU-PROJETO.supabase.co/functions/v1/postback-resend
```

Marque: `email.delivered`, `email.bounced`, `email.complained`, `email.opened`,
`email.clicked`, `email.delivery_delayed`.

Bounce e reclamação **entram sozinhos na supressão** — quem deu erro nunca mais recebe.

## 6. Primeiro teste
Crie uma mensagem, uma campanha para uma lista **pequena**, e confira em **Envios**:
saiu? chegou? o rodapé de descadastro apareceu? o Gmail mostra o botão "Cancelar inscrição"
ao lado do remetente? o clique registrou?

Só depois disso parta para volume.

---

# Parte 2 — Migrar para o Amazon SES (quando o volume crescer)

**Quando vale a pena:** o grátis do Resend trava em 100/dia. Uma base de 12 mil leads não
cabe. O SES cobra **US$ 0,10 por mil e-mails** — os mesmos 12 mil saem por cerca de R$ 6,
contra US$ 20/mês do Resend pago.

**Custo da troca no sistema: uma opção em Configurações.** Personalização, pixel de abertura,
rastreio de clique, rodapé de descadastro, endereço físico, cabeçalho `List-Unsubscribe`,
supressão e relatórios são montados pelo motor **antes** de escolher o provedor. Nada disso
muda.

## 1. Conta AWS
[portal.aws.amazon.com/billing/signup](https://portal.aws.amazon.com/billing/signup) — exige
cartão e telefone (o cadastro é seu, ninguém faz por você). O programa de créditos dá
**US$ 100 no cadastro**, chegando a **US$ 200** completando as tarefas de onboarding,
válidos por 6 meses. Dá para gastar em SES.

> O free tier específico do SES foi descontinuado para clientes novos em 21/07/2026. Os
> créditos do programa novo continuam valendo.

## 2. Verificar o domínio no SES
Console → **Amazon SES → Identities → Create identity** → *Domain* → `mkt.seudominio.com.br`
→ **Easy DKIM, 2048 bits**. Crie no Cloudflare os 3 CNAME que ele mostrar (proxy desligado).

Ainda em *Identities*, configure o **Custom MAIL FROM** (ex.: `bounce.mkt.seudominio.com.br`)
e crie os registros MX e TXT que ele pedir. Sem isso o SPF não alinha com o seu domínio.

## 3. Sair do sandbox
Conta nova do SES só envia para endereços verificados, no máximo 200/dia. Peça a liberação em
**Account dashboard → Request production access**. Descreva a operação de verdade: base
opt-in vinda do ActiveCampaign, descadastro de 1 clique em todo e-mail, bounces e reclamações
alimentando supressão automática. Costuma sair em 24h.

## 4. Usuário só de envio
**IAM → Users → Create user** (sem acesso ao console) → política **AmazonSESFullAccess** →
*Security credentials → Create access key*. Guarde as duas chaves.

Nunca use a chave-mestra da conta AWS para isso.

## 5. Instalar as credenciais
No `.env`:

```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGIAO=us-east-1
SES_SEGREDO=uma-frase-longa-que-voce-inventa
```

E rode:

```bash
./instalar.sh --so-painel
```

Isso grava as chaves como **secrets da Edge Function `enviar-ses`** — elas não passam pelo
banco nem pelo navegador.

## 6. Virar a chave
No Ressoar, **Configurações**:

| Campo | Valor |
|---|---|
| Provedor | `Amazon SES` |
| Região da AWS | `us-east-1` (a mesma do passo 2) |
| Segredo interno do SES | **a mesma frase** que você pôs em `SES_SEGREDO` |

Salvar. O próximo envio já sai pela AWS.

### Como isso funciona por dentro
O SES exige assinatura criptográfica AWS SigV4 em cada requisição, e o Postgres não sabe
assinar. Por isso o motor não fala com a AWS diretamente: ele chama a Edge Function
[`enviar-ses`](../app/functions/enviar-ses/index.ts), que assina, monta o MIME (com os
cabeçalhos de descadastro) e entrega. O `SES_SEGREDO` é o que impede qualquer outro de
chamar essa função.

## 7. Postbacks do SES
O SES manda eventos por SNS, num formato diferente do Resend. Configure em
**Configuration sets → Event destinations** apontando para um tópico SNS, e desse tópico para
a função de postback. Enquanto isso não estiver pronto, **bounces não entram sozinhos na
supressão** — confira a caixa de retorno à mão nos primeiros disparos.

---

# Aquecimento — não pule, em qualquer provedor

Domínio novo disparando 50 mil de uma vez = bloqueio quase certo.

| Semana | Por dia | Para quem |
|---|---|---|
| 1 | 200 → 500 | os mais engajados (abriram nos últimos 30 dias) |
| 2 | 1.000 → 2.500 | engajados dos últimos 90 dias |
| 3 | 5.000 → 10.000 | ativos em geral |
| 4 | 20.000 → 35.000 | base ativa completa |
| 5+ | 50.000 | tudo |

Antes de começar: **limpe a base** (bounces e quem não abre há 12 meses). Acompanhe no
Google Postmaster Tools. Meta: reclamação **abaixo de 0,1%**.

> Repare que a primeira semana pede 200 a 500 por dia. O teto do plano grátis do Resend
> (100/dia) está na mesma ordem de grandeza — no começo, quem limita é o aquecimento,
> não o preço.

---

# Provedores que NÃO servem

| Serviço | Por quê |
|---|---|
| Zoho ZeptoMail | proíbe marketing em massa em contrato |
| Scaleway | idem |
| Brevo (API transacional) | separa marketing de transacional; campanha tem que passar pelo *campaign builder* deles |
| Gmail / SMTP pessoal | viola os termos e destrói a entregabilidade |

Em todos, a punição é a mesma: bloqueio da conta sem aviso e sem reembolso.
