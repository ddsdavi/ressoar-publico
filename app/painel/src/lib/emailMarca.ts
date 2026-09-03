// Monta o e-mail final no modelo oficial da marca a partir do que a pessoa
// ESCREVEU — ela cuida do texto, o modelo cuida do resto (faixa, título em
// serifa, botão, fio e assinatura).
//
// É o mesmo desenho de app/modelos/email-base.html. Vive aqui, e não no
// editor, porque duas telas precisam dele: a prévia ao vivo enquanto se
// escreve e a gravação da mensagem na hora de salvar.
//
// Tudo em <table> + estilo inline: o Outlook renderiza e-mail com o motor do
// Word e ignora flexbox/grid; o Gmail descarta <style> em vários casos.

const LARGURA = 600;
const FONTE = "Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

export type CoresEmail = {
  destaque: string;   // botão, faixa, detalhes
  titulo: string;
  texto: string;
  fundo: string;      // moldura atrás do cartão
};

export const CORES_PADRAO: CoresEmail = {
  destaque: "#82308f",
  titulo: "#1f1a2e",
  texto: "#3c3646",
  fundo: "#f6f4f8",
};

export type PecasEmail = {
  nomeMarca: string;      // assinatura ("Um abraço, …")
  faixa?: string;         // texto da faixa do topo; ausente = nomeMarca; "" = sem faixa
  saudacao: boolean;      // abre com "Olá, {{nome}}!"
  titulo: string;         // título grande dentro do e-mail ("" = sem)
  corpoHtml: string;      // o que a pessoa escreveu no editor
  botaoTexto: string;     // "" = sem botão
  botaoLink: string;
  cores?: Partial<CoresEmail>;
};

const RESPONSIVO = `<style>
  @media only screen and (max-width:480px) {
    .col-empilha { display:block !important; width:100% !important; }
    .corpo-email { width:100% !important; }
  }
</style>`;

// os campos digitados entram em HTML — "Black & Friday <3" não pode virar
// tag quebrada, nem aspas no link estourar o href
const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function montarEmailMarca(p: PecasEmail): string {
  const c = { ...CORES_PADRAO, ...(p.cores ?? {}) };
  const temBotao = p.botaoTexto.trim() && /^https:\/\//.test(p.botaoLink.trim());
  // a faixa repete o nome da marca por padrão, mas o topo é editável — e
  // apagar o texto tira a faixa inteira (a assinatura continua cuidando do nome)
  const textoFaixa = (p.faixa ?? p.nomeMarca).trim();
  const faixa = textoFaixa
    ? `<tr><td bgcolor="${c.destaque}" style="padding:18px 28px">
        <p style="margin:0;font-family:${SERIF};font-size:18px;line-height:1.4;color:#ffffff;
                  letter-spacing:.3px">${escapar(textoFaixa)}</p>
      </td></tr>`
    : "";

  const saudacao = p.saudacao
    ? `<p style="margin:0 0 14px 0;font-family:${FONTE};font-size:16px;line-height:1.65;color:${c.texto}">
         Olá, {{nome}}!</p>`
    : "";

  const titulo = p.titulo.trim()
    ? `<h1 style="margin:0 0 16px 0;font-family:${SERIF};font-size:26px;line-height:1.35;
         color:${c.titulo};font-weight:normal">${escapar(p.titulo.trim())}</h1>`
    : "";

  const botao = temBotao
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
         <td align="center" style="padding:22px 0 6px 0">
           <table cellpadding="0" cellspacing="0" border="0"><tr>
             <td align="center" bgcolor="${c.destaque}" style="border-radius:8px">
               <a href="${escapar(p.botaoLink.trim())}" style="display:inline-block;padding:14px 32px;
                  font-family:${FONTE};font-size:16px;font-weight:700;color:#ffffff;
                  text-decoration:none;border-radius:8px">${escapar(p.botaoTexto.trim())}</a>
             </td></tr></table>
         </td></tr></table>`
    : "";

  // o corpo escrito ganha a tipografia do e-mail sem exigir nada de quem escreveu
  const corpo = `<div style="font-family:${FONTE};font-size:16px;line-height:1.65;color:${c.texto}">
    ${p.corpoHtml}</div>`;

  return `${RESPONSIVO}
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.fundo}"><tr>
  <td align="center" style="padding:28px 12px">
    <table width="${LARGURA}" class="corpo-email" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"
           style="max-width:${LARGURA}px;border-radius:12px;overflow:hidden">
      ${faixa}
      <tr><td style="padding:30px 28px 8px 28px">
        ${saudacao}${titulo}${corpo}${botao}
      </td></tr>
      <tr><td style="padding:14px 28px 0 28px">
        <div style="height:3px;background:#f7b500;border-radius:2px;font-size:0;line-height:0">&nbsp;</div>
      </td></tr>
      <tr><td style="padding:16px 28px 30px 28px">
        <p style="margin:0;font-family:${FONTE};font-size:15px;line-height:1.7;color:#6b6275">
          Um abraço,<br /><b style="color:${c.titulo}">${escapar(p.nomeMarca)}</b></p>
      </td></tr>
    </table>
  </td></tr></table>`;
}
