# -*- coding: utf-8 -*-
"""Confere se ESTA instalacao esta inteira e independente de qualquer outra.

Uso:  python scripts/conferir_instalacao.py

  Linux/Mac: set -a; source .env; set +a   antes de rodar
  Windows:   rode no mesmo PowerShell em que rodou o instalador

Nao altera nada: so le o banco, a lista de funcoes publicadas e os NOMES dos
segredos. Nenhum valor de segredo e impresso, nem trafega por aqui.

Por que existe: uma copia da plataforma nasce certa quando o .env esta certo,
mas nada avisava se algo continuou apontando para a operacao de origem — o
motor chamando a funcao de envio de OUTRO projeto, o remetente de outra casa,
as automacoes de recuperacao de outra gente nascidas ativas. Cada uma dessas
falhas so aparecia com o e-mail errado ja enviado. Este roteiro pergunta tudo
de uma vez, e diz em portugues o que fazer com cada resposta.

Rode: depois do instalador numa copia nova (o passo 11 do
docs/11-DUPLICAR-E-VENDER.md) e sempre que quiser um retrato desta casa.

Saida: GRAVE = nao envie e-mail antes de resolver · ATENCAO = resolva antes
de entregar · ok = conferido. O programa devolve 1 se houver GRAVE.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_sql_file import run_sql  # noqa: E402  (mesma API, mesmo .env)

for _saida in (sys.stdout, sys.stderr):
    try:
        _saida.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:      # Python < 3.7
        pass

REF = os.environ["SUPABASE_PROJECT_REF"]
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

achados = []        # (nivel, texto)


def diz(nivel, texto):
    achados.append((nivel, texto))
    marca = {"GRAVE": "GRAVE   ", "ATENCAO": "ATENCAO ", "ok": "ok      ",
             "-": "        "}[nivel]
    print("  " + marca + texto)


def secao(t):
    print("\n" + t)
    print("  " + "-" * (len(t) + 2))


def limpo(nome):
    return (os.environ.get(nome) or "").strip().strip('"').strip("'").strip()


def api(caminho):
    """GET na Management API. User-Agent proprio: o padrao do urllib e barrado."""
    req = urllib.request.Request(
        "https://api.supabase.com/v1/projects/%s/%s" % (REF, caminho),
        headers={"Authorization": "Bearer " + TOKEN,
                 "User-Agent": "ressoar-conferencia/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode("utf-8") or "null")
    except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
        return {"__erro__": str(e)[:120]}


# ---------------------------------------------------------------- o banco
cfg = {linha["chave"]: (linha["valor"] or "")
       for linha in run_sql("""
       select chave, valor from public.app_config where chave in (
         'url_api_interna','url_painel','base_url_tracking','remetentes_verificados',
         'from_email_padrao','from_name_padrao','provedor_email','envio_pausado',
         'envio_so_para','envio_limite_diario','resumo_diario_para','conteudo_origem',
         'manychat_tag_esc','endereco_fisico','resend_api_key','ses_segredo',
         'esteira_produto_principal','esteira_produtos_topo','esteira_lista_aquecimento')""") or []}

n = (run_sql("""
  select (select count(*) from public.tabela_1_leads) as leads,
         (select count(*) from public.envios) as envios,
         (select count(*) from public.envios where status = 'queued') as na_fila,
         (select count(*) from public.mensagens) as mensagens,
         (select count(*) from public.automacoes) as automacoes,
         (select count(*) from public.automacoes where ativa) as automacoes_ativas,
         (select count(*) from public.emails_da_operacao) as emails_da_casa,
         (select count(*) from cron.job where jobname like 'ressoar-%' and active) as relogios,
         (select count(*) from public.automacoes where nome like '[RESSOAR]%') as origem_total,
         (select count(*) from public.automacoes where nome like '[RESSOAR]%' and ativa) as origem_ativas,
         (select count(*) from public.mensagens where nome like '[Pagamento %'
            or nome like '[Carrinho]%' or nome like '[Aluno %' or nome like '[Lives %'
            or nome like '[Janela quente %' or nome like '[Reativação]%'
            or nome like '[RASCUNHO] Janela quente%') as origem_msgs
""") or [{}])[0]

print("\n============================================================")
print("  CONFERENCIA DA INSTALACAO — projeto %s" % REF)
print("============================================================")
print("  %s leads · %s envios (%s na fila) · %s mensagens · %s automacoes (%s ativas)"
      % (n.get("leads"), n.get("envios"), n.get("na_fila"), n.get("mensagens"),
         n.get("automacoes"), n.get("automacoes_ativas")))

# ------------------------------------------------- 1. de quem e esta casa
secao("1. De quem e esta instalacao")

esperado_api = limpo("SUPABASE_URL").rstrip("/") + "/functions/v1"
if cfg.get("url_api_interna") == esperado_api:
    diz("ok", "url_api_interna aponta para as funcoes DESTE projeto")
elif not cfg.get("url_api_interna"):
    diz("ATENCAO", "url_api_interna vazio — o motor cai no endereco embutido no codigo. "
                   "Rode: python scripts/configurar_instancia.py")
else:
    diz("GRAVE", "url_api_interna aponta para OUTRO projeto (%s). O motor mandaria o "
                 "envio pela casa alheia. Rode: python scripts/configurar_instancia.py"
        % cfg["url_api_interna"])

base = cfg.get("base_url_tracking", "")
if not base:
    diz("GRAVE", "base_url_tracking vazio — o motor NAO envia (guarda do rodape legal). "
                 "Preencha em Configuracoes; ver docs/11, passo 6")
elif ".supabase.co" in base and REF not in base:
    diz("GRAVE", "base_url_tracking aponta para o Supabase de OUTRO projeto (%s)" % base)
else:
    diz("ok", "base_url_tracking: %s" % base)

og = limpo("VITE_OG_URL").rstrip("/")
painel = cfg.get("url_painel", "").rstrip("/")
if og and painel == og:
    diz("ok", "url_painel igual ao VITE_OG_URL do .env")
elif not painel:
    diz("ATENCAO", "url_painel vazio — o resumo diario sai sem o botao do painel. "
                   "Preencha VITE_OG_URL no .env e rode scripts/configurar_instancia.py")
elif og and painel != og:
    diz("ATENCAO", "url_painel (%s) diferente do VITE_OG_URL do .env (%s)" % (painel, og))
else:
    diz("-", "url_painel: %s (VITE_OG_URL nao esta no ambiente para comparar)" % painel)

# ------------------------------------------------------- 2. o remetente
secao("2. O remetente")

verificados = [x.strip().lower() for x in cfg.get("remetentes_verificados", "").split(",")
               if x.strip()]
de = cfg.get("from_email_padrao", "").strip().lower()
if not verificados:
    diz("GRAVE", "remetentes_verificados vazio — nenhuma campanha sai daqui. Preencha "
                 "REMETENTES_VERIFICADOS no .env e rode scripts/configurar_instancia.py")
elif not de:
    diz("ATENCAO", "from_email_padrao vazio — defina o remetente em Configuracoes")
elif de in verificados:
    diz("ok", "o remetente padrao esta entre os %d verificado(s)" % len(verificados))
else:
    diz("GRAVE", "o remetente padrao (%s) NAO esta entre os verificados — a campanha e "
                 "barrada antes de sair" % de)

if cfg.get("from_name_padrao", "").strip():
    diz("ok", "nome do remetente: %s" % cfg["from_name_padrao"])
else:
    diz("ATENCAO", "from_name_padrao vazio — o e-mail sai assinado so pelo endereco")

# --------------------------------------- 3. conteudo da operacao de origem
secao("3. Conteudo da operacao de origem")

marca = cfg.get("conteudo_origem", "")
origem = int(n.get("origem_total") or 0)
origem_ativas = int(n.get("origem_ativas") or 0)
vazia = int(n.get("leads") or 0) == 0 and int(n.get("envios") or 0) == 0

if marca == "removido" and origem == 0:
    diz("ok", "nada da operacao de origem aqui, e a marca impede que volte numa atualizacao")
elif marca == "removido" and origem > 0:
    diz("GRAVE", "a marca diz removido, mas ha %d automacao(oes) [RESSOAR] de origem (%d "
                 "ativa[s]) — alguem as recriou a mao" % (origem, origem_ativas))
elif origem > 0 and vazia:
    diz("GRAVE", "instalacao vazia com %d automacao(oes) da operacao de origem, %d ATIVA(S): "
                 "o primeiro carrinho abandonado receberia o e-mail de outra casa. Rode: "
                 "python scripts/run_sql_file.py supabase/nova_operacao_v1.sql"
        % (origem, origem_ativas))
elif origem > 0:
    # a conta e por prefixo: inclui as que o proprio operador criou pela tela com
    # o mesmo [RESSOAR]. As semeadas por migracao — as que uma copia herdaria —
    # sao as 7 nomeadas em supabase/nova_operacao_v1.sql.
    diz("-", "%d automacao(oes) [RESSOAR] e %s mensagem(ns) de sequencia — esperado na "
             "instalacao DE ORIGEM; numa copia, o passo 4 do docs/11 remove as 7 que "
             "vem das migracoes (as criadas pela tela nao nascem numa copia)"
        % (origem, n.get("origem_msgs")))
else:
    diz("ok", "nenhuma automacao da operacao de origem")

if cfg.get("manychat_tag_esc", "").strip():
    diz("-", "manychat_tag_esc preenchido — e uma tag de UMA conta do ManyChat; "
             "numa copia tem de ser a do comprador (ou vazio)")
if int(n.get("emails_da_casa") or 0) > 0:
    diz("-", "%s endereco(s) em emails_da_operacao — confira se sao desta casa "
             "(supabase/emails_da_operacao_dados.local.sql)" % n.get("emails_da_casa"))

# ------------------------------------------------ 4. a esteira do scoring
secao("4. A esteira do lead scoring de venda")

# A regua leu produtos de dentro do codigo ate 04/09/2026; hoje le da
# configuracao (esteira_configuravel_v1). O que interessa e o mesmo: a
# esteira desta instalacao fala dos produtos DELA? Numa copia as chaves
# nascem com os valores da operacao de origem, e sem este aviso ninguem
# perceberia — a tela mostraria "proxima oferta" para todo mundo errado.
regua = run_sql("""
  with citados as (
    select btrim(x) as produto
    from unnest(
      string_to_array(coalesce(public.cfg('esteira_produto_principal'), ''), ',')
      || string_to_array(coalesce(public.cfg('esteira_produtos_topo'), ''), ',')) x
    where btrim(x) <> ''),
  vendidos as (
    select distinct nome_produto from public.tabela_4_alunos where status = 'aprovada')
  select c.produto,
         exists (select 1 from vendidos v where v.nome_produto ilike '%' || c.produto || '%')
           as vendido_aqui
  from citados c order by 1""") or []

lista_aq = cfg.get("esteira_lista_aquecimento", "").strip()

if not regua:
    diz("ATENCAO", "a esteira nao tem produto configurado — todo lead cai em 'aquecer "
                   "primeiro' e a coluna 'proxima oferta' nao serve para nada. Preencha "
                   "esteira_produto_principal e esteira_produtos_topo (docs/11, passo 6)")
else:
    fora = [r["produto"] for r in regua if not r["vendido_aqui"]]
    if not fora:
        diz("ok", "os %d produto(s) citados na regua sao vendidos nesta operacao" % len(regua))
    else:
        diz("ATENCAO", "a esteira decide a proxima oferta por %d produto(s) que esta base "
                       "nunca vendeu: %s. Numa copia isso e a configuracao da operacao de "
                       "origem: troque as chaves esteira_* e rode "
                       "select public.recalcular_pontuacao_venda() (docs/11, passo 6)"
            % (len(fora), ", ".join(fora)))

if not lista_aq:
    diz("-", "esteira_lista_aquecimento vazia — ninguem e classificado como 'aquecido "
             "sem ter comprado'. So preencha se a operacao tiver uma lista assim")
elif not (run_sql("select exists (select 1 from public.listas where lista_id = %s) as e"
                  % int(lista_aq)) or [{}])[0].get("e"):
    diz("ATENCAO", "esteira_lista_aquecimento aponta para a lista %s, que nao existe nesta "
                   "instalacao" % lista_aq)
else:
    diz("ok", "a lista de aquecimento existe")

# ---------------------------------------------------------- 5. o motor
secao("5. O motor e o envio")

relogios = int(n.get("relogios") or 0)
diz("ok" if relogios >= 4 else "GRAVE",
    "%d relogio(s) ressoar-* ativos no pg_cron%s"
    % (relogios, "" if relogios >= 4 else " — o motor nao roda sozinho; reaplique o banco"))

provedor = cfg.get("provedor_email", "") or "simulado"
if provedor == "simulado":
    diz("-", "provedor de envio: simulado — processa tudo e nao envia nada (docs/05)")
else:
    chave_ok = bool(cfg.get("resend_api_key")) if provedor == "resend" else bool(cfg.get("ses_segredo"))
    diz("ok" if chave_ok else "GRAVE",
        "provedor de envio: %s%s" % (provedor, "" if chave_ok else " — sem a chave/segredo em Configuracoes"))

if cfg.get("envio_so_para", "").strip():
    diz("ATENCAO", "envio_so_para PREENCHIDO: so aquele endereco recebe, todo o resto fica "
                   "retido. E a trava de teste — esvazie para operar de verdade")
else:
    diz("ok", "envio_so_para vazio — o envio vai para a base real")

if str(cfg.get("envio_pausado", "")).lower() in ("true", "t", "1", "sim"):
    diz("ATENCAO", "envio PAUSADO — a fila (%s) espera ate religar em Configuracoes"
        % n.get("na_fila"))
else:
    diz("ok", "envio liberado")

if not cfg.get("endereco_fisico", "").strip():
    diz("ATENCAO", "endereco_fisico vazio — o rodape legal do e-mail fica sem o endereco "
                   "do remetente (exigido por lei anti-spam)")

# ------------------------------------------- 6. funcoes e segredos
secao("6. Funcoes publicadas e segredos (so nomes, nunca valores)")

no_repo = sorted(d for d in os.listdir(os.path.join(RAIZ, "app", "functions"))
                 if os.path.isdir(os.path.join(RAIZ, "app", "functions", d)))
publicadas = api("functions")
if isinstance(publicadas, dict):
    diz("ATENCAO", "nao consegui listar as funcoes publicadas (%s)" % publicadas.get("__erro__"))
else:
    slugs = sorted(f.get("slug", "") for f in publicadas)
    faltam = [f for f in no_repo if f not in slugs]
    if faltam:
        diz("GRAVE", "funcao(oes) no repositorio e NAO publicada(s): %s. Rode ./instalar.sh "
                     "--so-painel" % ", ".join(faltam))
    else:
        diz("ok", "as %d funcoes do repositorio estao publicadas" % len(no_repo))

segredos = api("secrets")
if isinstance(segredos, dict):
    diz("ATENCAO", "nao consegui listar os segredos (%s)" % segredos.get("__erro__"))
else:
    nomes = {s.get("name") for s in segredos}
    precisa = [("URL_PAINEL", "destino de um link de rastreio quebrado (rastreio)"),
               ("MARCA_NOME", "assinatura dos e-mails de conta (conta-email)"),
               ("RESSOAR_EMAIL_WEBHOOK", "canal dos codigos de seguranca (conta-email)"),
               ("RESSOAR_EMAIL_SEGREDO", "senha desse canal (conta-email)")]
    if provedor == "ses":
        precisa += [("AWS_ACCESS_KEY_ID", "envio pelo SES"),
                    ("AWS_SECRET_ACCESS_KEY", "envio pelo SES"),
                    ("SES_SEGREDO", "senha entre o motor e a funcao enviar-ses")]
    if provedor == "resend":
        precisa += [("RESEND_WEBHOOK_SECRET", "postback-resend rejeita TUDO sem ele")]
    ausentes = [(k, p) for k, p in precisa if k not in nomes]
    if ausentes:
        for k, p in ausentes:
            diz("ATENCAO", "segredo %s ausente — %s" % (k, p))
    else:
        diz("ok", "os segredos que esta configuracao exige estao gravados")
    for k, p in [("VENDA_SEGREDO", "webhook da Hotmart (venda)"),
                 ("GOOGLE_CLIENT_ID", "planilhas do Google (google-sheets)")]:
        if k not in nomes:
            diz("-", "segredo %s ausente — so precisa se for usar %s" % (k, p))

# ------------------------------------------------------- 7. a porta
secao("7. A porta de entrada")

auth = api("config/auth")
if isinstance(auth, dict) and "__erro__" in auth:
    diz("ATENCAO", "nao consegui ler a configuracao do Auth (%s)" % auth["__erro__"])
else:
    if auth.get("disable_signup"):
        diz("ok", "cadastro fechado — ninguem cria conta sozinho")
    else:
        diz("ATENCAO", "cadastro ABERTO: qualquer pessoa cria conta (nasce pendente, sem "
                       "acesso, mas cria). Feche em Authentication > Sign In / Providers")
    permitidas = (auth.get("uri_allow_list") or "")
    if painel and painel not in permitidas:
        diz("ATENCAO", "o endereco do painel nao esta na allowlist do Auth — o login "
                       "redireciona errado. Supabase > Authentication > URL Configuration")
    elif painel:
        diz("ok", "o endereco do painel esta na allowlist do Auth")

# ------------------------------------------------------------ resumo
graves = sum(1 for nivel, _ in achados if nivel == "GRAVE")
atencoes = sum(1 for nivel, _ in achados if nivel == "ATENCAO")

print("\n============================================================")
if graves:
    print("  %d GRAVE(S) e %d atencao(oes). NAO envie e-mail antes de resolver os graves."
          % (graves, atencoes))
elif atencoes:
    print("  Nenhum problema grave. %d ponto(s) de atencao para resolver antes de entregar."
          % atencoes)
else:
    print("  Tudo conferido. A instalacao esta inteira e nao aponta para nenhuma outra.")
print("============================================================\n")

raise SystemExit(1 if graves else 0)
