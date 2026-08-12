# -*- coding: utf-8 -*-
"""Aplica os templates de e-mail do login (Ressoar) em portugues, com a marca.

NAO RODA HOJE, e por dois motivos independentes (medidos em 12/08/2026):

1. O Supabase recusa a edicao de template em projeto do plano gratis que usa o
   provedor de e-mail padrao: as cinco chamadas voltam com "Email template
   modification is not available for free tier projects". Para liberar, seria
   preciso plano pago ou SMTP proprio configurado.
2. Mesmo liberado, nao mudaria nada para quem usa a plataforma: `mailer_autoconfirm`
   esta LIGADO (conta nasce confirmada, entao o Supabase nao manda e-mail de
   confirmacao), e o painel nao chama nenhum outro fluxo de e-mail do Auth —
   recuperar senha, trocar e-mail e excluir conta passam pela Edge Function
   `conta-email`, que manda pelo canal proprio (n8n). Os templates do Auth estao
   hoje no padrao ingles do Supabase e ninguem os recebe.

Ou seja: este script fica guardado para o dia em que houver SMTP proprio. Se voce
o rodar hoje, o resultado esperado sao cinco linhas de ERRO — nao e defeito seu.
"""
import os
import json, os, urllib.request

API = f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/config/auth"
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]        # veja .env.example

# Quem assina vem do .env (VITE_MARCA_NOME), nunca do código: o repositório tem
# espelho público. Vazio, os e-mails se apresentam só como Ressoar.
MARCA = os.environ.get("VITE_MARCA_NOME", "").strip()
ASSINATURA = (' <span style="opacity:.6;font-weight:400;font-size:13px">'
              "&nbsp;·&nbsp; %s</span>" % MARCA) if MARCA else ""

BASE = f"""<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f6fa;font-family:'IBM Plex Sans',Segoe UI,Arial,sans-serif">
<table width="100%%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(23,0,32,.08)">
  <tr><td style="background:#170020;padding:20px 28px;color:#fff;font-size:18px;font-weight:700;letter-spacing:.3px">
    Ressoar{ASSINATURA}
  </td></tr>
  <tr><td style="padding:30px 28px;color:#1F2129;font-size:15px;line-height:1.7">
    %s
  </td></tr>
  <tr><td style="padding:18px 28px;background:#faf8fb;color:#5F667E;font-size:12px;line-height:1.6">
    Se você não esperava este e-mail, pode ignorar com segurança — nada acontece sem você clicar.
  </td></tr>
</table>
</td></tr></table></body></html>"""

BOTAO = """<a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#82308F;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px">%s</a>"""

LINK_ALT = """<p style="color:#5F667E;font-size:12.5px;margin-top:22px">Se o botão não funcionar, copie e cole este endereço no navegador:<br>
<span style="color:#82308F;word-break:break-all">{{ .ConfirmationURL }}</span></p>"""

CONVITE = ("<p><b>Você foi convidada para o Ressoar</b>, a plataforma de e-mails "
           "da %s.</p>" % MARCA) if MARCA else \
          "<p><b>Você foi convidada para o Ressoar.</b></p>"

templates = {
    "confirmation": (
        "Confirme seu e-mail — Ressoar",
        BASE % ("<p><b>Bem-vinda ao Ressoar!</b></p>"
                "<p>Sua conta foi criada. Confirme seu e-mail para concluir o cadastro:</p>"
                f"<p style='margin:26px 0'>{BOTAO % 'Confirmar meu e-mail'}</p>"
                "<p style='background:#FFF4D6;border-radius:8px;padding:12px 14px;font-size:13.5px;color:#8A6400'>"
                "Depois de confirmar, uma administradora precisa liberar seu acesso. "
                "Você é avisada assim que isso acontecer.</p>" + LINK_ALT)),
    "recovery": (
        "Redefinir sua senha — Ressoar",
        BASE % ("<p><b>Vamos redefinir sua senha.</b></p>"
                "<p>Você pediu para recuperar o acesso ao Ressoar. Clique no botão abaixo para criar uma nova senha:</p>"
                f"<p style='margin:26px 0'>{BOTAO % 'Criar nova senha'}</p>"
                "<p style='color:#5F667E;font-size:13.5px'>O link vale por 1 hora. "
                "Se não foi você que pediu, ignore este e-mail — sua senha atual continua valendo.</p>" + LINK_ALT)),
    "invite": (
        "Seu acesso ao Ressoar está pronto",
        BASE % (CONVITE +
                "<p>Clique abaixo para definir sua senha e entrar:</p>"
                f"<p style='margin:26px 0'>{BOTAO % 'Definir minha senha'}</p>" + LINK_ALT)),
    "magic_link": (
        "Seu link de entrada — Ressoar",
        BASE % ("<p><b>Entrar no Ressoar</b></p>"
                "<p>Use o botão abaixo para entrar sem digitar senha:</p>"
                f"<p style='margin:26px 0'>{BOTAO % 'Entrar no Ressoar'}</p>"
                "<p style='color:#5F667E;font-size:13.5px'>O link vale por 1 hora e só pode ser usado uma vez.</p>" + LINK_ALT)),
    "email_change": (
        "Confirme seu novo e-mail — Ressoar",
        BASE % ("<p><b>Confirmação de troca de e-mail</b></p>"
                "<p>Recebemos um pedido para trocar o e-mail da sua conta no Ressoar para <b>{{ .NewEmail }}</b>.</p>"
                f"<p style='margin:26px 0'>{BOTAO % 'Confirmar novo e-mail'}</p>"
                "<p style='color:#5F667E;font-size:13.5px'>Enquanto você não confirmar, o e-mail antigo continua valendo.</p>" + LINK_ALT)),
}

payload = {}
for chave, (assunto, corpo) in templates.items():
    payload[f"mailer_subjects_{chave}"] = assunto
    payload[f"mailer_templates_{chave}_content"] = corpo

def patch(corpo):
    req = urllib.request.Request(API, data=json.dumps(corpo).encode("utf-8"), method="PATCH", headers={
        "Authorization": "Bearer " + TOKEN,
        "Content-Type": "application/json",
        "User-Agent": "ressoa-setup/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return None, e.read().decode("utf-8", "replace")[:400]


# aplica um por vez para identificar qualquer campo rejeitado
for chave in templates:
    parcial = {
        f"mailer_subjects_{chave}": payload[f"mailer_subjects_{chave}"],
        f"mailer_templates_{chave}_content": payload[f"mailer_templates_{chave}_content"],
    }
    d, err = patch(parcial)
    if err:
        print(chave, "-> ERRO:", err)
    else:
        print(chave, "->", d.get(f"mailer_subjects_{chave}"))
