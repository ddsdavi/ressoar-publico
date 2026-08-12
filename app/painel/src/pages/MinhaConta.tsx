import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao, saudacao, primeiroNome } from "../lib/sessao";
import { ROTULO_PAPEL, DESCRICAO_PAPEL } from "../lib/papeis";
import Ajuda from "../components/Ajuda";

// Converte qualquer imagem para WebP (quadrada, 400px) direto no navegador,
// para o Supabase guardar sempre no formato leve.
async function paraWebp(arquivo: File, lado = 400): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo);
  const corte = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = lado;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    bitmap,
    (bitmap.width - corte) / 2, (bitmap.height - corte) / 2, corte, corte,
    0, 0, lado, lado,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao converter a imagem."))), "image/webp", 0.86));
}

export default function MinhaConta() {
  const { perfil, sessao, recarregar, sair } = useSessao();
  const [nome, setNome] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  // troca de e-mail em 2 etapas
  const [etapaEmail, setEtapaEmail] = useState<"inicio" | "codigo">("inicio");
  const [senhaEmail, setSenhaEmail] = useState("");
  const [codigoEmail, setCodigoEmail] = useState("");
  // exclusão de conta em 2 etapas
  const [abrirExcluir, setAbrirExcluir] = useState(false);
  const [etapaExcluir, setEtapaExcluir] = useState<"inicio" | "codigo">("inicio");
  const [senhaExcluir, setSenhaExcluir] = useState("");
  const [palavraExcluir, setPalavraExcluir] = useState("");
  const [codigoExcluir, setCodigoExcluir] = useState("");

  useEffect(() => {
    setNome(perfil?.nome ?? "");
    setNovoEmail(perfil?.email ?? "");
  }, [perfil]);

  async function salvarNome() {
    setOcupado(true); setMsg(null);
    const { error } = await supabase.from("usuarios_ressoar")
      .update({ nome: nome.trim(), updated_at: new Date().toISOString() })
      .eq("user_id", perfil!.user_id);
    if (error) setMsg({ tipo: "erro", texto: error.message });
    else {
      await supabase.auth.updateUser({ data: { nome: nome.trim() } });
      await recarregar();
      setMsg({ tipo: "ok", texto: "Nome atualizado." });
    }
    setOcupado(false);
  }

  async function chamarConta(corpo: Record<string, unknown>) {
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conta-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.session?.access_token ?? ""}`,
      },
      body: JSON.stringify(corpo),
    });
    return { ok: r.ok, dados: await r.json().catch(() => ({})) };
  }

  async function pedirCodigoEmail() {
    const alvo = novoEmail.trim().toLowerCase();
    setMsg(null);
    if (!alvo || alvo === perfil?.email) { setMsg({ tipo: "erro", texto: "Digite um e-mail diferente do atual." }); return; }
    if (!senhaEmail) { setMsg({ tipo: "erro", texto: "Digite sua senha atual para autorizar." }); return; }
    setOcupado(true);
    const { ok, dados } = await chamarConta({ acao: "solicitar", email_novo: alvo, senha: senhaEmail });
    if (!ok) setMsg({ tipo: "erro", texto: dados.erro ?? "Não foi possível pedir a troca." });
    else {
      setEtapaEmail("codigo");
      setSenhaEmail("");
      setMsg({ tipo: "ok", texto: `Enviamos um código de 6 dígitos para o seu e-mail atual (${dados.enviado_para}). Ele vale 15 minutos.` });
    }
    setOcupado(false);
  }

  async function confirmarTrocaEmail() {
    setMsg(null);
    setOcupado(true);
    const { ok, dados } = await chamarConta({ acao: "confirmar", codigo: codigoEmail });
    if (!ok) setMsg({ tipo: "erro", texto: dados.erro ?? "Código inválido." });
    else {
      setEtapaEmail("inicio");
      setCodigoEmail("");
      await supabase.auth.refreshSession();
      await recarregar();
      setMsg({ tipo: "ok", texto: `Pronto! Agora você entra com ${dados.email_novo}.` });
    }
    setOcupado(false);
  }

  async function cancelarTrocaEmail() {
    await chamarConta({ acao: "cancelar" });
    setEtapaEmail("inicio"); setCodigoEmail(""); setSenhaEmail("");
    setNovoEmail(perfil?.email ?? "");
    setMsg(null);
  }

  async function pedirCodigoExclusao() {
    setMsg(null);
    if (palavraExcluir.trim().toUpperCase() !== "EXCLUIR") {
      setMsg({ tipo: "erro", texto: 'Digite a palavra EXCLUIR para continuar.' }); return;
    }
    if (!senhaExcluir) { setMsg({ tipo: "erro", texto: "Digite sua senha atual." }); return; }
    setOcupado(true);
    const { ok, dados } = await chamarConta({
      acao: "excluir_solicitar", senha: senhaExcluir, confirmacao: palavraExcluir,
    });
    if (!ok) setMsg({ tipo: "erro", texto: dados.erro ?? "Não foi possível iniciar a exclusão." });
    else {
      setEtapaExcluir("codigo"); setSenhaExcluir("");
      setMsg({ tipo: "ok", texto: `Enviamos um código para ${dados.enviado_para}. Digite-o para concluir a exclusão.` });
    }
    setOcupado(false);
  }

  async function confirmarExclusao() {
    if (!confirm("Última confirmação: sua conta será apagada permanentemente. Continuar?")) return;
    setOcupado(true);
    const { ok, dados } = await chamarConta({ acao: "excluir_confirmar", codigo: codigoExcluir });
    if (!ok) { setMsg({ tipo: "erro", texto: dados.erro ?? "Código inválido." }); setOcupado(false); return; }
    alert("Sua conta foi excluída. Até logo!");
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function enviarFoto(ev: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = ev.target.files?.[0];
    if (!arquivo || !perfil) return;
    setOcupado(true); setMsg(null);
    try {
      const webp = await paraWebp(arquivo);
      const caminho = `${perfil.user_id}/foto.webp`;
      const { error: errUp } = await supabase.storage.from("avatares")
        .upload(caminho, webp, { contentType: "image/webp", upsert: true });
      if (errUp) throw errUp;
      const { data } = supabase.storage.from("avatares").getPublicUrl(caminho);
      const url = `${data.publicUrl}?v=${Date.now()}`;
      const { error } = await supabase.from("usuarios_ressoar")
        .update({ avatar_url: url, updated_at: new Date().toISOString() })
        .eq("user_id", perfil.user_id);
      if (error) throw error;
      await recarregar();
      setMsg({ tipo: "ok", texto: `Foto atualizada (convertida para WebP, ${Math.round(webp.size / 1024)} KB).` });
    } catch (e) {
      setMsg({ tipo: "erro", texto: (e as Error).message });
    }
    setOcupado(false);
    if (arquivoRef.current) arquivoRef.current.value = "";
  }

  async function removerFoto() {
    if (!perfil || !confirm("Remover sua foto de perfil?")) return;
    setOcupado(true);
    await supabase.storage.from("avatares").remove([`${perfil.user_id}/foto.webp`]);
    await supabase.from("usuarios_ressoar").update({ avatar_url: null }).eq("user_id", perfil.user_id);
    await recarregar();
    setOcupado(false);
  }

  async function trocarSenha() {
    setMsg(null);
    if (senha.length < 8) { setMsg({ tipo: "erro", texto: "A senha precisa ter pelo menos 8 caracteres." }); return; }
    if (senha !== senha2) { setMsg({ tipo: "erro", texto: "As duas senhas não são iguais." }); return; }
    setOcupado(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) setMsg({ tipo: "erro", texto: error.message });
    else { setSenha(""); setSenha2(""); setMsg({ tipo: "ok", texto: "Senha alterada com sucesso." }); }
    setOcupado(false);
  }

  if (!perfil) return null;

  return (
    <div>
      <h1>{saudacao()}, {primeiroNome(perfil)}!</h1>
      <div className="sub">Seus dados e preferências no Ressoar.</div>

      {msg && <div className={msg.tipo === "ok" ? "aviso ok" : "aviso"}>{msg.texto}</div>}

      <div className="caixa">
        <h2>Foto de perfil
          <Ajuda>
            Aparece no canto da tela e na saudação da Visão geral. É só do painel: nunca
            entra em e-mail que você manda para a base.
            <br /><br />
            A conversão para WebP acontece <b>no seu navegador</b>, antes de subir — uma foto
            de 4 MB do celular vira uns 40 KB.
          </Ajuda>
        </h2>
        <div className="linha" style={{ alignItems: "center" }}>
          <div style={{ flex: "0 0 auto" }}>
            {perfil.avatar_url
              ? <img src={perfil.avatar_url} alt="Sua foto" className="foto-perfil" />
              : <div className="foto-perfil vazia">{primeiroNome(perfil).slice(0, 2).toUpperCase()}</div>}
          </div>
          <div>
            <input ref={arquivoRef} type="file" accept="image/*" onChange={enviarFoto} disabled={ocupado} />
            <div className="sub" style={{ marginTop: 6 }}>
              Qualquer formato (JPG, PNG, HEIC…). O sistema recorta em quadrado e converte para <b>WebP</b> antes de guardar.
            </div>
          </div>
          {perfil.avatar_url && (
            <button className="perigo" style={{ flex: "0 0 auto" }} onClick={removerFoto}>Remover</button>
          )}
        </div>
      </div>

      <div className="caixa">
        <h2>Nome</h2>
        <div className="linha">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome completo" />
          <button className="primario" style={{ flex: "0 0 auto" }} disabled={ocupado} onClick={salvarNome}>Salvar nome</button>
        </div>
      </div>

      <div className="caixa">
        <h2>E-mail de acesso
          <Ajuda>
            É o e-mail com que <b>você entra</b> na plataforma — não tem nada a ver com o
            remetente das campanhas, que fica em Configurações.
            <br /><br />
            A troca pede sua senha e um código enviado para o endereço <b>atual</b>. Assim,
            quem pegar sua tela desbloqueada não consegue mudar o dono da conta: o código
            chega numa caixa que continua sendo sua. Cada tentativa fica no registro de
            segurança.
          </Ajuda>
        </h2>
        {etapaEmail === "inicio" ? (
          <>
            <label>Novo e-mail</label>
            <input type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} />
            <label>Sua senha atual (para autorizar)</label>
            <div className="linha">
              <input type="password" value={senhaEmail} onChange={(e) => setSenhaEmail(e.target.value)}
                placeholder="••••••••" autoComplete="current-password" />
              <button className="primario" style={{ flex: "0 0 auto" }} disabled={ocupado} onClick={pedirCodigoEmail}>
                Enviar código
              </button>
            </div>
            <div className="sub" style={{ marginTop: 8 }}>
              Por segurança, o código de confirmação vai para o seu <b>e-mail atual</b> ({perfil.email}).
              Sem esse código, o e-mail não muda.
            </div>
          </>
        ) : (
          <>
            <label>Código de 6 dígitos recebido no seu e-mail atual</label>
            <div className="linha">
              <input value={codigoEmail} onChange={(e) => setCodigoEmail(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" inputMode="numeric"
                style={{ letterSpacing: 6, fontSize: "calc(18px * var(--escala-texto))", fontWeight: 600, maxWidth: 180 }} />
              <button className="primario" style={{ flex: "0 0 auto" }} disabled={ocupado || codigoEmail.length < 6}
                onClick={confirmarTrocaEmail}>Confirmar troca</button>
              <button style={{ flex: "0 0 auto" }} onClick={cancelarTrocaEmail}>Cancelar</button>
            </div>
            <div className="sub" style={{ marginTop: 8 }}>Trocando para <b>{novoEmail}</b>. O código vale 15 minutos.</div>
          </>
        )}
      </div>

      <div className="caixa">
        <h2>Trocar senha
          <Ajuda>
            Mínimo de 8 caracteres. Prefira uma frase que só você diria a uma senha curta e
            complicada: é mais difícil de quebrar e mais fácil de lembrar.
            <br /><br />
            Sua senha não é guardada em lugar nenhum de onde alguém possa lê-la — nem admin
            vê a senha de ninguém. Trocar aqui não desconecta suas outras sessões.
          </Ajuda>
        </h2>
        <div className="linha">
          <div>
            <label>Nova senha</label>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
              placeholder="mínimo 8 caracteres" autoComplete="new-password" />
          </div>
          <div>
            <label>Repita a nova senha</label>
            <input type="password" value={senha2} onChange={(e) => setSenha2(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="primario" disabled={ocupado} onClick={trocarSenha}>Alterar senha</button>
        </div>
      </div>

      <div className="caixa">
        <h2>Seu acesso
          <Ajuda>
            Seu nível define o que você consegue fazer, e ele só muda por um admin, na página
            Usuários — ninguém aumenta o próprio acesso.
            <br /><br />
            Se algo que você precisa fazer aparece bloqueado, é aqui que está a resposta:
            peça a quem administra a conta.
          </Ajuda>
        </h2>
        <table>
          <tbody>
            <tr><td style={{ width: 190, color: "var(--ac-texto2)" }}>Nível</td>
              <td>
                <span className="etiqueta et-roxa">{ROTULO_PAPEL[perfil.papel]}</span>
                {perfil.admin_mestre && <span className="etiqueta et-verde">🔒 permanente</span>}
                <div style={{ fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--ac-texto2)", marginTop: 4 }}>{DESCRICAO_PAPEL[perfil.papel]}</div>
              </td></tr>
            <tr><td style={{ color: "var(--ac-texto2)" }}>Situação</td>
              <td><span className="etiqueta et-verde">{perfil.status}</span></td></tr>
            <tr><td style={{ color: "var(--ac-texto2)" }}>Último acesso</td>
              <td>{sessao?.user.last_sign_in_at ? new Date(sessao.user.last_sign_in_at).toLocaleString("pt-BR") : "—"}</td></tr>
          </tbody>
        </table>
        <div className="sub" style={{ marginTop: 12 }}>O nível de acesso só pode ser alterado por um admin, na página Usuários.</div>
      </div>

      <div className="caixa">
        <h2>Sessão
          <Ajuda>
            Encerra o acesso <b>neste navegador</b>. Suas preferências de tema e tamanho de
            texto continuam guardadas aqui para a próxima vez.
          </Ajuda>
        </h2>
        <button className="perigo" onClick={sair}>Sair da conta</button>
      </div>

      <div className="caixa" style={{ borderColor: "#F0C9C5" }}>
        <h2 style={{ color: "var(--ac-vermelho)" }}>Excluir minha conta
          <Ajuda>
            Apaga <b>o seu acesso</b>: cadastro, foto e histórico de login. Leads, campanhas,
            mensagens e automações são da operação e continuam onde estão — apagar sua conta
            não apaga o trabalho do time.
            <br /><br />
            É irreversível, e por isso pede senha, a palavra EXCLUIR e um código no seu
            e-mail. Se a ideia é só parar de usar por um tempo, peça a um admin para bloquear
            a conta.
          </Ajuda>
        </h2>
        {perfil.admin_mestre ? (
          <div className="sub">
            Esta é uma conta de administração permanente — não pode ser excluída pelo sistema.
          </div>
        ) : !abrirExcluir ? (
          <>
            <div className="sub">
              Apaga seu cadastro, sua foto e seu histórico de acesso. Os dados da operação
              (leads, campanhas, mensagens) pertencem à empresa e permanecem no sistema.
            </div>
            <button className="perigo" style={{ marginTop: 10 }} onClick={() => setAbrirExcluir(true)}>
              Quero excluir minha conta
            </button>
          </>
        ) : etapaExcluir === "inicio" ? (
          <>
            <div className="aviso" style={{ background: "var(--ac-vermelho2)", borderColor: "#F0C9C5", color: "#7A1F1F" }}>
              <b>Atenção: esta ação é irreversível.</b> Para continuar, confirme sua senha e digite a palavra EXCLUIR.
              Depois enviaremos um código para o seu e-mail cadastrado.
            </div>
            <label>Sua senha atual</label>
            <input type="password" value={senhaExcluir} onChange={(e) => setSenhaExcluir(e.target.value)}
              placeholder="••••••••" autoComplete="current-password" />
            <label>Digite EXCLUIR para confirmar</label>
            <div className="linha">
              <input value={palavraExcluir} onChange={(e) => setPalavraExcluir(e.target.value)} placeholder="EXCLUIR" />
              <button className="perigo" style={{ flex: "0 0 auto" }} disabled={ocupado} onClick={pedirCodigoExclusao}>
                Enviar código de exclusão
              </button>
              <button style={{ flex: "0 0 auto" }} onClick={() => { setAbrirExcluir(false); setSenhaExcluir(""); setPalavraExcluir(""); }}>
                Desistir
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="aviso" style={{ background: "var(--ac-vermelho2)", borderColor: "#F0C9C5", color: "#7A1F1F" }}>
              Último passo: digite o código que enviamos para o seu e-mail. Ao confirmar, sua conta será apagada.
            </div>
            <div className="linha">
              <input value={codigoExcluir} onChange={(e) => setCodigoExcluir(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" inputMode="numeric"
                style={{ letterSpacing: 6, fontSize: "calc(18px * var(--escala-texto))", fontWeight: 600, maxWidth: 180 }} />
              <button className="perigo" style={{ flex: "0 0 auto" }} disabled={ocupado || codigoExcluir.length < 6}
                onClick={confirmarExclusao}>Excluir permanentemente</button>
              <button style={{ flex: "0 0 auto" }} onClick={() => { setAbrirExcluir(false); setEtapaExcluir("inicio"); setCodigoExcluir(""); }}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
