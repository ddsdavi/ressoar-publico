import { useEffect, useState } from "react";

// Controles de aparência (tamanho do texto + tema) usados na topbar e no login.
// Cada um mostra só a opção em uso; ao clicar, abre as opções e recolhe na escolha.
export const NIVEIS_TEXTO: Record<number, [number, string]> = {
  1: [0.85, "Menor"], 2: [0.92, "Pequeno"], 3: [1, "Padrão"],
  4: [1.12, "Grande"], 5: [1.28, "Maior"],
};

const ICONES_TEMA: Record<string, [string, string]> = {
  claro: ["☀", "Tema claro"], escuro: ["🌙", "Tema escuro"], sistema: ["🖥", "Seguir o sistema"],
};

export function aplicarPreferencias() {
  const tema = localStorage.getItem("ressoar-tema") ?? "sistema";
  const escala = Number(localStorage.getItem("ressoar-escala") ?? 3);
  const escuro = tema === "escuro" ||
    (tema === "sistema" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("tema-escuro", escuro);
  document.documentElement.style.setProperty("--escala-texto", String(NIVEIS_TEXTO[escala]?.[0] ?? 1));
}

export default function ControlesAparencia() {
  const [tema, setTema] = useState<string>(() => localStorage.getItem("ressoar-tema") ?? "sistema");
  const [temaAberto, setTemaAberto] = useState(false);
  const [escala, setEscala] = useState<number>(() => Number(localStorage.getItem("ressoar-escala") ?? 3));
  const [escalaAberta, setEscalaAberta] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const aplicar = () => {
      const escuro = tema === "escuro" || (tema === "sistema" && mq.matches);
      document.documentElement.classList.toggle("tema-escuro", escuro);
    };
    aplicar();
    mq.addEventListener("change", aplicar);
    localStorage.setItem("ressoar-tema", tema);
    return () => mq.removeEventListener("change", aplicar);
  }, [tema]);

  useEffect(() => {
    document.documentElement.style.setProperty("--escala-texto", String(NIVEIS_TEXTO[escala]?.[0] ?? 1));
    localStorage.setItem("ressoar-escala", String(escala));
  }, [escala]);

  return (
    <>
      <div className="escala-grupo" title="Tamanho do texto">
        {!escalaAberta ? (
          <button className="ativo atual"
            title={`Texto ${NIVEIS_TEXTO[escala][1]} — nível ${escala} de 5. Clique para trocar.`}
            onClick={() => setEscalaAberta(true)}>
            <span className="letra">A</span><span className="nivel">{escala}</span>
          </button>
        ) : (
          [1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={escala === n ? "ativo" : ""}
              title={`Texto ${NIVEIS_TEXTO[n][1]} — nível ${n}`}
              onClick={() => { setEscala(n); setEscalaAberta(false); }}>{n}</button>
          ))
        )}
      </div>
      <div className="tema-grupo">
        {!temaAberto ? (
          <button className="ativo" title={`${ICONES_TEMA[tema][1]} — clique para trocar`}
            onClick={() => setTemaAberto(true)}>{ICONES_TEMA[tema][0]}</button>
        ) : (
          (["claro", "escuro", "sistema"] as const).map((t) => (
            <button key={t} className={tema === t ? "ativo" : ""} title={ICONES_TEMA[t][1]}
              onClick={() => { setTema(t); setTemaAberto(false); }}>{ICONES_TEMA[t][0]}</button>
          ))
        )}
      </div>
    </>
  );
}
