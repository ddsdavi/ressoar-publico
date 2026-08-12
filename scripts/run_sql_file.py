# -*- coding: utf-8 -*-
"""Executa um arquivo .sql no projeto Supabase indicado no .env via Management API.
Uso: python scripts/run_sql_file.py caminho/arquivo.sql"""
import os
import json, os, sys, time
import urllib.request, urllib.error

# O console do Windows abre em cp1252, e a MIGRACAO NAO ESTAVA ERRADA: o
# script morria ao IMPRIMIR o resultado quando ele trazia acento ou seta
# (nome de automacao como "Aluno -> Black" tem U+2192). A excecao dava saida
# 1, e os dois instaladores tratam saida 1 como "falhou em <arquivo>" e
# abortam a instalacao inteira, no meio do banco. Medido em 12/08/2026.
for _saida in (sys.stdout, sys.stderr):
    try:
        _saida.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:      # Python < 3.7
        pass

REF = os.environ["SUPABASE_PROJECT_REF"]       # veja .env.example
API = f"https://api.supabase.com/v1/projects/{REF}/database/query"
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]        # veja .env.example


def run_sql(query):
    body = json.dumps({"query": query}).encode("utf-8")
    last_err = None
    for attempt in range(6):
        req = urllib.request.Request(API, data=body, method="POST", headers={
            "Authorization": "Bearer " + TOKEN,
            "Content-Type": "application/json",
            "User-Agent": "supabase-import/1.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:1500]
            if e.code in (400, 401, 404):
                raise RuntimeError("HTTP %d: %s" % (e.code, detail))
            last_err = "HTTP %d: %s" % (e.code, detail)
        except Exception as e:
            last_err = str(e)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError("falhou: %s" % last_err)


if __name__ == "__main__":
    path = sys.argv[1]
    with open(path, encoding="utf-8") as f:
        sql = f.read()
    out = run_sql(sql)
    print(json.dumps(out, ensure_ascii=False, indent=2)[:3000])
    print("OK:", path)
