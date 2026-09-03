#!/usr/bin/env bash
# ============================================================
# RESSOAR — instalador de 1 comando.
#   ./instalar.sh              instala tudo
#   ./instalar.sh --so-banco   só cria/atualiza o banco
#   ./instalar.sh --so-painel  só publica o painel
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

verde() { printf "\033[32m%s\033[0m\n" "$1"; }
amarelo() { printf "\033[33m%s\033[0m\n" "$1"; }
vermelho() { printf "\033[31m%s\033[0m\n" "$1"; }
passo() { printf "\n\033[35m▶ %s\033[0m\n" "$1"; }

# ---------- 1. checagens ----------
passo "1/6 Conferindo o ambiente"
command -v node >/dev/null || { vermelho "Node não encontrado. Instale o Node 20+: https://nodejs.org"; exit 1; }
command -v python >/dev/null || command -v python3 >/dev/null || { vermelho "Python não encontrado. Instale o Python 3.10+"; exit 1; }
PY=$(command -v python || command -v python3)
verde "  Node $(node -v) e Python OK"

[ -f .env ] || { vermelho "Falta o arquivo .env. Rode: cp .env.example .env  — e preencha as chaves."; exit 1; }
set -a; source .env; set +a

faltando=""
for v in SUPABASE_PROJECT_REF SUPABASE_ACCESS_TOKEN SUPABASE_URL SUPABASE_ANON_KEY; do
  [ -n "${!v:-}" ] && [[ "${!v}" != *xxxx* ]] || faltando="$faltando $v"
done
[ -z "$faltando" ] || { vermelho "Preencha no .env:$faltando"; exit 1; }
verde "  .env preenchido"

SO_BANCO=false; SO_PAINEL=false
[ "${1:-}" = "--so-banco" ] && SO_BANCO=true
[ "${1:-}" = "--so-painel" ] && SO_PAINEL=true

# ---------- 2. banco ----------
if [ "$SO_PAINEL" = false ]; then
  # Nao entram aqui, de proposito:
  #   corrige_*.sql   consertos pontuais de uma migracao especifica
  #   regras_*.sql    regras dos produtos de uma operacao especifica
  #   teste_*.sql     provas do motor, para rodar a mao quando quiser
  passo "2/6 Criando o banco (tabelas, funções, permissões e agendamentos)"
  # A ordem vem de supabase/ordem.txt — uma linha por arquivo. Ver o cabeçalho
  # de lá para o porquê de não morar aqui dentro.
  [ -f supabase/ordem.txt ] || { vermelho "Falta supabase/ordem.txt"; exit 1; }
  while IFS= read -r sql; do
    case "$sql" in ''|\#*) continue ;; esac
    [ -f "$sql" ] || { vermelho "  listado em ordem.txt mas não existe: $sql"; exit 1; }
    printf "  → %s\n" "$(basename "$sql")"
    "$PY" scripts/run_sql_file.py "$sql" >/dev/null || { vermelho "  falhou em $sql"; exit 1; }
  done < supabase/ordem.txt
  # Os valores que sao DESTA instalacao — o endereco que o motor chama, o
  # endereco publico do painel, os remetentes verificados — vem do .env,
  # nunca de dentro de uma migracao (ver scripts/configurar_instancia.py).
  "$PY" scripts/configurar_instancia.py || { vermelho "  falhou ao gravar os valores desta instalacao"; exit 1; }
  verde "  Banco pronto"
fi


# ---------- 3. dependências do painel ----------
if [ "$SO_BANCO" = false ]; then
  passo "3/6 Instalando as dependências do painel"
  npm --prefix app/painel install --silent
  verde "  Dependências instaladas"

  passo "4/6 Gerando o arquivo de configuração do painel"
  # A assinatura vem junto: este arquivo é REESCRITO a cada instalação, e sem
  # estas duas linhas o --so-painel publicava um painel sem assinatura nenhuma.
  cat > app/painel/.env.local <<EOF
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
VITE_MARCA_NOME=${VITE_MARCA_NOME:-}
VITE_MARCA_RODAPE=${VITE_MARCA_RODAPE:-}
EOF
  verde "  app/painel/.env.local criado"

  # ---------- 4. Edge Functions ----------
  passo "5/6 Publicando as Edge Functions"
  mkdir -p app/supabase/functions
  cp -r app/functions/* app/supabase/functions/
  export SUPABASE_ACCESS_TOKEN
  if [ -n "${RESSOAR_EMAIL_WEBHOOK:-}" ] && [ -n "${RESSOAR_EMAIL_SEGREDO:-}" ]; then
    (cd app && npx --yes supabase secrets set \
        RESSOAR_EMAIL_WEBHOOK="$RESSOAR_EMAIL_WEBHOOK" \
        RESSOAR_EMAIL_SEGREDO="$RESSOAR_EMAIL_SEGREDO" \
        --project-ref "$SUPABASE_PROJECT_REF" >/dev/null) && verde "  Segredos do canal de e-mail configurados"
  else
    amarelo "  (canal transacional não configurado — códigos de segurança não serão enviados)"
  fi
  # Pela API, nao pelo CLI (ver scripts/definir_secret.py). E grava SEMPRE,
  # inclusive vazio.
  MARCA_NOME="${VITE_MARCA_NOME:-}" "$PY" scripts/definir_secret.py MARCA_NOME
  verde "  Assinatura dos e-mails de conta configurada"
  # O destino de cortesia de um link de rastreio quebrado e o endereco
  # publico do painel (VITE_OG_URL). Grava SEMPRE, inclusive vazio — vazio,
  # a funcao mostra uma pagina curta em vez de mandar para outra casa.
  URL_PAINEL="${VITE_OG_URL:-}" "$PY" scripts/definir_secret.py URL_PAINEL
  verde "  Destino dos links quebrados configurado"
  if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
    (cd app && npx --yes supabase secrets set \
        AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
        AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
        AWS_REGIAO="${AWS_REGIAO:-us-east-1}" \
        SES_SEGREDO="${SES_SEGREDO:-}" \
        --project-ref "$SUPABASE_PROJECT_REF" >/dev/null) && verde "  Credenciais do Amazon SES configuradas"
  fi
  # A lista sai do próprio diretório: função nova entra sozinha, e a
  # contagem no fim não tem como mentir.
  FUNCOES=$(ls app/functions)
  N=0
  for f in $FUNCOES; do
    printf "  → %s\n" "$f"
    (cd app && npx --yes supabase functions deploy "$f" \
        --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt --use-api >/dev/null)
    N=$((N + 1))
  done
  verde "  $N funções publicadas"

  # ---------- 5. painel ----------
  passo "6/6 Publicando o painel"
  npm --prefix app/painel run build --silent
  if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [[ "$CLOUDFLARE_ACCOUNT_ID" != *xxxx* ]]; then
    export CLOUDFLARE_ACCOUNT_ID
    # Projeto "ressoar" desde 12/08/2026: os dois dominios foram movidos para
    # ele (o Pages nao renomeia projeto, entao foi criado um novo e os dominios
    # mudaram de casa um por vez, sem janela). O projeto antigo ja foi apagado.
    # Uma segunda instalacao pode usar outro nome: CLOUDFLARE_PAGES_PROJECT no .env.
    PAGES_PROJETO="${CLOUDFLARE_PAGES_PROJECT:-ressoar}"
    npx --yes wrangler pages project create "$PAGES_PROJETO" --production-branch main 2>/dev/null || true
    npx --yes wrangler pages deploy app/painel/dist --project-name "$PAGES_PROJETO" --branch main --commit-dirty=true
    verde "  Painel publicado"
  else
    amarelo "  CLOUDFLARE_ACCOUNT_ID não preenchido — pulei a publicação."
    amarelo "  Para rodar local: npm --prefix app/painel run dev"
  fi
fi

# ---------- pronto ----------
cat <<'FIM'

============================================================
  RESSOAR INSTALADO
============================================================

O QUE FAZER AGORA

1) CRIAR O PRIMEIRO ADMIN
   Abra o painel, clique em "Criar conta" e cadastre-se.
   Depois libere a conta rodando no SQL Editor do Supabase:

     update public.usuarios_ressoar
     set papel = 'admin', status = 'aprovado'
     where email = 'SEU@EMAIL.COM';

   (E-mails listados em public.admins_permanentes já nascem admin.)

2) DOMÍNIO PRÓPRIO (opcional)
   No Cloudflare Pages > seu projeto > Custom domains, adicione o
   subdomínio e crie o CNAME apontando para <projeto>.pages.dev.
   Depois registre a URL em: Supabase > Authentication > URL Configuration.

3) ENVIO REAL
   O sistema começa em MODO SIMULADO: processa tudo, mas nenhum e-mail sai.
   Para ligar de verdade, siga docs/05-LIGAR-ENVIO-REAL.md

4) TRAZER SUA BASE DO ACTIVECAMPAIGN
   Siga docs/03-MIGRAR-DO-ACTIVECAMPAIGN.md

Documentação completa: pasta docs/
FIM
