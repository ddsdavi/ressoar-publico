// Diálogos da casa — substituem alert/confirm/prompt do navegador no fluxo
// de e-mail. Motivos (mesa de avaliação, 30/08/2026): os nativos têm a cara
// do Chrome (não da marca), bloqueiam a aba, o navegador pode ofertar
// "impedir esta página de criar caixas de diálogo" (matando confirmações de
// disparo), e já congelaram a automação de testes.
//
// Uso: montar <Dialogos /> uma vez na página (o último montado atende — o
// editor de blocos em tela cheia monta o seu por cima) e chamar:
//   await confirmar({ titulo, corpo, confirmarTexto, perigo })  -> boolean
//   await avisar({ titulo, corpo })                             -> void
//   await pedirTexto({ titulo, corpo, placeholder, valor })     -> string|null
import { useEffect, useRef, useState } from "react";

type Pedido = {
  tipo: "confirmar" | "avisar" | "texto";
  titulo: string;
  corpo?: React.ReactNode;
  confirmarTexto?: string;
  cancelarTexto?: string;
  perigo?: boolean;
  placeholder?: string;
  valor?: string;
  resolver: (r: boolean | string | null) => void;
};

type Atendente = (p: Pedido) => void;
const pilha: Atendente[] = [];

function atender(p: Pedido) {
  const a = pilha[pilha.length - 1];
  if (a) { a(p); return; }
  // rede de segurança: sem <Dialogos/> montado, cai nos nativos
  if (p.tipo === "confirmar") p.resolver(window.confirm(p.titulo));
  else if (p.tipo === "texto") p.resolver(window.prompt(p.titulo, p.valor ?? ""));
  else { window.alert(p.titulo); p.resolver(undefined as never); }
}

export function confirmar(o: {
  titulo: string; corpo?: React.ReactNode; confirmarTexto?: string;
  cancelarTexto?: string; perigo?: boolean;
}): Promise<boolean> {
  return new Promise((res) => atender({ tipo: "confirmar", resolver: (r) => res(!!r), ...o }));
}

export function avisar(o: { titulo: string; corpo?: React.ReactNode }): Promise<void> {
  return new Promise((res) => atender({ tipo: "avisar", resolver: () => res(), ...o }));
}

export function pedirTexto(o: {
  titulo: string; corpo?: React.ReactNode; placeholder?: string; valor?: string;
  confirmarTexto?: string;
}): Promise<string | null> {
  return new Promise((res) =>
    atender({ tipo: "texto", resolver: (r) => res(r === false ? null : (r as string | null)), ...o }));
}

export default function Dialogos() {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [texto, setTexto] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fila = useRef<Pedido[]>([]);

  useEffect(() => {
    const eu: Atendente = (p) => {
      fila.current.push(p);
      setPedido((atual) => atual ?? fila.current.shift() ?? null);
    };
    pilha.push(eu);
    return () => { pilha.splice(pilha.indexOf(eu), 1); };
  }, []);

  useEffect(() => {
    if (pedido?.tipo === "texto") {
      setTexto(pedido.valor ?? "");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [pedido]);

  function fechar(resposta: boolean | string | null) {
    pedido?.resolver(resposta);
    setPedido(fila.current.shift() ?? null);
  }

  useEffect(() => {
    if (!pedido) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar(pedido.tipo === "texto" ? null : false);
      if (e.key === "Enter" && pedido.tipo !== "texto") {
        fechar(pedido.tipo === "confirmar" ? true : false);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);

  if (!pedido) return null;

  return (
    <div onClick={() => fechar(pedido.tipo === "texto" ? null : false)}
      style={{
        position: "fixed", inset: 0, background: "rgba(12,4,18,.55)", zIndex: 400,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
      }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--cartao, #fff)", borderRadius: 14, width: "min(460px, 94vw)",
          padding: "20px 22px 18px", boxShadow: "0 18px 60px rgba(0,0,0,.4)",
        }}>
        <b style={{ display: "block", fontSize: "calc(15.5px * var(--escala-texto))", marginBottom: 8 }}>
          {pedido.titulo}
        </b>
        {pedido.corpo && (
          <div className="sub" style={{ margin: "0 0 14px", lineHeight: 1.55 }}>{pedido.corpo}</div>
        )}
        {pedido.tipo === "texto" && (
          <input ref={inputRef} value={texto} placeholder={pedido.placeholder}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") fechar(texto.trim() || null); }}
            style={{ marginBottom: 14 }} />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {pedido.tipo !== "avisar" && (
            <button onClick={() => fechar(pedido.tipo === "texto" ? null : false)}>
              {pedido.cancelarTexto ?? "Voltar"}
            </button>
          )}
          <button className="primario"
            style={pedido.perigo ? { background: "var(--perigo)", borderColor: "var(--perigo)" } : undefined}
            onClick={() => fechar(
              pedido.tipo === "confirmar" ? true :
              pedido.tipo === "texto" ? (texto.trim() || null) : false)}>
            {pedido.confirmarTexto ?? (pedido.tipo === "avisar" ? "Entendi" : "Confirmar")}
          </button>
        </div>
      </div>
    </div>
  );
}
