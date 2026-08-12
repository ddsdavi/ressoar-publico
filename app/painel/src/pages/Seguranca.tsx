import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import Ajuda from "../components/Ajuda";

type Log = {
  id: number; user_id: string | null; evento: string;
  detalhe: Record<string, unknown>; ip: string | null; created_at: string;
};

const ROTULOS: Record<string, [string, string]> = {
  troca_email_codigo_enviado: ["Código de troca de e-mail enviado", "et-amarela"],
  troca_email_codigo_errado: ["Código de troca digitado errado", "et-vermelha"],
  troca_email_senha_incorreta: ["Senha incorreta ao trocar e-mail", "et-vermelha"],
  troca_email_bloqueada_tentativas: ["Troca de e-mail bloqueada por tentativas", "et-vermelha"],
  troca_email_concluida: ["E-mail de acesso alterado", "et-verde"],
  troca_email_cancelada: ["Troca de e-mail cancelada", "et-cinza"],
  exclusao_codigo_enviado: ["Código de exclusão de conta enviado", "et-amarela"],
  exclusao_codigo_errado: ["Código de exclusão digitado errado", "et-vermelha"],
  exclusao_senha_incorreta: ["Senha incorreta ao excluir conta", "et-vermelha"],
  conta_excluida_pelo_titular: ["Conta excluída pelo titular", "et-vermelha"],
};

export default function Seguranca() {
  const { ehAdmin } = useSessao();
  const [logs, setLogs] = useState<Log[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const [l, u] = await Promise.all([
        supabase.from("log_seguranca").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("usuarios_ressoar").select("user_id, email"),
      ]);
      setLogs((l.data as Log[]) ?? []);
      setEmails(Object.fromEntries((u.data ?? []).map((x) => [x.user_id, x.email])));
    })();
  }, []);

  if (!ehAdmin) return <div><h1>Registro de segurança</h1><div className="aviso">Somente admins.</div></div>;

  return (
    <div>
      <h1>Registro de segurança</h1>
      <div className="sub">Tudo que acontece de sensível nas contas: trocas de e-mail, tentativas erradas e exclusões.
        <Ajuda>
          É o registro das <b>contas de acesso</b> — não da operação. O que aconteceu com um
          lead está na linha do tempo dele; quem importou ou exportou está em{" "}
          <b>Importações e exportações</b>.
          <br /><br />
          Vale ficar de olho em código digitado errado várias vezes seguidas e em senha
          incorreta na troca de e-mail: é o desenho de alguém tentando tomar uma conta.
          Mostra os 200 eventos mais recentes.
        </Ajuda>
      </div>

      <div className="caixa">
        <table>
          <thead><tr><th>Quando</th><th>Pessoa</th><th>Evento</th><th>Detalhe</th></tr></thead>
          <tbody>
            {logs.map((l) => {
              const [rotulo, cor] = ROTULOS[l.evento] ?? [l.evento, "et-cinza"];
              return (
                <tr key={l.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(l.created_at).toLocaleString("pt-BR")}</td>
                  <td>{l.user_id ? (emails[l.user_id] ?? "conta removida") : "—"}</td>
                  <td><span className={`etiqueta ${cor}`}>{rotulo}</span></td>
                  <td style={{ fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--ac-texto2)" }}>
                    {Object.entries(l.detalhe ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}
                  </td>
                </tr>
              );
            })}
            {!logs.length && <tr><td colSpan={4} style={{ color: "var(--ac-texto2)" }}>Nenhum evento de segurança registrado ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
