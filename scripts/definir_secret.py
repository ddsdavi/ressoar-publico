# -*- coding: utf-8 -*-
"""Grava um secret de Edge Function pela API do Supabase, em UTF-8.

Uso:  python scripts/definir_secret.py NOME_DO_SECRET

O valor vem da variavel de ambiente de mesmo nome (vazia = grava vazio).

Por que nao usar `supabase secrets set`: no Windows o valor atravessa a
pagina de codigo na passagem de argumento para o executavel, e acento chega
corrompido — "Patricia" virou "PatrA-cia" em producao em 12/08/2026. A API
e UTF-8 de ponta a ponta.
"""
import json
import os
import sys
import urllib.error
import urllib.request

if len(sys.argv) != 2:
    print("uso: python scripts/definir_secret.py NOME_DO_SECRET", file=sys.stderr)
    raise SystemExit(2)

nome = sys.argv[1]
valor = os.environ.get(nome, "")
ref = os.environ["SUPABASE_PROJECT_REF"]
token = os.environ["SUPABASE_ACCESS_TOKEN"]

req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{ref}/secrets",
    data=json.dumps([{"name": nome, "value": valor}]).encode("utf-8"),
    method="POST",
    headers={"Authorization": "Bearer " + token,
             "Content-Type": "application/json",
             "User-Agent": "ressoar-setup/1.0"})
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print(f"{nome}: gravado ({r.status})")
except urllib.error.HTTPError as e:
    print(f"{nome}: ERRO {e.code} — {e.read().decode('utf-8', 'replace')[:200]}",
          file=sys.stderr)
    raise SystemExit(1)
