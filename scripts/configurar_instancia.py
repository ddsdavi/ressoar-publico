# -*- coding: utf-8 -*-
"""Grava no banco os valores que sao DESTA instalacao, lidos do .env.

Uso:  python scripts/configurar_instancia.py
      (os dois instaladores chamam logo depois de aplicar o banco; rodar a
      mao e seguro — regrava os mesmos valores)

Por que existe: as migracoes sao iguais para toda instalacao, mas alguns
valores sao de UMA instalacao. Deixados dentro da migracao, uma copia nova
nasceria apontando para a instalacao de origem — o motor chamaria a funcao
de envio de OUTRO projeto, e o resumo diario levaria para o painel de outra
casa. Foi assim ate 03/09/2026 (ver docs/11-DUPLICAR-E-VENDER.md).

  url_api_interna         o endereco que o motor chama para enviar e-mail.
                          Derivado de SUPABASE_URL; gravado SEMPRE.
  url_painel              o endereco publico do painel; o resumo diario usa
                          no botao. Vem de VITE_OG_URL; gravado se houver.
  remetentes_verificados  os "De:" que o provedor de envio ja verificou; a
                          campanha e barrada antes de sair se o remetente
                          nao estiver aqui. Vem de REMETENTES_VERIFICADOS;
                          gravado se houver.

Chave ausente ou vazia no .env = o valor que esta no banco fica como esta.
Nenhum segredo passa por aqui: os tres valores sao publicos por natureza.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_sql_file import run_sql  # noqa: E402  (mesma API, mesmo .env)

for _saida in (sys.stdout, sys.stderr):
    try:
        _saida.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:      # Python < 3.7
        pass


def _limpo(nome):
    """O .sh entrega o valor sem aspas; o .ps1 tambem — mas quem roda a mao
    depois de um `export VITE_OG_URL="..."` pode deixar aspas no valor."""
    return (os.environ.get(nome) or "").strip().strip('"').strip("'").strip()


def _sql(valor):
    return "'" + valor.replace("'", "''") + "'"


url = _limpo("SUPABASE_URL").rstrip("/")
if not url or "xxxx" in url:
    print("SUPABASE_URL nao preenchido no .env", file=sys.stderr)
    raise SystemExit(1)

valores = {"url_api_interna": url + "/functions/v1"}

painel = _limpo("VITE_OG_URL").rstrip("/")
if painel:
    valores["url_painel"] = painel

remetentes = ",".join(
    x.strip() for x in _limpo("REMETENTES_VERIFICADOS").split(",") if x.strip())
if remetentes:
    valores["remetentes_verificados"] = remetentes

linhas = ", ".join("(%s, %s)" % (_sql(k), _sql(v)) for k, v in valores.items())
run_sql("insert into public.app_config (chave, valor) values " + linhas
        + " on conflict (chave) do update set valor = excluded.valor;")

for k, v in valores.items():
    print("  %s = %s" % (k, v))
print("OK: valores desta instalacao gravados")
