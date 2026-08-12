# -*- coding: utf-8 -*-
"""Renome PROFUNDO: os identificadores internos passam de ressoa para ressoar.

A leva de 12/08/2026 trocou so o que o usuario ve. Esta troca o resto, por
ordem do dono ("levar tudo pro ressoar"). Diferente do renome de marca, aqui
nao da para usar regex solta: cada token e um contrato com alguma coisa viva
(tabela, politica de RLS, relogio do pg_cron, cabecalho HTTP, chave de
localStorage). Por isso o mapa e explicito e ordenado do mais longo para o
mais curto -- trocar 'ressoa_perfil_proprio' antes de 'ressoa_perfil_admin'
nao importa, mas trocar 'ressoa-' antes de 'ressoa-tema' estragaria tudo.

NAO roda sozinho: exige --confirmo. E pula o proprio arquivo e o
renomear_ressoar.py, que contem a regex \\bRessoa\\b e nao pode ser tocado.
"""
import pathlib
import sys

if "--confirmo" not in sys.argv:
    print(__doc__)
    print("Nada foi alterado. Rode com --confirmo se voce tem certeza.")
    raise SystemExit(0)

RAIZ = pathlib.Path(__file__).resolve().parents[1]
INCLUIR = ["app", "docs", "scripts", "supabase", "operacao", "README.md",
           ".env.example", "instalar.ps1", "instalar.sh"]
PULAR_PASTAS = {".git", "node_modules", "dist", "activecampaign-export",
                "blueprint", "superpowers", "vendas-hotmart", ".temp",
                ".superpowers"}
PULAR_ARQUIVOS = {"renomear_ressoar.py", "renomear_identificadores_ressoar.py"}
EXT = {".ts", ".tsx", ".md", ".sql", ".py", ".ps1", ".sh", ".html", ".css",
       ".txt", ".example", ".toml", ".json"}

# ordenado: o mais especifico primeiro
MAPA = [
    # --- banco: tabela, funcao, trigger ---
    ("usuarios_ressoa", "usuarios_ressoar"),
    ("excluir_lead_ressoa", "excluir_lead_ressoar"),
    ("trg_ressoa_novo_usuario", "trg_ressoar_novo_usuario"),
    # --- banco: politicas de RLS ---
    ("ressoa_perfil_proprio_update", "ressoar_perfil_proprio_update"),
    ("ressoa_perfil_proprio", "ressoar_perfil_proprio"),
    ("ressoa_perfil_admin", "ressoar_perfil_admin"),
    ("ressoa_admin", "ressoar_admin"),
    ("ressoa_opera", "ressoar_opera"),
    ("ressoa_le", "ressoar_le"),
    # --- relogios do pg_cron ---
    ("ressoa-processar-eventos", "ressoar-processar-eventos"),
    ("ressoa-executar-automacoes", "ressoar-executar-automacoes"),
    ("ressoa-freio-entregabilidade", "ressoar-freio-entregabilidade"),
    ("ressoa-reativacao-semanal", "ressoar-reativacao-semanal"),
    ("ressoa-rampa-aquecimento", "ressoar-rampa-aquecimento"),
    ("ressoa-banidos-manychat", "ressoar-banidos-manychat"),
    ("ressoa-resumo-diario", "ressoar-resumo-diario"),
    ("ressoa-fila-envios", "ressoar-fila-envios"),
    ("ressoa-campanhas", "ressoar-campanhas"),
    # --- variaveis de ambiente e segredos ---
    ("RESSOA_EMAIL_WEBHOOK", "RESSOAR_EMAIL_WEBHOOK"),
    ("RESSOA_EMAIL_SEGREDO", "RESSOAR_EMAIL_SEGREDO"),
    # --- nomes de automacao gravados no banco ---
    ("[RESSOA]", "[RESSOAR]"),
    # --- cabecalhos HTTP e tipos de arrasto ---
    ("x-ressoa-segredo", "x-ressoar-segredo"),
    ("x-ressoa-gatilho", "x-ressoar-gatilho"),
    ("x-ressoa-passo", "x-ressoar-passo"),
    # --- preferencias no navegador (localStorage) ---
    ("ressoa-tour-visto", "ressoar-tour-visto"),
    ("ressoa-escala", "ressoar-escala"),
    ("ressoa-barra", "ressoar-barra"),
    ("ressoa-tema", "ressoar-tema"),
    # --- formulario publicado (classes e id do snippet) ---
    ("ressoa-form", "ressoar-form"),
    ("ressoa-erro", "ressoar-erro"),
    ("ressoa-${", "ressoar-${"),
    # --- identificadores do React ---
    ("MarcaRessoa", "MarcaRessoar"),
    ("setNaRessoa", "setNaRessoar"),
    ("NaRessoa", "NaRessoar"),
    ("naRessoa", "naRessoar"),
    ("pulsoRessoa", "pulsoRessoar"),
    # --- projeto do Cloudflare Pages e User-Agent dos scripts ---
    ("--project-name ressoa", "--project-name ressoar"),
    ("pages project create ressoa", "pages project create ressoar"),
    ("ressoa-setup/1.0", "ressoar-setup/1.0"),
]

mudados = 0
trocas = {velho: 0 for velho, _ in MAPA}
for base in INCLUIR:
    raiz = RAIZ / base
    arquivos = [raiz] if raiz.is_file() else \
        [p for p in raiz.rglob("*") if p.is_file()]
    for arq in arquivos:
        if set(arq.parts) & PULAR_PASTAS or arq.name in PULAR_ARQUIVOS:
            continue
        if arq.suffix.lower() not in EXT:
            continue
        texto = arq.read_text(encoding="utf-8", errors="strict")
        novo = texto
        for velho, troca in MAPA:
            if velho in novo:
                trocas[velho] += novo.count(velho)
                novo = novo.replace(velho, troca)
        if novo != texto:
            arq.write_text(novo, encoding="utf-8", newline="")
            mudados += 1

print(f"{mudados} arquivos alterados\n")
for velho, _ in MAPA:
    if trocas[velho]:
        print(f"  {trocas[velho]:4}x  {velho}")
