# -*- coding: utf-8 -*-
"""Sincroniza a base com um export completo do ActiveCampaign.

    python scripts/sincronizar_csv_ac.py "caminho/do/export.csv"
    python scripts/sincronizar_csv_ac.py "caminho/do/export.csv" --aplicar

Sem --aplicar, só mostra o que mudaria. Nada é gravado.

Por que existe: a migração foi uma fotografia. O ActiveCampaign continua
recebendo gente e aplicando tag todo dia; a base daqui ficou parada no dia
da exportação. A diferença aparece primeiro nas turmas — a tag da semana
tem sempre menos gente aqui do que lá.

O que faz:
  - cria quem existe no CSV e não existe aqui
  - completa nome e WhatsApp de quem já existe e está sem
  - cria as tags que faltam e liga quem está marcado lá

O que NÃO faz, de propósito:
  - não apaga nada. Tag que existe aqui e não no CSV fica: a Ressoar aplica
    tags próprias (turma por compra da Hotmart, por exemplo) que o
    ActiveCampaign nunca vai conhecer. Apagar pelo CSV desfaria isso.
"""
import csv, io, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Reaproveita o mesmo executor do resto do projeto. Escrever outro aqui
# custou um 403: a chamada sem User-Agent é barrada antes de chegar ao
# banco, e o erro não diz isso em lugar nenhum.
from run_sql_file import run_sql as sql          # noqa: E402

csv.field_size_limit(10_000_000)

if not os.environ.get("SUPABASE_PROJECT_REF") or not os.environ.get("SUPABASE_ACCESS_TOKEN"):
    sys.exit("Faltam SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN no ambiente (veja .env).")


def aspas(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    caminho = sys.argv[1]
    aplicar = "--aplicar" in sys.argv

    linhas = list(csv.DictReader(io.open(caminho, encoding="utf-8-sig", newline=""), delimiter=","))
    print("CSV: %d linhas" % len(linhas))

    # ---- o que o CSV diz ----
    pessoas = {}
    marcacoes = []          # (email, tag)
    for l in linhas:
        email = (l.get("Email") or "").strip().lower()
        if "@" not in email:
            continue
        nome = " ".join(x for x in [(l.get("Nome") or "").strip(),
                                    (l.get("Sobrenome") or "").strip()] if x).strip()
        fone = "".join(c for c in (l.get("Número de telefone") or "") if c.isdigit())
        pessoas[email] = (nome or None, fone or None)
        for t in (l.get("Tags") or "").split(","):
            t = t.strip()
            if t:
                marcacoes.append((email, t))

    print("  %d pessoas, %d marcações de tag" % (len(pessoas), len(marcacoes)))

    # ---- o que já existe aqui ----
    lote = list(pessoas.keys())
    existentes = set()
    for i in range(0, len(lote), 500):
        pedaco = ",".join(aspas(e) for e in lote[i:i + 500])
        r = sql("select lower(email::text) as e from public.tabela_1_leads "
                "where lower(email::text) in (%s)" % pedaco)
        existentes |= {x["e"] for x in r}

    novos = [e for e in pessoas if e not in existentes]
    print("\nPESSOAS")
    print("  já na base ..: %d" % len(existentes))
    print("  a criar .....: %d" % len(novos))

    tags_csv = sorted({t for _, t in marcacoes})
    r = sql("select nome from public.tags")
    tags_aqui = {x["nome"] for x in r}
    tags_novas = [t for t in tags_csv if t not in tags_aqui]
    print("\nTAGS")
    print("  no CSV ......: %d" % len(tags_csv))
    print("  a criar .....: %d%s" % (len(tags_novas),
          ("  → " + ", ".join(tags_novas[:6])) if tags_novas else ""))

    if not aplicar:
        print("\n(simulação — rode de novo com --aplicar para gravar)")
        return

    # ---- gravar ----
    print("\nAplicando…")
    # O telefone NÃO entra na criação. A coluna whatsapp é UNIQUE, e no
    # ActiveCampaign é comum a mesma pessoa aparecer com dois e-mails e o
    # mesmo celular — inserir junto derruba o lote inteiro por causa de uma
    # linha. O telefone entra depois, um a um, só onde não colide.
    #
    # O e-mail também não usa ON CONFLICT: o índice único é sobre
    # lower(email) e é parcial, então a cláusula não casa com ele. O
    # "where not exists" faz o mesmo trabalho e não depende do formato do
    # índice.
    if novos:
        for i in range(0, len(novos), 400):
            vals = ",".join("(%s,%s)" % (aspas(e), aspas(pessoas[e][0]))
                            for e in novos[i:i + 400])
            sql("""
            insert into public.tabela_1_leads (email, nome)
            select v.email, v.nome from (values %s) as v(email, nome)
            where not exists (select 1 from public.tabela_1_leads l
                              where lower(l.email::text) = v.email)
            """ % vals)
            print("  criados %d/%d" % (min(i + 400, len(novos)), len(novos)))

    if tags_novas:
        vals = ",".join("(%s,'importada do ActiveCampaign')" % aspas(t) for t in tags_novas)
        sql("insert into public.tags (nome, descricao) values %s on conflict (nome) do nothing" % vals)
        print("  %d tag(s) criada(s)" % len(tags_novas))

    # completa o nome de quem estava sem
    for i in range(0, len(lote), 400):
        vals = ",".join("(%s,%s)" % (aspas(e), aspas(pessoas[e][0])) for e in lote[i:i + 400])
        sql("""
        update public.tabela_1_leads l set nome = v.nome
        from (values %s) as v(email, nome)
        where lower(l.email::text) = v.email
          and coalesce(l.nome, '') = '' and coalesce(v.nome, '') <> ''
        """ % vals)
    print("  nomes completados onde faltavam")

    # O telefone entra só onde ninguém mais o usa — a coluna é UNIQUE.
    #
    # Duas defesas, porque uma só não basta. O "not exists" lá embaixo olha
    # quem JÁ tem aquele número; ele não enxerga duas linhas com o mesmo
    # número dentro do próprio lote, porque as duas são avaliadas contra o
    # estado anterior. Então o número repetido é descartado aqui antes, e
    # fica com o primeiro e-mail que aparecer.
    vistos = set()
    fones = []
    for e in lote:
        f = pessoas[e][1]
        if f and f not in vistos:
            vistos.add(f)
            fones.append((e, f))
    repetidos = sum(1 for e in lote if pessoas[e][1]) - len(fones)
    if repetidos:
        print("  %d telefone(s) repetido(s) no CSV — fica com o primeiro e-mail" % repetidos)

    for i in range(0, len(fones), 400):
        vals = ",".join("(%s,%s)" % (aspas(e), aspas(f)) for e, f in fones[i:i + 400])
        if not vals:
            continue
        sql("""
        update public.tabela_1_leads l set whatsapp = v.fone
        from (values %s) as v(email, fone)
        where lower(l.email::text) = v.email
          and coalesce(l.whatsapp, '') = ''
          and not exists (select 1 from public.tabela_1_leads o
                          where o.whatsapp = v.fone)
        """ % vals)
    print("  telefones completados onde não havia conflito")

    # liga as tags
    for i in range(0, len(marcacoes), 800):
        vals = ",".join("(%s,%s)" % (aspas(e), aspas(t)) for e, t in marcacoes[i:i + 800])
        sql("""
        insert into public.lead_tags (lead_fk, tag_fk)
        select l.lead_id, t.tag_id
        from (values %s) as v(email, tag)
        join public.tabela_1_leads l on lower(l.email::text) = v.email
        join public.tags t on t.nome = v.tag
        on conflict do nothing
        """ % vals)
        print("  tags ligadas %d/%d" % (min(i + 800, len(marcacoes)), len(marcacoes)))

    r = sql("""select (select count(*) from public.tabela_1_leads) as leads,
                      (select count(*) from public.tags) as tags,
                      (select count(*) from public.lead_tags) as vinculos""")
    print("\nAgora: %s leads, %s tags, %s vínculos"
          % (r[0]["leads"], r[0]["tags"], r[0]["vinculos"]))


if __name__ == "__main__":
    main()
