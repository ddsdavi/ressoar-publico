# O dia a dia

## Descadastro — sai em todo e-mail, automaticamente

Você não precisa lembrar de colocar: **todo e-mail que sai leva**, injetado pelo motor:

1. **Link "Não quero mais receber estes e-mails"** no rodapé
2. **Endereço físico** da empresa (exigência de lei anti-spam)
3. **Cabeçalho de descadastro de 1 clique** — o botão "Cancelar inscrição" que o Gmail
   mostra ao lado do remetente (exigência do Gmail e do Yahoo para quem envia em massa)
4. **Pixel de abertura** e links com rastreio de clique

Quando a pessoa clica, ela é marcada como descadastrada em **todas** as listas e entra na
**supressão** — nunca mais recebe nada, aconteça o que acontecer.

> Isso não é só conformidade: taxa de reclamação de spam acima de 0,3% derruba a reputação
> do seu domínio e o Gmail passa a jogar tudo na caixa de spam. O descadastro fácil é o que
> evita que a pessoa clique em "isto é spam".

---

## Criar e disparar uma campanha

1. **Mensagens → + Nova mensagem** → escreva no editor visual (arrastar e soltar)
   - use `{{nome}}` no assunto ou no texto para chamar pelo primeiro nome
2. **Campanhas → + Nova campanha**
   - escolha a mensagem
   - escolha quem recebe: **listas** ou um **segmento salvo**
   - **Disparar agora** ou informe data/hora para agendar
3. Acompanhe em **Campanhas → Relatório**: quem abriu, cliques por link, bounces, descadastros

Só recebe quem está **ativo** na lista. Descadastrados, bounces e suprimidos são pulados
automaticamente — e aparecem no relatório como "suprimidos", para você saber que existiram.

---

## Segmentar

**Filtros rápidos** (topo de Leads): lista, status na lista, tag, com/sem WhatsApp, busca.

**Segmento avançado** (botão 🧩): combine quantas condições quiser com **E** / **OU**:
está numa lista (com status), tem/não tem tag, com/sem WhatsApp, texto, domínio do e-mail,
participou de evento, campo personalizado, **abriu/clicou nos últimos N dias**, não suprimido.

- **Contar** mostra quantos atendem, na hora
- **Salvar** deixa o segmento disponível nas Campanhas

---

## Importar leads

**Leads → Importar CSV.** Aceita `;`, `,` ou tabulação. O sistema adivinha as colunas pelo
cabeçalho e você confirma.

- Quem já existe (mesmo WhatsApp ou e-mail) é **atualizado**, nunca duplicado
- Telefones ganham DDI 55 e números falsos são descartados
- Dá para inscrever todos numa lista e aplicar uma tag na mesma importação
  (isso **dispara as automações** correspondentes)

---

## Automações

**Gatilho** (entrou numa lista · ganhou uma tag · lead novo) → **passos** em ordem:
enviar e-mail, esperar (15 min a 7 dias), aplicar/remover tag, inscrever/desinscrever de
lista, chamar um webhook.

Automações novas **nascem desativadas** — você ativa quando estiver pronta.

> A chave-geral dos webhooks (em **API & Webhooks**) começa **desligada**, para não duplicar
> disparos enquanto o ActiveCampaign ainda estiver vivo.

---

## Usuários

**Admin → Usuários.** Cadastros novos nascem **Assistente** e **pendentes** — ninguém entra
sem liberação. Lá também está a tabela do que cada nível pode fazer.

**Admin → Registro de segurança:** trocas de e-mail, tentativas erradas de código e exclusões
de conta, com data e IP.

---

## Integrações (API e webhooks)

Tudo o que o painel faz, outro sistema pode fazer. Exemplos prontos em **API & Webhooks**:

```bash
# criar/atualizar contato
curl -X POST "$SUPABASE_URL/rest/v1/tabela_1_leads" \
  -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE" \
  -H "Prefer: resolution=merge-duplicates" \
  -d '{"email":"x@y.com","nome":"Fulana"}'

# aplicar tag (dispara automação)
curl -X POST "$SUPABASE_URL/rest/v1/lead_tags" \
  -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE" \
  -d '{"lead_fk":"UUID","tag_fk":65}'
```

**Captação com formulário** (landing page, construtor de página) — pública; a lista e a
tag vêm do cadastro do formulário, nunca do corpo:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/formulario" \
  -H "Content-Type: application/json" \
  -d '{"form_slug":"meu-formulario","email":"lead@email.com",
       "nome":"Fulana","whatsapp":"61999998888"}'
```

**Captação por API** (ManyChat, n8n, checkout próprio) — escolhe `lista_id`/`tag_id` no
corpo, por isso exige a **chave de captação** (Configurações → API e webhooks) no
cabeçalho `x-api-key` ou no campo `api_key`. Sem `form_slug` e sem a chave, o POST é
recusado (armadilha 37):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/formulario" \
  -H "Content-Type: application/json" -H "x-api-key: $CHAVE_CAPTACAO" \
  -d '{"email":"lead@email.com","nome":"Fulana","whatsapp":"61999998888",
       "lista_id":17,"tag_id":45}'
```

**Webhooks de saída:** cadastre a URL do seu n8n em **API & Webhooks** e escolha os eventos
(`lead_criado`, `lista_inscrita`, `tag_adicionada`, `lead_descadastrado`…). O Ressoar faz POST
com o contato completo.
