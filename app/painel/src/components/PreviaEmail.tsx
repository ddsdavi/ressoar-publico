// Prévia de e-mail completa e autocontida: miniatura encolhida (sem barra de
// rolagem morta) + pop-up em tamanho real com rolagem de verdade + dados de
// amostra ("Maria") + rodapé legal simulado. É a experiência aprovada na
// página de Campanhas, empacotada para servir também à biblioteca de
// Mensagens — onde a prévia antiga cortava o e-mail e não rolava.
import { useEffect, useState } from "react";
import MiniPrevia from "./MiniPrevia";

export function comAmostra(h: string, endereco?: string) {
  if (!h) return h;
  const corpo = h
    .replace(/\{\{\s*nome\s*\}\}/g, "Maria")
    .replace(/\{\{\s*nome_completo\s*\}\}/g, "Maria Exemplo")
    .replace(/\{\{\s*email\s*\}\}/g, "maria@exemplo.com")
    .replace(/%FIRSTNAME%/g, "Maria")
    .replace(/%FULLNAME%/g, "Maria Exemplo");
  const rodape = `<div style="text-align:center;font-size:12px;color:#9a93a5;padding:22px 12px 8px;font-family:sans-serif">${
    endereco ? endereco + " · " : ""}<span style="text-decoration:underline">Não quero mais receber estes e-mails</span></div>` +
    `<div style="text-align:center;font-size:10.5px;color:#b3adbd;font-family:sans-serif;padding-bottom:16px">↑ rodapé posto automaticamente em todo envio</div>`;
  return corpo + rodape;
}

export default function PreviaEmail({ html, altura = 420, endereco, titulo = "Como vai chegar" }: {
  html: string; altura?: number; endereco?: string; titulo?: string;
}) {
  const [ampla, setAmpla] = useState(false);
  const [alturaAmpla, setAlturaAmpla] = useState(1200);

  useEffect(() => {
    if (!ampla) return;
    const fechar = (e: KeyboardEvent) => { if (e.key === "Escape") setAmpla(false); };
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [ampla]);

  const pronto = comAmostra(html, endereco);
  if (!html) return null;

  return (
    <>
      <MiniPrevia html={pronto} altura={altura} aoAmpliar={() => setAmpla(true)} />
      {ampla && (
        <div onClick={() => setAmpla(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(12,4,18,.62)", zIndex: 320,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--cartao, #fff)", borderRadius: 14, width: "min(680px, 96vw)",
              maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 18px 60px rgba(0,0,0,.45)",
            }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--borda)",
            }}>
              <b>{titulo}</b>
              <button onClick={() => setAmpla(false)} title="Fechar (Esc)">✕ Fechar</button>
            </div>
            <div style={{ overflow: "auto", background: "#eceaf1" }}>
              <iframe title="prévia em tamanho real" scrolling="no" sandbox="allow-same-origin"
                srcDoc={pronto}
                onLoad={(e) => {
                  try {
                    const d = e.currentTarget.contentDocument;
                    if (d) setAlturaAmpla(Math.max(400, d.documentElement.scrollHeight + 20));
                  } catch { /* sem medida, fica a reserva */ }
                }}
                style={{
                  display: "block", width: 600, maxWidth: "100%", margin: "0 auto",
                  height: alturaAmpla, border: 0, pointerEvents: "none", background: "#fff",
                }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
