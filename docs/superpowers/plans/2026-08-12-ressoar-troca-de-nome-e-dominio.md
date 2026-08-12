# Plano — Ressoa vira Ressoar (nome do produto + domínio), sem parar o carro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** renomear o produto de **Ressoa** para **Ressoar**, mover o painel de
`ressoa.drapatriciadomingos.com.br` para `ressoar.drapatriciadomingos.com.br` e
consertar os três defeitos que a investigação achou — com a operação rodando o tempo
inteiro e **zero perda de dado novo** (compras da Hotmart, inscrições de formulário,
postbacks de e-mail, ManyChat).

**Arquitetura da troca:** tudo é **aditivo até o fim**. O domínio novo entra como
*segundo* domínio do mesmo projeto Cloudflare Pages (os dois servem o mesmo painel e o
mesmo banco ao mesmo tempo); só depois disso o nome troca no código e nas configurações.
O domínio antigo continua funcionando até o Davi decidir conectar outra coisa nele
(Fase B) — e essa decisão tem checklist próprio.

**Stack:** Cloudflare Pages (painel React/Vite, projeto `ressoa`), Supabase
(`$SUPABASE_PROJECT_REF` no `.env`; banco + Auth + 11 Edge Functions), Resend,
Hotmart, ManyChat, wrangler já logado na conta certa nesta máquina.

**Onde se trabalha:** no próprio diretório do projeto, na `main` — como todo o histórico
deste repositório. **Worktree isolada não serve aqui**: `.env` e `app/painel/.env.local`
são ignorados pelo git e existem só neste diretório; sem eles, nenhum comando de deploy,
SQL ou build funciona.

**Data:** 2026-08-12. Levantamento feito com leitura do repositório, do DNS, da
configuração viva do Auth e varredura só-leitura do banco de produção.

---

## Por que essa troca não perde dado nenhum (o mapa verificado)

A pergunta que governa o plano: **por onde entra dado novo, e algum desses caminhos
passa pelo domínio que vai mudar?** Resposta, verificada ponto a ponto em 12/08:

| Porta de entrada | Endereço real | Passa pelo domínio do painel? |
|---|---|---|
| Webhook de venda da Hotmart | `…supabase.co/functions/v1/venda` | **Não** |
| Formulário das Lives (landing no Lovable) | POST direto em `…supabase.co/functions/v1/formulario` | **Não** |
| Formulários embutidos em sites de fora | snippet posta em `…supabase.co/functions/v1/formulario` (código gerado usa `VITE_SUPABASE_URL`) | **Não** |
| Pixel de abertura, clique e descadastro nos e-mails | `base_url_tracking` = `…supabase.co/functions/v1` | **Não** |
| Postbacks do Resend / SES | `…supabase.co/functions/v1/postback-*` | **Não** |
| ManyChat (External Request) e vigia de banidos | `…supabase.co/functions/v1/manychat` + cron no banco | **Não** |
| Callback do OAuth do Google (planilhas) | `…supabase.co/functions/v1/google-sheets/callback`; a volta ao painel usa a **origem dinâmica** gravada no `state` | **Não** |
| Motor (7 crons do pg_cron) | dentro do próprio Postgres | **Não** |
| O painel em si + páginas `/f/<slug>` | `ressoa.drapatriciadomingos.com.br` | **Sim — e é só isso** |

O domínio serve exclusivamente **pessoas**: a equipe no painel e visitantes de páginas
`/f/`. Como o domínio novo entra **ao lado** do antigo (mesmo projeto Pages), em nenhum
segundo existe um domínio fora do ar. Não há migração de dados: banco, funções e
webhooks nem sabem que o domínio mudou.

As únicas referências vivas ao domínio antigo, encontradas por varredura completa
(repositório + banco de produção + config do Auth):

1. **`enviar_resumo_diario`** (função do banco) — link fixo
   `https://ressoa.drapatriciadomingos.com.br/leadscoring` e assunto "Ressoa · …".
   Única função do banco com o domínio dentro (confirmado via `pg_proc`).
2. **Supabase Auth** — `site_url` e `uri_allow_list` com o domínio antigo (é o que monta
   `{{ .ConfirmationURL }}` dos e-mails de confirmação/convite/recuperação).
3. **Docs** do repositório (referências em texto).

## Os três defeitos que entram de carona (achados na investigação)

1. **Allowlist do Auth com endereço morto** — listava `ressoa.pages.dev`, mas o projeto
   responde em `ressoa-2zl.pages.dev`. Corrigido na Task 2.
2. **`instalar.ps1 -SoPainel` apaga a assinatura do painel** — o passo "gerando o
   arquivo de configuração" **regrava** `app/painel/.env.local` só com as duas variáveis
   do Supabase, levando junto `VITE_MARCA_NOME`/`VITE_MARCA_RODAPE`. Quem publicasse por
   ele poria no ar um painel sem assinatura. Vale para `instalar.sh` também. Task 4.
3. **"Nome do Remetente" literal nos e-mails de conta** — resíduo da sanitização do
   espelho público: `conta-email/index.ts` e `scripts/aplicar_emails_auth.py` mandam
   e-mail de verdade com o texto de placeholder no cabeçalho. Task 4.

---

## Global Constraints

- **Regra do renome (vale em todas as tarefas):**
  - `Ressoa` (palavra exata, R maiúsculo, com fronteira de palavra) → `Ressoar`.
  - `ressoa.drapatriciadomingos.com.br` → `ressoar.drapatriciadomingos.com.br`.
  - **Nada mais muda.** A regra é desenhada para NÃO tocar, por construção:
    identificadores camelCase (`MarcaRessoa`, `naRessoa`, `pulsoRessoa`), minúsculas
    (`usuarios_ressoa`, crons `ressoa-*`, classe `.ressoa-form`,
    `application/x-ressoa-*`, `ressoa.pages.dev`, repos GitHub `ressoa`/
    `ressoa-publico`, caminho n8n `/webhook/ressoa/transacional`) e maiúsculas
    (variáveis `RESSOA_*`, nomes de automação `[RESSOA]`).
  - Artigos ficam como estão ("a Ressoa" → "a Ressoar", "no Ressoa" → "no Ressoar") —
    leitura natural em PT, diff mínimo.
- **Identificadores internos NÃO são renomeados nesta leva** (nem depois, salvo os da
  Fase C): renomear projeto do Pages, crons, tabela, envs ou webhooks é risco sem
  ganho — ninguém de fora vê.
- **Aditivo sempre:** nenhuma tarefa derruba, remove ou troca algo que esteja
  atendendo tráfego. Remoções só na Fase B, com gate do Davi.
- **Repo público:** nenhum segredo, telefone, e-mail real ou nome de pessoa entra em
  arquivo versionado. Valores reais só no `.env` e no `app/painel/.env.local`, que o
  git ignora.
- **Produção é tudo junto:** GitHub, Supabase e Cloudflare saem na mesma leva.
- **NÃO usar `instalar.ps1 -SoPainel` para publicar** durante esta migração (defeito 2;
  só está consertado a partir da Task 4). Publicação é manual (Task 8).
- **Nada de e-mail para lead real.** Nenhuma tarefa dispara campanha, automação ou
  `enviar_resumo_diario()`. As provas usam o endereço do próprio Davi.
- Pastas fora do renome: `blueprint/` e `docs/superpowers/` (história de projeto, como
  "ActiveCampaign" ficou nos docs), `activecampaign-export/`, `dist/`, `node_modules/`.

---

### Task 1 — Domínio novo no ar, ao lado do antigo (nenhuma linha de código)

**Onde:** painel do Cloudflare (única etapa sem CLI — Pages não expõe custom domain
pelo wrangler). Conta já confirmada: projeto **`ressoa`** com `ressoa-2zl.pages.dev` +
`ressoa.drapatriciadomingos.com.br`; a zona `drapatriciadomingos.com.br` está no
Cloudflare (nameservers cory/zara).

- [ ] **1.1** Dashboard → Workers & Pages → projeto **ressoa** → **Custom domains** →
  *Set up a custom domain* → `ressoar.drapatriciadomingos.com.br` → Activate.
  O Cloudflare cria o CNAME sozinho (zona na mesma conta). Certificado sai em minutos.
- [ ] **1.2** Verificar que o domínio novo serve o painel (ainda com o nome antigo —
  esperado nesta fase):

```bash
curl -sI https://ressoar.drapatriciadomingos.com.br | head -3
```

Esperado: `HTTP/2 200`.

- [ ] **1.3** Conferir que o domínio antigo segue intacto:

```bash
curl -sI https://ressoa.drapatriciadomingos.com.br | head -3
```

Esperado: `HTTP/2 200`.

**Produz:** os dois domínios servindo o mesmo painel, mesmo banco. Nada para migrar.

---

### Task 2 — O Auth do Supabase aprende o domínio novo (e o allowlist morto some)

`{{ .ConfirmationURL }}` dos e-mails de conta usa o `site_url`; o `uri_allow_list` diz
quais redirects são aceitos. Estado atual: `site_url` no domínio antigo; allowlist com
domínio antigo + `ressoa.pages.dev` (**defeito 1**) + localhost.

**Interfaces:**
- Consome: Task 1 verificada (o `site_url` novo precisa estar servindo).
- Produz: e-mails de conta apontando para o domínio novo; domínio antigo ainda aceito.

- [ ] **2.1** Aplicar a configuração nova — domínio novo vira o principal, o antigo
  **continua na lista** (links de e-mail já emitidos seguem válidos):

```bash
cd "/d/1. CLAUDE/RESSOA" && export $(grep -E '^SUPABASE_(ACCESS_TOKEN|PROJECT_REF)=' .env | xargs) && curl -s -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: ressoa-setup/1.0" -d '{"site_url":"https://ressoar.drapatriciadomingos.com.br","uri_allow_list":"https://ressoar.drapatriciadomingos.com.br,https://ressoar.drapatriciadomingos.com.br/**,https://ressoa.drapatriciadomingos.com.br,https://ressoa.drapatriciadomingos.com.br/**,https://ressoa-2zl.pages.dev,https://ressoa-2zl.pages.dev/**,http://localhost:5173,http://localhost:5173/**"}' | grep -o '"site_url":"[^"]*"'
```

Esperado: `"site_url":"https://ressoar.drapatriciadomingos.com.br"`.

---

### Task 3 — O renome no repositório, de uma vez e com revisão

Um script aplica a regra global (palavra exata + domínio) no repositório inteiro; o diff
é revisado antes de qualquer publicação. Locais com `RESSOA` em caixa alta que são
**texto** (não identificador) são 3 edições manuais.

**Files:**
- Create: `scripts/renomear_ressoar.py`
- Modify: tudo que casar a regra em `app/`, `docs/` (menos `docs/superpowers/`),
  `scripts/`, `supabase/`, `operacao/`, `README.md`, `.env.example`, `instalar.ps1`,
  `instalar.sh`

**Interfaces:**
- Produz: repositório renomeado e compilando. A Task 4 edita por cima de alguns dos
  mesmos arquivos (`conta-email/index.ts`, `aplicar_emails_auth.py`, os dois
  instaladores, `.env.example`), então esta tem que fechar antes.

- [ ] **3.1** Criar `scripts/renomear_ressoar.py`:

```python
# -*- coding: utf-8 -*-
"""Renome unico da marca: Ressoa -> Ressoar (palavra exata, R maiusculo) e o
subdominio antigo -> novo. Identificadores nao mudam por construcao: camelCase
(MarcaRessoa), minusculas (usuarios_ressoa, ressoa-*, .ressoa-form) e caixa
alta (RESSOA_*, [RESSOA]) nao casam com \\bRessoa\\b. Regra e motivo no plano
docs/superpowers/plans/2026-08-12-ressoar-troca-de-nome-e-dominio.md."""
import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parents[1]
INCLUIR = ["app", "docs", "scripts", "supabase", "operacao", "README.md",
           ".env.example", "instalar.ps1", "instalar.sh"]
PULAR_PASTAS = {".git", "node_modules", "dist", "activecampaign-export",
                "blueprint", "superpowers", "vendas-hotmart", ".temp"}
EXT = {".ts", ".tsx", ".md", ".sql", ".py", ".ps1", ".sh", ".html", ".css",
       ".txt", ".example", ".toml", ".json"}

PALAVRA = re.compile(r"\bRessoa\b")
DOM_VELHO = "ressoa.drapatriciadomingos.com.br"
DOM_NOVO = "ressoar.drapatriciadomingos.com.br"

mudados = 0
for base in INCLUIR:
    raiz = RAIZ / base
    arquivos = [raiz] if raiz.is_file() else \
        [p for p in raiz.rglob("*") if p.is_file()]
    for arq in arquivos:
        if set(arq.parts) & PULAR_PASTAS:
            continue
        if arq.suffix.lower() not in EXT:
            continue
        texto = arq.read_text(encoding="utf-8", errors="ignore")
        novo = PALAVRA.sub("Ressoar", texto).replace(DOM_VELHO, DOM_NOVO)
        if novo != texto:
            arq.write_text(novo, encoding="utf-8", newline="")
            mudados += 1
            print("  ->", arq.relative_to(RAIZ))
print(f"{mudados} arquivos alterados")
```

- [ ] **3.2** Rodar e revisar o diff:

```bash
cd "/d/1. CLAUDE/RESSOA" && python scripts/renomear_ressoar.py && git diff --stat | tail -5
```

Esperado: dezenas de arquivos (painel, funções, docs, sql, scripts). Revisar o diff por
amostragem: strings de tela viraram "Ressoar", identificadores intactos.

- [ ] **3.3** As 3 edições manuais de caixa alta (texto de banner, não identificador):
  `instalar.ps1` (cabeçalho `# RESSOA — instalador…` e banner `RESSOA INSTALADO`),
  `instalar.sh` (os dois equivalentes) e `.env.example` (linha 2, `# RESSOA — copie…`)
  → `RESSOAR`. **Não tocar** em `RESSOA_EMAIL_WEBHOOK`/`RESSOA_EMAIL_SEGREDO`.

- [ ] **3.4** Verificações de fechamento (todas devem bater):

```bash
cd "/d/1. CLAUDE/RESSOA" && grep -rnP '\bRessoa\b' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.sql' --include='*.py' --include='*.ps1' --include='*.sh' --include='*.html' --include='*.css' --include='*.txt' --include='*.toml' app docs scripts supabase operacao README.md instalar.ps1 instalar.sh .env.example | grep -v superpowers | wc -l
```

Esperado: `0`.

```bash
cd "/d/1. CLAUDE/RESSOA" && grep -rln "ressoa\.drapatriciadomingos" app docs scripts supabase operacao | grep -v superpowers | wc -l
```

Esperado: `0`.

```bash
cd "/d/1. CLAUDE/RESSOA" && grep -c "MarcaRessoa" app/painel/src/pages/Login.tsx; grep -c "usuarios_ressoa" instalar.ps1; grep -c "ressoa-form" app/painel/src/pages/Formularios.tsx; grep -c "RESSOA_EMAIL_SEGREDO" instalar.sh
```

Esperado: quatro números maiores que zero (identificadores preservados).

- [ ] **3.5** Build do painel prova que nada quebrou:

```bash
cd "/d/1. CLAUDE/RESSOA" && npm --prefix app/painel run build
```

Esperado: build verde, sem erro de TypeScript.

- [ ] **3.6** Commit:

```bash
cd "/d/1. CLAUDE/RESSOA" && git add -A && git commit -m "O produto se chama Ressoar: nome no painel, nos e-mails do sistema e na documentacao"
```

**Produz:** repositório renomeado e compilando. Nada publicado ainda — produção segue
dizendo "Ressoa" até a Task 8.

---

### Task 4 — A assinatura sai do código e vira configuração (defeitos 2 e 3)

Hoje o nome de quem assina a instalação está **escrito à mão** em dois arquivos que
mandam e-mail de verdade, com o texto de placeholder "Nome do Remetente" — resíduo da
sanitização que tirou o nome real do repositório público. E o instalador **apaga** a
assinatura do painel toda vez que regenera o `.env.local`.

A cura é a mesma para os dois: **uma fonte só**, o `.env` (fora do git), e o instalador
levando o valor para os dois destinos — o painel (via `VITE_*` no `.env.local`) e a
Edge Function `conta-email` (via secret `MARCA_NOME`). Vazio em todos os lugares = tudo
se apresenta só como Ressoar, sem nome de ninguém e sem cara de campo esquecido.

**Files:**
- Modify: `.env` (fora do git — não aparece no diff), `.env.example`, `instalar.ps1`,
  `instalar.sh`, `app/functions/conta-email/index.ts`,
  `scripts/aplicar_emails_auth.py`

**Interfaces:**
- Consome: Task 3 (os arquivos já dizem "Ressoar").
- Produz: secret `MARCA_NOME` esperado pela Task 5 (deploy) e pela Task 6 (templates do
  Auth, que leem `VITE_MARCA_NOME` do ambiente).

- [ ] **4.1** No `.env` local (arquivo ignorado pelo git — os valores reais já existem
  em `app/painel/.env.local`, copie de lá), acrescentar ao fim, **com aspas duplas**:

```
# --- Assinatura da instalacao ---
# As aspas NAO sao enfeite: o instalar.sh faz `source .env`, e valor com espaco
# sem aspas faz o shell tentar executar a segunda palavra como comando.
VITE_MARCA_NOME="<o valor que ja esta em app/painel/.env.local>"
VITE_MARCA_RODAPE="<o valor que ja esta em app/painel/.env.local>"
```

Prova de que o `.env` continua legível pelos dois instaladores:

```bash
cd "/d/1. CLAUDE/RESSOA" && ( set -a && . ./.env && set +a && echo "sh le: [$VITE_MARCA_NOME]" )
```

Esperado: o nome entre colchetes, **sem** aspas e sem erro de "command not found".

- [ ] **4.2** No `.env.example`, substituir o bloco atual da assinatura (que manda
  preencher `app/painel/.env.local` à mão) por este, que diz onde a informação mora
  agora:

```
# --- Assinatura da instalação (opcional) ---
# Quem assina: aparece na aba do navegador, no rodapé da barra lateral, na tela
# de entrada e no cabeçalho dos e-mails de conta. Preencha AQUI: o instalador
# leva o valor para o painel (app/painel/.env.local, porque o Vite só entrega ao
# navegador o que começa com VITE_) e para a Edge Function conta-email (secret
# MARCA_NOME). Vazias, tudo se apresenta só como Ressoar — nome de ninguém.
VITE_MARCA_NOME=
VITE_MARCA_RODAPE=
```

- [ ] **4.3a** Ainda em `instalar.ps1`, o leitor do `.env` precisa **tirar as aspas** que
  a linha 4.1 obrigou a existir — sem isso o valor viaja com aspas e o e-mail de conta
  sai assinado com as aspas na cara do leitor. Trocar:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process")
  }
}
```

por:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
    # O .sh faz `source .env`, entao valor com espaco PRECISA de aspas la; aqui
    # elas sao ruido e teriam de ser tiradas na mao em cada uso.
    $valor = $Matches[2].Trim() -replace '^"(.*)"$', '$1' -replace "^'(.*)'$", '$1'
    [Environment]::SetEnvironmentVariable($Matches[1], $valor, "Process")
  }
}
```

- [ ] **4.3** No passo 4/6 do `instalar.ps1`, passar a escrever as quatro linhas. Trocar:

```powershell
  @(
    "VITE_SUPABASE_URL=$env:SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY=$env:SUPABASE_ANON_KEY"
  ) | Out-File -FilePath "app/painel/.env.local" -Encoding utf8
```

por:

```powershell
  # A assinatura vem junto: este arquivo e REESCRITO a cada instalacao, e sem
  # estas duas linhas o -SoPainel publicava um painel sem assinatura nenhuma.
  @(
    "VITE_SUPABASE_URL=$env:SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY=$env:SUPABASE_ANON_KEY",
    "VITE_MARCA_NOME=$env:VITE_MARCA_NOME",
    "VITE_MARCA_RODAPE=$env:VITE_MARCA_RODAPE"
  ) | Out-File -FilePath "app/painel/.env.local" -Encoding utf8
```

- [ ] **4.4** Ainda em `instalar.ps1`, logo depois do bloco que configura os segredos do
  canal de e-mail (`RESSOA_EMAIL_WEBHOOK`/`RESSOA_EMAIL_SEGREDO`), acrescentar:

```powershell
  if ($env:VITE_MARCA_NOME) {
    Push-Location app
    npx --yes supabase secrets set "MARCA_NOME=$($env:VITE_MARCA_NOME)" --project-ref $env:SUPABASE_PROJECT_REF | Out-Null
    Pop-Location
    Ok "Assinatura dos e-mails de conta configurada"
  }
```

- [ ] **4.5** Em `instalar.sh`, o mesmo par. Trocar o heredoc do passo 4/6:

```sh
  cat > app/painel/.env.local <<EOF
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
EOF
```

por:

```sh
  # A assinatura vem junto: este arquivo é REESCRITO a cada instalação, e sem
  # estas duas linhas o --so-painel publicava um painel sem assinatura nenhuma.
  cat > app/painel/.env.local <<EOF
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
VITE_MARCA_NOME=${VITE_MARCA_NOME:-}
VITE_MARCA_RODAPE=${VITE_MARCA_RODAPE:-}
EOF
```

e, depois do bloco dos segredos do canal de e-mail, acrescentar:

```sh
  if [ -n "${VITE_MARCA_NOME:-}" ]; then
    (cd app && npx --yes supabase secrets set \
        MARCA_NOME="$VITE_MARCA_NOME" \
        --project-ref "$SUPABASE_PROJECT_REF" >/dev/null) && verde "  Assinatura dos e-mails de conta configurada"
  fi
```

- [ ] **4.6** Em `app/functions/conta-email/index.ts`, o molde do e-mail para de trazer
  o nome escrito à mão. Imediatamente **antes** da constante `molde`, acrescentar:

```ts
// Quem assina a instalação vem do secret MARCA_NOME — não do código: este
// repositório tem espelho público, e nome de pessoa não mora em arquivo
// versionado. Vazio, o e-mail se apresenta só como Ressoar.
const MARCA = (Deno.env.get("MARCA_NOME") ?? "").trim();
const ASSINATURA = MARCA
  ? ` <span style="opacity:.6;font-weight:400;font-size:13px">&nbsp;·&nbsp; ${MARCA}</span>`
  : "";
```

e, na linha do cabeçalho dentro de `molde`, trocar

```
>Ressoar <span style="opacity:.6;font-weight:400;font-size:13px">&nbsp;·&nbsp; Nome do Remetente</span></td></tr>
```

por

```
>Ressoar${ASSINATURA}</td></tr>
```

- [ ] **4.7** Em `scripts/aplicar_emails_auth.py`, a mesma ideia lendo do ambiente.
  Logo depois da linha `TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]`, acrescentar:

```python
# Quem assina vem do .env (VITE_MARCA_NOME), nunca do código: o repositório tem
# espelho público. Vazio, os e-mails se apresentam só como Ressoar.
MARCA = os.environ.get("VITE_MARCA_NOME", "").strip()
ASSINATURA = (' <span style="opacity:.6;font-weight:400;font-size:13px">'
              "&nbsp;·&nbsp; %s</span>" % MARCA) if MARCA else ""
```

Transformar a constante `BASE` em f-string para receber `{ASSINATURA}` — o `%s` do
corpo e os `%%` continuam como estão, porque `BASE % corpo` segue sendo usado:

```python
BASE = f"""<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f6fa;font-family:'IBM Plex Sans',Segoe UI,Arial,sans-serif">
<table width="100%%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(23,0,32,.08)">
  <tr><td style="background:#170020;padding:20px 28px;color:#fff;font-size:18px;font-weight:700;letter-spacing:.3px">
    Ressoar{ASSINATURA}
  </td></tr>
  <tr><td style="padding:30px 28px;color:#1F2129;font-size:15px;line-height:1.7">
    %s
  </td></tr>
  <tr><td style="padding:18px 28px;background:#faf8fb;color:#5F667E;font-size:12px;line-height:1.6">
    Se você não esperava este e-mail, pode ignorar com segurança — nada acontece sem você clicar.
  </td></tr>
</table>
</td></tr></table></body></html>"""
```

E o template `invite`, que cita o nome no meio da frase, passa a ter as duas versões.
Antes do dicionário `templates`, acrescentar:

```python
CONVITE = ("<p><b>Você foi convidada para o Ressoar</b>, a plataforma de e-mails "
           "da %s.</p>" % MARCA) if MARCA else \
          "<p><b>Você foi convidada para o Ressoar.</b></p>"
```

e no template `invite` usar `CONVITE` no lugar da frase escrita à mão.

- [ ] **4.8** Provas de que os quatro arquivos continuam válidos:

```bash
cd "/d/1. CLAUDE/RESSOA" && python -m py_compile scripts/aplicar_emails_auth.py && echo "python OK" && bash -n instalar.sh && echo "sh OK"
```

Esperado: `python OK` e `sh OK`.

```powershell
powershell -NoProfile -Command "[void][scriptblock]::Create((Get-Content -Raw 'D:\1. CLAUDE\RESSOA\instalar.ps1')); 'ps1 OK'"
```

Esperado: `ps1 OK`.

```bash
cd "/d/1. CLAUDE/RESSOA" && grep -rn "Nome do Remetente" app scripts | wc -l
```

Esperado: `0`.

- [ ] **4.9** Commit:

```bash
cd "/d/1. CLAUDE/RESSOA" && git add -A && git commit -m "Quem assina a instalacao vem da configuracao: o instalador para de apagar a marca do painel e o e-mail de conta para de dizer Nome do Remetente"
```

---

### Task 5 — Publicar as funções que falam com gente (e o secret da assinatura)

Só duas funções têm **saída visível** com o nome: `conta-email` (códigos de segurança,
avisos de conta) e `google-sheets` (texto do callback). As demais mudaram só em
comentários — sobem na próxima leva completa. Deploy de Edge Function é troca atômica de
versão; `venda` e `manychat` nem são tocadas.

**Interfaces:**
- Consome: Task 4 (o código lê `MARCA_NOME`; o `.env` tem `VITE_MARCA_NOME`).

- [ ] **5.1** Gravar o secret e publicar as duas funções (PowerShell, na raiz do repo):

```powershell
Set-Location "D:\1. CLAUDE\RESSOA"
Get-Content .env -Encoding utf8 | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $v = $Matches[2].Trim() -replace '^"(.*)"$', '$1'; [Environment]::SetEnvironmentVariable($Matches[1], $v, "Process") } }
Write-Host "assinatura lida: [$env:VITE_MARCA_NOME]"   # SEM aspas e COM acento certo
Copy-Item app/functions/* app/supabase/functions/ -Recurse -Force
Push-Location app
npx --yes supabase functions deploy conta-email --project-ref $env:SUPABASE_PROJECT_REF --no-verify-jwt --use-api
npx --yes supabase functions deploy google-sheets --project-ref $env:SUPABASE_PROJECT_REF --no-verify-jwt --use-api
Pop-Location
```

Esperado: dois deploys concluídos, e a assinatura impressa com o acento correto.

- [ ] **5.1b** O secret `MARCA_NOME` **não** vai pelo CLI: valor com acento atravessa dois
  conversores de página de código no Windows (a leitura do arquivo e a passagem de
  argumento para o executável) e chega corrompido — foi o que aconteceu em 12/08, com o
  secret gravado como `PatrÃ­cia Domingos`. Vai pela API, que é UTF-8 de ponta a ponta,
  e a conferência é por hash (o Supabase devolve o secret como SHA-256, então dá para
  provar o que está lá sem nunca imprimir o valor):

```bash
cd "/d/1. CLAUDE/RESSOA" && python - <<'PY'
import json, re, urllib.request, hashlib, pathlib
env = dict(re.findall(r'^([A-Z_]+)=(.*)$', pathlib.Path(".env").read_text(encoding="utf-8"), re.M))
valor = env["VITE_MARCA_NOME"].strip().strip('"')
ref, tok = env["SUPABASE_PROJECT_REF"], env["SUPABASE_ACCESS_TOKEN"]
cab = {"Authorization": "Bearer " + tok, "User-Agent": "ressoa-setup/1.0"}
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/secrets",
                             data=json.dumps([{"name": "MARCA_NOME", "value": valor}]).encode("utf-8"),
                             method="POST", headers={**cab, "Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=60) as r: print("POST ->", r.status)
with urllib.request.urlopen(urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/secrets", headers=cab), timeout=60) as r:
    guardado = {s["name"]: s.get("value") for s in json.load(r)}
esperado = hashlib.sha256(valor.encode("utf-8")).hexdigest()
print("BATE" if guardado.get("MARCA_NOME") == esperado else "NAO BATE")
PY
```

Esperado: `POST -> 201` e `BATE`.

- [ ] **5.2** Prova real, com o endereço do próprio Davi: na tela de login do domínio
  novo, "Esqueci a senha" → o e-mail do código chega com **Ressoar · a assinatura configurada** no cabeçalho (nunca mais "Nome do Remetente").

---

### Task 6 — Templates de e-mail do Auth · **NÃO SE APLICA** (medido em 12/08/2026)

Tentado e recusado, e a investigação mostrou que também é desnecessário:

1. **O Supabase bloqueia**: projeto no plano grátis usando o provedor de e-mail padrão
   não pode editar template — as cinco chamadas voltam com *"Email template modification
   is not available for free tier projects using the default email provider"*. Só com
   plano pago ou SMTP próprio.
2. **E não faria diferença**: `mailer_autoconfirm` está **ligado** (a conta nasce
   confirmada, então nem o e-mail de confirmação sai), e o painel não usa nenhum outro
   fluxo de e-mail do Auth — `resetPasswordForEmail`, `signInWithOtp` e `inviteUser` não
   aparecem no código. Recuperar senha, trocar e-mail e excluir conta passam pela Edge
   Function `conta-email`, pelo canal próprio (n8n). Os templates do Auth estão hoje no
   **padrão em inglês do Supabase** e ninguém os recebe.

O que ficou feito, e vale: o script **voltou a compilar** (estava com erro de sintaxe
desde a sanitização do espelho público — ver Task 4) e já lê a assinatura do `.env`.
Ele fica guardado para o dia em que houver SMTP próprio, com um cabeçalho explicando
por que hoje ele devolve cinco erros.

> Registro do que foi tentado, para quem repetir:

- [ ] **6.1**

```bash
cd "/d/1. CLAUDE/RESSOA" && ( set -a && . ./.env && set +a && python scripts/aplicar_emails_auth.py )
```

Esperado: 5 linhas `chave -> assunto`, todas com "Ressoar" e nenhuma com erro.

O `set -a; . ./.env` não é preciosismo: `export $(grep … | xargs)` **quebra** em valor com
espaço, porque o shell reparte o resultado da substituição em palavras e tenta exportar
`Domingos` como se fosse outra variável. Vale para qualquer comando deste plano que
precise de `VITE_MARCA_NOME`.

---

### Task 7 — Banco: o resumo diário e a mensagem antiga

A Task 3 já corrigiu `supabase/resumo_diario_v1.sql` (link `…/leadscoring` e assunto
"Ressoar · N compras…"). Falta reaplicar no banco — o arquivo é `create or replace`,
reaplicar é a via normal deste repositório.

- [ ] **7.1**

```bash
cd "/d/1. CLAUDE/RESSOA" && export $(grep -E '^SUPABASE_(ACCESS_TOKEN|PROJECT_REF)=' .env | xargs) && python scripts/run_sql_file.py supabase/resumo_diario_v1.sql
```

- [ ] **7.2** Conferir que o banco não guarda mais o domínio antigo em função nenhuma:

```bash
cd "/d/1. CLAUDE/RESSOA" && export $(grep -E '^SUPABASE_(ACCESS_TOKEN|PROJECT_REF)=' .env | xargs) && curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: ressoa-setup/1.0" -d '{"query":"select count(*)::text as funcoes_com_dominio_velho from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='"'"'public'"'"' and p.prosrc ilike '"'"'%ressoa.drapatriciadomingos%'"'"'"}'
```

Esperado: `[{"funcoes_com_dominio_velho":"0"}]`.

- [ ] **7.3** A única mensagem da biblioteca com o nome antigo (teste histórico "Olá
  {{nome}}, o Ressoa está no ar" — não está em automação nenhuma; atualizar é inerte,
  nenhum envio acontece):

```bash
cd "/d/1. CLAUDE/RESSOA" && export $(grep -E '^SUPABASE_(ACCESS_TOKEN|PROJECT_REF)=' .env | xargs) && curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: ressoa-setup/1.0" -d '{"query":"update public.mensagens set subject = replace(subject, '"'"'Ressoa'"'"', '"'"'Ressoar'"'"'), html = replace(html, '"'"'Ressoa'"'"', '"'"'Ressoar'"'"') where mensagem_id = '"'"'6c92a779-2599-4057-b221-4877835ec9c6'"'"' returning subject"}'
```

Esperado: `[{"subject":"Olá {{nome}}, o Ressoar está no ar"}]`.

- [ ] **7.4** ⚠️ **Não** disparar `enviar_resumo_diario()` para testar — manda e-mail
  real para quem estiver em `resumo_diario_para`. A prova é o resumo das 8h de amanhã.

---

### Task 8 — Publicar o painel: o momento em que o nome troca na tela

- [ ] **8.1**

```bash
cd "/d/1. CLAUDE/RESSOA" && npm --prefix app/painel run build && npx --yes wrangler pages deploy app/painel/dist --project-name ressoa --branch main --commit-dirty=true
```

Esperado: "Deployment complete!". Os **dois** domínios passam a servir o build novo no
mesmo instante (mesmo projeto).

- [ ] **8.2** Provas:

```bash
curl -s https://ressoar.drapatriciadomingos.com.br | grep -o "<title>[^<]*</title>"
```

Esperado: `<title>Ressoar</title>`.

No navegador, no domínio novo: aba e tela de entrada mostram **"Ressoar · a assinatura configurada"** (a assinatura vem do `.env.local`); `/f/lives-semanais` renderiza; uma tela
interna abre sem erro no console.

---

### Task 9 — Verificação fim-a-fim de que o carro nunca parou

- [ ] **9.1** Hotmart continua entrando (o webhook nunca dependeu do domínio; isto é
  evidência, não conserto):

```bash
cd "/d/1. CLAUDE/RESSOA" && export $(grep -E '^SUPABASE_(ACCESS_TOKEN|PROJECT_REF)=' .env | xargs) && curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: ressoa-setup/1.0" -d '{"query":"select max(created_at)::text as ultimo_hotmart, (select max(criado_em)::text from public.manychat_log) as ultimo_manychat, (select count(*)::text from public.envios where status = '"'"'queued'"'"') as fila from public.hotmart_eventos"}'
```

Esperado: timestamps recentes; a fila é informativa (o envio segue pausado por ordem do
dono — não destravar).

- [ ] **9.2** Login + "esqueci a senha" no domínio **novo**, ponta a ponta.
- [ ] **9.3** Login no domínio **antigo** ainda funciona (equipe em transição).
- [ ] **9.4** O resumo diário **não serve de prova**: `resumo_diario_para` está vazio
  desde 06/08 (conferido em 12/08), então o e-mail das 8h não sai para ninguém. A prova
  do resumo é a checagem de código da Task 7.2 (nenhuma função do banco com o domínio
  antigo). Quem for religar o resumo um dia preenche `resumo_diario_para` em
  Configurações — e aí o assunto já nasce "Ressoar · …".

---

### Task 10 — Diário, commit e espelhos

- [ ] **10.1** Registrar no topo de `docs/09-ONDE-PAREI.md`, no padrão do diário: o que
  mudou (nome + domínio), o que **não** mudou de propósito (identificadores: crons
  `ressoa-*`, `usuarios_ressoa`, automações `[RESSOA]`, projeto Pages `ressoa`, envs
  `RESSOA_*`, repos GitHub), os dois defeitos consertados de carona (instalador que
  apagava a assinatura; "Nome do Remetente" nos e-mails de conta) e o estado da Fase B
  (domínio antigo vivo, aguardando decisão).
- [ ] **10.2** Commit + push do privado:

```bash
cd "/d/1. CLAUDE/RESSOA" && git add -A && git commit -m "O diario registra a troca: Ressoa virou Ressoar com o carro andando" && git push origin main
```

- [ ] **10.3** Espelho público — **só com ordem do Davi**, e sempre com a varredura de
  segurança antes:

```bash
cd "/d/1. CLAUDE/RESSOA" && git ls-files | grep -E "\.env$|export/|\.csv$|\.local\.sql$" | wc -l
```

Esperado: `0`. Então o ritual do espelho (histórias paralelas, sem push direto):

```bash
cd "/d/1. CLAUDE/RESSOA" && git fetch publico && TREE=$(git rev-parse HEAD^{tree}) && C=$(git commit-tree "$TREE" -p publico/main -m "Ressoa virou Ressoar: nome e dominio novos") && git push publico "$C:refs/heads/main"
```

---

## Fase B — liberar o domínio antigo (gate: decisão do Davi, sem prazo)

O `ressoa.` fica no ar servindo o painel até aqui — não custa nada e não conflita.
Quando o Davi for conectar a outra coisa nele:

1. **Checklist antes de desconectar** — procurar `ressoa.drapatriciadomingos` em:
   fluxos e mensagens do ManyChat, links de bio (`links.` / `biopatricia…`), anúncios
   ativos, planilhas e docs da equipe, favoritos do time. O único endereço público
   conhecido hoje é a página `/f/lives-semanais` — e a landing real das Lives (Lovable)
   **não** usa essa página (posta direto na função), então a exposição esperada é zero;
   conferir mesmo assim.
2. (Opcional, recomendado) Regra de redirect na zona do Cloudflare, que roda na frente
   do que ocupar o domínio: `301 ressoa.…/f/* → ressoar.…/f/$1` — proteção perpétua
   para link de formulário antigo, sem atrapalhar o novo ocupante.
3. Pages → projeto ressoa → Custom domains → **remover**
   `ressoa.drapatriciadomingos.com.br`. O DNS do subdomínio fica livre.
4. Limpeza no Auth: tirar o domínio antigo do `uri_allow_list` (mesmo curl da Task 2,
   sem as duas entradas antigas).
5. Avisar a equipe: favoritos novos; sessões abertas no domínio antigo morrem com ele.

## Fase C — cosméticos adiados (cada um com seu risco escrito; nenhum é necessário)

| Item | Risco se fizer | Veredito sugerido |
|---|---|---|
| Automações `[RESSOA] …` (8 no banco) | as migrações que as criam têm guarda **por nome** (`janela_quente_v*`, `recuperacao_e_jogadas_v1`, `lives_passo_planilha_v1`, `desafio_planilha_v1`…): renomear a linha viva sem editar a guarda faz o instalador recriar duplicata — **ativa** | só com edição casada linha-viva + migração; fora da troca de pneu |
| Crons `ressoa-*` | zero ganho (ninguém de fora vê) | deixar |
| Consentimento Google "Ressoa" (projeto `ressoa-504702`) | trocar nome de app **Em produção** com escopo sensível (Sheets) pode reabrir verificação da marca; o redirect URI não muda | trocar sem pressa, aceitando eventual re-verificação — e, no mesmo dia, atualizar os dois textos que citam o nome da tela do Google: o comentário em `app/functions/google-sheets/index.ts` e o bloco "Planilhas do Google" do `.env.example` |
| Repos GitHub `ressoa` / `ressoa-publico` | baixo (GitHub redireciona nome antigo); ajustar `git remote set-url` | opcional |
| Projeto Supabase (nome de exibição) | zero (o ref não muda) | pode renomear à vontade |
| Projeto Pages `ressoa` / `ressoa-2zl.pages.dev` | **quebra** o alvo do deploy, o pages.dev e o allowlist | **nunca** |
| Webhook n8n `/webhook/ressoa/transacional` + secrets `RESSOA_*` | quebra código de login se dessincronizar | deixar |
| Tabela `usuarios_ressoa`, classe `.ressoa-form`, tipos `application/x-ressoa-*` | quebra real (banco e embeds já instalados em sites de terceiros) | **nunca** |

## Fica pendente, e é decisão do Davi (não desta leva)

Três textos das telas ainda falam do ActiveCampaign no presente, como se estivesse
ligado — o aviso de "pode gerar disparo duplicado" ao ligar os webhooks, o "só saem com
a chave-geral LIGADA — pra não duplicar com o AC enquanto ele existir" e o "enquanto o
ActiveCampaign ainda estiver rodando, deixe desligados" em Configurações. O AC morreu em
05/08 e os webhooks estão ligados: hoje esses avisos justificam uma trava com um motivo
que não existe mais. Já estava anotado no diário como decisão em aberto desde 06/08.
