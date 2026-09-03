# -*- coding: utf-8 -*-
"""Desenha a imagem de compartilhamento (Open Graph) da landing, 1200x630.

E ela que aparece quando o link da Ressoar e colado no WhatsApp e afins.
A arte segue a identidade da pagina: fundo noturno com brilho roxo, as ondas
de ressonancia, o simbolo com o nome e o titulo da casa propria.

Uso:  python scripts/gerar_og.py
Sai:  app/painel/public/og.png  (o build do Vite copia para o dist)

A IBM Plex Sans vem do proprio painel (node_modules/@fontsource, formato
WOFF v1), convertida para TTF aqui mesmo — WOFF v1 e um TTF com as tabelas
comprimidas em zlib, entao a conversao dispensa biblioteca externa. Sem o
node_modules instalado, a fonte cai para a Segoe UI do Windows.
"""
import io
import struct
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
FONTES = RAIZ / "app" / "painel" / "node_modules" / "@fontsource" / "ibm-plex-sans" / "files"
SAIDA = RAIZ / "app" / "painel" / "public" / "og.png"

# fator de superamostragem: desenha grande, reduz com LANCZOS = bordas lisas
F = 2
L, A = 1200 * F, 630 * F

# paleta da landing
NOITE1, NOITE2, NOITE3 = (32, 10, 43), (21, 8, 24), (12, 6, 15)
GLOW = (59, 15, 74)
LILAS, LILAS2, LILAS_ESCURO = (199, 127, 214), (217, 163, 230), (142, 124, 153)
BRANCO = (255, 255, 255)
NOITE_TEXTO2 = (203, 187, 214)


def woff_para_ttf(caminho: Path) -> bytes:
    """WOFF v1 -> TTF: descomprime tabela por tabela (zlib builtin)."""
    dados = caminho.read_bytes()
    (assinatura, flavor, _tam, num_tabelas) = struct.unpack(">4sIIH", dados[:14])
    if assinatura != b"wOFF":
        raise ValueError("nao e WOFF v1")
    tabelas = []
    for i in range(num_tabelas):
        base = 44 + i * 20
        tag, offset, comp, orig, checksum = struct.unpack(">4sIIII", dados[base:base + 20])
        bruto = dados[offset:offset + comp]
        tabelas.append((tag, checksum, zlib.decompress(bruto) if comp < orig else bruto))
    # cabecalho sfnt + diretorio + tabelas alinhadas em 4 bytes
    busca = 1
    while busca * 2 <= num_tabelas:
        busca *= 2
    saida = io.BytesIO()
    saida.write(struct.pack(">IHHHH", flavor, num_tabelas, busca * 16,
                            busca.bit_length() - 1, num_tabelas * 16 - busca * 16))
    pos = 12 + num_tabelas * 16
    corpo = io.BytesIO()
    for tag, checksum, conteudo in tabelas:
        saida.write(struct.pack(">4sIII", tag, checksum, pos, len(conteudo)))
        corpo.write(conteudo)
        resto = (-len(conteudo)) % 4
        corpo.write(b"\0" * resto)
        pos += len(conteudo) + resto
    return saida.getvalue() + corpo.getvalue()


def fonte(peso: str, tamanho: int) -> ImageFont.FreeTypeFont:
    woff = FONTES / f"ibm-plex-sans-latin-{peso}-normal.woff"
    if woff.exists():
        return ImageFont.truetype(io.BytesIO(woff_para_ttf(woff)), tamanho)
    return ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf" if peso == "700"
                              else "C:/Windows/Fonts/segoeui.ttf", tamanho)


def gradiente_diagonal() -> Image.Image:
    """Fundo noturno: 3 cores escorrendo na diagonal + brilho roxo em dois cantos."""
    mini = Image.new("RGB", (64, 34))
    px = mini.load()
    for y in range(34):
        for x in range(64):
            t = (x / 63 * 0.55 + y / 33 * 0.45)
            if t < 0.55:
                a, b, f = NOITE1, NOITE2, t / 0.55
            else:
                a, b, f = NOITE2, NOITE3, (t - 0.55) / 0.45
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * f) for i in range(3))
    base = mini.resize((L, A), Image.BILINEAR)

    def brilho(cx, cy, raio, forca):
        m = Image.new("L", (160, 84), 0)
        d = ImageDraw.Draw(m)
        for r in range(60, 0, -1):
            alfa = round(forca * (1 - r / 60) ** 2)
            d.ellipse([cx / L * 160 - r, cy / A * 84 - r * 84 / 160 / (A / L) * (160 / 84),
                       cx / L * 160 + r, cy / A * 84 + r * 84 / 160 / (A / L) * (160 / 84)], fill=alfa)
        mascara = m.resize((L, A), Image.BILINEAR)
        cor = Image.new("RGB", (L, A), GLOW)
        return Image.composite(cor, base, mascara)

    saida = brilho(int(L * 0.14), int(A * 0.10), 60, 150)
    base = saida
    saida = brilho(int(L * 0.92), int(A * 0.96), 46, 110)
    return saida


def desenhar() -> Image.Image:
    img = gradiente_diagonal().convert("RGBA")

    # ondas de ressonancia, centradas a direita
    ondas = Image.new("RGBA", (L, A), (0, 0, 0, 0))
    d = ImageDraw.Draw(ondas)
    cx, cy = int(L * 0.80), int(A * 0.52)
    for i, raio in enumerate(range(130 * F, 640 * F, 102 * F)):
        alfa = max(14, 52 - i * 8)
        d.ellipse([cx - raio, cy - raio, cx + raio, cy + raio],
                  outline=LILAS + (alfa,), width=2 * F)
    img = Image.alpha_composite(img, ondas)

    d = ImageDraw.Draw(img)
    mx = 84 * F  # margem esquerda

    # simbolo (circulo + duas ondas) e o nome
    lx, ly, esc = mx, 64 * F, F * 1.55
    d.ellipse([lx + 8 * esc, ly + 12 * esc, lx + 16 * esc, ly + 20 * esc], fill=LILAS2)
    for raio in (10, 14):
        d.arc([lx + 12 * esc - raio * esc, ly + 16 * esc - raio * esc,
               lx + 12 * esc + raio * esc, ly + 16 * esc + raio * esc],
              start=-63, end=63, fill=LILAS2, width=int(2.6 * esc))
    d.text((lx + 34 * esc, ly + 16 * esc), "Ressoar", font=fonte("700", 40 * F),
           fill=BRANCO, anchor="lm")

    # pilula "E-mail marketing em casa propria"
    fp = fonte("600", 25 * F)
    texto_pill = "E-mail marketing em casa própria"
    tw = d.textlength(texto_pill, font=fp)
    py, ph = 205 * F, 52 * F
    d.rounded_rectangle([mx, py, mx + tw + 66 * F, py + ph], radius=ph // 2,
                        outline=LILAS + (110,), width=F,
                        fill=(130, 48, 143, 40))
    d.ellipse([mx + 24 * F, py + ph // 2 - 5 * F, mx + 34 * F, py + ph // 2 + 5 * F], fill=LILAS)
    d.text((mx + 48 * F, py + ph // 2), texto_pill, font=fp, fill=LILAS2, anchor="lm")

    # titulo em duas linhas
    ft = fonte("700", 88 * F)
    d.text((mx, 322 * F), "A casa própria do", font=ft, fill=BRANCO, anchor="lm")
    y2 = 422 * F
    d.text((mx, y2), "e-mail marketing.", font=ft, fill=LILAS2, anchor="lm")
    tw2 = d.textlength("e-mail marketing.", font=ft)
    d.rounded_rectangle([mx, y2 + 52 * F, mx + tw2 - 26 * F, y2 + 58 * F],
                        radius=3 * F, fill=LILAS + (120,))

    # a linha de recursos, no pe
    fr = fonte("500", 27 * F)
    partes = ["Base", "Campanhas", "Automações", "Lead scoring", "Vendas", "WhatsApp"]
    x = mx
    yr = 548 * F
    for i, parte in enumerate(partes):
        d.text((x, yr), parte, font=fr, fill=NOITE_TEXTO2, anchor="lm")
        x += d.textlength(parte, font=fr) + 18 * F
        if i < len(partes) - 1:
            d.text((x, yr), "·", font=fr, fill=LILAS_ESCURO, anchor="lm")
            x += d.textlength("·", font=fr) + 18 * F

    return img.convert("RGB").resize((1200, 630), Image.LANCZOS)


if __name__ == "__main__":
    arte = desenhar()
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    arte.save(SAIDA, "PNG", optimize=True)
    kb = SAIDA.stat().st_size / 1024
    # WhatsApp ignora imagem pesada: acima de ~290 KB o PNG vira JPEG
    if kb > 290:
        arte.save(SAIDA, "PNG")  # mantem o nome .png por simplicidade de rota
        arte.save(SAIDA.with_suffix(".jpg"), "JPEG", quality=88)
        print(f"og.png ficou com {kb:.0f} KB — gerei tambem og.jpg")
    print(f"pronto: {SAIDA.relative_to(RAIZ)} ({SAIDA.stat().st_size / 1024:.0f} KB)")
