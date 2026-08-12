# Instalar do zero

Recriar o Ressoar inteiro num projeto novo. Tempo: ~30 minutos.

---

## Antes de começar

| Você precisa de | Onde conseguir | Custo |
|---|---|---|
| Node 20+ | https://nodejs.org | grátis |
| Python 3.10+ | https://python.org | grátis |
| Conta Supabase | https://supabase.com | grátis |
| Conta Cloudflare | https://cloudflare.com | grátis |

---

## Passo 1 — Criar o projeto no Supabase

1. https://supabase.com/dashboard → **New project**
2. Região: **South America (São Paulo)** — mais perto dos seus leads
3. Guarde a senha do banco (o instalador não precisa dela, mas você vai querer depois)
4. Espere ficar verde (~2 min)

Anote em *Project Settings*:
- **Reference ID** (em *General*)
- **Project URL**, **anon public** e **service_role** (em *API*)

E gere um token pessoal em https://supabase.com/dashboard/account/tokens → começa com `sbp_`.

## Passo 2 — Pegar o ID da conta Cloudflare

https://dash.cloudflare.com → escolha a conta → o ID aparece na URL:
`dash.cloudflare.com/`**`SEU_ACCOUNT_ID`**`/...`

> ⚠️ Se você tem mais de uma conta, use a que **é dona do domínio** que vai usar. Misturar contas
> é a armadilha nº 10 de [06-PROBLEMAS-CONHECIDOS.md](06-PROBLEMAS-CONHECIDOS.md).

## Passo 3 — Baixar e configurar

```bash
git clone <endereço-do-repositório>
cd ressoa
cp .env.example .env
```

Abra o `.env` e preencha com o que você anotou. Cada linha tem um comentário dizendo onde achar.

## Passo 4 — Rodar o instalador

```bash
./instalar.sh        # Linux/Mac
.\instalar.ps1       # Windows (PowerShell)
```

Ele cria o banco inteiro, publica as 5 funções e sobe o painel. No fim, imprime o endereço.

> Na primeira vez o `wrangler` pode pedir para você autorizar no navegador. Escolha a conta certa.

## Passo 5 — Criar o primeiro admin

1. Abra o painel → **Criar conta** → cadastre-se
2. A conta nasce *pendente* (ninguém entra sem liberação)
3. No Supabase → **SQL Editor**, rode:

```sql
update public.usuarios_ressoa
set papel = 'admin', status = 'aprovado'
where email = 'SEU@EMAIL.COM';
```

4. Recarregue o painel — você entrou como Admin.

### Contas de admin permanente (opcional)

E-mails nessa lista nascem admin aprovados e **não podem ser rebaixados nem excluídos**:

```sql
insert into public.admins_permanentes (email, nota)
values ('dona@empresa.com', 'Dona da operação');
```

## Passo 6 — Domínio próprio (opcional)

1. Cloudflare → **Workers & Pages** → seu projeto → **Custom domains** → adicione o subdomínio
2. Em **DNS** do domínio, crie:

| Tipo | Nome | Destino | Proxy |
|---|---|---|---|
| CNAME | `ressoa` | `<seu-projeto>.pages.dev` | ligado |

3. No Supabase → **Authentication → URL Configuration**, ponha a URL final em
   *Site URL* e em *Redirect URLs*.

## Passo 7 — Canal de e-mail transacional

Os códigos de segurança (troca de e-mail, exclusão de conta, recuperar senha) saem por um
webhook. O mais simples é um fluxo no n8n:

1. **Webhook** (POST) → 2. **IF** conferindo `{{ $json.body.segredo }}` → 3. **Gmail/SMTP**
   enviando para `{{ $json.body.para }}` com assunto `{{ $json.body.assunto }}` e corpo HTML
   `{{ $json.body.html }}`

Ponha a URL e o segredo no `.env` (`RESSOA_EMAIL_WEBHOOK`, `RESSOA_EMAIL_SEGREDO`) e rode
`./instalar.sh --so-painel` para reenviar os segredos.

## Passo 8 — Trazer sua base

[03-MIGRAR-DO-ACTIVECAMPAIGN.md](03-MIGRAR-DO-ACTIVECAMPAIGN.md) para vir do AC, ou
importe um CSV direto pelo painel em **Leads → Importar CSV**.

## Passo 9 — Ligar o envio real

O sistema começa em **modo simulado**: processa tudo, mas nenhum e-mail sai — de propósito,
para você testar sem risco. Para ligar: [05-LIGAR-ENVIO-REAL.md](05-LIGAR-ENVIO-REAL.md).

---

## Atualizar depois

```bash
git pull
./instalar.sh            # reaplica banco + funções + painel (é seguro repetir)
./instalar.sh --so-painel  # só o painel
./instalar.sh --so-banco   # só o banco
```

Todos os arquivos SQL usam `create ... if not exists` / `create or replace` — rodar de novo
não apaga nada.

---

## O que o instalador NÃO aplica, e por quê

Ficam de fora, de propósito:

| Arquivo | Por quê |
|---|---|
| `corrige_*.sql` | consertos pontuais de uma migração específica — não fazem sentido num banco novo |
| `regras_produtos.sql` | as regras dos produtos de **uma** operação; monte as suas pela tela |
| `teste_*.sql` | provas do motor, para rodar à mão quando quiser conferir |

Os testes valem a pena conhecer:

```bash
python scripts/run_sql_file.py supabase/teste_automacao.sql   # prova gatilho → passo
python scripts/run_sql_file.py supabase/teste_condicao.sql    # prova o se/então
```

Os dois só aplicam tags. **Nenhum e-mail sai**, então dá para rodar a qualquer momento —
inclusive em produção, se você desconfiar que uma automação parou de disparar.
