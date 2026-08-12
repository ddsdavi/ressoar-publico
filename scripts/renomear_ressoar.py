# -*- coding: utf-8 -*-
"""Renome unico da marca: Ressoa -> Ressoar (palavra exata, R maiusculo) e o
subdominio antigo -> novo. Identificadores nao mudam por construcao: camelCase
(MarcaRessoa), minusculas (usuarios_ressoa, ressoa-*, .ressoa-form) e caixa
alta (RESSOA_*, [RESSOA]) nao casam com \\bRessoa\\b. Regra e motivo no plano
docs/superpowers/plans/2026-08-12-ressoar-troca-de-nome-e-dominio.md.

Aplicado em 12/08/2026. Rodar de novo corrompe docs/09-ONDE-PAREI.md, que
tem quatro ocorrencias propositais da palavra 'Ressoa' (o proprio paragrafo
que documenta essas ocorrencias), e app/functions/google-sheets/index.ts,
que cita de proposito o nome do app cadastrado no Google. Revise as duas
excecoes antes de rodar de novo."""
import pathlib
import re
import sys

if "--confirmo" not in sys.argv:
    print(__doc__)
    print("Nada foi alterado. Rode com --confirmo se voce tem certeza.")
    raise SystemExit(0)

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
        # O proprio script nao se reescreve: o docstring e a constante
        # DOM_VELHO contem justamente os literais que ele procura, e rodar
        # sobre si mesmo deixava DOM_VELHO igual a DOM_NOVO — um replace que
        # nao troca nada, sem erro nem aviso.
        if arq.resolve() == pathlib.Path(__file__).resolve():
            continue
        if set(arq.parts) & PULAR_PASTAS:
            continue
        if arq.suffix.lower() not in EXT:
            continue
        texto = arq.read_text(encoding="utf-8", errors="strict")
        novo = PALAVRA.sub("Ressoar", texto).replace(DOM_VELHO, DOM_NOVO)
        if novo != texto:
            arq.write_text(novo, encoding="utf-8", newline="")
            mudados += 1
            print("  ->", arq.relative_to(RAIZ))
print(f"{mudados} arquivos alterados")
