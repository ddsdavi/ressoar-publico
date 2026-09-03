import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Caixa de escolha com busca — a mesma pele do <select> do painel, mas dá
// para digitar e ir filtrando.
//
// Escolher uma lista entre trinta, ou uma tag entre duzentas, rolando uma
// lista fechada é trabalho braçal: quem sabe o nome quer digitar o nome. E
// no celular a lista nativa vira um rolo de tela inteira sem busca nenhuma.
//
// O que ela faz e o <select> não fazia:
//  · acha sem acento e sem caixa — "sao" acha "São Paulo";
//  · acha por pedaço do meio — "desafio" acha "CASA_H_DESAFIO_2026";
//  · acha por várias palavras soltas — "casa 2026" acha "CASA_H_2026_03";
//  · abre para cima quando não há espaço embaixo (a gaveta é alta);
//  · escapa do recorte da gaveta — a lista sai num portal, presa na tela.
//
// Continua se comportando como o <select>: `valor` entra e `aoMudar` devolve
// texto, igualzinho ao `e.target.value` de antes. Foi de propósito — assim a
// troca em cada tela foi linha por linha, sem mexer no que já funcionava.

export type Opcao = {
  valor: string | number;
  rotulo: string;
  detalhe?: string;    // texto de apoio à direita; também entra na busca
  grupo?: string;      // cabeçalho, como era o <optgroup>
  desabilitado?: boolean;
};

// tira acento e caixa: quem digita com pressa não põe acento
const crua = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function Escolher({
  valor, aoMudar, opcoes, vazio, placeholder, desabilitado, titulo, className, style,
}: {
  valor: string | number | null | undefined;
  aoMudar: (valor: string) => void;
  opcoes: Opcao[];
  /** entrada de "— escolher —" / "nenhuma" / "todas", sempre no topo da lista */
  vazio?: string;
  /** o que aparece apagado quando nada está escolhido */
  placeholder?: string;
  desabilitado?: boolean;
  titulo?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [aberto, setAberto] = useState(false);
  // null = fechado, e o campo mostra o nome do que está escolhido. Aberto, é
  // sempre texto (começa em "") — o campo passa a ser a caixa de busca.
  const [busca, setBusca] = useState<string | null>(null);
  const [destaque, setDestaque] = useState(0);
  const [pos, setPos] = useState<{
    esquerda: number; largura: number; larguraMax: number;
    topo?: number; base?: number; altura: number;
  } | null>(null);

  const caixaRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const idLista = useId();

  const todas: Opcao[] = vazio === undefined
    ? opcoes
    : [{ valor: "", rotulo: vazio }, ...opcoes];

  const atual = String(valor ?? "");
  const escolhida = todas.find((o) => String(o.valor) === atual);
  const dica = placeholder ?? "— escolher —";

  const termo = busca === null ? "" : crua(busca).trim();
  const palavras = termo ? termo.split(/\s+/) : [];
  const visiveis = palavras.length === 0 ? todas : todas.filter((o) => {
    const alvo = crua(`${o.rotulo} ${o.detalhe ?? ""} ${o.grupo ?? ""}`);
    return palavras.every((p) => alvo.includes(p));
  });

  // Abrir limpa o campo: ele vira a caixa de busca, vazia, esperando o que
  // você vai digitar. O nome antigo continuar ali era estranho — parecia que
  // o campo já tinha texto a apagar, e digitar em cima dele colava as duas
  // coisas ("16LC_SET25black"). Quem estava escolhido segue marcado com ✓ na
  // lista, e volta sozinho ao campo se você fechar sem escolher outro.
  function abrir() {
    if (desabilitado || aberto) return;
    setBusca("");
    const i = todas.findIndex((o) => String(o.valor) === atual);
    setDestaque(i < 0 ? 0 : i);
    setAberto(true);
  }
  function digitou(texto: string) {
    setBusca(texto);
    setDestaque(0);
    if (!aberto) setAberto(true);
  }
  function fechar() {
    setAberto(false);
    setBusca(null);
  }
  function escolher(o: Opcao) {
    if (o.desabilitado) return;
    aoMudar(String(o.valor));
    fechar();
    campoRef.current?.focus();
  }

  // onde a lista cai. Medida na tela, e remedida a cada rolagem: dentro da
  // gaveta o campo anda, e a lista tem de andar junto.
  useEffect(() => {
    if (!aberto) { setPos(null); return; }
    const medir = () => {
      const el = caixaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // no celular o teclado sobe por cima da página sem encolhê-la: quem sabe
      // o que ainda dá para ver é a janela visual, não a altura da página
      const vv = window.visualViewport;
      const tetoVisivel = vv ? vv.offsetTop : 0;
      const chaoVisivel = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const folgaAbaixo = chaoVisivel - r.bottom - 10;
      const folgaAcima = r.top - tetoVisivel - 10;
      const paraCima = folgaAbaixo < 190 && folgaAcima > folgaAbaixo;
      // campo estreito (os de "por página") não pode espremer o nome das opções
      const largura = Math.max(r.width, 200);
      // e campo estreito com opção comprida (a gaveta da automação, onde cada
      // e-mail tem nome e assunto) pode passar da largura do campo: a lista
      // cresce com o conteúdo até este teto e depois desliza para caber.
      const larguraMax = Math.max(largura, Math.min(560, window.innerWidth - 16));
      setPos({
        esquerda: Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)),
        largura, larguraMax,
        ...(paraCima
          ? { base: window.innerHeight - r.top + 4 }
          : { topo: r.bottom + 4 }),
        altura: Math.max(140, Math.min(300, paraCima ? folgaAcima : folgaAbaixo)),
      });
    };
    medir();
    window.addEventListener("scroll", medir, true);
    window.addEventListener("resize", medir);
    window.visualViewport?.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("resize", medir);
      window.visualViewport?.removeEventListener("resize", medir);
    };
  }, [aberto]);

  // a lista larga (mais que o campo) não pode nascer cortada na borda direita:
  // medida a largura que o conteúdo pediu, ela desliza para a esquerda.
  useLayoutEffect(() => {
    if (!aberto || !pos) return;
    const l = listaRef.current;
    if (!l) return;
    const cabe = Math.max(8, Math.min(pos.esquerda, window.innerWidth - l.offsetWidth - 8));
    if (Math.abs(cabe - pos.esquerda) > 0.5) setPos({ ...pos, esquerda: cabe });
  }, [aberto, pos]);

  // a opção do teclado sempre visível
  useEffect(() => {
    if (!aberto) return;
    listaRef.current
      ?.querySelector<HTMLElement>(`[data-i="${destaque}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [destaque, aberto]);

  function tecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!aberto) { abrir(); return; }
      if (!visiveis.length) return;
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setDestaque((d) => (d + passo + visiveis.length) % visiveis.length);
    } else if (e.key === "Enter") {
      if (!aberto) return;
      e.preventDefault();
      const o = visiveis[destaque];
      if (o) escolher(o);
    } else if (e.key === "Escape") {
      if (!aberto) return;
      e.preventDefault();
      e.stopPropagation();   // fecha a lista, não a gaveta atrás dela
      fechar();
    } else if (e.key === "Tab") {
      if (aberto) fechar();
    }
  }

  return (
    <div ref={caixaRef} className={`escolher${aberto ? " aberta" : ""}${className ? ` ${className}` : ""}`}
      style={style}>
      <input
        ref={campoRef}
        className="escolher-campo"
        role="combobox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={aberto && visiveis[destaque] ? `${idLista}-${destaque}` : undefined}
        autoComplete="off"
        spellCheck={false}
        title={titulo}
        disabled={desabilitado}
        value={busca ?? escolhida?.rotulo ?? ""}
        placeholder={aberto ? "digite para buscar…" : (escolhida ? "" : dica)}
        onMouseDown={abrir}
        onChange={(e) => digitou(e.target.value)}
        onKeyDown={tecla}
        onBlur={fechar}
      />
      <span className="escolher-seta" aria-hidden="true">▾</span>

      {aberto && pos && createPortal(
        <div ref={listaRef} id={idLista} role="listbox" className="escolher-lista"
          style={{
            left: pos.esquerda, minWidth: pos.largura, maxWidth: pos.larguraMax,
            top: pos.topo, bottom: pos.base, maxHeight: pos.altura,
          }}
          // segurar o mousedown mantém o foco no campo: sem isto o clique
          // fecha a lista antes de a opção ser escolhida
          onMouseDown={(e) => e.preventDefault()}>
          {visiveis.map((o, i) => {
            const cabecalho = o.grupo && o.grupo !== visiveis[i - 1]?.grupo;
            return (
              <div key={`${o.valor}-${i}`}>
                {cabecalho && <div className="escolher-grupo">{o.grupo}</div>}
                <div id={`${idLista}-${i}`} data-i={i} role="option"
                  aria-selected={String(o.valor) === atual}
                  className={"escolher-opcao"
                    + (i === destaque ? " destacada" : "")
                    + (String(o.valor) === atual ? " escolhida" : "")
                    + (o.desabilitado ? " apagada" : "")}
                  title={o.detalhe ? `${o.rotulo} — ${o.detalhe}` : o.rotulo}
                  onMouseEnter={() => setDestaque(i)}
                  onClick={() => escolher(o)}>
                  <span className="tique" aria-hidden="true">
                    {String(o.valor) === atual ? "✓" : ""}
                  </span>
                  <span className="rot">{o.rotulo}</span>
                  {o.detalhe && <span className="detalhe">{o.detalhe}</span>}
                </div>
              </div>
            );
          })}
          {!visiveis.length && <div className="escolher-vazia">nada com esse nome</div>}
        </div>,
        document.body)}
    </div>
  );
}
