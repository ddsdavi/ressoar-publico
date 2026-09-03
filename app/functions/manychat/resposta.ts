type Envelope = Record<string, unknown>;

const conteudo = (valor: unknown): Envelope => {
  if (!valor || typeof valor !== "object") return {};
  const objeto = valor as Envelope;
  const data = objeto.data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as Envelope
    : objeto;
};

// A API do ManyChat pode responder HTTP 200 e ainda declarar erro no corpo.
// Por isso o transporte e o contrato da API precisam concordar.
export function respostaManyChatOk(httpOk: boolean, dados: unknown): boolean {
  if (!httpOk) return false;
  if (!dados || typeof dados !== "object") return false;
  const status = (dados as Envelope).status;
  return typeof status === "string" && status.toLowerCase() === "success";
}

export function assinantePodeReceberTag(dados: unknown): boolean {
  const assinante = conteudo(dados);
  const status = String(assinante.status ?? "").toLowerCase();
  const id = assinante.id;
  return id != null && String(id) !== "" && status !== "deleted";
}

export function assinanteTemTag(dados: unknown, tag: string): boolean {
  const assinante = conteudo(dados);
  const tags = Array.isArray(assinante.tags) ? assinante.tags : [];
  return tags.some((item) =>
    !!item && typeof item === "object" &&
    String((item as Envelope).name ?? "") === tag
  );
}

export function telefoneWhatsAppManyChat(telefone: string): string {
  const digitos = telefone.replace(/\D+/g, "");
  return digitos ? `+${digitos}` : "";
}
