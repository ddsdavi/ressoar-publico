import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from "react-router-dom";
import { ProvedorSessao, useSessao, primeiroNome } from "./lib/sessao";
import Login from "./pages/Login";
import Usuarios from "./pages/Usuarios";
import MinhaConta from "./pages/MinhaConta";
import Seguranca from "./pages/Seguranca";
import Tour, { tourJaVisto } from "./components/Tour";
import ControlesAparencia from "./components/ControlesAparencia";
import { ROTULO_PAPEL } from "./lib/papeis";
import { TITULO } from "./lib/marca";
import Dashboard from "./pages/Dashboard";
import Leads from "./pages/Leads";
import Listas from "./pages/Listas";
import Tags from "./pages/Tags";
import Mensagens from "./pages/Mensagens";
import Campanhas from "./pages/Campanhas";
import Automacoes from "./pages/Automacoes";
import Envios from "./pages/Envios";
import Dados from "./pages/Dados";
import Campos from "./pages/Campos";
import FormularioPublico from "./pages/FormularioPublico";
import Formularios from "./pages/Formularios";
import Relatorios from "./pages/Relatorios";
import LeadScoring from "./pages/LeadScoring";
import Vendas from "./pages/Vendas";
import Config from "./pages/Config";
import ManyChat from "./pages/ManyChat";

// Layout no padrão do ActiveCampaign: topbar escura + rail de ícones + sidebar branca contextual.
// Cada seção lista só os seus itens de menu; as rotas que ela responde saem
// daí, no .map() do fim. Antes eram duas listas escritas à mão, e bastou
// esquecer "/envios" na segunda: a página abria certa, mas nenhuma seção
// assumia a rota e a barra caía na "Visão geral" — parecia que o clique tinha
// voltado para o início.
const SECOES = [
  {
    id: "inicio", titulo: "Visão geral",
    icone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
    grupos: [{ titulo: null, itens: [["Visão geral", "/"]] }],
  },
  {
    id: "contatos", titulo: "Contatos",
    icone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>,
    grupos: [
      { titulo: null, itens: [["Leads", "/leads"], ["Listas", "/listas"], ["Tags", "/tags"],
                            ["Campos", "/campos"], ["Formulários", "/formularios"]] },
      { titulo: "Gerenciar", itens: [["Envios e exclusões", "/envios"],
                                     ["Importações e exportações", "/dados"],
                                     ["Lead scoring", "/leadscoring"],
                                     ["Relatórios", "/relatorios"]] },
    ],
  },
  {
    id: "email", titulo: "Email",
    icone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>,
    // Envios não se repete aqui: é a mesma página de Contatos › Gerenciar, e
    // uma rota só pode pertencer a uma seção. Repetida, o clique feito por
    // Email jogava o menu inteiro para Contatos.
    grupos: [
      { titulo: null, itens: [["Campanhas", "/campanhas"], ["Mensagens", "/mensagens"]] },
    ],
  },
  {
    id: "produtos", titulo: "Produtos",
    icone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" /><path d="m3 7.5 9 4.5 9-4.5M12 12v9" /></svg>,
    grupos: [{ titulo: null, itens: [["Produtos e vendas", "/vendas"]] }],
  },
  {
    id: "automacoes", titulo: "Automações",
    icone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M6 8.5V12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8.5M12 14v1.5" /></svg>,
    grupos: [{ titulo: null, itens: [["Fluxos", "/automacoes"], ["ManyChat", "/manychat"]] }],
  },
  {
    id: "admin", titulo: "Admin", soAdmin: true,
    icone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l7 3v6c0 4.4-3 8.2-7 9-4-.8-7-4.6-7-9V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>,
    grupos: [{ titulo: null, itens: [["Usuários", "/usuarios"], ["Registro de segurança", "/seguranca"]] }],
  },
  {
    id: "config", titulo: "Configurações", soAdmin: true,
    icone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" /></svg>,
    grupos: [{ titulo: null, itens: [["Configurações", "/config"]] }],
  },
].map((s) => ({ ...s, rotas: s.grupos.flatMap((g) => g.itens.map(([, rota]) => rota)) }));

function Layout() {
  const { pathname } = useLocation();
  const { perfil, ehAdmin, sair } = useSessao();
  const secoesVisiveis = SECOES.filter((s) => !s.soAdmin || ehAdmin);
  const secao = secoesVisiveis.find((s) => s.rotas.some((r) => (r === "/" ? pathname === "/" : pathname.startsWith(r)))) ?? secoesVisiveis[0];
  const [menuAberto, setMenuAberto] = useState(false);
  const [contaAberta, setContaAberta] = useState(false);
  const [tourAberto, setTourAberto] = useState(false);
  // A barra da seção encolhe para dar tela ao conteúdo. A escolha fica salva:
  // quem encolheu uma vez não quer encolher de novo a cada visita.
  const [barraFechada, setBarraFechada] = useState(() => localStorage.getItem("ressoar-barra") === "fechada");

  useEffect(() => {
    if (!tourJaVisto()) {
      const t = setTimeout(() => setTourAberto(true), 900);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("ressoar-barra", barraFechada ? "fechada" : "aberta");
  }, [barraFechada]);


  return (
    <div className={`ac-app${barraFechada ? " barra-fechada" : ""}`}>
      <header className="ac-topbar">
        <button className="hamburguer" onClick={() => setMenuAberto(!menuAberto)}
          title="Menu">{menuAberto ? "✕" : "☰"}</button>
        <NavLink to="/" className="marca" title="Ir para a área inicial">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="4" fill="#fff" />
            <path d="M16 6a10 10 0 0 1 0 20M16 2a14 14 0 0 1 0 28" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Ressoar
        </NavLink>
        <div className="direita">
          <button className="ajuda-tour" title="Rever o tour guiado"
            onClick={() => setTourAberto(true)}>?</button>
          <ControlesAparencia />
          <span title={perfil?.email}>
            {perfil?.nome || perfil?.email}
            {perfil && <b style={{ marginLeft: 6, opacity: .75 }}>· {ROTULO_PAPEL[perfil.papel]}</b>}
          </span>
          <div className="menu-conta">
            <button className="avatar" title="Minha conta" onClick={() => setContaAberta(!contaAberta)}>
              {perfil?.avatar_url
                ? <img src={perfil.avatar_url} alt="" />
                : (perfil?.nome || perfil?.email || "?").slice(0, 2).toUpperCase()}
            </button>
            {contaAberta && (
              <>
                <div className="fundo-menu" onClick={() => setContaAberta(false)} />
                <div className="painel-conta">
                  <div className="cabeca">
                    <b>{perfil?.nome || primeiroNome(perfil)}</b>
                    <span>{perfil?.email}</span>
                    <span className="etiqueta et-roxa" style={{ marginTop: 6 }}>{ROTULO_PAPEL[perfil!.papel]}</span>
                  </div>
                  <NavLink to="/minha-conta" onClick={() => setContaAberta(false)}>⚙ Minha conta</NavLink>
                  <button onClick={() => { setContaAberta(false); sair(); }}>⏻ Sair</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      {menuAberto && (
        <div className="menu-mobile">
          {secoesVisiveis.map((s) => (
            <div key={s.id}>
              <h2>{s.titulo}</h2>
              {s.grupos.flatMap((g) => g.itens).map(([rotulo, rota]) => (
                <NavLink key={`${s.id}-${rota}`} to={rota} end={rota === "/"}
                  className={({ isActive }) => (isActive ? "ativo" : "")}
                  onClick={() => setMenuAberto(false)}>
                  {rotulo}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="ac-corpo">
        <nav className="ac-rail">
          {secoesVisiveis.map((s) => (
            <NavLink key={s.id} to={s.rotas[0]} title={s.titulo}
              className={secao.id === s.id ? "ativo" : ""}>
              {s.icone}
            </NavLink>
          ))}
        </nav>
        <button className="alterna-barra" onClick={() => setBarraFechada(!barraFechada)}
          aria-expanded={!barraFechada} aria-controls="barra-secao"
          title={barraFechada ? `Abrir o menu de ${secao.titulo}` : "Encolher o menu da seção"}
          aria-label={barraFechada ? `Abrir o menu de ${secao.titulo}` : "Encolher o menu da seção"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <aside className="ac-sidebar" id="barra-secao" inert={barraFechada}>
          <h1>{secao.titulo}</h1>
          {secao.grupos.map((g, i) => (
            <div key={i}>
              {g.titulo && <div className="grupo">{g.titulo}</div>}
              {g.itens.map(([rotulo, rota]) => (
                <NavLink key={rota} to={rota} end={rota === "/"}
                  className={({ isActive }) => (isActive ? "ativo" : "")}>
                  {rotulo}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="rodape">{TITULO}</div>
        </aside>
        <main className="conteudo">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/listas" element={<Listas />} />
            <Route path="/tags" element={<Tags />} />
            <Route path="/campanhas" element={<Campanhas />} />
            <Route path="/mensagens" element={<Mensagens />} />
            <Route path="/automacoes" element={<Automacoes />} />
            <Route path="/envios" element={<Envios />} />
            <Route path="/dados" element={<Dados />} />
            <Route path="/campos" element={<Campos />} />
            <Route path="/formularios" element={<Formularios />} />
            <Route path="/relatorios" element={<Relatorios />} />
            <Route path="/leadscoring" element={<LeadScoring />} />
            <Route path="/vendas" element={<Vendas />} />
            {/* endereço antigo: API e webhooks agora moram numa aba de Configurações */}
            <Route path="/api" element={<Navigate to="/config" replace />} />
            <Route path="/manychat" element={ehAdmin ? <ManyChat /> : <Navigate to="/" replace />} />
            <Route path="/config" element={ehAdmin ? <Config /> : <Navigate to="/" replace />} />
            <Route path="/usuarios" element={ehAdmin ? <Usuarios /> : <Navigate to="/" replace />} />
            <Route path="/seguranca" element={ehAdmin ? <Seguranca /> : <Navigate to="/" replace />} />
            <Route path="/minha-conta" element={<MinhaConta />} />
          </Routes>
        </main>
      </div>
      <Tour aberto={tourAberto} aoFechar={() => setTourAberto(false)} />
    </div>
  );
}

function Portao() {
  const { sessao, perfil, carregando, sair } = useSessao();
  const local = useLocation();

  // /f/slug é a página de captação — fica fora do login de propósito:
  // quem vai preencher não tem conta nem deveria precisar de uma.
  if (local.pathname.startsWith("/f/")) {
    return (
      <Routes>
        <Route path="/f/:slug" element={<FormularioPublico />} />
      </Routes>
    );
  }

  if (carregando) {
    return <div className="tela-login"><div className="cartao-login">Carregando…</div></div>;
  }
  if (!sessao) return <Login />;
  if (!perfil || perfil.status !== "aprovado") {
    return (
      <div className="tela-login">
        <div className="cartao-login">
          <h2>{perfil?.status === "bloqueado" ? "Acesso bloqueado" : "Cadastro em análise"}</h2>
          <p style={{ fontSize: "calc(14px * var(--escala-texto))", color: "var(--ac-texto2)", lineHeight: 1.7 }}>
            {perfil?.status === "bloqueado"
              ? "Sua conta foi bloqueada por um admin. Fale com quem administra a conta para voltar a entrar."
              : "Sua conta foi criada e está aguardando liberação de um admin. Assim que ela for liberada, o acesso é imediato."}
          </p>
          <button onClick={sair} style={{ width: "100%", marginTop: 18 }}>Sair</button>
        </div>
      </div>
    );
  }
  return <Layout />;
}

export default function App() {
  return (
    <ProvedorSessao>
      <BrowserRouter>
        <Portao />
      </BrowserRouter>
    </ProvedorSessao>
  );
}
