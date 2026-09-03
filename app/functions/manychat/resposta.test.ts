import assert from "node:assert/strict";
import test from "node:test";

async function carregarContrato() {
  try {
    return await import("./resposta.ts");
  } catch {
    assert.fail("falta o contrato que valida a resposta real do ManyChat");
  }
}

test("não trata corpo de erro do ManyChat como sucesso só porque o HTTP foi 200", async () => {
  const { respostaManyChatOk } = await carregarContrato();
  assert.equal(respostaManyChatOk(true, { status: "error", message: "falhou" }), false);
});

test("recusa assinante apagado como destino de tag", async () => {
  const { assinantePodeReceberTag } = await carregarContrato();
  assert.equal(assinantePodeReceberTag({ id: 123, status: "deleted" }), false);
  assert.equal(assinantePodeReceberTag({ id: 123, status: "active" }), true);
});

test("envia o WhatsApp no formato internacional exigido na criação", async () => {
  const { telefoneWhatsAppManyChat } = await carregarContrato();
  assert.equal(telefoneWhatsAppManyChat("5551999999999"), "+5551999999999");
});

test("confirma a tag pelo estado devolvido pelo ManyChat", async () => {
  const { assinanteTemTag } = await carregarContrato();
  assert.equal(
    assinanteTemTag({ tags: [{ name: "BLACK_2026_INSCRITOS" }] }, "BLACK_2026_INSCRITOS"),
    true,
  );
  assert.equal(assinanteTemTag({ tags: [] }, "BLACK_2026_INSCRITOS"), false);
});
