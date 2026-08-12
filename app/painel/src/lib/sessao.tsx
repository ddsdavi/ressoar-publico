import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Papel = "admin" | "terapeuta" | "assistente";
export type Perfil = {
  user_id: string; email: string; nome: string | null;
  papel: Papel; status: "pendente" | "aprovado" | "bloqueado";
  admin_mestre?: boolean;
  avatar_url?: string | null;
};

export function saudacao(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export function primeiroNome(p: { nome?: string | null; email?: string } | null): string {
  const n = (p?.nome ?? "").trim();
  if (n) return n.split(/\s+/)[0];
  return (p?.email ?? "").split("@")[0];
}

type Ctx = {
  sessao: Session | null;
  perfil: Perfil | null;
  carregando: boolean;
  ehAdmin: boolean;
  podeOperar: boolean;    // admin ou terapeuta — dispara e mexe no motor
  podePreparar: boolean;  // + assistente — cria e edita a operação
  sair: () => Promise<void>;
  recarregar: () => Promise<void>;
};

const SessaoCtx = createContext<Ctx>(null as never);
export const useSessao = () => useContext(SessaoCtx);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function buscarPerfil(s: Session | null) {
    if (!s) { setPerfil(null); return; }
    const { data } = await supabase.from("usuarios_ressoar")
      .select("user_id, email, nome, papel, status, admin_mestre, avatar_url").eq("user_id", s.user.id).maybeSingle();
    setPerfil((data as Perfil) ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSessao(data.session);
      await buscarPerfil(data.session);
      setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSessao(s);
      await buscarPerfil(s);
      setCarregando(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const papel = perfil?.status === "aprovado" ? perfil.papel : null;

  return (
    <SessaoCtx.Provider value={{
      sessao, perfil, carregando,
      ehAdmin: papel === "admin",
      podeOperar: papel === "admin" || papel === "terapeuta",
      podePreparar: papel === "admin" || papel === "terapeuta" || papel === "assistente",
      sair: async () => { await supabase.auth.signOut(); },
      recarregar: async () => { await buscarPerfil(sessao); },
    }}>
      {children}
    </SessaoCtx.Provider>
  );
}
