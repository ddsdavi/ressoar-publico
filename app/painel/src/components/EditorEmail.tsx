import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import grapesjs, { type Editor, type Component } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import presetNewsletter from "grapesjs-preset-newsletter";
import { MARCA_NOME, MARCA_RODAPE } from "../lib/marca";
import Dialogos, { avisar, confirmar, pedirTexto } from "./Dialogo";

// Editor visual de e-mail (GrapesJS, 100% local — nada sai do navegador).
// Salva HTML com o CSS embutido em cada tag (é o que cliente de e-mail
// entende) + o design em JSON, para reeditar depois sem perder a estrutura.
//
// A interface é NOSSA, não a de fábrica: o GrapesJS nasce pelado, com cara
// de ferramenta de programador (painéis "Classes", "State", tudo em inglês,
// vinte ícones sem nome). Aqui ele roda decapitado — sem painéis próprios —
// e a gente monta em volta: blocos à esquerda, folha no centro, aparência à
// direita, tudo em português. Quem escreve e-mail não precisa saber o que é
// um seletor CSS.
//
// Tudo aqui é montado com <table>: o Outlook ignora boa parte de flex/grid,
// e e-mail quebrado no Outlook é e-mail quebrado para meia lista.

const LARGURA = 600;                            // largura clássica de newsletter
const FONTE = "Arial, Helvetica, sans-serif";   // fonte segura em todo cliente
const SERIF = "Georgia, 'Times New Roman', serif"; // a serifa da marca

// Endereço das funções públicas. O contador é uma imagem servida por elas —
// precisa de URL absoluta, porque quem abre o e-mail está fora do painel.
const BASE_FUNCOES = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1`;
const URL_CONTADOR = `${BASE_FUNCOES}/contador`;

// prazo de exemplo: uma semana à frente, só para o bloco nascer mostrando algo
const PRAZO_EXEMPLO = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 19) + "-03:00";

// As cores e a fonte que os blocos trazem de fábrica. Servem de gabarito: o
// que estiver configurado em Ajustes substitui estes valores no momento em
// que o bloco é registrado, e aí todo bloco arrastado já nasce na identidade
// visual certa — sem ninguém precisar repintar nada à mão.
const PADRAO = {
  email_fonte: "Arial, Helvetica, sans-serif",
  email_cor_texto: "#3c3646",
  email_cor_titulo: "#1f1a2e",
  email_cor_destaque: "#82308f",
  email_cor_fundo: "#f6f4f8",
};

const aplicarEstilos = (html: string, estilos: Record<string, string>) => {
  let saida = html;
  for (const [chave, de] of Object.entries(PADRAO)) {
    const para = estilos[chave];
    if (!para || para === de) continue;
    saida = saida.split(de).join(para);
    if (de.startsWith("#")) {                    // o mesmo tom sem o "#" (ex.: contador)
      saida = saida.split(de.slice(1)).join(para.replace("#", ""));
    }
  }
  return saida;
};

const bloco = (interno: string, padding = "8px 24px") =>
  `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
     <td style="padding:${padding};font-family:${FONTE}">${interno}</td>
   </tr></table>`;


// ---- estruturas de coluna ------------------------------------------------
// Coluna de e-mail é <td>, não flex nem grid: o Outlook ignora os dois. E no
// celular cada <td> continua lado a lado — por isso as colunas ganham a
// classe "col-empilha", que a media query do topo empilha abaixo de 480px.
const coluna = (larguras: number[]) => {
  // o respiro lateral (24px) é o MESMO dos blocos de conteúdo: texto digitado
  // dentro de uma célula fica alinhado com o resto do e-mail — antes a célula
  // nascia com 8px e o texto saía colado na borda ("célula fantasma")
  const tds = larguras.map((w) => `
        <td class="col-empilha" width="${w}%" valign="top"
            style="padding:8px 24px;font-family:${FONTE};font-size:15px;line-height:1.6;color:#3c3646">
          Escreva aqui
        </td>`).join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:4px 16px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${tds}
        </tr></table>
      </td></tr></table>`;
};

const ESTRUTURAS: { id: string; label: string; content: string }[] = [
  { id: "est-1", label: "1 coluna", content: coluna([100]) },
  { id: "est-2", label: "2 colunas", content: coluna([50, 50]) },
  { id: "est-3", label: "3 colunas", content: coluna([33, 34, 33]) },
  { id: "est-4", label: "4 colunas", content: coluna([25, 25, 25, 25]) },
  { id: "est-1-2", label: "1 : 2", content: coluna([33, 67]) },
  { id: "est-2-1", label: "2 : 1", content: coluna([67, 33]) },
];

// Os blocos recebem o nome real do remetente (Configurações → Nome do
// remetente padrão) na hora do registro — nada de "Nome do Remetente"
// vazando para e-mail de gente de verdade.
const montarBlocos = (nomeMarca: string): { id: string; label: string; icone: string; content: string }[] => [
  {
    id: "ress-titulo", label: "Título", icone: "T",
    content: bloco(`<h1 style="margin:0;font-size:26px;line-height:1.3;color:#1f1a2e;font-weight:700">
      Seu título aqui</h1>`),
  },
  {
    id: "ress-texto", label: "Parágrafo", icone: "¶",
    content: bloco(`<p style="margin:0;font-size:16px;line-height:1.65;color:#3c3646">
      Olá {{nome}}, escreva seu texto aqui. Frases curtas funcionam melhor no celular,
      que é onde a maioria vai ler.</p>`),
  },
  {
    id: "ress-botao", label: "Botão", icone: "▭",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:20px 24px">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="#82308f" style="border-radius:8px">
            <a href="https://" style="display:inline-block;padding:14px 32px;font-family:${FONTE};
               font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">
              Quero participar</a>
          </td></tr></table>
      </td></tr></table>`,
  },
  {
    id: "ress-imagem", label: "Imagem", icone: "🖼",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:8px 24px">
        <img src="https://placehold.co/552x280/efeae1/82308f?text=sua+imagem" alt=""
             width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:8px" />
      </td></tr></table>`,
  },
  {
    id: "ress-destaque", label: "Destaque", icone: "❝",
    content: bloco(`<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-left:4px solid #82308f;background:#f6f3fb;padding:16px 20px;border-radius:6px">
        <p style="margin:0;font-size:16px;line-height:1.6;color:#3c3646">
          Um recado que não pode passar batido.</p>
      </td></tr></table>`),
  },
  {
    id: "ress-divisor", label: "Divisor", icone: "—",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:12px 24px"><div style="border-top:1px solid #e6e2da;font-size:0;line-height:0">&nbsp;</div></td>
    </tr></table>`,
  },
  {
    id: "ress-espaco", label: "Espaço", icone: "␣",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td height="28" style="font-size:0;line-height:0">&nbsp;</td></tr></table>`,
  },
  {
    id: "ress-video", label: "Vídeo", icone: "▶",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:12px 24px">
        <a href="https://" style="display:block;text-decoration:none">
          <img src="https://placehold.co/552x310/1f1a2e/ffffff?text=%E2%96%B6" alt="Assistir"
               width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:8px" />
        </a>
        <div style="font-family:${FONTE};font-size:13px;color:#7a756a;padding-top:6px">
          clique para assistir</div>
      </td></tr></table>`,
  },
  {
    id: "ress-social", label: "Redes sociais", icone: "@",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:16px 24px">
        <a href="https://instagram.com/" style="display:inline-block;padding:0 8px;text-decoration:none;
           font-family:${FONTE};font-size:14px;color:#82308f">Instagram</a>
        <a href="https://youtube.com/" style="display:inline-block;padding:0 8px;text-decoration:none;
           font-family:${FONTE};font-size:14px;color:#82308f">YouTube</a>
        <a href="https://facebook.com/" style="display:inline-block;padding:0 8px;text-decoration:none;
           font-family:${FONTE};font-size:14px;color:#82308f">Facebook</a>
      </td></tr></table>`,
  },
  {
    id: "ress-banner", label: "Banner", icone: "▬",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#82308f"><tr>
      <td align="center" style="padding:26px 24px;font-family:${FONTE}">
        <div style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.35">
          Uma chamada que precisa aparecer</div>
        <div style="font-size:15px;color:#e9e2f7;padding-top:6px;line-height:1.5">
          e uma frase de apoio logo abaixo</div>
      </td></tr></table>`,
  },
  {
    id: "ress-prazo", label: "Prazo (data)", icone: "⏰",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:18px 24px;font-family:${FONTE}">
        <div style="font-size:13px;color:#7a756a;text-transform:uppercase;letter-spacing:.5px">
          As inscrições encerram em</div>
        <div style="font-size:26px;font-weight:700;color:#1f1a2e;padding-top:4px">
          segunda-feira, 07:00</div>
      </td></tr></table>`,
  },
  {
    id: "ress-menu", label: "Menu de links", icone: "☰",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:12px 24px;border-bottom:1px solid #e6e2da;font-family:${FONTE}">
        <a href="https://" style="padding:0 10px;font-size:14px;color:#3c3646;text-decoration:none">Início</a>
        <a href="https://" style="padding:0 10px;font-size:14px;color:#3c3646;text-decoration:none">Cursos</a>
        <a href="https://" style="padding:0 10px;font-size:14px;color:#3c3646;text-decoration:none">Contato</a>
      </td></tr></table>`,
  },
  {
    id: "ress-passos", label: "Lista de passos", icone: "1)",
    content: bloco(`<table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td valign="top" width="32" style="font-size:16px;font-weight:700;color:#82308f;padding:6px 0">1)</td>
          <td style="font-size:16px;line-height:1.6;color:#3c3646;padding:6px 0">
            <b>Primeiro passo</b> — o que a pessoa precisa fazer agora.</td></tr>
      <tr><td valign="top" style="font-size:16px;font-weight:700;color:#82308f;padding:6px 0">2)</td>
          <td style="font-size:16px;line-height:1.6;color:#3c3646;padding:6px 0">
            <b>Segundo passo</b> — e o seguinte.</td></tr>
      <tr><td valign="top" style="font-size:16px;font-weight:700;color:#82308f;padding:6px 0">3)</td>
          <td style="font-size:16px;line-height:1.6;color:#3c3646;padding:6px 0">
            <b>Terceiro passo</b> — feche com o mais importante.</td></tr>
    </table>`),
  },
  {
    id: "ress-contador", label: "Contador regressivo", icone: "⏳",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:20px 24px;font-family:${FONTE}">
        <div style="font-size:13px;color:#7a756a;text-transform:uppercase;letter-spacing:.5px;
                    padding-bottom:8px">Falta pouco</div>
        <img src="${URL_CONTADOR}?ate=${PRAZO_EXEMPLO}&cor=82308f&fundo=ffffff"
             alt="tempo restante" width="362"
             style="display:block;margin:0 auto;max-width:100%;height:auto" />
        <div style="font-size:12px;color:#a09a8e;padding-top:6px">
          dias &middot; horas &middot; min &middot; seg</div>
      </td></tr></table>`,
  },
  {
    id: "ress-html", label: "HTML livre", icone: "</>",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0" data-ress-html="1"><tr>
      <td style="padding:8px 24px;font-family:${FONTE};font-size:15px;color:#3c3646">
        Bloco de HTML livre. Clique nele e cole o seu código no painel à direita.
      </td></tr></table>`,
  },
  {
    id: "ress-assinatura", label: "Assinatura", icone: "✍",
    content: bloco(`<p style="margin:0;font-size:15px;line-height:1.7;color:#3c3646">
      Um abraço,<br /><b>${nomeMarca}</b><br />
      <span style="color:#7a756a;font-size:13px">${MARCA_RODAPE.split("·")[0].trim() || ""}</span></p>`, "20px 24px"),
  },
];

// o motor entende os dois formatos: o nosso e o herdado do ActiveCampaign
const TAGS = [
  { tag: "{{nome}}", desc: "primeiro nome" },
  { tag: "{{nome_completo}}", desc: "nome completo" },
  { tag: "{{email}}", desc: "e-mail" },
  { tag: "%FIRSTNAME%", desc: "primeiro nome, formato ActiveCampaign" },
];

// Sem isto, uma linha de 4 colunas fica com 138px cada no celular e o texto
// vira uma coluna de letras. Media query em <style> no topo do e-mail é a
// forma que Gmail, Apple Mail e a maioria respeita.
const RESPONSIVO = `<style>
  @media only screen and (max-width:480px) {
    .col-empilha { display:block !important; width:100% !important; }
    .corpo-email { width:100% !important; }
  }
</style>`;

const envolve = (miolo: string) =>
  `${RESPONSIVO}<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f4f8"><tr>
     <td align="center" style="padding:28px 12px">
       <table width="${LARGURA}" class="corpo-email" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"
              style="max-width:${LARGURA}px;border-radius:12px">
         <tr><td style="padding:12px 0">${miolo}</td></tr>
       </table>
     </td></tr></table>`;

// O modelo oficial da marca — o mesmo desenho de app/modelos/email-base.html,
// traduzido para os tokens do gabarito (as cores trocam junto com Ajustes).
// Não usa envolve(): a faixa do topo precisa nascer colada no cartão, e o
// wrapper padrão daria um respiro branco acima dela.
const montarModelos = (nomeMarca: string) => {
  const B = Object.fromEntries(montarBlocos(nomeMarca).map((b) => [b.id, b.content]));
  const marca = `${RESPONSIVO}
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f4f8"><tr>
  <td align="center" style="padding:28px 12px">
    <table width="${LARGURA}" class="corpo-email" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"
           style="max-width:${LARGURA}px;border-radius:12px;overflow:hidden">
      <tr><td bgcolor="#82308f" style="padding:18px 28px">
        <p style="margin:0;font-family:${SERIF};font-size:18px;
                  line-height:1.4;color:#ffffff;letter-spacing:.3px">${nomeMarca}</p>
      </td></tr>
      <tr><td style="padding:10px 4px 4px 4px">
        ${bloco(`<h1 style="margin:0;font-family:${SERIF};font-size:26px;
          line-height:1.35;color:#1f1a2e;font-weight:normal">Seu título aqui</h1>`, "18px 24px 6px 24px")}
        ${B["ress-texto"]}
        ${B["ress-botao"]}
        ${bloco(`<div style="height:3px;background:#82308f;border-radius:2px;font-size:0;line-height:0">&nbsp;</div>`, "6px 24px")}
        ${B["ress-assinatura"]}
      </td></tr>
    </table>
  </td></tr></table>`;

  const modelos: { nome: string; descricao: string; html: string; selo?: string }[] = [
    {
      nome: "Padrão da marca",
      descricao: "O visual oficial: faixa da marca, título em serifa e assinatura. Comece por aqui.",
      html: marca,
      selo: "padrão",
    },
    {
      nome: "Carta simples",
      descricao: "Só texto, como um e-mail pessoal. É o formato que costuma ter a melhor entrega.",
      html: envolve(B["ress-texto"] + B["ress-assinatura"]),
    },
    {
      nome: "Convite com botão",
      descricao: "Título, texto e uma chamada para ação. Para aulas, lives e lançamentos.",
      html: envolve(B["ress-titulo"] + B["ress-texto"] + B["ress-botao"] + B["ress-assinatura"]),
    },
    {
      nome: "Anúncio com imagem",
      descricao: "Imagem no topo, título, texto, destaque e botão.",
      html: envolve(B["ress-imagem"] + B["ress-titulo"] + B["ress-texto"] +
                    B["ress-destaque"] + B["ress-botao"] + B["ress-assinatura"]),
    },
    {
      nome: "Começar do zero",
      descricao: "Uma folha quase em branco para montar do seu jeito.",
      html: envolve(B["ress-texto"]),
    },
  ];
  return modelos;
};

// A cara do editor. O GrapesJS injeta as classes .gjs-*; aqui elas deixam de
// parecer ferramenta de programador e entram no tema do painel. Vive num
// <style> próprio para não depender da ordem dos CSS globais.
const TEMA_EDITOR = `
.ress-editor .gjs-one-bg { background: #ffffff; }
.ress-editor .gjs-two-color { color: #2a2233; }
.ress-editor .gjs-three-bg { background: #82308f; color: #fff; }
.ress-editor .gjs-four-color, .ress-editor .gjs-four-color-h:hover { color: #82308f; }
.ress-editor .gjs-cv-canvas { background: #eee9f0; }
.ress-editor .gjs-block {
  width: 100%; min-height: 64px; margin: 0; padding: 10px 6px 8px;
  border: 1px solid #e5dcea; border-radius: 10px; background: #fff;
  color: #4a4152; font-size: 12px; box-shadow: none; cursor: grab;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  transition: border-color .12s, box-shadow .12s, transform .12s;
}
.ress-editor .gjs-block:hover {
  border-color: #82308f; box-shadow: 0 3px 10px rgba(130,48,143,.14);
  transform: translateY(-1px); color: #82308f;
}
.ress-editor .gjs-block .ress-b-ico {
  font-size: 19px; line-height: 1; color: #82308f; font-family: Georgia, serif;
}
.ress-editor .gjs-block-category, .ress-editor .gjs-sm-sector { border: none; }
.ress-editor .gjs-block-category .gjs-title, .ress-editor .gjs-sm-sector-title {
  background: transparent; border: none; color: #6d6478; font-size: 11px;
  font-weight: 700; letter-spacing: .8px; text-transform: uppercase;
  padding: 14px 4px 6px;
}
.ress-editor .gjs-blocks-c { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 2px; }
.ress-editor .gjs-sm-sector .gjs-sm-properties { padding: 4px 2px 10px; }
.ress-editor .gjs-sm-label { color: #55495e; font-size: 12px; }
.ress-editor .gjs-field {
  background: #f6f2f8; border: 1px solid #e5dcea; border-radius: 8px; color: #2a2233;
}
.ress-editor .gjs-field input, .ress-editor .gjs-field select { color: #2a2233; }
.ress-editor .gjs-sm-btn, .ress-editor .gjs-btn-prim {
  background: #f1e7f3; color: #82308f; border-radius: 8px; border: none;
}
.ress-editor .gjs-toolbar { background: #82308f; border-radius: 8px; }
.ress-editor .gjs-badge { background: #82308f; border-radius: 6px; }
.ress-editor .gjs-selected { outline: 2px solid #82308f !important; outline-offset: -2px; }
.ress-editor .gjs-rte-toolbar { background: #2a2233; border-radius: 10px; border: none; }
.ress-editor .gjs-rte-action { color: #fff; border: none; }
.ress-editor .gjs-rte-action.gjs-rte-active { background: #82308f; }
`;

export default function EditorEmail({
  html, design, onSalvar, onFechar,
  assunto, aoMudarAssunto, preheader, aoMudarPreheader,
}: {
  html: string;
  design: unknown | null;
  onSalvar: (html: string, design: unknown) => void;
  onFechar: () => void;
  // o editor toma a tela inteira e escondia o assunto do passo de trás —
  // espelhados aqui, a pessoa escreve o e-mail completo sem sair dele
  assunto?: string;
  aoMudarAssunto?: (v: string) => void;
  preheader?: string;
  aoMudarPreheader?: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const refBlocos = useRef<HTMLDivElement>(null);
  const refEstilos = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const inicial = useRef<string>(html);
  // instantâneo do canvas para sobreviver às remontagens do editor
  // (guardar bloco muda `modulos` e o useEffect recria tudo)
  const retomarDesign = useRef<unknown>(null);
  // nivela recuos e varre blocos vazios — preenchido na montagem do editor,
  // usado pelo salvar() para o e-mail sair limpo mesmo sem novo drag
  const limparRef = useRef<() => void>(() => {});
  const [dispositivo, setDispositivo] = useState<"Desktop" | "Mobile">("Desktop");
  // galeria só aparece quando não há nada escrito ainda
  const [escolhendo, setEscolhendo] = useState(!html && !design);
  const [copiado, setCopiado] = useState("");
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [estilos, setEstilos] = useState<Record<string, string> | null>(null);
  const [modulos, setModulos] = useState<{ modulo_id: string; nome: string; html: string }[]>([]);
  const [ocupado, setOcupado] = useState("");
  // o que está selecionado na folha — alimenta o inspetor em linguagem humana
  const [sel, setSel] = useState<Component | null>(null);
  const [versaoSel, setVersaoSel] = useState(0);   // força re-render após aplicar mudança

  // O nome que assina os blocos: primeiro o das Configurações (é o que os
  // e-mails realmente usam), depois a assinatura da instalação, e um genérico
  // só como última rede.
  const nomeMarca = estilos?.from_name_padrao || MARCA_NOME || "Sua marca";
  const MODELOS = montarModelos(nomeMarca);

  // Os estilos precisam chegar ANTES de registrar os blocos — depois já não
  // adianta, o bloco arrastado sairia com a cor de fábrica.
  useEffect(() => {
    Promise.all([
      supabase.from("app_config").select("chave,valor")
        .or("chave.like.email_%,chave.eq.from_name_padrao"),
      supabase.from("email_modulos").select("modulo_id,nome,html").order("nome"),
    ]).then(([cfg, mod]) => {
      setEstilos(Object.fromEntries((cfg.data ?? []).map((r) => [r.chave, r.valor])));
      setModulos(mod.data ?? []);
    }).catch(() => {
      // rede falhou: melhor abrir com o padrão de fábrica do que uma tela
      // em branco eterna esperando uma resposta que não vem
      setEstilos({});
      setModulos([]);
    });
  }, []);

  useEffect(() => {
    if (!ref.current || !refBlocos.current || !refEstilos.current || escolhendo || !estilos) return;
    const editor = grapesjs.init({
      container: ref.current,
      height: "100%",
      storageManager: false,
      plugins: [presetNewsletter],
      // sem os painéis de fábrica: a moldura é nossa
      panels: { defaults: [] },
      blockManager: { appendTo: refBlocos.current },
      styleManager: {
        appendTo: refEstilos.current,
        // só o que faz sentido para e-mail, com nome de gente
        sectors: [
          {
            name: "Texto", open: true,
            properties: [
              { property: "font-size", name: "Tamanho" },
              { property: "font-weight", name: "Peso" },
              { property: "text-align", name: "Alinhamento" },
              { property: "line-height", name: "Entrelinha" },
              { property: "color", name: "Cor do texto" },
            ],
          },
          {
            name: "Fundo e borda", open: false,
            properties: [
              { property: "background-color", name: "Cor de fundo" },
              { property: "border-radius", name: "Cantos" },
              { property: "border", name: "Borda" },
            ],
          },
          {
            name: "Espaço", open: false,
            properties: [
              { property: "padding", name: "Respiro interno" },
              { property: "margin", name: "Distância externa" },
            ],
          },
          {
            name: "Tamanho", open: false,
            properties: [
              { property: "width", name: "Largura" },
              { property: "height", name: "Altura" },
            ],
          },
        ],
      },
      // "Classes" e "State" são conversa de CSS — ninguém aqui precisa disso
      selectorManager: { custom: true },
      traitManager: { custom: true },
      deviceManager: {
        devices: [
          { id: "Desktop", name: "Computador", width: "" },
          { id: "Mobile", name: "Celular", width: "375px", widthMedia: "480px" },
        ],
      },
      assetManager: {
        // O upload vai para o Storage do próprio projeto. Imagem de e-mail
        // precisa de URL pública e estável: quem abre a mensagem não está
        // logado, e o link continua sendo pedido meses depois — link
        // temporário quebraria o e-mail antigo.
        upload: false,          // desligamos o envio padrão; o nosso está abaixo
        autoAdd: true,
        assets: [],
      },
    });

    // O preset-newsletter ignora o panels:{defaults:[]} e recoloca a régua
    // de ícones dele; e o styleManager dele atropela os nossos setores em
    // português. Aqui, depois que ele terminou, a casa volta a ser nossa.
    editor.onReady(() => {
      editor.Panels.getPanels().reset([]);
      editor.StyleManager.getSectors().reset([
        {
          name: "Texto", open: true,
          properties: [
            { property: "font-size", name: "Tamanho" },
            { property: "font-weight", name: "Peso" },
            { property: "text-align", name: "Alinhamento" },
            { property: "line-height", name: "Entrelinha" },
            { property: "color", name: "Cor do texto" },
          ],
        },
        {
          name: "Fundo e borda", open: false,
          properties: [
            { property: "background-color", name: "Cor de fundo" },
            { property: "border-radius", name: "Cantos" },
            { property: "border", name: "Borda" },
          ],
        },
        {
          name: "Espaço", open: false,
          properties: [
            { property: "padding", name: "Respiro interno" },
            { property: "margin", name: "Distância externa" },
          ],
        },
        {
          name: "Tamanho", open: false,
          properties: [
            { property: "width", name: "Largura" },
            { property: "height", name: "Altura" },
          ],
        },
      ] as never);
    });

    // as etiquetas que aparecem sobre o que está selecionado, em português
    editor.I18n.addMessages({
      pt: {
        domComponents: {
          names: {
            "": "Bloco", wrapper: "Folha", text: "Texto", textnode: "Texto",
            cell: "Coluna", row: "Estrutura", table: "Bloco", image: "Imagem",
            link: "Link", video: "Vídeo", label: "Rótulo",
          },
        },
      },
    });
    editor.I18n.setLocale("pt");

    // ---- envio das imagens para o Storage ----
    editor.on("asset:upload:start", () => setEnviandoImagem(true));
    editor.on("asset:upload:end", () => setEnviandoImagem(false));

    const am = editor.AssetManager;

    // troca o envio padrão do GrapesJS pelo nosso
    editor.on("run:open-assets", () => { /* nada; só garante o registro */ });
    const inputArquivo = () => {
      const el = document.querySelector<HTMLInputElement>("#gjs-am-uploadFile");
      if (!el || el.dataset.ligado) return;
      el.dataset.ligado = "1";
      el.addEventListener("change", async (ev) => {
        const arquivos = (ev.target as HTMLInputElement).files;
        if (!arquivos?.length) return;
        setEnviandoImagem(true);
        for (const arq of Array.from(arquivos)) {
          const nome = `${Date.now()}-${arq.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
          const { error } = await supabase.storage.from("imagens").upload(nome, arq, {
            contentType: arq.type, upsert: false,
          });
          if (error) { avisar({ titulo: "Não foi possível enviar " + arq.name, corpo: error.message }); continue; }
          const { data } = supabase.storage.from("imagens").getPublicUrl(nome);
          am.add({ src: data.publicUrl, name: arq.name });
        }
        setEnviandoImagem(false);
        (ev.target as HTMLInputElement).value = "";
      });
    };
    editor.on("modal:open", () => setTimeout(inputArquivo, 60));

    // carrega o que já foi enviado antes
    supabase.storage.from("imagens").list("", { limit: 200, sortBy: { column: "created_at", order: "desc" } })
      .then(({ data }) => {
        for (const f of data ?? []) {
          if (f.name === ".emptyFolderPlaceholder") continue;
          am.add({ src: supabase.storage.from("imagens").getPublicUrl(f.name).data.publicUrl, name: f.name });
        }
      });

    // O preset-newsletter traz a mecânica boa (arrastar, embutir CSS), mas
    // também uma prateleira de blocos genéricos em inglês. Fora com eles:
    // aqui só entram os nossos, com nome em português.
    const bm = editor.BlockManager;
    bm.getAll().slice(0).forEach((b: { getId: () => string }) => {
      const id = b.getId();
      if (!/^(ress-|est-|mod-)/.test(id)) bm.remove(id);
    });

    ESTRUTURAS.forEach((e) => {
      bm.add(e.id, {
        label: e.label, content: aplicarEstilos(e.content, estilos), category: "Colunas",
      });
    });
    montarBlocos(nomeMarca).forEach((b) => {
      bm.add(b.id, {
        label: `<span class="ress-b-ico">${b.icone}</span>${b.label}`,
        content: aplicarEstilos(b.content, estilos), category: "Conteúdo",
      });
    });
    modulos.forEach((m) => {
      bm.add(`mod-${m.modulo_id}`, {
        label: m.nome, content: m.html, category: "Meus blocos guardados",
      });
    });

    if (retomarDesign.current) {
      // remontagem no meio do trabalho (ex.: guardou um bloco): o canvas
      // volta exatamente de onde estava, não do último salvamento
      try { editor.loadProjectData(retomarDesign.current as never); }
      catch { editor.setComponents(inicial.current || MODELOS[0].html); }
      retomarDesign.current = null;
    } else if (design) {
      try { editor.loadProjectData(design as never); }
      catch { editor.setComponents(inicial.current || MODELOS[0].html); }
    } else {
      editor.setComponents(inicial.current || MODELOS[0].html);
    }

    // E-mails desenhados antes de 30/08 têm a tabela central de 600px sem a
    // classe responsiva — no celular estouravam a tela ("100% desfigurado").
    // Ao abrir, a classe entra na tabela e a regra entra no CSS do canvas,
    // valendo para o modo Celular do editor e para o e-mail salvo.
    editor.Css.addRules(
      "@media only screen and (max-width:480px){ .corpo-email{ width:100% !important; } " +
      ".col-empilha{ display:block !important; width:100% !important; } }",
    );
    editor.getWrapper()?.onAll?.((c: Component) => {
      if ((c.get("tagName") || "").toLowerCase() === "table" &&
          String(c.getAttributes().width) === "600") {
        c.addClass("corpo-email");
      }
    });

    // ---- régua de recuos -------------------------------------------------
    // Bloco largado DENTRO de outro bloco (ou de uma célula de coluna) somava
    // o recuo lateral dos dois — 24px + 24px — e os parágrafos do e-mail
    // saíam desalinhados entre si, uns a 28px e outros a 52px da borda: a
    // marca verde do Davi no Gmail (30/08). A régua: um td de recuo que mora
    // dentro de outro td que já dá recuo perde o lateral próprio — quem dá o
    // respiro é o de fora. Assim todo caminho leva ao MESMO alinhamento.
    const nivelarRecuos = () => {
      editor.getWrapper()?.onAll?.((c: Component) => {
        if ((c.get("tagName") || "").toLowerCase() !== "td") return;
        const st = (c.getStyle?.() ?? {}) as Record<string, string>;
        const partes = String(st.padding ?? "").trim().split(/\s+/).filter(Boolean);
        if (!partes.length) return;
        const [t, r = t, b = t, l = r] = partes;
        if ((parseFloat(l) || 0) < 12 && (parseFloat(r) || 0) < 12) return; // já rente
        // cartão interno (fundo ou borda próprios, como o miolo do Destaque)
        // não é recuo — o respiro dele é visual e fica como está
        const at = c.getAttributes?.() ?? {};
        if (at.bgcolor || st.background || st["background-color"] ||
            st.border || st["border-left"]) return;
        // sobe até o primeiro td: se ele também recua (≥12px) ou é célula de
        // coluna, este é um recuo aninhado. A tabela central (corpo-email)
        // é a cerca — dali para fora é moldura, não conteúdo.
        let pai = c.parent();
        let aninhado = false;
        while (pai) {
          const tag = (pai.get("tagName") || "").toLowerCase();
          if (tag === "table" &&
              (String(pai.getAttributes?.().width) === "600" ||
               (pai.getClasses?.() ?? []).includes("corpo-email"))) break;
          if (tag === "td") {
            const stp = (pai.getStyle?.() ?? {}) as Record<string, string>;
            const pp = String(stp.padding ?? "").trim().split(/\s+/).filter(Boolean);
            const [, rr = pp[0], , ll = rr] = pp;
            aninhado = (pai.getClasses?.() ?? []).includes("col-empilha") ||
              (parseFloat(ll) || 0) >= 12 || (parseFloat(rr) || 0) >= 12;
            break;
          }
          pai = pai.parent();
        }
        if (!aninhado) return;
        c.addStyle({ padding: `${t} 0 ${b} 0` });
      });
    };

    // ---- varredura de fantasmas ------------------------------------------
    // Título ou parágrafo que ficou sem NENHUM texto vira um bloco invisível
    // que ocupa espaço e "assombra" o clique — a "célula fantasma" de 30/08.
    // Ao abrir e ao salvar, texto vazio sai; se o td-wrapper dele ficar sem
    // mais nada, a carcaça (a tabela do bloco) sai junto.
    const varrerFantasmas = () => {
      const mortos: Component[] = [];
      editor.getWrapper()?.onAll?.((c: Component) => {
        const tag = (c.get("tagName") || "").toLowerCase();
        if (!["h1", "h2", "h3", "p"].includes(tag)) return;
        const el = c.getEl?.();
        const txt = (el ? el.textContent ?? "" : c.toHTML().replace(/<[^>]*>/g, ""))
          .replace(/ |&nbsp;/g, " ").trim();
        if (txt || el?.querySelector?.("img,a")) return;
        mortos.push(c);
      });
      for (const c of mortos) {
        // sobe enquanto o pai ficará vazio sem ele — leva a carcaça junto
        let alvo: Component = c;
        let pai = alvo.parent();
        while (pai && (pai.components()?.models?.length ?? 0) === 1 &&
               (pai.get("tagName") || "").toLowerCase() !== "body" &&
               !(pai.getClasses?.() ?? []).includes("col-empilha") &&
               !(pai.getClasses?.() ?? []).includes("corpo-email")) {
          alvo = pai;
          pai = alvo.parent();
        }
        alvo.remove();
      }
    };

    // ---- papéis: só BLOCO e COLUNA são vivos ----------------------------
    // Desenho da mesa (30/08): o esqueleto do e-mail (tbody/tr/td/tabelas
    // internas) é implementação de renderização — não pode receber clique,
    // hover nem drop. As únicas unidades que a pessoa toca são o BLOCO (a
    // tabela inteira de cada peça: parágrafo, botão, fio…) e a COLUNA
    // (célula de estrutura, o único contêiner legítimo). Foi o drop dentro
    // do esqueleto que pôs um parágrafo dentro do bloco do fio no e-mail
    // real da Black — com o cerco abaixo, esse aninhamento é impossível.
    const ehTabelaBloco = (c: Component): boolean => {
      if ((c.get("tagName") || "").toLowerCase() !== "table") return false;
      if ((c.getClasses?.() ?? []).includes("corpo-email")) return false;
      // sobe até o primeiro td/table relevante: bloco é a tabela cujo lar é
      // o miolo do cartão ou uma coluna
      let p = c.parent();
      while (p) {
        const tg = (p.get("tagName") || "").toLowerCase();
        if (tg === "td") {
          if ((p.getClasses?.() ?? []).includes("col-empilha")) return true;
          const tabelaDoTd = (() => {
            let x = p.parent();
            while (x && (x.get("tagName") || "").toLowerCase() !== "table") x = x.parent();
            return x;
          })();
          return !!tabelaDoTd && (tabelaDoTd.getClasses?.() ?? []).includes("corpo-email");
        }
        if (tg === "table") return false; // tabela dentro de tabela sem td no meio: interna
        p = p.parent();
      }
      return true; // tabela solta no topo (e-mail sem moldura): trata como bloco
    };

    const soPodeCairEmLarValido = (_src: unknown, destino?: Component) => {
      if (!destino) return false;
      const papel = String(destino.get?.("ress-papel") ?? "");
      return papel === "raiz" || papel === "coluna";
    };
    const aceitaSoBloco = (src?: Component) =>
      !!src && (src.get?.("tagName") || "").toLowerCase() === "table";

    const marcarPapeis = () => {
      editor.getWrapper()?.onAll?.((c: Component) => {
        const tg = (c.get("tagName") || "").toLowerCase();
        const classes = c.getClasses?.() ?? [];

        if (tg === "table" && classes.includes("corpo-email")) {
          c.set({ "ress-papel": "cartao", selectable: false, hoverable: false,
                  draggable: false, droppable: false, badgable: false }, { avoidStore: true } as never);
          return;
        }
        if (tg === "td" && classes.includes("col-empilha")) {
          c.set({ "ress-papel": "coluna", selectable: true, hoverable: true,
                  draggable: false, droppable: aceitaSoBloco as never }, { avoidStore: true } as never);
          return;
        }
        // pelo MODEL, nunca pelo DOM: no primeiro marcar, o iframe ainda não
        // renderizou e getEl() vem vazio — foi assim que todo td de bloco
        // escapou como "conteudo" clicável na primeira tentativa
        const filhosElemento = (x: Component) =>
          (x.components()?.models ?? []).filter((f) =>
            ((f as Component).get("tagName") || "") !== "");
        if (tg === "td") {
          const tabelaPai = (() => {
            let x = c.parent();
            while (x && (x.get("tagName") || "").toLowerCase() !== "table") x = x.parent();
            return x;
          })();
          const filhoTable = filhosElemento(c).some((f) =>
            ((f as Component).get("tagName") || "").toLowerCase() === "table");
          if (tabelaPai && (tabelaPai.getClasses?.() ?? []).includes("corpo-email") && filhoTable) {
            // o miolo do cartão: o chão onde os blocos se empilham
            c.set({ "ress-papel": "raiz", selectable: false, hoverable: false,
                    draggable: false, droppable: aceitaSoBloco as never, badgable: false },
              { avoidStore: true } as never);
            return;
          }
        }
        if (ehTabelaBloco(c)) {
          c.set({ "ress-papel": "bloco", selectable: true, hoverable: true,
                  draggable: soPodeCairEmLarValido as never, droppable: false,
                  removable: true, copyable: true }, { avoidStore: true } as never);
          return;
        }
        if (["tbody", "tr", "table"].includes(tg)) {
          c.set({ "ress-papel": "interno", selectable: false, hoverable: false,
                  draggable: false, droppable: false, badgable: false, copyable: false },
            { avoidStore: true } as never);
          return;
        }
        if (tg === "td") {
          if (filhosElemento(c).length > 0) {
            // td-esqueleto de um bloco: inerte — o clique atravessa e cai no bloco
            c.set({ "ress-papel": "interno", selectable: false, hoverable: false,
                    draggable: false, droppable: false, badgable: false, copyable: false },
              { avoidStore: true } as never);
          } else {
            // td com texto direto ("Escreva aqui" de coluna, passos, menu):
            // continua editável por dois cliques
            c.set({ "ress-papel": "conteudo", draggable: false, droppable: false },
              { avoidStore: true } as never);
          }
          return;
        }
        // conteúdo (p, h1-h3, a, img, div): editável, mas não sai do bloco
        if (["p", "h1", "h2", "h3", "a", "img", "div", "span"].includes(tg)) {
          c.set({ draggable: false, droppable: false }, { avoidStore: true } as never);
        }
      });
    };

    nivelarRecuos();                        // nivela e-mails já desenhados
    varrerFantasmas();
    marcarPapeis();
    limparRef.current = () => { nivelarRecuos(); varrerFantasmas(); };
    let nivelaAgendada: number | undefined; // e tudo que entrar daqui em diante
    editor.on("component:add", () => {
      window.clearTimeout(nivelaAgendada);
      nivelaAgendada = window.setTimeout(() => { nivelarRecuos(); marcarPapeis(); }, 60);
    });
    // ---- seleção esperta -------------------------------------------------
    // O GrapesJS entrega no primeiro clique o contêiner (célula, linha,
    // "Folha"), e quem clicou num botão via o painel dizer "Folha" — foi a
    // reclamação de 30/08 ("impossível construir um e-mail"). Guardamos o
    // alvo REAL do clique dentro da folha e, se a seleção veio num ancestral
    // dele, descemos para a peça útil (link, botão ou imagem).
    let alvoClique: HTMLElement | null = null;
    const guardarAlvo = (e: Event) => { alvoClique = e.target as HTMLElement; };
    const acharPorEl = (raiz: Component, el: HTMLElement): Component | null => {
      if (raiz.getEl?.() === el) return raiz;
      for (const filho of raiz.components()?.models ?? []) {
        const achou = acharPorEl(filho as Component, el);
        if (achou) return achou;
      }
      return null;
    };
    let reselecionando = false;
    editor.on("component:selected", (c: Component) => {
      if (!reselecionando && alvoClique) {
        const util = alvoClique.closest("a, img") as HTMLElement | null;
        const el = c.getEl?.();
        if (util && el && el !== util && el.contains(util)) {
          const compUtil = acharPorEl(c, util);
          if (compUtil) {
            reselecionando = true;
            editor.select(compUtil);
            reselecionando = false;
            return; // o select acima já disparou este evento com a peça certa
          }
        }
      }
      setSel(c);
    });
    editor.on("component:deselected", () => setSel(null));
    editor.on("component:remove", (c: Component) => setSel((s) => (s === c ? null : s)));
    editor.on("canvas:frame:load", () => {
      editor.Canvas.getDocument()?.addEventListener("mousedown", guardarAlvo, true);
    });
    editor.Canvas.getDocument()?.addEventListener("mousedown", guardarAlvo, true);

    editorRef.current = editor;
    // diagnóstico em produção: a instância fica visível para inspeção manual
    (window as unknown as Record<string, unknown>).__ressEditor = editor;
    return () => { editor.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escolhendo, estilos, modulos]);

  function trocarDispositivo(d: "Desktop" | "Mobile") {
    setDispositivo(d);
    editorRef.current?.setDevice(d);
  }

  async function copiarTag(tag: string) {
    try {
      await navigator.clipboard.writeText(tag);
      setCopiado(tag);
      setTimeout(() => setCopiado(""), 1600);
    } catch {
      // clipboard bloqueado (acontece): a pessoa copia à mão
      await avisar({ titulo: "Não consegui copiar sozinho",
        corpo: <>Selecione e copie daqui: <code>{tag}</code></> });
    }
  }

  // ---- guardar o bloco selecionado para reusar em outros e-mails ----
  async function salvarModulo() {
    const editor = editorRef.current;
    const sel = editor?.getSelected();
    if (!sel) {
      await avisar({ titulo: "Selecione antes o bloco que você quer guardar",
        corpo: "Clique na parte do e-mail (um botão, uma assinatura, uma seção) e depois em Guardar bloco." });
      return;
    }
    const nome = (await pedirTexto({
      titulo: "Nome do bloco guardado",
      corpo: "Ele aparece na lista “Meus blocos guardados” de todos os e-mails.",
      placeholder: "ex.: Assinatura com foto", confirmarTexto: "Guardar",
    }))?.trim();
    if (!nome) return;
    setOcupado("Guardando…");
    const htmlSel = sel.toHTML();
    const { data, error } = await supabase.from("email_modulos")
      .insert({ nome, html: htmlSel }).select("modulo_id,nome,html").single();
    setOcupado("");
    if (error) {
      await avisar({ titulo: "Não foi possível guardar o bloco",
        corpo: <>Tente de novo em instantes. Detalhe técnico: <small>{error.message}</small></> });
      return;
    }
    // A lista nova remonta o editor — e remontar da prop `design` jogaria
    // fora TUDO que foi feito desde a abertura (aconteceu: meia hora de
    // montagem sumia ao clicar em "guardar"). O estado vivo do canvas é
    // capturado aqui e a remontagem parte dele.
    if (editor) retomarDesign.current = editor.getProjectData();
    setModulos((m) => [...m, data].sort((a, b) => a.nome.localeCompare(b.nome)));
  }

  function salvar() {
    const editor = editorRef.current;
    if (!editor) return;
    limparRef.current();   // recuos nivelados e blocos vazios varridos
    let htmlFinal = "";
    try {
      // devolve o HTML com o CSS embutido em cada tag — a única forma que
      // Gmail e Outlook respeitam de verdade
      htmlFinal = editor.runCommand("gjs-get-inlined-html");
    } catch { /* preset ausente */ }
    if (!htmlFinal) {
      htmlFinal = `<!doctype html><html><head><meta charset="utf-8"><style>${editor.getCss()}</style></head><body>${editor.getHtml()}</body></html>`;
    }

    // A tabela central de 600px precisa da classe responsiva para encolher
    // no celular — e-mails desenhados antes da correção ganham a classe aqui
    htmlFinal = htmlFinal.replace(/<table\b[^>]*width="600"[^>]*>/g, (tag) => {
      if (tag.includes("corpo-email")) return tag;
      if (/class="/.test(tag)) return tag.replace('class="', 'class="corpo-email ');
      return tag.replace("<table", '<table class="corpo-email"');
    });

    // Media query não pode ser embutida em atributo style — ela precisa
    // viver num <style>. Se o e-mail usa colunas ou a tabela central e ainda
    // não tem a regra (o embutidor de CSS às vezes descarta o <style>), ela
    // entra aqui. Sem isso, 4 colunas no celular viram 4 tiras de 90px e a
    // tabela de 600px estoura a tela do celular.
    if ((htmlFinal.includes("col-empilha") || htmlFinal.includes("corpo-email")) &&
        !htmlFinal.includes("@media only screen and (max-width:480px)")) {
      htmlFinal = htmlFinal.includes("</head>")
        ? htmlFinal.replace("</head>", `${RESPONSIVO}</head>`)
        : RESPONSIVO + htmlFinal;
    }

    onSalvar(htmlFinal, editor.getProjectData());
  }

  const btn = (ativo: boolean) => ({
    padding: "6px 13px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${ativo ? "#82308f" : "#e5dcea"}`,
    background: ativo ? "#82308f" : "#fff",
    color: ativo ? "#fff" : "#4a4152",
    fontSize: "calc(12.5px * var(--escala-texto))",
  });

  if (escolhendo) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--fundo)", overflow: "auto" }}>
        <Dialogos />
        <div style={{ maxWidth: 940, margin: "0 auto", padding: "40px 20px" }}>
          <h1 style={{ marginBottom: 4 }}>Por onde começar?</h1>
          <div className="sub" style={{ marginBottom: 24 }}>
            Todos já vêm prontos para celular e para o Outlook. Você muda tudo depois.
          </div>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
            {MODELOS.map((m) => (
              <div key={m.nome} className="caixa" style={{ cursor: "pointer", margin: 0 }}
                onClick={() => { inicial.current = m.html; setEscolhendo(false); }}>
                <iframe title={m.nome} srcDoc={m.html} sandbox=""
                  style={{
                    width: "100%", height: 190, border: "1px solid var(--borda)",
                    borderRadius: 8, pointerEvents: "none", background: "#fff",
                  }} />
                <b style={{ display: "block", marginTop: 10 }}>
                  {m.nome}
                  {m.selo && (
                    <span style={{
                      marginLeft: 8, fontSize: 11, fontWeight: 700, letterSpacing: .4,
                      textTransform: "uppercase", color: "#fff", background: "#82308f",
                      borderRadius: 999, padding: "2px 8px", verticalAlign: "middle",
                    }}>{m.selo}</span>
                  )}
                </b>
                <div style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))", lineHeight: 1.5 }}>
                  {m.descricao}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24 }}>
            <button onClick={onFechar}>Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  const tituloLateral = {
    margin: 0, padding: "14px 14px 8px",
    fontSize: 11.5, fontWeight: 700 as const, letterSpacing: .8,
    textTransform: "uppercase" as const, color: "#6d6478",
  };

  // ================= inspetor: o selecionado, em linguagem humana ==========
  // A regra de ouro veio de uma reclamação real ("é impossível colocar um
  // link num botão"): cada tipo de peça mostra SÓ os campos que fazem
  // sentido para ela, com nome de gente. O painel técnico continua embaixo,
  // recolhido, para quem quiser o ajuste fino.

  const mexer = (fn: () => void) => { fn(); setVersaoSel((v) => v + 1); };

  const tag = (c: Component | null) => (c?.get("tagName") || "").toLowerCase();
  const estiloDe = (c: Component) => (c.getStyle() ?? {}) as Record<string, string>;

  // botão = <a> de bloco; link comum = <a> no meio do texto
  const ehBotao = (c: Component | null) =>
    !!c && tag(c) === "a" && /inline-block|block/.test(String(estiloDe(c).display || ""));
  const ehLink = (c: Component | null) => !!c && tag(c) === "a" && !ehBotao(c);
  const ehImagem = (c: Component | null) => !!c && (tag(c) === "img" || c.get("type") === "image");
  const ehContador = (c: Component | null) =>
    ehImagem(c) && String(c?.getAttributes().src || "").includes("/contador");

  const textoDo = (c: Component) => {
    try { return (c.getEl()?.innerText ?? "").trim(); } catch { return ""; }
  };

  function trocarImagem(c: Component) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = async () => {
      const arq = input.files?.[0];
      if (!arq) return;
      setOcupado("Enviando imagem…");
      const nome = `${Date.now()}-${arq.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      const { error } = await supabase.storage.from("imagens").upload(nome, arq, {
        contentType: arq.type, upsert: false,
      });
      setOcupado("");
      if (error) { avisar({ titulo: "Não foi possível enviar a imagem", corpo: error.message }); return; }
      const { data } = supabase.storage.from("imagens").getPublicUrl(nome);
      mexer(() => c.addAttributes({ src: data.publicUrl }));
    };
    input.click();
  }

  const CoresBotao = ["#82308f", "#1f1a2e", "#0e8a4c", "#b45309", "#d63031", "#004cff"];

  const L = ({ children }: { children: React.ReactNode }) => (
    <label style={{ display: "block", margin: "10px 0 4px", fontSize: 12, color: "#55495e" }}>{children}</label>
  );
  const campo = {
    width: "100%", boxSizing: "border-box" as const, padding: "8px 10px", borderRadius: 8,
    border: "1px solid #e5dcea", background: "#fff", color: "#2a2233", fontSize: 13,
  };
  const botaoAcao = {
    padding: "7px 12px", borderRadius: 8, border: "1px solid #e5dcea", background: "#fff",
    color: "#4a4152", fontSize: 12.5, cursor: "pointer",
  };

  function Inspetor() {
    if (!sel) {
      return (
        <div style={{ padding: "4px 4px 0", fontSize: 12.5, lineHeight: 1.55, color: "#6d6478" }}>
          <b style={{ color: "#4a4152" }}>Nada selecionado.</b><br />
          Clique numa parte do e-mail para ajustá-la aqui — botão, imagem, texto…<br /><br />
          Para <b>trocar um texto</b>, dê dois cliques direto nele.
        </div>
      );
    }

    const attrs = sel.getAttributes();
    const comuns = (
      <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
        <button style={botaoAcao} title="Cria uma cópia logo abaixo"
          onClick={() => mexer(() => {
            const p = sel.parent();
            if (p) p.components().add(sel.clone(), { at: sel.index() + 1 });
          })}>⧉ Duplicar</button>
        <button style={{ ...botaoAcao, color: "#d63031" }} title="Remove esta peça do e-mail"
          onClick={async () => {
            if (await confirmar({
              titulo: "Excluir esta peça do e-mail?",
              corpo: "Dá para desfazer com o ↩ da barra de cima.",
              confirmarTexto: "Excluir", perigo: true,
            })) mexer(() => sel.remove());
          }}>
          🗑 Excluir</button>
      </div>
    );

    // ---------- botão ----------
    if (ehBotao(sel)) {
      const pai = sel.parent();
      return (
        <div key={sel.cid + versaoSel}>
          <b style={{ fontSize: 13 }}>🔘 Botão</b>
          <L>Texto do botão</L>
          <input style={campo} defaultValue={textoDo(sel)}
            onBlur={(e) => { const v = e.target.value.trim(); if (v) mexer(() => sel.components(v)); }} />
          <L>Link — para onde o clique leva</L>
          <input style={campo} defaultValue={attrs.href || ""} placeholder="https://…"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && !/^https:\/\//.test(v)) {
                avisar({ titulo: "O link precisa começar com https://",
                  corpo: "Sem isso o clique não sai do e-mail. Confira o endereço e tente de novo." });
                return;
              }
              mexer(() => sel.addAttributes({ href: v }));
            }} />
          <L>Cor do botão</L>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {CoresBotao.map((c) => (
              <button key={c} title={c}
                onClick={() => mexer(() => {
                  sel.addStyle({ "background-color": c });
                  if (pai && tag(pai) === "td") { pai.addAttributes({ bgcolor: c }); pai.addStyle({ "background-color": c }); }
                })}
                style={{
                  width: 24, height: 24, borderRadius: "50%", cursor: "pointer",
                  background: c, border: "2px solid #fff", boxShadow: "0 0 0 1px #e5dcea",
                }} />
            ))}
            <label title="Qualquer cor" style={{
              width: 24, height: 24, borderRadius: "50%", cursor: "pointer", overflow: "hidden",
              background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
              border: "2px solid #fff", boxShadow: "0 0 0 1px #e5dcea",
            }}>
              <input type="color" style={{ opacity: 0, width: "100%", height: "100%" }}
                onChange={(e) => mexer(() => {
                  const c = e.target.value;
                  sel.addStyle({ "background-color": c });
                  if (pai && tag(pai) === "td") { pai.addAttributes({ bgcolor: c }); pai.addStyle({ "background-color": c }); }
                })} />
            </label>
          </div>
          {comuns}
        </div>
      );
    }

    // ---------- link no meio do texto ----------
    if (ehLink(sel)) {
      return (
        <div key={sel.cid + versaoSel}>
          <b style={{ fontSize: 13 }}>🔗 Link</b>
          <L>Endereço</L>
          <input style={campo} defaultValue={attrs.href || ""} placeholder="https://…"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && !/^https:\/\//.test(v)) {
                avisar({ titulo: "O link precisa começar com https://",
                  corpo: "Sem isso o clique não sai do e-mail. Confira o endereço e tente de novo." });
                return;
              }
              mexer(() => sel.addAttributes({ href: v }));
            }} />
          {comuns}
        </div>
      );
    }

    // ---------- contador regressivo ----------
    if (ehContador(sel)) {
      const src = String(attrs.src || "");
      const ate = decodeURIComponent((src.match(/[?&]ate=([^&]+)/)?.[1] ?? "")).slice(0, 16);
      return (
        <div key={sel.cid + versaoSel}>
          <b style={{ fontSize: 13 }}>⏳ Contador regressivo</b>
          <L>Conta até</L>
          <input style={campo} type="datetime-local" defaultValue={ate}
            onBlur={(e) => {
              if (!e.target.value) return;
              const novo = src.replace(/([?&]ate=)[^&]+/, `$1${encodeURIComponent(e.target.value + ":00-03:00")}`);
              mexer(() => sel.addAttributes({ src: novo }));
            }} />
          <div style={{ fontSize: 11.5, color: "#6d6478", marginTop: 6 }}>
            Horário de Brasília. O contador é uma imagem que se atualiza a cada abertura.
          </div>
          {comuns}
        </div>
      );
    }

    // ---------- imagem ----------
    if (ehImagem(sel)) {
      const pai = sel.parent();
      const paiLink = pai && tag(pai) === "a" ? pai : null;
      return (
        <div key={sel.cid + versaoSel}>
          <b style={{ fontSize: 13 }}>🖼 Imagem</b>
          <div style={{ marginTop: 10 }}>
            <button style={{ ...botaoAcao, background: "#82308f", color: "#fff", border: "none" }}
              onClick={() => trocarImagem(sel)}>⬆ Trocar imagem…</button>
          </div>
          <L>Largura no e-mail</L>
          <select style={campo} defaultValue={String(estiloDe(sel).width || "100%")}
            onChange={(e) => mexer(() => sel.addStyle({ width: e.target.value, height: "auto" }))}>
            <option value="100%">Inteira</option>
            <option value="75%">3/4</option>
            <option value="50%">Metade</option>
            <option value="33%">1/3</option>
          </select>
          {paiLink && (
            <>
              <L>Link ao clicar na imagem</L>
              <input style={campo} defaultValue={paiLink.getAttributes().href || ""} placeholder="https://…"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && !/^https:\/\//.test(v)) {
                avisar({ titulo: "O link precisa começar com https://",
                  corpo: "Sem isso o clique não sai do e-mail. Confira o endereço e tente de novo." });
                return;
              }
                  mexer(() => paiLink.addAttributes({ href: v }));
                }} />
            </>
          )}
          {comuns}
        </div>
      );
    }

    // peças de dentro — atalhos usados pela célula e pelo painel genérico
    const internas: { rotulo: string; c: Component }[] = [];
    const coletar = (c: Component) => {
      if (internas.length >= 8) return;
      if (ehBotao(c)) internas.push({ rotulo: `🔘 Botão “${textoDo(c).slice(0, 22) || "sem texto"}”`, c });
      else if (ehContador(c)) internas.push({ rotulo: "⏳ Contador regressivo", c });
      else if (ehImagem(c)) internas.push({ rotulo: "🖼 Imagem", c });
      else if (ehLink(c)) internas.push({ rotulo: `🔗 Link “${textoDo(c).slice(0, 22)}”`, c });
      else c.components()?.models?.forEach((f) => coletar(f as Component));
    };
    sel.components()?.models?.forEach((f) => coletar(f as Component));
    const Atalhos = () => internas.length === 0 ? null : (
      <>
        <L>Dentro desta parte:</L>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {internas.map(({ rotulo, c }, i) => (
            <button key={i} style={{ ...botaoAcao, textAlign: "left" }}
              title="Clique para editar esta peça"
              onClick={() => editorRef.current?.select(c)}>
              {rotulo}
            </button>
          ))}
        </div>
      </>
    );

    const dentroDeHtmlLivre = (c: Component | null): boolean => {
      let x: Component | null = c;
      for (let i = 0; x && i < 5; i++) {
        if (String(x.getAttributes()["data-ress-html"] || "") === "1") return true;
        x = x.parent() ?? null;
      }
      return false;
    };

    // ---------- coluna (a única estrutura viva; "célula" morreu) ----------
    // Com os papéis marcados, o esqueleto interno não recebe mais clique:
    // um td só chega aqui se for COLUNA de estrutura (col-empilha) ou um
    // canto de texto editável — e o painel fala a língua da pessoa.
    if (tag(sel) === "td" && !dentroDeHtmlLivre(sel)) {
      const el = sel.getEl?.();
      const ehColuna = (sel.getClasses?.() ?? []).includes("col-empilha");
      const vazia = !!el && (el.innerText ?? "").trim() === "" && !el.querySelector("img,a,table");
      const lateralAtual = parseInt(String(estiloDe(sel)["padding-left"] ?? "").replace("px", ""), 10);
      const respiro = (px: number) => mexer(() => sel.addStyle({
        "padding-left": `${px}px`, "padding-right": `${px}px`,
      }));
      return (
        <div key={sel.cid + versaoSel}>
          <b style={{ fontSize: 13 }}>{ehColuna ? "▥ Coluna" : "✍ Canto de texto"}</b>
          {vazia ? (
            <>
              <div style={{ fontSize: 12.5, color: "#6d6478", marginTop: 8, lineHeight: 1.55 }}>
                {"Está "}<b>vazia</b> — solte um bloco aqui dentro, escreva com dois
                cliques, ou remova se sobrou sem querer.
              </div>
              <button style={{ ...botaoAcao, marginTop: 10, color: "#d63031" }}
                onClick={() => mexer(() => {
                  // remove a moldura inteira do bloco vazio, não só o miolo
                  let alvo: Component = sel;
                  for (let i = 0; i < 3; i++) {
                    const pai = alvo.parent();
                    if (!pai) break;
                    if ((pai.get("tagName") || "").toLowerCase() === "table") { alvo = pai; break; }
                    alvo = pai;
                  }
                  alvo.remove();
                })}>
                🗑 Remover a caixa vazia
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: "#6d6478", marginTop: 8, lineHeight: 1.55 }}>
                {ehColuna
                  ? "Uma coluna da estrutura: os blocos soltos aqui se empilham dentro dela."
                  : "Para trocar o texto, dê dois cliques direto nele."} Aqui você acerta o
                respiro das laterais.
              </div>
              <L>Respiro das laterais</L>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={{ ...botaoAcao, ...(lateralAtual === 24 ? { borderColor: "#82308f", color: "#82308f" } : {}) }}
                  title="24px — o mesmo recuo dos blocos: tudo alinhado"
                  onClick={() => respiro(24)}>Alinhado (padrão)</button>
                <button style={{ ...botaoAcao, ...(lateralAtual === 8 ? { borderColor: "#82308f", color: "#82308f" } : {}) }}
                  title="8px — quase na borda" onClick={() => respiro(8)}>Estreito</button>
                <button style={{ ...botaoAcao, ...(lateralAtual === 0 ? { borderColor: "#82308f", color: "#82308f" } : {}) }}
                  title="0 — colado na borda" onClick={() => respiro(0)}>Nenhum</button>
              </div>
              <Atalhos />
            </>
          )}
          {comuns}
        </div>
      );
    }

    // ---------- HTML livre: o código se edita aqui, no painel ----------
    const acharHtmlLivre = (c: Component | null): Component | null => {
      let x: Component | null = c;
      for (let i = 0; x && i < 5; i++) {
        if (String(x.getAttributes()["data-ress-html"] || "") === "1") return x;
        x = x.parent() ?? null;
      }
      return null;
    };
    const blocoHtml = acharHtmlLivre(sel);
    if (blocoHtml) {
      return (
        <div key={blocoHtml.cid + versaoSel}>
          <b style={{ fontSize: 13 }}>{"</>"} HTML livre</b>
          <L>Cole o seu código aqui</L>
          <textarea defaultValue={blocoHtml.toHTML()}
            style={{ ...campo, height: 180, fontFamily: "monospace", fontSize: 11.5, resize: "vertical" }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v) return;
              mexer(() => {
                const pai = blocoHtml.parent();
                const pos = blocoHtml.index();
                if (pai) {
                  pai.components().add(v, { at: pos });
                  blocoHtml.remove();
                }
              });
            }} />
          <div style={{ fontSize: 11.5, color: "#6d6478", marginTop: 6 }}>
            Aplicado ao clicar fora da caixa. Lembre: e-mail entende tabela e estilo
            na própria tag; flex e grid não funcionam no Outlook.
          </div>
          {comuns}
        </div>
      );
    }

    // ---------- qualquer outra peça ----------
    // caiu numa estrutura (célula, linha, folha): os atalhos "internas",
    // coletados lá em cima, apontam as peças de dentro

    // sem texto, sem imagem e sem link = um bloco invisível no e-mail — o
    // "fantasma" que sobra quando todo o texto de um bloco é apagado
    const elSel = sel.getEl?.();
    const fantasma = !!elSel &&
      !(elSel.textContent ?? "").replace(/ /g, " ").trim() &&
      !elSel.querySelector?.("img,a") &&
      !elSel.querySelector?.("[style*='background'],[bgcolor],[style*='border']");

    return (
      <div key={sel.cid + versaoSel}>
        <b style={{ fontSize: 13 }}>▦ {sel.getName?.() || "Peça do e-mail"}{fantasma ? " — vazia" : ""}</b>
        {fantasma ? (
          <div style={{
            fontSize: 12.5, marginTop: 8, lineHeight: 1.55, padding: "8px 10px",
            background: "#fdf3e7", border: "1px solid #f0d9b8", borderRadius: 8, color: "#7a5a2a",
          }}>
            Esta parte está <b>sem nada dentro</b> — no e-mail ela vira só um espaço
            em branco. Se ela não é de propósito, use <b>🗑 Excluir</b> aqui embaixo.
            (Ao salvar, partes vazias de texto também são removidas sozinhas.)
          </div>
        ) : (
        <div style={{ fontSize: 12.5, color: "#6d6478", marginTop: 8, lineHeight: 1.55 }}>
          Para trocar um texto, dê <b>dois cliques</b> nele, direto na folha.
        </div>
        )}
        {internas.length > 0 && (
          <>
            <L>Dentro desta parte:</L>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {internas.map(({ rotulo, c }, i) => (
                <button key={i} style={{ ...botaoAcao, textAlign: "left" }}
                  title="Clique para editar esta peça"
                  onClick={() => editorRef.current?.select(c)}>
                  {rotulo}
                </button>
              ))}
            </div>
          </>
        )}
        {comuns}
      </div>
    );
  }

  return (
    <div className="ress-editor"
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "#f6f2f8", display: "flex", flexDirection: "column" }}>
      <style>{TEMA_EDITOR}</style>
      <Dialogos />

      {/* ---- barra de cima: o essencial, em português ---- */}
      <div style={{
        display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
        padding: "10px 16px", borderBottom: "1px solid #e5dcea", background: "#fff",
      }}>
        <b style={{ fontSize: "calc(14px * var(--escala-texto))", color: "#2a2233" }}>Montar o e-mail</b>

        <div style={{ display: "flex", gap: 6 }}>
          <button style={btn(dispositivo === "Desktop")} onClick={() => trocarDispositivo("Desktop")}>
            🖥 Computador
          </button>
          <button style={btn(dispositivo === "Mobile")} onClick={() => trocarDispositivo("Mobile")}>
            📱 Celular
          </button>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button style={btn(false)} title="Desfazer a última mudança"
            onClick={() => editorRef.current?.runCommand("core:undo")}>↩ Desfazer</button>
          <button style={btn(false)} title="Refazer o que foi desfeito"
            onClick={() => editorRef.current?.runCommand("core:redo")}>↪ Refazer</button>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "#6d6478", fontSize: "calc(12px * var(--escala-texto))" }}>personalizar:</span>
          {TAGS.map((t) => (
            <button key={t.tag} style={btn(copiado === t.tag)} onClick={() => copiarTag(t.tag)}
              title={`${t.desc} — clique para copiar e cole no texto`}>
              {copiado === t.tag ? "copiado ✓" : t.tag}
            </button>
          ))}
        </div>

        <button style={btn(false)} onClick={salvarModulo}
          title="Guarda o bloco selecionado para reusar em qualquer e-mail">
          💾 Guardar bloco
        </button>

        {(enviandoImagem || ocupado) && (
          <span style={{ color: "#82308f", fontSize: "calc(12.5px * var(--escala-texto))" }}>
            {ocupado || "enviando imagem…"}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="primario" onClick={salvar}>Salvar e voltar</button>
          <button onClick={async () => {
            // sair sem salvar merece uma pergunta — está colado no botão de salvar
            if (await confirmar({
              titulo: "Sair sem salvar?",
              corpo: "O que você mexeu desde o último “Salvar e voltar” será descartado.",
              confirmarTexto: "Sair sem salvar", cancelarTexto: "Continuar editando", perigo: true,
            })) onFechar();
          }}>Cancelar</button>
        </div>
      </div>

      {/* ---- assunto e pré-cabeçalho, sem sair do editor ---- */}
      {aoMudarAssunto && (
        <div style={{
          display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
          padding: "8px 16px", borderBottom: "1px solid #e5dcea", background: "#fdfbfe",
        }}>
          <label style={{
            display: "flex", alignItems: "center", gap: 8, flex: "2 1 340px", margin: 0,
            fontSize: "calc(12.5px * var(--escala-texto))", fontWeight: 600, color: "#55495e",
          }}>
            Assunto
            <input value={assunto ?? ""} onChange={(e) => aoMudarAssunto(e.target.value)}
              placeholder="O que aparece na caixa de entrada"
              style={{
                flex: 1, height: 32, margin: 0, padding: "0 10px", borderRadius: 8,
                border: "1px solid #e5dcea", background: "#fff", color: "#2a2233",
                fontWeight: 400, fontSize: "calc(13px * var(--escala-texto))",
              }} />
          </label>
          {aoMudarPreheader && (
            <label style={{
              display: "flex", alignItems: "center", gap: 8, flex: "2 1 340px", margin: 0,
              fontSize: "calc(12.5px * var(--escala-texto))", fontWeight: 600, color: "#55495e",
            }}>
              Pré-cabeçalho
              <input value={preheader ?? ""} onChange={(e) => aoMudarPreheader(e.target.value)}
                placeholder="a linha cinza depois do assunto, na caixa de entrada"
                style={{
                  flex: 1, height: 32, margin: 0, padding: "0 10px", borderRadius: 8,
                  border: "1px solid #e5dcea", background: "#fff", color: "#2a2233",
                  fontWeight: 400, fontSize: "calc(13px * var(--escala-texto))",
                }} />
            </label>
          )}
        </div>
      )}

      {/* ---- três colunas: blocos | folha | aparência ---- */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{
          width: 236, minWidth: 236, overflow: "auto", background: "#faf7fb",
          borderRight: "1px solid #e5dcea", padding: "0 10px 20px",
        }}>
          <p style={tituloLateral}>Arraste para a folha</p>
          <div ref={refBlocos} />
        </div>

        <div ref={ref} style={{ flex: 1, minWidth: 0 }} />

        <div style={{
          width: 280, minWidth: 280, overflow: "auto", background: "#faf7fb",
          borderLeft: "1px solid #e5dcea", padding: "0 14px 20px",
        }}>
          <p style={{ ...tituloLateral, padding: "14px 0 10px" }}>Editar o selecionado</p>
          <div style={{
            background: "#fff", border: "1px solid #e5dcea", borderRadius: 12, padding: "12px 14px",
          }}>
            <Inspetor />
          </div>
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#6d6478" }}>
              Ajustes finos (avançado) — fonte, cores, espaços
            </summary>
            <div ref={refEstilos} />
          </details>
        </div>
      </div>
    </div>
  );
}
