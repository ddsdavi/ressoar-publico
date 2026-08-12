import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import ApiWebhooks from "./ApiWebhooks";
import Ajuda from "../components/Ajuda";
import CampoSegredo from "../components/CampoSegredo";
import Escolher from "../components/Escolher";

// Fontes que existem em Windows, Mac, Android e iOS. Fonte fora desta lista
// não é arriscada: é loteria — o cliente cai para o padrão dele e o e-mail
// que você conferiu não é o e-mail que a pessoa vê.
const FONTES = [
  "Arial, Helvetica, sans-serif",
  "Georgia, 'Times New Roman', serif",
  "'Trebuchet MS', Tahoma, sans-serif",
  "Verdana, Geneva, sans-serif",
  "'Courier New', Courier, monospace",
  "Tahoma, Verdana, sans-serif",
];

const CORES = [
  { chave: "email_cor_titulo", rotulo: "Títulos", padrao: "#1f1a2e" },
  { chave: "email_cor_texto", rotulo: "Texto", padrao: "#3c3646" },
  { chave: "email_cor_destaque", rotulo: "Destaque e botões", padrao: "#6b4ea8" },
  { chave: "email_cor_fundo", rotulo: "Fundo", padrao: "#f4f1ec" },
];


// Tudo que é e-mail fica junto: provedor, remetente, aparência e as travas.
// Separar "envio" de "aparência" obrigava a pessoa a lembrar em qual das
// duas estava o que ela procurava, sendo que as duas tratam da mesma coisa.
// O cadeado na aba avisa quando o modo de teste está ligado — esquecer isso
// ligado é campanha que não chega em ninguém.
const ABAS = [
  { id: "email", icone: "✉", rotulo: "E-mail",
    sub: "Provedor, remetente, aparência das mensagens e as travas de envio." },
  { id: "manychat", icone: "💬", rotulo: "ManyChat",
    sub: "A ponte com o WhatsApp e o Instagram." },
  { id: "planilhas", icone: "📗", rotulo: "Planilhas",
    sub: "A conta Google que as automações usam para escrever em planilhas." },
  { id: "api", icone: "⌨", rotulo: "API e webhooks",
    sub: "Endereços de entrada e saída, e a chave de acesso aos dados." },
];

// O painel fala com a Edge Function google-sheets levando a sessão do
// usuário — o servidor confere se é admin, não a tela.
async function chamarPlanilhas(acao: string, corpo: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-sheets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ acao, ...corpo }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro ?? "não deu para falar com o Google agora");
  return d;
}

export default function Config() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [salvo, setSalvo] = useState(false);
  const [mcChave, setMcChave] = useState("");
  const [mcConfigurado, setMcConfigurado] = useState(false);
  const [mcResposta, setMcResposta] = useState("");
  const [capChave, setCapChave] = useState("");
  const [capConfigurada, setCapConfigurada] = useState(false);
  const [capResposta, setCapResposta] = useState("");
  const [aba, setAba] = useState("email");
  const [naFila, setNaFila] = useState(0);
  const [gsStatus, setGsStatus] = useState<{
    app_configurado?: boolean; conectada?: boolean;
    conta?: string | null; url_retorno?: string;
  }>({});
  const [gsResposta, setGsResposta] = useState("");
  const [gsEsperando, setGsEsperando] = useState(false);
  const relogioGoogle = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (relogioGoogle.current) clearInterval(relogioGoogle.current);
  }, []);

  async function carregar() {
    const { data } = await supabase.from("app_config").select("chave, valor");
    setCfg(Object.fromEntries((data ?? []).map((r) => [r.chave, r.valor ?? ""])));

    // pergunta se a chave existe, não qual é — a função devolve só o fato
    const { data: seg } = await supabase.rpc("segredos_configurados");
    setMcConfigurado(!!(seg as Record<string, unknown>)?.manychat_api_key);
    setCapConfigurada(!!(seg as Record<string, unknown>)?.formulario_api_key);

    // quanto está represado agora — é o número que dá sentido ao "pausar"
    const { count } = await supabase.from("envios")
      .select("envio_id", { count: "exact", head: true }).eq("status", "queued");
    setNaFila(count ?? 0);
  }
  useEffect(() => { carregar(); }, []);

  async function carregarGoogle() {
    try {
      const s = await chamarPlanilhas("status");
      setGsStatus(s);
      if (s.conectada) desistirDeEsperar();
      return s as typeof gsStatus;
    } catch (e) { setGsResposta((e as Error).message); return {} as typeof gsStatus; }
  }
  useEffect(() => { if (aba === "planilhas") carregarGoogle(); }, [aba]);

  // A volta do Google cai AQUI, no painel — a função do servidor só redireciona,
  // porque o Supabase não serve HTML do domínio dela. Se esta página é a
  // janelinha, ela avisa quem a abriu e se fecha; se a pessoa fez tudo na mesma
  // aba, ela mesma mostra o resultado.
  useEffect(() => {
    const resultado = new URLSearchParams(window.location.search).get("google");
    if (!resultado) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage({ ressoar: "google", resultado },
                                  window.location.origin);
      } catch { /* quem abriu era de outra origem: segue o fluxo normal */ }
      window.close();
      return;
    }
    setAba("planilhas");
    contarOFinal(resultado);
  }, []);

  // O recado da janelinha para a aba que a abriu.
  useEffect(() => {
    const ouvir = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { ressoar?: string })?.ressoar !== "google") return;
      contarOFinal(String((e.data as { resultado?: string }).resultado ?? ""));
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, []);

  function contarOFinal(resultado: string) {
    desistirDeEsperar();
    setGsResposta(resultado === "ok"
      ? "✓ Conta Google conectada."
      : `Não deu para conectar (${resultado}). Clique em Conectar e tente de novo.`);
    carregarGoogle();
  }

  // Rede de segurança: se o recado se perder (pop-up bloqueado, janela fechada
  // na mão), a volta da pessoa para esta aba já vale como pergunta ao servidor.
  useEffect(() => {
    if (!gsEsperando) return;
    const aoVoltar = () => { carregarGoogle(); };
    window.addEventListener("focus", aoVoltar);
    return () => window.removeEventListener("focus", aoVoltar);
  }, [gsEsperando]);

  async function conectarGoogle() {
    try {
      const d = await chamarPlanilhas("conectar",
        { origem: window.location.origin });
      const janela = window.open(d.url, "ressoar_google",
        "width=520,height=680,menubar=no,toolbar=no");
      if (!janela) {
        setGsResposta("O navegador bloqueou a janela do Google. Libere os pop-ups " +
          "para este endereço e clique de novo.");
        return;
      }
      setGsResposta("Escolha a conta Google na janela que abriu.");
      setGsEsperando(true);

      // O recado da janelinha é quem costuma chegar primeiro. Este relógio é
      // só teimosia: aba em segundo plano tem o timer estrangulado pelo Chrome,
      // então ele não serve como plano A — serve para o caso de tudo falhar.
      if (relogioGoogle.current) clearInterval(relogioGoogle.current);
      let voltas = 0;
      relogioGoogle.current = setInterval(async () => {
        voltas++;
        const s = await carregarGoogle();
        if (s.conectada) {
          try { janela?.close(); } catch { /* já se fechou sozinha */ }
        } else if (voltas > 150 || (voltas > 2 && janela?.closed)) {
          desistirDeEsperar();
        }
      }, 2000);
    } catch (e) { setGsResposta((e as Error).message); setGsEsperando(false); }
  }

  function desistirDeEsperar() {
    if (relogioGoogle.current) clearInterval(relogioGoogle.current);
    relogioGoogle.current = null;
    setGsEsperando(false);
  }

  async function desconectarGoogle() {
    try {
      await chamarPlanilhas("desconectar");
      setGsResposta("Conta desconectada.");
      await carregarGoogle();
    } catch (e) { setGsResposta((e as Error).message); }
  }

  async function salvarManyChat() {
    const { error } = await supabase.rpc("guardar_segredo", {
      p_chave: "manychat_api_key", p_valor: mcChave.trim(),
    });
    if (error) { setMcResposta("Não deu para guardar: " + error.message); return; }
    setMcChave("");
    setMcConfigurado(true);
    setMcResposta("✓ Chave guardada. Clique em Testar para confirmar que o ManyChat aceita.");
  }

  async function salvarChaveCaptacao() {
    const { error } = await supabase.rpc("guardar_segredo", {
      p_chave: "formulario_api_key", p_valor: capChave.trim(),
    });
    if (error) { setCapResposta("Não deu para guardar: " + error.message); return; }
    setCapChave("");
    setCapConfigurada(true);
    setCapResposta("✓ Chave guardada. Atualize quem chama a captação por API — a antiga parou de valer.");
  }

  async function testarManyChat() {
    setMcResposta("Conferindo com o ManyChat…");
    try {
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manychat?acao=testar`,
        { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "" } });
      const d = await r.json();
      setMcResposta(d.ok
        ? `✓ ${d.mensagem}${d.tags?.length ? ". Tags lá: " + d.tags.slice(0, 8).join(", ") : ""}`
        : "O ManyChat recusou a chave. Confira se copiou inteira, em Settings → API.");
    } catch (e) {
      setMcResposta("Não deu para falar com o ManyChat agora: " + (e as Error).message);
    }
  }

  async function salvar() {
    for (const [chave, valor] of Object.entries(cfg)) {
      await supabase.from("app_config").upsert({ chave, valor, updated_at: new Date().toISOString() });
    }
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2500);
  }

  return (
    <div>
      <h1>Configurações</h1>
      <div className="sub">{ABAS.find((a) => a.id === aba)?.sub}</div>

      <div style={{
        display: "flex", gap: 4, flexWrap: "wrap",
        borderBottom: "1px solid var(--borda)", margin: "18px 0 20px",
      }}>
        {ABAS.map((a) => {
          const ativa = aba === a.id;
          return (
            <button key={a.id} onClick={() => setAba(a.id)}
              style={{
                border: "none", background: "transparent", cursor: "pointer",
                padding: "9px 16px", marginBottom: -1,
                borderBottom: `2px solid ${ativa ? "var(--marca)" : "transparent"}`,
                color: ativa ? "var(--texto)" : "var(--texto2)",
                fontWeight: ativa ? 700 : 400,
                fontSize: "calc(14px * var(--escala-texto))",
              }}>
              {a.icone} {a.rotulo}
              {a.id === "email" && (cfg.envio_so_para ?? "").trim() !== "" && (
                <span title="modo de teste ligado" style={{ marginLeft: 6 }}>🔒</span>
              )}
            </button>
          );
        })}
      </div>

      {cfg.provedor_email === "simulado" && (
        <div className="aviso">
          <b>Modo simulado:</b> tudo é processado e marcado como enviado, mas nenhum e-mail
          real sai.
          <Ajuda>
            Para ligar de verdade, preencha a chave do provedor abaixo e troque a opção.
            Nada mais muda: personalização, rastreio, descadastro e relatórios continuam
            iguais em qualquer provedor.
          </Ajuda>
        </div>
      )}

      {aba === "email" && (
      <div className="caixa" style={{ borderLeft: "4px solid var(--perigo)" }}>
        <h2>Trava de envio</h2>

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <input type="checkbox" checked={cfg.envio_pausado === "true"}
            onChange={(e) => setCfg({ ...cfg, envio_pausado: e.target.checked ? "true" : "false" })} />
          <span>
            Pausar todo envio
            <Ajuda>
              Botão de pânico: a fila para de escoar. Ela continua enchendo, e nada se
              perde.
              <br /><br />
              <b>Ao despausar, não sai tudo de uma vez.</b> O motor manda 100 por minuto,
              cerca de 6 mil por hora, e retoma de onde parou. Uma campanha de 12 mil
              pessoas leva umas 2 horas para escoar inteira — pausada ou não.
            </Ajuda>
          </span>
        </label>

        {cfg.envio_pausado === "true" && naFila > 0 && (
          <div className="aviso" style={{ marginTop: 10 }}>
            <b>{naFila.toLocaleString("pt-BR")}</b> e-mail(s) esperando na fila. Ao
            despausar, saem a 100 por minuto — cerca de {Math.ceil(naFila / 100)} minuto(s)
            até o último.
          </div>
        )}

        <label style={{ marginTop: 14 }}>
          Só enviar para
          <Ajuda>
            Um ou mais endereços separados por vírgula. Quem não estiver na lista fica
            com o envio marcado como <b>retido</b> — dá para ver quem teria recebido, e
            nada é mandado escondido depois. Vazio = envia normalmente para todos.
          </Ajuda>
        </label>
        <input value={cfg.envio_so_para ?? ""}
          placeholder="vazio = todos"
          onChange={(e) => setCfg({ ...cfg, envio_so_para: e.target.value })} />

        {(cfg.envio_so_para ?? "").trim() !== "" && (
          <div className="aviso" style={{ marginTop: 10 }}>
            Só chega em <b>{cfg.envio_so_para}</b>. Esvazie o campo para operar de verdade.
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar"}</button>
        </div>
      </div>
      )}

      {aba === "email" && (
      <div className="caixa">
        <h2>Envio de e-mail</h2>
        <label>Provedor
          <Ajuda>
            Quem leva o e-mail até a caixa da pessoa. Em <b>simulado</b>, tudo é processado e
            marcado como enviado, mas nada sai de verdade — é o modo certo para conferir uma
            campanha inteira sem risco.
            <br /><br />
            Trocar o provedor não muda mais nada: personalização, rastreio, descadastro e
            relatórios continuam iguais nos três.
          </Ajuda>
        </label>
        <Escolher valor={cfg.provedor_email ?? "simulado"}
          aoMudar={(v) => setCfg({ ...cfg, provedor_email: v })}
          opcoes={[
            { valor: "simulado", rotulo: "simulado (nenhum e-mail real sai)" },
            { valor: "resend", rotulo: "Resend" },
            { valor: "ses", rotulo: "Amazon SES" },
          ]} />
        <label>Webhooks das automações
          <Ajuda>
            A chave-geral dos passos que avisam <b>outro sistema</b> — n8n, Boost, um endereço
            seu. Desligada, esses passos não fazem POST nenhum; o resto da automação (e-mail,
            tag, lista) roda normalmente.
            <br /><br />
            Deixe desligada se algum fluxo do outro lado já fizer sozinho o que a automação
            daqui faria: os dois sistemas chamando o mesmo destino é a pessoa recebendo tudo
            em dobro.
            <br /><br />
            O passo <b>Planilha do Google</b> no modo direto não passa por aqui — ele escreve
            pela conta conectada na aba Planilhas.
          </Ajuda>
        </label>
        <Escolher valor={cfg.executar_webhooks ?? "false"}
          aoMudar={(v) => setCfg({ ...cfg, executar_webhooks: v })}
          opcoes={[
            { valor: "false", rotulo: "desligados" },
            { valor: "true", rotulo: "ligados" },
          ]} />
        {cfg.provedor_email !== "ses" && (
          <>
            <label>Chave da API do Resend
              <Ajuda>
                Pegue em <b>resend.com → API Keys</b>. Sem ela preenchida, o envio continua em
                modo simulado mesmo com o provedor trocado.
                <br /><br />
                Lembre de apontar o webhook do Resend para o endereço de postback (aba{" "}
                <b>API e webhooks</b>): sem isso, bounce e reclamação de spam não entram
                sozinhos no bloqueio.
              </Ajuda>
            </label>
            <CampoSegredo value={cfg.resend_api_key ?? ""} placeholder="re_..."
              onChange={(v) => setCfg({ ...cfg, resend_api_key: v })} />
          </>
        )}
        {cfg.provedor_email === "ses" && (
          <>
            <label>Região da AWS</label>
            <input value={cfg.ses_regiao ?? "us-east-1"} placeholder="us-east-1"
              onChange={(e) => setCfg({ ...cfg, ses_regiao: e.target.value })} />
            <label>Segredo interno do SES
              <Ajuda>
                A mesma frase precisa estar no segredo <b>SES_SEGREDO</b> da função de
                envio. As chaves da AWS não ficam aqui — moram nos segredos da função,
                fora do banco.
              </Ajuda>
            </label>
            <CampoSegredo value={cfg.ses_segredo ?? ""} placeholder="uma frase secreta qualquer"
              onChange={(v) => setCfg({ ...cfg, ses_segredo: v })} />

          </>
        )}
        <div className="linha">
          <div><label>Nome do remetente padrão
            <Ajuda>
              O nome que aparece na caixa de entrada de quem recebe — e o que mais decide se a
              pessoa abre. Toda campanha e toda mensagem nova já nascem com ele preenchido.
              <br /><br />
              Mudar aqui não mexe nas mensagens já escritas: cada uma guardou o remetente que
              tinha na hora.
            </Ajuda>
          </label>
            <input value={cfg.from_name_padrao ?? ""}
              onChange={(e) => setCfg({ ...cfg, from_name_padrao: e.target.value })} /></div>
          <div><label>E-mail do remetente padrão
            <Ajuda>
              Precisa ser de um domínio <b>verificado no provedor</b>, senão o envio é
              recusado. Use um subdomínio só para envio (ex.: <code>envio.seudominio.com.br</code>):
              se a reputação se estragar, o e-mail humano do domínio principal continua
              funcionando.
              <br /><br />
              Subdomínio de envio costuma só enviar — por isso o campo “Responder para”
              abaixo aponta para uma caixa que existe de verdade.
            </Ajuda>
          </label>
            <input value={cfg.from_email_padrao ?? ""}
              onChange={(e) => setCfg({ ...cfg, from_email_padrao: e.target.value })} /></div>
        </div>
        <label>Responder para
          <Ajuda>
            Precisa ser uma caixa que <b>existe e recebe</b>. O subdomínio de envio só
            envia: quem responder para ele leva "endereço não encontrado", a resposta se
            perde, e o filtro de spam anota que o remetente não aceita mensagem.
          </Ajuda>
        </label>
        <input value={cfg.reply_to_padrao ?? ""}
          placeholder="contato@seudominio.com.br"
          onChange={(e) => setCfg({ ...cfg, reply_to_padrao: e.target.value })} />

        <label>Endereço físico no rodapé
          <Ajuda>
            Exigência da lei anti-spam: todo e-mail comercial mostra o endereço real de
            quem envia. Precisa ser verdadeiro — endereço inventado é sinal de spam para
            o Gmail, além de irregular. Em branco, o rodapé sai só com o descadastro.
          </Ajuda>
        </label>
        <input value={cfg.endereco_fisico ?? ""}
          placeholder="Razão Social, Rua, nº — Cidade/UF, CEP"
          onChange={(e) => setCfg({ ...cfg, endereco_fisico: e.target.value })} />

        <label>Endereço das funções públicas
          <Ajuda>
            Onde ficam o pixel de abertura, o rastreio de clique e a página de
            descadastro. Só mude se trocar de projeto no Supabase.
          </Ajuda>
        </label>
        <input value={cfg.base_url_tracking ?? ""}
          onChange={(e) => setCfg({ ...cfg, base_url_tracking: e.target.value })} />
        <div style={{ marginTop: 14 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar"}</button>
        </div>
      </div>
      )}

      {aba === "email" && (
      <div className="caixa">
        <h2>Aparência dos e-mails
          <Ajuda>
            Vale para todo bloco novo do editor. Trocar aqui não mexe nos e-mails já
            escritos — mudar o passado estragaria campanha aprovada.
          </Ajuda>
        </h2>


        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <div>
            <label>Fonte
              <Ajuda>
                Só as que existem em Windows, Mac, Android e iOS. Fonte que o cliente não
                tem vira Times New Roman, e o e-mail que você conferiu não é o que a
                pessoa vê.
              </Ajuda>
            </label>
            <Escolher valor={cfg.email_fonte ?? FONTES[0]}
              aoMudar={(v) => setCfg({ ...cfg, email_fonte: v })}
              opcoes={FONTES.map((f) => ({ valor: f, rotulo: f.split(",")[0] }))} />

          </div>
          <div>
            <label>Largura
              <Ajuda>600px é o padrão do mercado, e o que a maioria dos modelos assume.</Ajuda>
            </label>
            <input type="number" min={480} max={800} value={cfg.email_largura ?? "600"}
              onChange={(e) => setCfg({ ...cfg, email_largura: e.target.value })} />

          </div>
        </div>

        <div style={{ display: "grid", gap: 14, marginTop: 14,
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {CORES.map((c) => (
            <div key={c.chave}>
              <label>{c.rotulo}</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={cfg[c.chave] ?? c.padrao}
                  style={{ width: 44, height: 32, padding: 2, cursor: "pointer" }}
                  onChange={(e) => setCfg({ ...cfg, [c.chave]: e.target.value })} />
                <input value={cfg[c.chave] ?? c.padrao} style={{ flex: 1 }}
                  onChange={(e) => setCfg({ ...cfg, [c.chave]: e.target.value })} />
              </div>
            </div>
          ))}
        </div>

        {/* prévia: mais rápido de conferir do que abrir o editor */}
        <div style={{
          marginTop: 16, borderRadius: 8, padding: 20, textAlign: "center",
          background: cfg.email_cor_fundo ?? "#f4f1ec",
          fontFamily: cfg.email_fonte ?? FONTES[0],
          border: "1px solid var(--borda)",
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: cfg.email_cor_titulo ?? "#1f1a2e" }}>
            Assim vai ficar um título
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.6, color: cfg.email_cor_texto ?? "#3c3646", padding: "6px 0 12px" }}>
            E este é o texto comum de um parágrafo do seu e-mail.
          </div>
          <span style={{
            display: "inline-block", padding: "11px 26px", borderRadius: 6, color: "#fff",
            background: cfg.email_cor_destaque ?? "#6b4ea8", fontWeight: 700, fontSize: 15,
          }}>Botão principal</span>
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar"}</button>
        </div>
      </div>
      )}

      {aba === "api" && (
      <div className="caixa">
        <h2>Chave da API de captação</h2>

        <label style={{ marginTop: 10 }}>
          Chave
          {capConfigurada && <span style={{ color: "var(--marca)" }}> · configurada ✓</span>}
          <Ajuda>
            Protege a captação por API — o POST em <b>/formulario</b> sem{" "}
            <b>form_slug</b>, que escolhe lista e tag no próprio corpo. Sem ela no
            cabeçalho <b>x-api-key</b>, esse POST é recusado; os formulários
            publicados continuam públicos, porque neles a lista vem do banco.
            Depois de guardada ela não aparece mais aqui — fica num lugar do banco
            que o navegador não lê. Para trocar, digite a nova por cima.
          </Ajuda>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <CampoSegredo value={capChave} style={{ flex: 1 }}
            placeholder={capConfigurada ? "••••••••  (digite para trocar)" : "cole aqui uma chave longa e aleatória"}
            onChange={setCapChave} />
          <button onClick={salvarChaveCaptacao} disabled={!capChave.trim()}>Guardar</button>
        </div>

        {!capConfigurada && (
          <div className="aviso" style={{ marginTop: 10 }}>
            Sem chave guardada, a captação por API fica fechada. Os formulários
            publicados não dependem dela.
          </div>
        )}

        {capResposta && (
          <div className={capResposta.startsWith("✓") ? "sub" : "aviso"} style={{ marginTop: 10 }}>
            {capResposta}
          </div>
        )}
      </div>
      )}

      {aba === "api" && <ApiWebhooks embutido />}

      {aba === "manychat" && (
      <div className="caixa">
        <h2>ManyChat</h2>

        <label style={{ marginTop: 10 }}>
          Chave da API
          {mcConfigurado && <span style={{ color: "var(--marca)" }}> · configurada ✓</span>}
          <Ajuda>
            Pegue em <b>manychat.com → Settings → API</b>. Depois de guardar, ela não
            aparece mais aqui — nem para você: fica num lugar do banco que o navegador não
            lê. Para trocar, digite a nova por cima.
          </Ajuda>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <CampoSegredo value={mcChave} style={{ flex: 1 }}
            placeholder={mcConfigurado ? "••••••••  (digite para trocar)" : "cole aqui a chave do ManyChat"}
            onChange={setMcChave} />
          <button onClick={salvarManyChat} disabled={!mcChave.trim()}>Guardar</button>
          <button onClick={testarManyChat} disabled={!mcConfigurado}>Testar</button>
        </div>
        <label style={{ marginTop: 16 }}>
          Campo que guarda o WhatsApp
          <Ajuda>
            É por ele que a pessoa é encontrada lá, e não por e-mail: quem entra pelo
            WhatsApp ou pelo Instagram chega com e-mail e telefone vazios. Na conta da
            Patrícia o campo se chama <b>WHATSAPP-ID</b>. O número que vai aqui aparece
            na barra de endereço quando você abre o campo no ManyChat.
          </Ajuda>
        </label>
        <input value={cfg.manychat_campo_whatsapp ?? ""} placeholder="ex.: 12378861"
          onChange={(e) => setCfg({ ...cfg, manychat_campo_whatsapp: e.target.value })} />

        {(cfg.manychat_campo_whatsapp ?? "").trim() === "" && mcConfigurado && (
          <div className="aviso" style={{ marginTop: 10 }}>
            Sem isto, ninguém é encontrado lá — e cada compra cria um assinante repetido.
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar"}</button>
        </div>

        {mcResposta && (
          <div className={mcResposta.startsWith("✓") ? "sub" : "aviso"} style={{ marginTop: 10 }}>
            {mcResposta}
          </div>
        )}
      </div>
      )}

      {aba === "planilhas" && (
      <div className="caixa">
        <h2>Planilhas do Google</h2>
        <div className="sub" style={{ marginTop: 4 }}>
          Conecte uma conta Google uma vez. Depois, em qualquer automação, o passo{" "}
          <b>Planilha do Google</b> deixa colar o link de uma planilha, escolher a aba
          e mapear o que entra em cada coluna — e o Ressoar escreve as linhas sozinho,
          sem n8n no caminho.
        </div>

        {gsStatus.conectada ? (
          <div className="sub" style={{ marginTop: 18 }}>
            Conectada{gsStatus.conta ? <> como <b>{gsStatus.conta}</b></> : null}. As
            automações escrevem nas planilhas que essa conta pode editar.
          </div>
        ) : (
          <div className="sub" style={{ marginTop: 18 }}>
            Nenhuma conta conectada ainda.
            <Ajuda>
              Clique no botão, escolha a conta Google na janela que abrir e pronto —
              esta tela vira sozinha quando o Google responder. Se aparecer o aviso de
              app não verificado, é o app desta própria plataforma: <b>Avançado → Acessar</b>,
              uma vez só.
            </Ajuda>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="primario" onClick={conectarGoogle}
            disabled={gsEsperando || gsStatus.app_configurado === false}>
            {gsEsperando ? "Esperando o Google…"
              : gsStatus.conectada ? "Trocar a conta" : "Conectar conta Google"}
          </button>
          {gsStatus.conectada && (
            <button onClick={desconectarGoogle}>Desconectar</button>
          )}
        </div>

        {gsStatus.app_configurado === false && (
          <div className="aviso" style={{ marginTop: 12 }}>
            A ponte com o Google ainda não foi ligada <b>neste servidor</b> — faltam os
            secrets <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code>{" "}
            da função <code>google-sheets</code>. É coisa de instalação, uma vez na
            vida, como as chaves do envio de e-mail — não é para ser resolvido nesta
            tela.
          </div>
        )}

        {gsResposta && (
          <div className={gsResposta.startsWith("✓") ? "sub" : "aviso"} style={{ marginTop: 10 }}>
            {gsResposta}
          </div>
        )}
      </div>
      )}

      

      
    </div>
  );
}
