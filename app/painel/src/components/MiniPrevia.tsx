// Miniatura de prévia de e-mail: o e-mail tem 600px de largura e o espaço
// quase nunca tem — encolher para caber INTEIRO, sem barra de rolagem morta
// (pointer-events desligado para não navegar), e o clique amplia.
// Nasceu em Campanhas (mesa de 30/08) e virou peça compartilhada quando a
// página Mensagens foi flagrada com o defeito antigo.
import { useEffect, useRef, useState } from "react";

export default function MiniPrevia({ html, altura, aoAmpliar }: {
  html: string; altura: number; aoAmpliar: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [larg, setLarg] = useState(300);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLarg(el.clientWidth || 300));
    ro.observe(el);
    setLarg(el.clientWidth || 300);
    return () => ro.disconnect();
  }, []);
  const fator = Math.min(1, larg / 600) || 0.5;
  return (
    <div ref={caixa} onClick={aoAmpliar} role="button" title="Ver em tamanho real"
      style={{
        position: "relative", height: altura, overflow: "hidden", cursor: "zoom-in",
        border: "1px solid var(--borda)", borderRadius: 8, background: "#fff",
      }}>
      <iframe title="prévia" srcDoc={html} sandbox="" scrolling="no"
        style={{
          width: 600, height: altura / fator, border: 0, background: "#fff",
          transform: `scale(${fator})`, transformOrigin: "top left", pointerEvents: "none",
        }} />
      <span style={{
        position: "absolute", right: 8, bottom: 8, fontSize: 12, borderRadius: 999,
        background: "rgba(23,0,32,.78)", color: "#fff", padding: "4px 10px",
      }}>🔍 Ampliar</span>
    </div>
  );
}
