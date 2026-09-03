#!/usr/bin/env bash
# ============================================================
# Poe o espelho PUBLICO (remote `publico`) em dia com o `main`.
#
#   scripts/publicar_espelho.sh              monta o commit e mostra o que mudaria
#   scripts/publicar_espelho.sh --publicar   monta e envia para publico/main
#   MSG="..." scripts/publicar_espelho.sh    mensagem do commit (sem acento: o
#                                            historico do espelho e assim)
#
# Como funciona: o espelho nao compartilha historico com o main. Cada
# publicacao e UM commit em cima de publico/main cuja arvore e a arvore do
# main, menos o que esta em FORA. Assim o historico desta operacao (nomes,
# numeros, decisoes dos commits) nunca sai daqui, e a arvore publica e
# sempre identica ao codigo em producao. E dele que saem as copias da
# plataforma (docs/11-DUPLICAR-E-VENDER.md).
#
# Antes de rodar com --publicar, olhe a lista de "linhas novas" que ele
# imprime: nome, e-mail ou telefone de gente real nao vai para o espelho
# (README, "Antes de publicar").
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# O que NAO vai para o espelho, alem do que o .gitignore ja segura:
#   docs/10-PLANO-SEGURANCA.md  lista o que ainda NAO esta protegido — e um
#                               mapa para quem quiser atacar; fica privado.
FORA=(docs/10-PLANO-SEGURANCA.md)

MSG="${MSG:-Poe o espelho em dia com o main}"

git fetch publico >/dev/null 2>&1
base=$(git rev-parse publico/main)

# indice temporario: a arvore de trabalho e o indice de verdade nao sao tocados
tmp="$(git rev-parse --git-dir)/espelho-tmp.index"
rm -f "$tmp"
export GIT_INDEX_FILE="$tmp"
git read-tree main
for f in "${FORA[@]}"; do
  git update-index --force-remove -- "$f" >/dev/null 2>&1 || true
done
tree=$(git write-tree)
unset GIT_INDEX_FILE
rm -f "$tmp"

# nada proibido na arvore, nunca
if git ls-tree -r --name-only "$tree" | grep -E '(^|/)\.env$|export/|\.csv$|\.local\.sql$|\.keys_|(^|/)PASSAGEM\.md$|\.secrets\.env$'; then
  echo "ARQUIVO PROIBIDO na arvore do espelho — nada foi feito" >&2
  exit 1
fi

if [ "$(git rev-parse "$base^{tree}")" = "$tree" ]; then
  echo "O espelho ja esta em dia com o main."
  exit 0
fi

echo "--- o que muda no espelho (publico/main -> main) ---"
git diff --stat "$base" "$tree" | tail -n 12
echo
echo "--- linhas NOVAS com cara de e-mail ou telefone: confira uma a uma ---"
git diff "$base" "$tree" | grep '^+' | grep -v '^+++' \
  | grep -nE '[A-Za-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo|icloud|uol|bol)\.|(^|[^0-9A-Za-z])[0-9]{10,13}([^0-9A-Za-z]|$)' \
  | cut -c1-160 | head -n 40 || true
echo

commit=$(git commit-tree "$tree" -p "$base" -m "$MSG")
git update-ref refs/heads/espelho-publico "$commit"
echo "commit do espelho: $commit  (branch local espelho-publico)"

if [ "${1:-}" = "--publicar" ]; then
  git push publico espelho-publico:main
  echo "Publicado em publico/main."
else
  echo "(nao enviado — rode de novo com --publicar)"
fi
