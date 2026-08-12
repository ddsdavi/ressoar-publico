import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import ControlesAparencia from "../components/ControlesAparencia";
import { MARCA_NOME, MARCA_RODAPE } from "../lib/marca";

type Modo = "entrar" | "cadastrar" | "esqueci" | "codigo";

const MarcaRessoa = ({ tamanho = 46 }: { tamanho?: number }) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" fill="none" aria-hidden>
    <circle cx="16" cy="16" r="4" fill="currentColor" />
    <path d="M16 6a10 10 0 0 1 0 20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity=".85" />
    <path d="M16 2a14 14 0 0 1 0 28" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity=".5" />
  </svg>
);

export default function Login() {
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");
  const [senha2, setSenha2] = useState("");
  const [msg, setMsg] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // limpa qualquer resquício de link antigo do provedor de autenticação
  useEffect(() => {
    if (window.location.hash.includes("type=recovery") || window.location.search.includes("code=")) {
      supabase.auth.signOut();
      window.history.replaceState({}, "", window.location.pathname);
      setModo("esqueci");
      setMsg({ tipo: "erro", texto: "Este link não é mais usado. Peça um novo código aqui." });
    }
  }, []);

  const API = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conta-email`;
  async function chamar(corpo: Record<string, unknown>) {
    const r = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
    return { ok: r.ok, dados: await r.json().catch(() => ({})) };
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setOcupado(true);
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
        if (error) throw new Error("E-mail ou senha incorretos.");
      } else if (modo === "cadastrar") {
        if (senha.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(), password: senha,
          options: { data: { nome: nome.trim() } },
        });
        if (error) throw new Error(error.message);
        setMsg({ tipo: "ok", texto: "Cadastro enviado! Sua conta precisa ser liberada por um admin antes do primeiro acesso." });
        setModo("entrar");
      } else if (modo === "esqueci") {
        const { dados } = await chamar({ acao: "senha_solicitar", email: email.trim().toLowerCase() });
        setModo("codigo");
        setMsg({ tipo: "ok", texto: dados.mensagem ?? "Se este e-mail tiver conta no Ressoar, o código chega em instantes." });
      } else if (modo === "codigo") {
        if (senha.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
        if (senha !== senha2) throw new Error("As duas senhas não são iguais.");
        const { ok, dados } = await chamar({
          acao: "senha_redefinir", email: email.trim().toLowerCase(), codigo, senha,
        });
        if (!ok) throw new Error(dados.erro ?? "Não foi possível criar a senha.");
        setModo("entrar"); setCodigo(""); setSenha(""); setSenha2("");
        setMsg({ tipo: "ok", texto: "Senha criada! Agora é só entrar com ela." });
      }
    } catch (err) {
      setMsg({ tipo: "erro", texto: (err as Error).message });
    }
    setOcupado(false);
  }

  const titulos: Record<Modo, string> = {
    entrar: "Entrar",
    cadastrar: "Criar conta",
    esqueci: "Recuperar acesso",
    codigo: "Criar nova senha",
  };
  const legendas: Record<Modo, string> = {
    entrar: "Use o e-mail cadastrado para acessar a plataforma.",
    cadastrar: "Seu acesso é liberado por um admin depois do cadastro.",
    esqueci: "Enviamos um código de 6 dígitos para o seu e-mail.",
    codigo: "Digite o código que chegou por e-mail e escolha sua nova senha.",
  };

  return (
    <div className="tela-login">
      <div className="controles-login"><ControlesAparencia /></div>

      <div className="ondas" aria-hidden>
        <span /><span /><span /><span />
      </div>

      <div className="login-quadro">
        <aside className="login-marca">
          <div className="topo">
            <MarcaRessoa tamanho={40} />
            <div>
              <b>Ressoar</b>
              {MARCA_NOME && <span>{MARCA_NOME}</span>}
            </div>
          </div>
          <h2>A sua base, na sua mão.</h2>
          <p>
            A plataforma que fala com quem confia no seu trabalho — listas, campanhas
            e automações num lugar só, no seu ritmo.
          </p>
          <ul>
            <li><i>◇</i> Leads e segmentos organizados</li>
            <li><i>◇</i> Campanhas e automações próprias</li>
            <li><i>◇</i> Métricas de verdade, sem intermediário</li>
          </ul>
          {MARCA_RODAPE && <footer>{MARCA_RODAPE}</footer>}
        </aside>

        <form className="cartao-login" onSubmit={enviar}>
          <div className="marca-mobile">
            <MarcaRessoa tamanho={34} />
            <div><b>Ressoar</b>{MARCA_NOME && <span>{MARCA_NOME}</span>}</div>
          </div>

          <h2>{titulos[modo]}</h2>
          <p className="legenda">{legendas[modo]}</p>

          {msg && <div className={msg.tipo === "erro" ? "aviso" : "aviso ok"}>{msg.texto}</div>}

          {modo === "cadastrar" && (
            <>
              <label>Seu nome</label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" required />
            </>
          )}

          <label>E-mail</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com" autoComplete="email" required readOnly={modo === "codigo"} />

          {modo === "codigo" && (
            <>
              <label>Código recebido por e-mail</label>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" inputMode="numeric" required
                style={{ letterSpacing: 8, fontSize: "calc(20px * var(--escala-texto))", fontWeight: 700, textAlign: "center" }} />
            </>
          )}

          {modo !== "esqueci" && (
            <>
              <label>{modo === "codigo" ? "Nova senha" : "Senha"}</label>
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••" autoComplete={modo === "entrar" ? "current-password" : "new-password"} required />
            </>
          )}

          {modo === "codigo" && (
            <>
              <label>Repita a nova senha</label>
              <input type="password" value={senha2} onChange={(e) => setSenha2(e.target.value)}
                placeholder="••••••••" autoComplete="new-password" required />
            </>
          )}

          <button className="primario botao-login" type="submit" disabled={ocupado}>
            {ocupado ? "Aguarde…" : modo === "entrar" ? "Entrar na plataforma"
              : modo === "cadastrar" ? "Criar minha conta"
              : modo === "esqueci" ? "Enviar código" : "Salvar nova senha"}
          </button>

          <div className="links-login">
            {modo === "entrar" && (
              <>
                <button type="button" onClick={() => { setModo("esqueci"); setMsg(null); }}>Esqueci minha senha</button>
                <button type="button" onClick={() => { setModo("cadastrar"); setMsg(null); }}>Criar conta</button>
              </>
            )}
            {modo !== "entrar" && (
              <button type="button" onClick={() => { setModo("entrar"); setMsg(null); }}>← Voltar para o login</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
