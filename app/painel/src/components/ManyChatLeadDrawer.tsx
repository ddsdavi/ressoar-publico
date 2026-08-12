import { useCallback, useEffect, useState } from "react";
import Escolher from "./Escolher";
import {
  chamarManyChat,
  descreverStatusManyChat,
  type ManyChatAssinante,
  type ManyChatTag,
} from "../lib/manychat";

export type LeadParaManyChat = {
  lead_id: string;
  nome: string | null;
  email: string | null;
  whatsapp: string | null;
};

type Props = {
  lead: LeadParaManyChat | null;
  ehAdmin: boolean;
  onClose: () => void;
};

type Estado = "carregando" | "encontrado" | "ausente" | "sem_whatsapp" | "erro";
type Mensagem = { texto: string; erro?: boolean } | null;

export default function ManyChatLeadDrawer({ lead, ehAdmin, onClose }: Props) {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [assinante, setAssinante] = useState<ManyChatAssinante | null>(null);
  const [tags, setTags] = useState<ManyChatTag[]>([]);
  const [tag, setTag] = useState("");
  const [nomeCriacao, setNomeCriacao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  const carregar = useCallback(async (alvo: LeadParaManyChat) => {
    setMensagem(null);
    setTag("");
    setAssinante(null);
    if (!alvo.whatsapp?.trim()) {
      setTags([]);
      setEstado("sem_whatsapp");
      return;
    }

    setEstado("carregando");
    try {
      const [pessoa, listaTags] = await Promise.all([
        chamarManyChat({ acao: "procurar", whatsapp: alvo.whatsapp }),
        chamarManyChat({ acao: "tags" }),
      ]);
      if (!pessoa.ok) {
        setEstado("erro");
        setMensagem({ texto: pessoa.erro ?? "Não deu para consultar o ManyChat.", erro: true });
        return;
      }
      setTags(listaTags.ok ? (listaTags.tags ?? []) : []);
      setAssinante(pessoa.existe ? pessoa.assinante : null);
      setEstado(pessoa.existe ? "encontrado" : "ausente");
    } catch {
      setEstado("erro");
      setMensagem({ texto: "Não deu para consultar o ManyChat.", erro: true });
    }
  }, []);

  useEffect(() => {
    if (!lead) return;
    setNomeCriacao(lead.nome?.trim() || lead.email?.split("@")[0] || "");
    void carregar(lead);
  }, [lead, carregar]);

  if (!lead) return null;

  async function criar() {
    if (!lead?.whatsapp || !nomeCriacao.trim()) return;
    setOcupado(true);
    setMensagem(null);
    try {
      const resposta = await chamarManyChat({
        acao: "criar",
        lead_id: lead.lead_id,
        whatsapp: lead.whatsapp,
        nome: nomeCriacao.trim(),
      });
      if (!resposta.ok) {
        setMensagem({ texto: resposta.erro ?? "Não deu para criar o usuário no ManyChat.", erro: true });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await carregar(lead);
      setMensagem({
        texto: resposta.criado
          ? "Usuário criado no ManyChat. Agora você pode aplicar uma tag."
          : "O usuário já existia no ManyChat e foi localizado.",
      });
    } catch {
      setMensagem({ texto: "Não deu para criar o usuário no ManyChat.", erro: true });
    } finally {
      setOcupado(false);
    }
  }

  async function alterarTag(remover: boolean) {
    if (!lead || !assinante || !tag) return;
    setOcupado(true);
    setMensagem(null);
    try {
      const resposta = await chamarManyChat(remover
        ? {
            acao: "desmarcar",
            lead_id: lead.lead_id,
            manychat_id: String(assinante.id),
            tag,
          }
        : {
            lead_id: lead.lead_id,
            manychat_id: String(assinante.id),
            tag,
            criar: false,
          });
      if (!resposta.ok) {
        setMensagem({
          texto: resposta.erro ?? resposta.motivo ?? "A operação não foi concluída.",
          erro: true,
        });
        return;
      }
      const tagAlterada = tag;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await carregar(lead);
      setMensagem({ texto: remover ? `Tag “${tagAlterada}” removida.` : `Tag “${tagAlterada}” aplicada.` });
    } catch {
      setMensagem({ texto: "Não deu para alterar a tag no ManyChat.", erro: true });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="gaveta" role="dialog" aria-modal="true" aria-label={`ManyChat de ${lead.nome || lead.email || "lead"}`}>
      <button className="fechar" onClick={onClose} aria-label="Fechar">✕</button>
      <div className="mc-cabecalho">
        <span className="mc-sinal" aria-hidden="true" />
        <div>
          <h2>ManyChat</h2>
          <div className="sub">{lead.nome || "Lead sem nome"} · {lead.whatsapp || "sem WhatsApp"}</div>
        </div>
      </div>

      {estado === "carregando" && (
        <div className="caixa mc-estado"><b>Buscando no ManyChat…</b></div>
      )}

      {estado === "sem_whatsapp" && (
        <div className="aviso">
          <b>Este lead não tem WhatsApp.</b>
          <div className="sub" style={{ marginTop: 5 }}>
            Adicione o número na Ressoar antes de procurar ou criar o usuário no ManyChat.
          </div>
        </div>
      )}

      {estado === "ausente" && (
        <div className="caixa mc-estado mc-ausente">
          <span className="etiqueta et-amarela">Não encontrado</span>
          <h2>Este lead ainda não existe no ManyChat</h2>
          <div className="sub">Crie o usuário com o mesmo WhatsApp cadastrado na Ressoar.</div>
          {ehAdmin ? (
            <>
              <label>Nome no ManyChat</label>
              <input value={nomeCriacao} onChange={(e) => setNomeCriacao(e.target.value)}
                placeholder="Nome do usuário" />
              <button className="primario" style={{ marginTop: 12 }} onClick={criar}
                disabled={ocupado || !nomeCriacao.trim()}>
                {ocupado ? "Criando…" : "Criar usuário no ManyChat"}
              </button>
            </>
          ) : (
            <div className="aviso" style={{ marginTop: 12 }}>
              Somente administradores podem criar usuários no ManyChat.
            </div>
          )}
        </div>
      )}

      {estado === "encontrado" && assinante && (
        <>
          <div className="caixa mc-estado">
            <span className="etiqueta et-verde">Encontrado</span>
            <h2>{assinante.nome || lead.nome || "Usuário sem nome"}</h2>
            <div className="sub">
              ID do contato no ManyChat: {assinante.id} · {descreverStatusManyChat(assinante.status)}
            </div>
          </div>

          <div className="caixa">
            <h2>Tags atuais</h2>
            <div className="mc-tags-atuais">
              {assinante.tags.length
                ? assinante.tags.map((nomeTag) => (
                    <span key={nomeTag} className="etiqueta et-roxa">{nomeTag}</span>
                  ))
                : <span className="sub">nenhuma tag aplicada</span>}
            </div>

            <label>Alterar tag</label>
            <Escolher valor={tag} aoMudar={setTag} vazio="— escolher uma tag —"
              opcoes={tags.map((item) => ({ valor: item.name, rotulo: item.name }))} />
            <div className="linha" style={{ marginTop: 12 }}>
              <button className="primario" disabled={!tag || ocupado}
                onClick={() => alterarTag(false)}>
                {ocupado ? "Aguarde…" : "Aplicar tag"}
              </button>
              <button disabled={!tag || ocupado} onClick={() => alterarTag(true)}>
                Remover tag
              </button>
            </div>
          </div>
        </>
      )}

      {mensagem && (
        <div className="aviso" style={{ color: mensagem.erro ? "var(--perigo)" : "var(--marca)" }}>
          {mensagem.texto}
        </div>
      )}
    </div>
  );
}
