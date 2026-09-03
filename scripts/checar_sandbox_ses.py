#!/usr/bin/env python3
"""Pergunta ao SES se a conta ainda esta na area restrita (sandbox).

Existe porque a espera pela liberacao da AWS pode durar horas: o console
desloga sozinho e ninguem quer ficar recarregando pagina. Este script fala
direto com a API, entao roda de madrugada, sem navegador e sem sessao.

    python scripts/checar_sandbox_ses.py

Sai com codigo 0 quando JA FOI LIBERADO e 10 quando ainda esta preso — assim
a tarefa agendada do Windows consegue disparar aviso so na hora certa.
As chaves vem do .env e nunca sao impressas.
"""
import datetime
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICO = "ses"
CAMINHO = "/v2/email/account"


def ler_env(caminho: str) -> dict:
    """Le o .env sem depender de biblioteca externa."""
    valores = {}
    if not os.path.exists(caminho):
        return valores
    with open(caminho, encoding="utf-8") as arquivo:
        for linha in arquivo:
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, _, valor = linha.partition("=")
            valores[chave.strip()] = valor.strip().strip('"').strip("'")
    return valores


def assinar(chave: bytes, dado: str) -> bytes:
    return hmac.new(chave, dado.encode("utf-8"), hashlib.sha256).digest()


def cabecalhos_sigv4(chave_id: str, segredo: str, regiao: str, host: str) -> dict:
    """Monta a assinatura AWS SigV4 para um GET sem corpo."""
    agora = datetime.datetime.now(datetime.timezone.utc)
    stamp = agora.strftime("%Y%m%dT%H%M%SZ")
    dia = agora.strftime("%Y%m%d")
    escopo = f"{dia}/{regiao}/{SERVICO}/aws4_request"
    hash_corpo = hashlib.sha256(b"").hexdigest()

    canonica = "\n".join([
        "GET", CAMINHO, "",
        f"host:{host}", f"x-amz-date:{stamp}", "",
        "host;x-amz-date", hash_corpo,
    ])
    para_assinar = "\n".join([
        "AWS4-HMAC-SHA256", stamp, escopo,
        hashlib.sha256(canonica.encode("utf-8")).hexdigest(),
    ])

    chave = f"AWS4{segredo}".encode("utf-8")
    for parte in (dia, regiao, SERVICO, "aws4_request"):
        chave = assinar(chave, parte)
    assinatura = hmac.new(chave, para_assinar.encode("utf-8"), hashlib.sha256).hexdigest()

    return {
        "Host": host,
        "X-Amz-Date": stamp,
        "Authorization": (
            f"AWS4-HMAC-SHA256 Credential={chave_id}/{escopo}, "
            f"SignedHeaders=host;x-amz-date, Signature={assinatura}"
        ),
    }


def main() -> int:
    env = ler_env(os.path.join(RAIZ, ".env"))
    chave_id = env.get("AWS_ACCESS_KEY_ID", "")
    segredo = env.get("AWS_SECRET_ACCESS_KEY", "")
    regiao = env.get("AWS_REGIAO", "us-east-1")

    if not chave_id or not segredo:
        print("ERRO: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY ausentes no .env")
        return 2

    host = f"email.{regiao}.amazonaws.com"
    pedido = urllib.request.Request(
        f"https://{host}{CAMINHO}",
        headers=cabecalhos_sigv4(chave_id, segredo, regiao, host),
        method="GET",
    )

    try:
        with urllib.request.urlopen(pedido, timeout=30) as resposta:
            dados = json.loads(resposta.read().decode("utf-8"))
    except urllib.error.HTTPError as erro:
        corpo = erro.read().decode("utf-8", "replace")[:300]
        print(f"ERRO HTTP {erro.code}: {corpo}")
        # 403 aqui costuma significar que falta ses:GetAccount na politica IAM
        return 3
    except Exception as erro:  # rede caiu, DNS, etc.
        print(f"ERRO: {erro}")
        return 4

    liberado = bool(dados.get("ProductionAccessEnabled"))
    envio_ativo = bool(dados.get("SendingEnabled"))
    cota = (dados.get("SendQuota") or {}).get("Max24HourSend")
    momento = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")

    if liberado:
        print(f"[{momento}] LIBERADO! Producao ativa. Cota 24h: {cota}. Envio ligado: {envio_ativo}")
        return 0

    print(f"[{momento}] ainda na area restrita (sandbox). Cota 24h: {cota}")
    return 10


if __name__ == "__main__":
    sys.exit(main())
