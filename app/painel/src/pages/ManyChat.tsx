import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Ajuda from "../components/Ajuda";
import Escolher from "../components/Escolher";
import {
  chamarManyChat as chamar,
  descreverStatusManyChat,
  type ManyChatAssinante as Assinante,
  type ManyChatTag as Tag,
} from "../lib/manychat";

// Banco de testes do ManyChat.
//
// A tela anterior tinha três caixas soltas — procurar, trazer da Ressoar,
// rodar a regra — e nenhuma delas era o que se precisa fazer. O que se
// precisa é percorrer o caminho inteiro de uma vez, com um número:
//
//   formata o telefone → procura no ManyChat → achou? aplica a tag
//                                            → não achou? cria e aplica
//
// É o mesmo caminho da automação quando alguém compra. Aqui ele roda a
// pedido, e cada passo aparece — para dar para ver ONDE parou quando
// parar, em vez de só descobrir que não funcionou.

type NaRessoa = {
  lead_id: string; nome: string | null; whatsapp: string | null;
  manychat_id: string | null; tags: string[]; listas: string[];
};
type Banido = {
  whatsapp: string; nome: string | null; motivo: string | null;
  manychat_id: string | null; ultima_verificacao: string | null; ultima_acao: string | null;
};
type Produto = {
  id: number; apelido: string; tag_manychat: string | null; tag_manychat_turma: boolean;
};
type Passo = { texto: string; estado: "ok" | "erro" | "info" };

export default function ManyChat() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [erroGeral, setErroGeral] = useState("");

  // o fluxo
  const [fone, setFone] = useState("");
  const [nome, setNome] = useState("");
  const [produto, setProduto] = useState("");
  const [tagAvulsa, setTagAvulsa] = useState("");
  const [passos, setPassos] = useState<Passo[]>([]);
  const [rodando, setRodando] = useState(false);
  const [acaoContato, setAcaoContato] = useState(false);
  const [mensagemContato, setMensagemContato] = useState<Passo | null>(null);
  const [mensagemTagUsuario, setMensagemTagUsuario] = useState<Passo | null>(null);

  // quem é essa pessoa, dos dois lados
  const [assinante, setAssinante] = useState<Assinante | null>(null);
  const [naRessoa, setNaRessoa] = useState<NaRessoa | null>(null);
  const [procurou, setProcurou] = useState(false);
  const [consultaManyChatOk, setConsultaManyChatOk] = useState(false);

  // banidos
  const [banidos, setBanidos] = useState<Banido[]>([]);
  const [banNome, setBanNome] = useState("");
  const [banFone, setBanFone] = useState("");
  const [banAcao, setBanAcao] = useState(false);
  const [mensagemBanidos, setMensagemBanidos] = useState<Passo | null>(null);
  const [banidoParaRemover, setBanidoParaRemover] = useState<Banido | null>(null);

  // tags da conta
  const [novaTag, setNovaTag] = useState("");
  const [filtro, setFiltro] = useState("");
  const [verTags, setVerTags] = useState(false);
  const [tagEmAcao, setTagEmAcao] = useState<number | null>(null);
  const [mensagemTags, setMensagemTags] = useState<Passo | null>(null);
  const [tagParaExcluir, setTagParaExcluir] = useState<Tag | null>(null);

  async function carregarTags() {
    try {
      const d = await chamar({ acao: "tags" });
      if (d.ok) { setTags(d.tags ?? []); setErroGeral(""); }
      else setErroGeral("Não deu para ler as tags do ManyChat. Confira a chave em Configurações → ManyChat.");
    } catch {
      setErroGeral("Não deu para falar com o ManyChat. Tente novamente.");
    }
  }

  async function carregarBanidos() {
    const { data } = await supabase.from("manychat_banidos")
      .select("*").order("nome").order("whatsapp");
    setBanidos((data as Banido[]) ?? []);
  }

  useEffect(() => {
    carregarTags();
    carregarBanidos();
    supabase.from("hotmart_produtos")
      .select("id,apelido,tag_manychat,tag_manychat_turma").eq("ativo", true).order("apelido")
      .then(({ data }) => setProdutos((data as Produto[]) ?? []));
  }, []);

  // A forma canônica do número, a mesma da base: DDI+DDD+número. Aqui só
  // o suficiente para não gravar um número que a trava nunca vai casar —
  // a régua completa (fixo, DDD 55, zero do DDD) mora na Edge Function.
  function canonizar(bruto: string): string | null {
    let n = bruto.replace(/\D+/g, "");
    if ((n.length === 12 || n.length === 13) && n.startsWith("550")) n = "55" + n.slice(3);
    if (n.length === 11 && n[2] === "9") n = "55" + n;
    if (n.length === 13 && n.startsWith("55")) return n[4] === "9" ? n : null;
    return n.length >= 12 ? n : null;
  }

  async function adicionarBanido() {
    const fone = canonizar(banFone);
    if (!fone) {
      setMensagemBanidos({ texto: "Número inválido. Use DDI + DDD + número: 5511999990000.", estado: "erro" });
      return;
    }
    setBanAcao(true);
    setMensagemBanidos(null);
    try {
      const { error } = await supabase.from("manychat_banidos").insert({
        whatsapp: fone, nome: banNome.trim() || null, motivo: "adicionado pelo painel",
      });
      if (error) {
        setMensagemBanidos({
          texto: error.code === "23505"
            ? "Esse número já está na lista."
            : "Não deu para adicionar — somente admin pode alterar a lista.",
          estado: "erro",
        });
        return;
      }
      setBanNome(""); setBanFone("");
      await carregarBanidos();
      setMensagemBanidos({
        texto: `Número ${fone} banido. A vigilância roda a cada 10 minutos — ou clique em “Verificar agora”.`,
        estado: "ok",
      });
    } finally {
      setBanAcao(false);
    }
  }

  async function confirmarRemocaoBanido() {
    const b = banidoParaRemover;
    if (!b) return;
    setBanAcao(true);
    setMensagemBanidos(null);
    try {
      const { error } = await supabase.from("manychat_banidos")
        .delete().eq("whatsapp", b.whatsapp);
      if (error) {
        setMensagemBanidos({ texto: "Não deu para remover — somente admin pode alterar a lista.", estado: "erro" });
        return;
      }
      setBanidoParaRemover(null);
      await carregarBanidos();
      setMensagemBanidos({ texto: `Número ${b.whatsapp} saiu da lista de banidos.`, estado: "ok" });
    } finally {
      setBanAcao(false);
    }
  }

  async function verificarBanidosAgora() {
    setBanAcao(true);
    setMensagemBanidos(null);
    try {
      const d = await chamar({ acao: "banidos_verificar" });
      if (!d.ok) {
        setMensagemBanidos({ texto: d.erro ?? "Não deu para verificar agora.", estado: "erro" });
        return;
      }
      await carregarBanidos();
      setMensagemBanidos({
        texto: `Verificação concluída: ${d.verificados} número(s) conferido(s). O resultado está na coluna “última ação”.`,
        estado: "ok",
      });
    } catch {
      setMensagemBanidos({ texto: "Não deu para verificar agora.", estado: "erro" });
    } finally {
      setBanAcao(false);
    }
  }

  // Procurar dos DOIS lados de uma vez. Antes eram duas caixas separadas, e
  // a pergunta "quem é essa pessoa" tinha duas respostas em lugares
  // diferentes da tela.
  async function procurar(numero = fone) {
    if (!numero.trim()) return null;
    const [mc, { data: rs }] = await Promise.all([
      chamar({ acao: "procurar", whatsapp: numero }),
      supabase.rpc("lead_por_whatsapp", { p_fone: numero }),
    ]);
    setAssinante(mc.existe ? mc.assinante : null);
    setNaRessoa((rs as NaRessoa) ?? null);
    setConsultaManyChatOk(mc.ok === true);
    if (!mc.existe && (rs as NaRessoa | null)?.nome && !nome.trim()) {
      setNome((rs as NaRessoa).nome ?? "");
    }
    setProcurou(true);
    return mc;
  }

  async function buscarUsuario() {
    if (!fone.trim()) return;
    setAcaoContato(true);
    setMensagemContato(null);
    try {
      const d = await procurar();
      if (!d?.ok) {
        setMensagemContato({ texto: d?.erro ?? "Não deu para consultar o ManyChat.", estado: "erro" });
      } else if (d.existe) {
        setMensagemContato({ texto: "Usuário encontrado pelo WhatsApp.", estado: "ok" });
      } else {
        setMensagemContato({ texto: "Nenhum usuário encontrado com esse WhatsApp.", estado: "info" });
      }
    } catch {
      setMensagemContato({ texto: "Não deu para consultar o ManyChat.", estado: "erro" });
    } finally {
      setAcaoContato(false);
    }
  }

  async function criarUsuario() {
    if (!fone.trim() || !nome.trim()) return;
    setAcaoContato(true);
    setMensagemContato(null);
    try {
      const d = await chamar({ acao: "criar", whatsapp: fone, nome: nome.trim() });
      if (!d.ok) {
        setMensagemContato({ texto: d.erro ?? "Não deu para criar o usuário.", estado: "erro" });
        return;
      }
      await new Promise((r) => setTimeout(r, 1200));
      await procurar();
      setMensagemContato({
        texto: d.criado
          ? "Usuário criado no ManyChat e ligado ao WhatsApp."
          : "Esse WhatsApp já existia no ManyChat; nenhum duplicado foi criado.",
        estado: d.criado ? "ok" : "info",
      });
    } catch {
      setMensagemContato({ texto: "Não deu para criar o usuário.", estado: "erro" });
    } finally {
      setAcaoContato(false);
    }
  }

  const produtoTemTag = () => {
    const p = produtos.find((x) => String(x.id) === produto);
    return !!(p?.tag_manychat || p?.tag_manychat_turma);
  };

  async function rodarFluxo() {
    const registro: Passo[] = [];
    const anota = (texto: string, estado: Passo["estado"] = "ok") => {
      registro.push({ texto, estado });
      setPassos([...registro]);
    };

    setRodando(true);
    setPassos([]);

    // 1. quem é aqui
    const mc = await procurar();
    const { data: rs } = await supabase.rpc("lead_por_whatsapp", { p_fone: fone });
    anota(rs ? `Na Ressoar: ${(rs as NaRessoa).nome ?? "(sem nome)"}`
             : "Na Ressoar: não existe ainda", rs ? "ok" : "info");

    if (!mc || mc.erro) {
      anota(mc?.erro ?? "não deu para consultar o ManyChat", "erro");
      setRodando(false); return;
    }
    anota(`Telefone acertado para ${mc.formatado}`, "info");

    // 2. rodar a regra do produto
    if (!produto) { anota("escolha o produto", "erro"); setRodando(false); return; }
    const { data, error } = await supabase.rpc("testar_regra_produto", {
      p_nome: nome.trim() || null, p_whatsapp: fone.trim(),
      p_email: null, p_produto_id: Number(produto),
    });
    if (error) { anota(error.message, "erro"); setRodando(false); return; }
    const d = data as Record<string, any>;
    if (!d?.ok) { anota(d?.erro ?? "não rodou", "erro"); setRodando(false); return; }
    anota(`Contato: ${d.como}`);
    anota(d.resultado?.lista ? "Entrou na lista do produto" : "Produto sem lista configurada",
          d.resultado?.lista ? "ok" : "info");
    anota(d.resultado?.turma ? `Tag de turma aqui: ${d.resultado.turma}` : "Sem tag de turma",
          d.resultado?.turma ? "ok" : "info");
    anota(d.resultado?.manychat
            ? `Mandado ao ManyChat: ${d.resultado.manychat}`
            : "Produto sem tag do ManyChat — configure em Vendas",
          d.resultado?.manychat ? "ok" : "erro");

    // 3. como ficou
    await new Promise((r) => setTimeout(r, 2500));   // o ManyChat leva um instante
    const fim = await procurar();
    anota(fim?.existe
      ? `Agora tem ${fim.assinante.tags.length} tag(s) no ManyChat`
      : "Ainda não aparece no ManyChat — veja o passo que falhou acima",
      fim?.existe ? "ok" : "erro");
    setRodando(false);
  }

  async function marcar(tag: string, remover: boolean) {
    if (!assinante) return;
    setRodando(true);
    setMensagemTagUsuario(null);
    try {
      const d = await chamar(remover
        ? { acao: "desmarcar", manychat_id: String(assinante.id), tag }
        : { manychat_id: String(assinante.id), tag, criar: false });
      if (!d.ok) {
        setMensagemTagUsuario({ texto: d.erro ?? d.motivo ?? "A operação não foi concluída.", estado: "erro" });
        return;
      }
      await new Promise((r) => setTimeout(r, 1200));
      await procurar();
      setMensagemTagUsuario({
        texto: remover ? `Tag “${tag}” removida desse usuário.` : `Tag “${tag}” aplicada nesse usuário.`,
        estado: "ok",
      });
    } catch {
      setMensagemTagUsuario({ texto: "Não deu para concluir a operação no ManyChat.", estado: "erro" });
    } finally {
      setRodando(false);
    }
  }

  async function criarTag() {
    if (!novaTag.trim()) return;
    setTagEmAcao(-1);
    setMensagemTags(null);
    const nomeTag = novaTag.trim();
    try {
      const d = await chamar({ acao: "criar_tag", tag: nomeTag });
      if (d.ok) {
        setNovaTag("");
        await carregarTags();
        setMensagemTags({ texto: d.mensagem ?? `Tag “${nomeTag}” criada.`, estado: "ok" });
      } else {
        setMensagemTags({ texto: d.erro ?? "Não deu para criar a tag.", estado: "erro" });
      }
    } catch {
      setMensagemTags({ texto: "Não deu para criar a tag.", estado: "erro" });
    } finally {
      setTagEmAcao(null);
    }
  }

  async function confirmarExclusaoTag() {
    const t = tagParaExcluir;
    if (!t) return;
    setTagEmAcao(t.id);
    setMensagemTags(null);
    try {
      const d = await chamar({ acao: "excluir_tag", tag_id: t.id, tag: t.name });
      if (!d.ok) {
        setMensagemTags({ texto: d.erro ?? "Não deu para excluir a tag.", estado: "erro" });
        return;
      }
      if (tagAvulsa === t.name) setTagAvulsa("");
      await carregarTags();
      if (assinante) await procurar();
      setMensagemTags({ texto: d.mensagem ?? `Tag “${t.name}” excluída.`, estado: "ok" });
      setTagParaExcluir(null);
    } catch {
      setMensagemTags({ texto: "Não deu para excluir a tag.", estado: "erro" });
    } finally {
      setTagEmAcao(null);
    }
  }

  const cor = (e: Passo["estado"]) =>
    e === "erro" ? "var(--perigo)" : e === "info" ? "var(--texto2)" : "var(--marca)";
  const tagsFiltradas = tags.filter((t) =>
    !filtro.trim() || t.name.toLowerCase().includes(filtro.toLowerCase()));

  return (
    <div>
      <h1>ManyChat</h1>
      <div className="sub">
        Gerencie pessoas e tags do ManyChat. A busca de pessoa é sempre pelo WhatsApp.
      </div>

      {erroGeral && <div className="aviso">{erroGeral}</div>}

      {/* ---------------- pessoas ---------------- */}
      <div className="caixa">
        <h2>Pessoas no ManyChat
          <Ajuda>
            A consulta usa somente o número completo do WhatsApp. O nome não participa da
            busca; ele é usado apenas quando você cria um usuário novo.
          </Ajuda>
        </h2>

        <div style={{ marginTop: 12 }}>
          <div>
            <label>WhatsApp
              <Ajuda>
                DDI + DDD (sem o zero) + número, tudo junto: <b>5551999990000</b>.
                Pode colar com pontuação que o sistema limpa — mas telefone fixo é
                recusado, porque fixo não tem WhatsApp.
              </Ajuda>
            </label>
            <input value={fone} placeholder="5551999990000"
              onChange={(e) => {
                setFone(e.target.value);
                setProcurou(false);
                setConsultaManyChatOk(false);
                setAssinante(null);
                setNaRessoa(null);
                setMensagemContato(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && buscarUsuario()} />
          </div>
        </div>

        <div className="linha" style={{ marginTop: 16 }}>
          <button className="primario" style={{ flex: "0 0 auto" }}
            onClick={buscarUsuario} disabled={acaoContato || !fone.trim()}>
            {acaoContato ? "aguarde…" : "Buscar por WhatsApp"}
          </button>
        </div>

        {mensagemContato && (
          <div className="aviso" style={{ marginTop: 14, color: cor(mensagemContato.estado) }}>
            {mensagemContato.texto}
          </div>
        )}

        {procurou && (
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--borda)" }}>
            <h3 style={{ margin: "0 0 12px" }}>Resultado da busca</h3>
          <div style={{ display: "grid", gap: 16,
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div>
              <b>Na Ressoar</b>
              {naRessoa ? (
                <div style={{ marginTop: 6 }}>
                  <div>{naRessoa.nome || <i>sem nome</i>}</div>
                  <div className="sub" style={{ marginTop: 2 }}>{naRessoa.whatsapp}</div>
                </div>
              ) : <div className="sub" style={{ marginTop: 6 }}>não existe aqui ainda</div>}
            </div>

            <div>
              <b>No ManyChat</b>
              {assinante ? (
                <div style={{ marginTop: 6 }}>
                  <div>{assinante.nome || <i>sem nome</i>}</div>
                  <div className="sub" style={{ margin: "2px 0 8px" }}>
                    ID do contato no ManyChat: {assinante.id} · {descreverStatusManyChat(assinante.status)}
                  </div>
                </div>
              ) : (
                <div className="sub" style={{ marginTop: 6 }}>
                  {consultaManyChatOk ? "não existe lá ainda" : "consulta não concluída"}
                </div>
              )}
            </div>
          </div>

            {consultaManyChatOk && !assinante && (
              <div className="aviso" style={{ margin: "18px 0 0", borderColor: "var(--ac-ambar)" }}>
                <h3 style={{ margin: "0 0 5px" }}>Criar este usuário no ManyChat</h3>
                <div className="sub" style={{ marginBottom: 10 }}>
                  O WhatsApp não foi encontrado. Confirme o nome e crie o usuário agora.
                </div>
                <div className="linha">
                  <input value={nome} placeholder="Nome do usuário"
                    onChange={(e) => setNome(e.target.value)} />
                  <button className="primario" style={{ flex: "0 0 auto" }} onClick={criarUsuario}
                    disabled={acaoContato || !fone.trim() || !nome.trim()}>
                    {acaoContato ? "Criando…" : "Criar usuário no ManyChat"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------------- automação ---------------- */}
      <div className="caixa">
        <h2>Testar automação de produto
          <Ajuda>
            Usa o WhatsApp informado acima e percorre o mesmo caminho de uma compra,
            inclusive lista, turma e tag configurada no produto.
          </Ajuda>
        </h2>
        <div className="sub" style={{ marginBottom: 12 }}>
          WhatsApp usado: <b>{fone.trim() || "informe o número no bloco Pessoas"}</b>
        </div>

        <Escolher valor={produto} aoMudar={setProduto} vazio="— escolher o produto —"
          opcoes={produtos.map((p) => ({
            valor: p.id,
            rotulo: p.apelido,
            detalhe: p.tag_manychat
              ? `→ ${p.tag_manychat}`
              : p.tag_manychat_turma
                ? "→ tag semanal da turma"
                : "(sem tag configurada)",
          }))} />
        {produto && !produtoTemTag() && (
          <div className="aviso" style={{ marginTop: 8 }}>
            Este produto não tem tag do ManyChat. Configure em <b>Vendas</b>, na regra dele.
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="primario" onClick={rodarFluxo}
            disabled={rodando || !fone.trim() || !produto}>
            {rodando ? "executando…" : "Testar regra do produto"}
          </button>
        </div>

        {!!passos.length && (
          <ol style={{ marginTop: 16, paddingLeft: 20, lineHeight: 2 }}>
            {passos.map((p, i) => (
              <li key={i} style={{ color: cor(p.estado) }}>
                {p.estado === "erro" ? "✕ " : p.estado === "ok" ? "✓ " : "· "}{p.texto}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ---------------- todas as tags ---------------- */}
      <div className="caixa">
        <h2 style={{ marginTop: 0 }}>Tags</h2>

        <div>
          <h3 style={{ margin: "0 0 6px" }}>Tags do usuário encontrado
            <Ajuda>
              Aplicar ou remover aqui muda a tag <b>no ManyChat</b>, na hora — e aplicar uma
              tag é o que dispara o fluxo de mensagem de lá. Não é um rascunho: a pessoa pode
              receber WhatsApp por causa deste clique.
              <br /><br />
              As tags daqui e as do Ressoar são listas separadas: mexer numa não mexe na outra.
            </Ajuda>
          </h3>
          {!procurou && (
            <div className="sub">Busque um usuário pelo WhatsApp para aplicar ou remover tags.</div>
          )}
          {procurou && consultaManyChatOk && !assinante && (
            <div className="sub">Esse WhatsApp ainda não possui usuário no ManyChat.</div>
          )}
          {assinante && (
            <>
              <div className="sub" style={{ marginBottom: 10 }}>
                <b>{assinante.nome || "sem nome"}</b> · {fone}
              </div>
              <div style={{ marginBottom: 10 }}>
                {assinante.tags.length
                  ? assinante.tags.map((t) => (
                      <span key={t} className="etiqueta et-roxa"
                        style={{ marginRight: 5, marginBottom: 5, display: "inline-block" }}>
                        {t}
                        <button title="remover esta tag" disabled={rodando}
                          onClick={() => marcar(t, true)}
                          style={{
                            marginLeft: 6, padding: 0, width: 15, height: 15, borderRadius: "50%",
                            border: "none", background: "rgba(0,0,0,.25)", color: "inherit",
                            cursor: "pointer", fontSize: 10, lineHeight: "13px",
                          }}>×</button>
                      </span>
                    ))
                  : <span className="sub">Esse usuário ainda não possui tags.</span>}
              </div>
              <div className="linha">
                <Escolher valor={tagAvulsa} style={{ flex: 2 }} vazio="— escolher a tag —"
                  aoMudar={setTagAvulsa}
                  opcoes={tags.map((t) => ({ valor: t.name, rotulo: t.name }))} />
                <button style={{ flex: "0 0 auto" }} disabled={!tagAvulsa || rodando}
                  onClick={() => marcar(tagAvulsa, false)}>Aplicar</button>
                <button style={{ flex: "0 0 auto" }} disabled={!tagAvulsa || rodando}
                  onClick={() => marcar(tagAvulsa, true)}>Remover</button>
              </div>
            </>
          )}
          {mensagemTagUsuario && (
            <div className="aviso" style={{ marginTop: 12, color: cor(mensagemTagUsuario.estado) }}>
              {mensagemTagUsuario.texto}
            </div>
          )}
        </div>

        <div style={{ margin: "22px 0 18px", borderTop: "1px solid var(--borda)" }} />

        <div className="linha" style={{ alignItems: "center" }}>
          <h3 style={{ margin: 0, flex: 1 }}>
            Tags da conta <span className="contagem">({tags.length})</span>
            <Ajuda>
              São as tags do ManyChat, não as da Ressoar. É por elas que os fluxos de lá
              disparam — por isso a tag precisa existir lá antes de a automação usá-la.
            </Ajuda>
          </h3>
          <button style={{ flex: "0 0 auto" }} onClick={() => setVerTags((v) => !v)}>
            {verTags ? "Esconder lista" : "Gerenciar tags"}
          </button>
        </div>

        <div className="sub" style={{ marginTop: 8 }}>
          Crie uma tag nova ou abra a lista para localizar e excluir uma tag da conta.
          <Ajuda>
            Criar a tag aqui <b>antes</b> de usá-la numa regra de produto ou num passo de
            automação é o caminho seguro: assim você já consegue pendurar o fluxo nela do lado
            do ManyChat. Tag criada só na hora do disparo nasce sem fluxo escutando, e a
            pessoa é marcada sem receber nada.
            <br /><br />
            Excluir remove a tag da conta e de todos os usuários lá, e não tem desfazer.
          </Ajuda>
        </div>

        <div className="linha" style={{ marginTop: 12 }}>
          <input value={novaTag} placeholder="criar uma tag nova"
            onChange={(e) => setNovaTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criarTag()} />
          <button style={{ flex: "0 0 auto" }} onClick={criarTag}
            disabled={!novaTag.trim() || tagEmAcao !== null}>
            {tagEmAcao === -1 ? "Criando…" : "Criar tag"}
          </button>
        </div>

        {mensagemTags && (
          <div className="aviso" style={{ marginTop: 12, color: cor(mensagemTags.estado) }}>
            {mensagemTags.texto}
          </div>
        )}

        {tagParaExcluir && (
          <div className="aviso" style={{ marginTop: 12, borderColor: "var(--perigo)" }}>
            <b>Excluir a tag “{tagParaExcluir.name}”?</b>
            <div className="sub" style={{ marginTop: 5 }}>
              Ela será removida da conta e de todos os usuários. Esta ação não pode ser desfeita.
            </div>
            <div className="linha" style={{ marginTop: 10 }}>
              <button style={{ flex: "0 0 auto" }} disabled={tagEmAcao !== null}
                onClick={() => setTagParaExcluir(null)}>Cancelar</button>
              <button className="perigo" style={{ flex: "0 0 auto" }}
                disabled={tagEmAcao !== null} onClick={confirmarExclusaoTag}>
                {tagEmAcao === tagParaExcluir.id ? "Excluindo…" : "Confirmar exclusão"}
              </button>
            </div>
          </div>
        )}

        {verTags && (
          <>
            <input value={filtro} placeholder="buscar tag pelo nome…" style={{ marginTop: 12 }}
              onChange={(e) => setFiltro(e.target.value)} />
            <div style={{ marginTop: 10, maxHeight: 260, overflowY: "auto" }}>
              {tagsFiltradas.map((t) => (
                <div key={t.id} className="sub"
                  style={{
                    padding: "7px 0", borderBottom: "1px solid var(--borda)",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                  <span style={{ flex: 1 }}>{t.name}</span>
                  <button className="perigo" style={{ flex: "0 0 auto", padding: "5px 10px" }}
                    disabled={tagEmAcao !== null} onClick={() => setTagParaExcluir(t)}>
                    {tagEmAcao === t.id ? "Excluindo…" : "Excluir"}
                  </button>
                </div>
              ))}
              {!tagsFiltradas.length && <div className="sub">nada com esse texto.</div>}
            </div>
          </>
        )}
      </div>

      {/* ---------------- banidos ---------------- */}
      <div className="caixa">
        <h2>Banidos do ManyChat <span className="contagem">({banidos.length})</span>
          <Ajuda>
            Números desta lista <b>nunca recebem tag</b> no ManyChat — nem por compra, nem
            por automação, nem pela tela. E o sistema vigia: a cada 10 minutos procura cada
            número lá; se o usuário existir, derruba os opt-ins que a API deixa e aplica a
            tag <b>ESC WHATSAPP</b>.
            <br /><br />
            A <b>exclusão de verdade</b> a API do ManyChat não oferece — quando a coluna
            “última ação” disser que o usuário foi encontrado, exclua-o à mão na conta de lá.
            <br /><br />
            Somente admin adiciona ou remove números daqui.
          </Ajuda>
        </h2>

        <div className="linha" style={{ marginTop: 12 }}>
          <input value={banNome} placeholder="nome (opcional)"
            onChange={(e) => setBanNome(e.target.value)} />
          <input value={banFone} placeholder="5511999990000"
            onChange={(e) => setBanFone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && adicionarBanido()} />
          <button className="primario" style={{ flex: "0 0 auto" }}
            onClick={adicionarBanido} disabled={banAcao || !banFone.trim()}>
            {banAcao ? "aguarde…" : "Banir número"}
          </button>
          <button style={{ flex: "0 0 auto" }} onClick={verificarBanidosAgora}
            disabled={banAcao || !banidos.length}>
            Verificar agora
          </button>
        </div>

        {mensagemBanidos && (
          <div className="aviso" style={{ marginTop: 12, color: cor(mensagemBanidos.estado) }}>
            {mensagemBanidos.texto}
          </div>
        )}

        {banidoParaRemover && (
          <div className="aviso" style={{ marginTop: 12, borderColor: "var(--perigo)" }}>
            <b>Tirar {banidoParaRemover.nome || banidoParaRemover.whatsapp} da lista?</b>
            <div className="sub" style={{ marginTop: 5 }}>
              O número {banidoParaRemover.whatsapp} volta a poder receber tags — inclusive
              pelas automações, já na próxima compra.
            </div>
            <div className="linha" style={{ marginTop: 10 }}>
              <button style={{ flex: "0 0 auto" }} disabled={banAcao}
                onClick={() => setBanidoParaRemover(null)}>Cancelar</button>
              <button className="perigo" style={{ flex: "0 0 auto" }}
                disabled={banAcao} onClick={confirmarRemocaoBanido}>Confirmar</button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          {banidos.map((b) => (
            <div key={b.whatsapp}
              style={{
                padding: "10px 0", borderBottom: "1px solid var(--borda)",
                display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap",
              }}>
              <div style={{ flex: "1 1 220px" }}>
                <b>{b.nome || <i>sem nome</i>}</b>
                <div className="sub" style={{ marginTop: 2 }}>
                  {b.whatsapp}
                  {b.manychat_id ? ` · assinante ${b.manychat_id}` : ""}
                </div>
              </div>
              <div className="sub" style={{ flex: "2 1 260px" }}>
                {b.ultima_verificacao
                  ? <>vigiado {new Date(b.ultima_verificacao).toLocaleString("pt-BR")}
                      <br />{b.ultima_acao}</>
                  : "ainda não vigiado — aguarde o próximo ciclo ou clique em Verificar agora"}
              </div>
              <button className="perigo" style={{ flex: "0 0 auto", padding: "5px 10px" }}
                disabled={banAcao} onClick={() => setBanidoParaRemover(b)}>
                Remover
              </button>
            </div>
          ))}
          {!banidos.length && (
            <div className="sub">Nenhum número banido.</div>
          )}
        </div>
      </div>
    </div>
  );
}
