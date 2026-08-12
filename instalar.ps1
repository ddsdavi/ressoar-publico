# ============================================================
# RESSOAR — instalador de 1 comando (Windows)
#   .\instalar.ps1              instala tudo
#   .\instalar.ps1 -SoBanco     só cria/atualiza o banco
#   .\instalar.ps1 -SoPainel    só publica o painel
# ============================================================
param([switch]$SoBanco, [switch]$SoPainel)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Passo($t) { Write-Host "`n> $t" -ForegroundColor Magenta }
function Ok($t)    { Write-Host "  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  $t" -ForegroundColor Yellow }
function Erro($t)  { Write-Host $t -ForegroundColor Red; exit 1 }

# ---------- 1. checagens ----------
Passo "1/6 Conferindo o ambiente"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Erro "Node nao encontrado. Instale o Node 20+: https://nodejs.org" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Erro "Python nao encontrado. Instale o Python 3.10+" }
Ok "Node $(node -v) e Python OK"

if (-not (Test-Path .env)) { Erro "Falta o arquivo .env. Rode: copy .env.example .env  — e preencha as chaves." }
# -Encoding utf8 nao e opcional: sem ele o Windows PowerShell le o .env na
# pagina de codigo ANSI e "Patricia" com acento chega como mojibake ate o
# painel e o cabecalho dos e-mails de conta. Medido em 12/08/2026.
Get-Content .env -Encoding utf8 | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
    # O .sh faz `source .env`, entao valor com espaco PRECISA de aspas la; aqui
    # elas sao ruido e teriam de ser tiradas na mao em cada uso.
    $valor = $Matches[2].Trim() -replace '^"(.*)"$', '$1' -replace "^'(.*)'$", '$1'
    [Environment]::SetEnvironmentVariable($Matches[1], $valor, "Process")
  }
}
$faltando = @()
foreach ($v in @("SUPABASE_PROJECT_REF","SUPABASE_ACCESS_TOKEN","SUPABASE_URL","SUPABASE_ANON_KEY")) {
  $valor = [Environment]::GetEnvironmentVariable($v, "Process")
  if (-not $valor -or $valor -like "*xxxx*") { $faltando += $v }
}
if ($faltando.Count -gt 0) { Erro ("Preencha no .env: " + ($faltando -join ", ")) }
Ok ".env preenchido"

# ---------- 2. banco ----------
if (-not $SoPainel) {
  # Nao entram aqui, de proposito: corrige_* (consertos de uma migracao
  # especifica), regras_* (produtos de uma operacao especifica) e teste_*
  Passo "2/6 Criando o banco (tabelas, funcoes, permissoes e agendamentos)"
  # A ordem vem de supabase/ordem.txt - a mesma fonte que o instalar.sh usa.
  if (-not (Test-Path "supabase/ordem.txt")) { Erro "Falta supabase/ordem.txt" }
  $sqls = Get-Content "supabase/ordem.txt" |
          Where-Object { $_.Trim() -ne "" -and -not $_.TrimStart().StartsWith("#") } |
          ForEach-Object { $_.Trim() }
  foreach ($s in $sqls) {
    if (-not (Test-Path $s)) { Erro "  listado em ordem.txt mas nao existe: $s" }
  }
  foreach ($sql in $sqls) {
    Write-Host "  -> $(Split-Path $sql -Leaf)"
    python scripts/run_sql_file.py $sql | Out-Null
    if ($LASTEXITCODE -ne 0) { Erro "  falhou em $sql" }
  }
  Ok "Banco pronto"
}

if (-not $SoBanco) {
  # ---------- 3. painel ----------
  Passo "3/6 Instalando as dependencias do painel"
  npm --prefix app/painel install --silent
  Ok "Dependencias instaladas"

  Passo "4/6 Gerando o arquivo de configuracao do painel"
  # A assinatura vem junto: este arquivo e REESCRITO a cada instalacao, e sem
  # estas duas linhas o -SoPainel publicava um painel sem assinatura nenhuma.
  @(
    "VITE_SUPABASE_URL=$env:SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY=$env:SUPABASE_ANON_KEY",
    "VITE_MARCA_NOME=$env:VITE_MARCA_NOME",
    "VITE_MARCA_RODAPE=$env:VITE_MARCA_RODAPE"
  ) | Out-File -FilePath "app/painel/.env.local" -Encoding utf8
  Ok "app/painel/.env.local criado"

  # ---------- 4. Edge Functions ----------
  Passo "5/6 Publicando as Edge Functions"
  New-Item -ItemType Directory -Force "app/supabase/functions" | Out-Null
  Copy-Item "app/functions/*" "app/supabase/functions/" -Recurse -Force
  if ($env:RESSOAR_EMAIL_WEBHOOK -and $env:RESSOAR_EMAIL_SEGREDO) {
    Push-Location app
    npx --yes supabase secrets set "RESSOAR_EMAIL_WEBHOOK=$env:RESSOAR_EMAIL_WEBHOOK" "RESSOAR_EMAIL_SEGREDO=$env:RESSOAR_EMAIL_SEGREDO" --project-ref $env:SUPABASE_PROJECT_REF | Out-Null
    Pop-Location
    Ok "Segredos do canal de e-mail configurados"
  } else {
    Aviso "(canal transacional nao configurado — codigos de seguranca nao serao enviados)"
  }
  # Pela API, nao pelo CLI: no Windows o CLI corrompe acento na passagem de
  # argumento. E grava SEMPRE (inclusive vazio), senao apagar o nome do .env
  # deixava o e-mail assinado com o nome velho.
  $env:MARCA_NOME = $env:VITE_MARCA_NOME
  python scripts/definir_secret.py MARCA_NOME
  Ok "Assinatura dos e-mails de conta configurada"
  if ($env:AWS_ACCESS_KEY_ID -and $env:AWS_SECRET_ACCESS_KEY) {
    $regiao = if ($env:AWS_REGIAO) { $env:AWS_REGIAO } else { "us-east-1" }
    Push-Location app
    npx --yes supabase secrets set "AWS_ACCESS_KEY_ID=$($env:AWS_ACCESS_KEY_ID)" `
      "AWS_SECRET_ACCESS_KEY=$($env:AWS_SECRET_ACCESS_KEY)" "AWS_REGIAO=$regiao" `
      "SES_SEGREDO=$($env:SES_SEGREDO)" --project-ref $env:SUPABASE_PROJECT_REF | Out-Null
    Pop-Location
    Write-Host "  Credenciais do Amazon SES configuradas" -ForegroundColor Green
  }
  # A lista sai do proprio diretorio: funcao nova entra sozinha.
  $funcoes = Get-ChildItem -Directory app/functions | ForEach-Object { $_.Name }
  foreach ($f in $funcoes) {
    Write-Host "  -> $f"
    Push-Location app
    npx --yes supabase functions deploy $f --project-ref $env:SUPABASE_PROJECT_REF --no-verify-jwt --use-api | Out-Null
    Pop-Location
  }
  Ok "  $($funcoes.Count) funcoes publicadas"

  # ---------- 5. publicar ----------
  Passo "6/6 Publicando o painel"
  npm --prefix app/painel run build --silent
  if ($env:CLOUDFLARE_ACCOUNT_ID -and $env:CLOUDFLARE_ACCOUNT_ID -notlike "*xxxx*") {
    # Projeto "ressoar" desde 12/08/2026: os dois dominios foram movidos para
    # ele (o Pages nao renomeia projeto, entao foi criado um novo e os dominios
    # mudaram de casa um por vez, sem janela). O projeto antigo "ressoa" ficou
    # vazio de dominios e pode ser apagado quando der.
    npx --yes wrangler pages project create ressoar --production-branch main 2>$null
    npx --yes wrangler pages deploy app/painel/dist --project-name ressoar --branch main --commit-dirty=true
    Ok "Painel publicado"
  } else {
    Aviso "CLOUDFLARE_ACCOUNT_ID nao preenchido — pulei a publicacao."
    Aviso "Para rodar local: npm --prefix app/painel run dev"
  }
}

Write-Host @"

============================================================
  RESSOAR INSTALADO
============================================================

O QUE FAZER AGORA

1) CRIAR O PRIMEIRO ADMIN
   Abra o painel, clique em "Criar conta" e cadastre-se.
   Depois libere a conta no SQL Editor do Supabase:

     update public.usuarios_ressoar
     set papel = 'admin', status = 'aprovado'
     where email = 'SEU@EMAIL.COM';

2) DOMINIO PROPRIO (opcional)
   Cloudflare Pages > projeto > Custom domains + CNAME para <projeto>.pages.dev
   Depois registre a URL em Supabase > Authentication > URL Configuration.

3) ENVIO REAL
   O sistema comeca em MODO SIMULADO. Para ligar: docs/05-LIGAR-ENVIO-REAL.md

4) TRAZER SUA BASE DO ACTIVECAMPAIGN
   Siga docs/03-MIGRAR-DO-ACTIVECAMPAIGN.md

Documentacao completa: pasta docs/
"@ -ForegroundColor Cyan
