# 09 — Onde parei

Documento de passagem. Serve para quem pegar este projeto do zero — outra
sessão, outra conta, outra pessoa — saber em que pé está sem ter que
reconstituir a conversa.

Última atualização: 12/08/2026.

---

## Ressoa virou Ressoar, com o carro andando (12/08/2026)

O produto mudou de nome e o painel mudou de endereço, sem tirar nada do ar e
sem perder um dado sequer.

| | |
|---|---|
| Nome | **Ressoa → Ressoar** (tela, e-mails do sistema, documentação) |
| Painel | `ressoar.drapatriciadomingos.com.br` |
| Endereço antigo | **continua no ar**, servindo o mesmo painel — o Davi vai plugar outra coisa nele depois (a "Fase B" do plano) |

**Por que não houve janela de risco.** A pergunta que governou o desenho foi
*por onde entra dado novo, e algum desses caminhos passa pelo domínio?* A
resposta, conferida uma a uma: **nenhum**. Venda da Hotmart, formulário (tanto
o embutido em site de fora quanto a landing das Lives), pixel de abertura e
clique, descadastro, postbacks do Resend, ManyChat e o callback do Google
entram todos por `*.supabase.co`; o motor roda dentro do Postgres. O domínio
serve **só gente**: a equipe no painel e as páginas `/f/`. Por isso o endereço
novo entrou como **segundo domínio do mesmo projeto do Pages** — os dois
apontam para o mesmo painel e o mesmo banco ao mesmo tempo, e em nenhum
instante existiu um endereço fora do ar. Não houve migração de dados: o banco
e as funções nem sabem que o domínio mudou.

**A prova, medida no fim:** 47 eventos da Hotmart nas 4 horas da troca, **zero
sem processar**; 76 eventos do motor, **zero pendentes**; 13 leads novos; uma
compra aprovada às 14:46 processada normalmente. A base saiu de 13.453 para
13.459 leads durante o trabalho.

**O que foi publicado:** o painel (Cloudflare) e três Edge Functions —
`conta-email` (o cabeçalho dos e-mails de conta), `google-sheets` (o texto que
fecha o consentimento do Google) e `manychat` (a frase de consentimento que vai
**gravada no registro do assinante** lá, e por isso não era só comentário). As
outras oito funções mudaram só em comentário e seguem publicadas na versão
anterior: o código delas em produção é idêntico ao do repositório em tudo que
executa.

### O que NÃO mudou, de propósito

Renomear identificador é risco sem ganho — ninguém de fora vê. Ficaram como
estavam, e quem for procurar tem de procurar por eles:

- os **7 relógios do pg_cron** (`ressoar-processar-eventos`, `ressoar-fila-envios`…);
- a tabela **`usuarios_ressoar`**, a classe CSS **`.ressoar-form`** (já embutida em
  site de terceiro) e os tipos de arrasto `application/x-ressoa-*`;
- os nomes das **8 automações `[RESSOAR] …`** — e este tem um motivo forte: as
  migrações que as criam têm guarda **por nome**, então renomear a linha viva
  sem editar a guarda faria o instalador criar uma **duplicata ativa**;
- o projeto do Cloudflare Pages **`ressoa`** e o `ressoa-2zl.pages.dev` (alvo do
  deploy), os repositórios no GitHub, as variáveis `RESSOA_EMAIL_*` e o caminho
  do webhook no n8n.

No **código** (`app/`, `scripts/`, `supabase/`) sobraram **duas** ocorrências da
palavra antiga isolada, e as duas são corretas: o comentário em
`app/functions/google-sheets/index.ts` (que cita o nome do app **no Google
Cloud**, que não foi renomeado) e a docstring de `scripts/renomear_ressoar.py`
(que descreve a própria regra do renome). Quem varrer o repositório inteiro vai
achar mais do que isso, porque **esta seção do diário** fala do nome antigo o
tempo todo — a conta de "duas" vale para código, não para documentação. E o
script do renome **não pode ser rodado de novo**: ele tem trava pedindo
`--confirmo` justamente porque uma segunda passada reescreveria estes parágrafos
e a exceção do google-sheets, apagando a memória de por que aquelas palavras
ficaram.

### Seis defeitos consertados no caminho

1. **A allowlist do Auth apontava para um endereço morto** (`ressoa.pages.dev`;
   o real é `ressoa-2zl.pages.dev`).
2. **`instalar.ps1 -SoPainel` apagava a assinatura do painel.** O passo que
   regenera `app/painel/.env.local` escrevia só as duas chaves do Supabase e
   levava junto `VITE_MARCA_NOME`/`VITE_MARCA_RODAPE`. Agora a assinatura mora
   no `.env` (fonte única) e o instalador a leva para os dois destinos: o painel
   e o secret `MARCA_NOME` da função `conta-email`.
3. **Os e-mails de conta diziam "Nome do Remetente"** — resíduo da sanitização
   do espelho público, indo para gente de verdade. Agora vêm do secret.
4. **`scripts/aplicar_emails_auth.py` não compilava desde `8ed69ad`** ("Tira do
   repositorio tudo que e pessoal"): a sanitização escapou aspas dentro de uma
   f-string. O arquivo estava morto e ninguém sabia. Varri os 13 scripts: era o
   único.
5. **O `instalar.ps1` lia o `.env` na página de código ANSI**, e "Patrícia"
   chegava como `PatrÃ­cia` no painel e no cabeçalho do e-mail. Aconteceu de
   verdade nesta leva: o secret foi gravado corrompido e teve de ser regravado
   pela API. Agora o instalador usa `Get-Content -Encoding utf8`. **Regra que
   ficou:** secret com acento vai pela **API**, nunca pelo CLI — no Windows o
   valor atravessa dois conversores de página de código e chega estragado. A
   conferência é por hash: o Supabase devolve o secret como SHA-256, então dá
   para provar o que está lá sem imprimir o valor.
6. **O script do renome se autocorrompeu** (rodou sobre si mesmo e deixou
   `DOM_VELHO` igual a `DOM_NOVO`, um replace que não troca nada e não avisa).
   Agora ele pula o próprio arquivo.

### Três coisas que não são defeito, mas precisam estar escritas

- **Os e-mails do Auth do Supabase não existem nesta operação.**
  `mailer_autoconfirm` está **ligado** (a conta nasce confirmada) e o painel não
  chama `resetPasswordForEmail`, `signInWithOtp` nem `inviteUser` — recuperar
  senha, trocar e-mail e excluir conta passam pela Edge Function `conta-email`,
  que manda pelo canal próprio (n8n). Os templates do Auth estão no **padrão em
  inglês do Supabase** e ninguém os recebe. Some-se a isso que o Supabase
  **recusa** editar template em projeto do plano grátis com o provedor padrão
  (as cinco chamadas voltam com erro). O script fica guardado para o dia em que
  houver SMTP próprio, com o porquê escrito no cabeçalho dele.
- **O resumo diário não vai para ninguém**: `resumo_diario_para` está vazio
  desde 06/08. A função foi reaplicada com o nome e o link novos, mas só volta
  a chegar em alguém quando alguém preencher esse campo em Configurações.
- **A máquina onde este trabalho roda fica atrás de um proxy corporativo que
  inspeciona TLS** — o certificado que chega não é o do Cloudflare, é o do
  próprio proxy. Consequências ao conferir qualquer coisa dali: `curl` e
  ferramentas de busca falham por certificado não confiável, e **domínio
  recém-criado pode dar "Erro de privacidade" no Chrome mesmo estando perfeito
  para o resto do mundo** — foi o que aconteceu com o `ressoar.` no dia em que
  subiu. Para provar que um site está no ar dali, use o navegador; se ele
  reclamar num domínio novo, busque por fora (um leitor server-side resolve)
  antes de concluir que quebrou.

### Segunda leva do mesmo dia: o renome profundo ("levar tudo pro ressoar")

O dono pediu o resto — os identificadores internos que a primeira leva tinha
deixado de propósito. Feito, e **com a operação rodando**: passou uma compra
aprovada às 16:04:34, processada normalmente, no meio da troca.

| O quê | De | Para |
|---|---|---|
| Tabela de usuários | `usuarios_ressoa` | `usuarios_ressoar` |
| Políticas de RLS | `ressoa_*` (42 delas) | `ressoar_*` |
| Relógios do pg_cron | `ressoa-*` (8) | `ressoar-*` |
| Automações no banco | `[RESSOA] …` (8) | `[RESSOAR] …` |
| Função de exclusão | `excluir_lead_ressoa` | `excluir_lead_ressoar` |
| Cabeçalho interno | `x-ressoa-segredo` | `x-ressoar-segredo` |
| Segredos das funções | `RESSOA_EMAIL_*` | `RESSOAR_EMAIL_*` |
| Formulário publicado | `.ressoa-form`, `.ressoa-erro` | `.ressoar-*` |
| Preferências no navegador | `ressoa-tema`, `-escala`, `-barra`, `-tour-visto` | `ressoar-*` |
| Payload dos webhooks | `origem: 'ressoa'` | `origem: 'ressoar'` |
| Projeto no Supabase | Ressoa | Ressoar |
| Repositórios no GitHub | `ddsdavi/ressoa`, `ressoa-publico` | `ressoar`, `ressoar-publico` |

**Como a troca da tabela não teve janela.** `papel_atual()` é lida por todas as
políticas de RLS e cita a tabela pelo nome — e renomear tabela **não** reescreve
o corpo das funções. Por isso o `alter table` e o `create or replace` das quatro
funções dependentes acontecem na **mesma transação**
(`renomear_identificadores_ressoar_v1.sql`), e uma view-ponte `usuarios_ressoa`
segurou o painel que ainda estava publicado até o build novo subir. A ponte foi
derrubada logo depois. As funções também aceitam o cabeçalho antigo por ora, de
propósito: banco e função não trocam de versão no mesmo instante.

**O que a plataforma não deixou renomear, e não é escolha:** o gatilho
`trg_ressoa_novo_usuario` mora em `auth.users`, tabela do Supabase, e o banco
responde `42501: must be owner of table users`. Ele não aparece para ninguém, e
a função que ele chama já usa o nome novo.

**A mudança de casa no Cloudflare foi concluída no mesmo dia** (o Davi liberou o
navegador): os dois domínios agora moram no projeto **`ressoar`**
(`ressoar.pages.dev`), movidos um por vez — o novo primeiro, com o antigo
segurando o tráfego; depois o antigo, com o novo já ativo — de modo que em
nenhum momento o painel ficou sem endereço. Os instaladores publicam em
`--project-name ressoar`. O projeto antigo `ressoa` ficou **sem domínios e sem
função**: pode ser apagado pelo painel quando der (Workers & Pages → ressoa →
Configurações → Excluir projeto). O allowlist do Auth trocou
`ressoa-2zl.pages.dev` por `ressoar.pages.dev`.

Durante a mudança, uma janela real e assumida: o domínio **novo** (`ressoar.`)
ficou ~15 minutos "pending" enquanto o certificado saía no projeto novo — o
painel seguiu acessível o tempo todo pelo domínio antigo, que era o que a
equipe usava. A compra das 16:04 e a vigília do ManyChat atravessaram a mudança
sem um evento perdido.

### Fim da linha: o domínio antigo saiu do ar e o Google virou Ressoar

Ainda em 12/08, com o Davi liberando o navegador de novo:

- **`ressoa.drapatriciadomingos.com.br` foi liberado.** Desconectado do projeto
  Pages e com o CNAME removido junto (o próprio painel do Cloudflare apaga o
  registro ao remover o domínio). Hoje ele **não resolve** — está livre para
  receber outra coisa. Saiu também do `uri_allow_list` do Auth. Antes de soltar,
  auditei: nenhuma configuração, mensagem ou função do banco citava o endereço;
  as únicas coisas servidas por ele eram as duas páginas `/f/`, que continuam no
  domínio novo.
- **O projeto `ressoa` no Cloudflare foi apagado** (estava sem domínio nenhum).
  Sobraram dois projetos na conta: `ressoar` e `desafio-casa-harmonizada`.
- **O app OAuth do Google virou "Ressoar"**, e o projeto do Google Cloud também.
  O risco que fez adiar **não existia**: o console mostrava *"sua marca precisa
  ser verificada antes de ser mostrada aos usuários"* — ou seja, nunca houve
  verificação concedida, então não havia o que reabrir. A tela de consentimento
  agora diz "Prosseguir para **Ressoar**", e o comentário em
  `app/functions/google-sheets/index.ts` foi corrigido para descrever isso (ele
  tinha virado mentira no instante do rename). O **ID** do projeto
  (`ressoa-504702`) é imutável por definição do Google e fica como está.

**Auditoria do n8n (62 fluxos ativos, lidos um a um):** nenhum filtra por
`origem`, então a troca do payload para `origem: 'ressoar'` **não quebrou nada** —
os quatro fluxos que citam a palavra usam `evento_origem` (outro campo) ou apenas
leem `body.origem` sem comparar. Só dois fluxos citam o nome antigo:
`[RESSOAR] Envio transacional`, cujo webhook foi renomeado no fim do dia (ver
abaixo), e
`[RESSOA - TERAPEUTAS] Lista de Espera`, que **não é alimentado pela Ressoar** —
conferi os passos de webhook das automações e nenhum aponta para ele.

**O caminho do webhook também virou `ressoar` — e o susto vale registro.**
`/webhook/ressoa/transacional` passou a ser `/webhook/ressoar/transacional`. O
que quase deu errado: **este n8n publica por versão**. Trocar o campo e clicar
em salvar guarda um RASCUNHO; a versão no ar continua a antiga. Como eu já tinha
virado o `.env` e o secret para o caminho novo, o canal dos códigos de segurança
ficou fora do ar por alguns minutos — e só apareceu porque testei a rota em vez
de confiar no "salvou". Ordem certa, para quem repetir:

1. trocar o `path` no nó **Webhook** e salvar;
2. **Publish** (nomear a versão e confirmar) — é isso que põe no ar;
3. provar com um POST de segredo ERRADO: o caminho novo tem de responder
   `200 {"ok":false,"erro":"segredo invalido"}` e o antigo passa a dar 500;
4. **só então** trocar `RESSOAR_EMAIL_WEBHOOK` no `.env` e no secret da função.

Feito e conferido nessa ordem: hoje o caminho novo responde 200 e o antigo, 500.

**Não sobrou pendência de migração.**