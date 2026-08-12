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

**Ficou UMA pendência, por decisão de risco, não por acesso:**

1. **O app OAuth no Google Cloud ainda se chama "Ressoa"** — trocar exige o
   console do Google e pode reabrir a verificação de marca (escopo sensível de
   Planilhas). Os textos do repositório já dizem a verdade sobre isso.

**Uma mudança que toca o lado de fora, e merece conferência:** o payload que a
Ressoar posta em webhook (n8n, Boost) agora manda `origem: 'ressoar'`. Se algum
fluxo do outro lado filtra por `origem = 'ressoa'`, ele para de casar. Não deu
para conferir os fluxos daqui; os gatilhos com webhook são listas e tags de
lançamento, hoje sem tráfego, então dá tempo de olhar antes do próximo.

### A promessa de "rodar de novo é seguro" era falsa — e agora é verdade

O README diz que reaplicar o instalador não estraga nada. Não era o caso, e o
estrago seria dos grandes:

- **`recuperacao_e_jogadas_v1.sql` não tinha trava nenhuma.** Uma segunda
  execução criava **9 mensagens e 5 automações duplicadas** — e uma delas,
  `[RESSOAR] Pagamento não caiu`, nasce **ativa, com passo de e-mail**.
- **`janela_quente_v1.sql` tinha a trava errada.** Ela procurava
  `'[RESSOAR] Formação — janela quente (revisar e ligar)'`, mas a `v2` **renomeia**
  a automação ao ligá-la. A trava deixou de reconhecer o que ela mesma criou;
  agora compara com `like '…janela quente%'`.
- **`scripts/run_sql_file.py` matava a instalação no acento.** O console do
  Windows abre em cp1252 e o script morria ao **imprimir** o resultado quando
  ele trazia `→` (nome de automação "Aluno → Black"). A migração tinha
  funcionado; a exceção dava saída 1, e os dois instaladores tratam saída 1
  como "falhou em tal arquivo" e abortam no meio do banco. Agora a saída é
  forçada para UTF-8.

Provado, não suposto: as duas migrações foram **reexecutadas em produção** com
as travas novas, e as contagens ficaram idênticas (28 automações, 115
mensagens, 62 passos, antes e depois). Depois disso, varri as 93 migrações do
`ordem.txt`: as quatro que inserem automação ou mensagem têm trava.

### Duas arrumações que vieram junto

- **O remetente das migrações saiu do código.** `recuperacao_e_jogadas_v1.sql` e
  `janela_quente_v1.sql` cravavam nome e endereços do remetente em 12 lugares.
  Agora leem `app_config` (`from_name_padrao`, `from_email_padrao`,
  `reply_to_padrao`) — a migração serve a qualquer instalação, e nome de pessoa
  sai de arquivo versionado. Conferido: as 66 mensagens da base já usam
  exatamente o valor que está na configuração, então nada muda de
  comportamento.
- **Três textos da tela pararam de falar do ActiveCampaign no presente.** Eles
  justificavam a trava dos webhooks com "enquanto o AC ainda estiver rodando" —
  o AC morreu em 05/08. O risco real continua existindo (um fluxo do outro lado
  fazendo a mesma coisa), e é isso que os textos dizem agora.

### O que falta (Fase B, sem prazo — decisão do Davi)

**A parte que dava para adiantar já foi feita: o banco está limpo.** Varredura
de 12/08 procurando `ressoa.drapatricia` em passos de automação (é onde moram as
URLs de webhook e de planilha), mensagens, campanhas, formulários, configurações
e webhooks cadastrados: **zero ocorrências em todas**. Ou seja, desligar o
domínio antigo não quebra nada de dentro da plataforma.

**O que sobra é tudo fora daqui**, e só o Davi alcança: fluxos e mensagens do
ManyChat, links de bio, anúncios ativos, planilhas da equipe e favoritos do
time. O único endereço público conhecido é a página `/f/lives-semanais` — e a
landing real das Lives não usa essa página (posta direto na função), então a
exposição esperada é zero. Conferir mesmo assim.

Depois disso: opcionalmente criar uma regra 301 de `ressoa.…/f/*` para
`ressoar.…/f/*` (protege link de formulário antigo para sempre); remover o
domínio antigo em Pages → Custom domains; e tirar as duas entradas antigas da
allowlist do Auth.

### O espelho público, e a inconsistência que ficou

O espelho foi atualizado em 12/08 pelo ritual de sempre (árvore do HEAD com o
topo público como pai — nada reescrito, histórico preservado, 64 commits lá).
Conferido depois de publicar: a árvore publicada é byte a byte a mesma daqui, e
o nome da dona da conta **não aparece mais em SQL nenhum**.

**Mas vale saber, porque é decisão e não defeito:** o espelho identifica a
operação de qualquer jeito. O domínio `drapatriciadomingos.com.br` aparece em 6
arquivos públicos (docs e SQL das automações), e o domínio *é* o nome. Enquanto
isso, o README se apresenta com "Nome do Remetente" no lugar da marca, como se a
identidade estivesse protegida. As duas coisas não podem estar certas ao mesmo
tempo. Além disso, o nome ainda existe no **histórico** público antigo (os
commits anteriores a 12/08), e tirá-lo de lá exigiria reescrever esse histórico
— o oposto do que o ritual do espelho faz de propósito. Escolher um dos dois
caminhos (assumir a identidade ou esconder de verdade, inclusive o domínio) é
decisão do dono.

O plano completo, com os comandos e as provas de cada etapa, está em
`docs/superpowers/plans/2026-08-12-ressoar-troca-de-nome-e-dominio.md`.

---

## A tag dupla de turma e o banimento (11/08/2026)

**O incidente:** compradores do Desafio entravam no ManyChat com DUAS tags de
turma — a certa (`CASA_H_26_08_17`, calculada pela Ressoar) e a da semana
anterior (`CASA_H_26_08_10`). A Ressoar estava certa; a errada vem de **fora**:
a Hotmart posta o webhook de compra também direto no n8n, nos workflows
Published **A = `ySkiGv6PY1l3TPRu`** e **B = `d9ZmqxI1vbj80GHb`** ("Comprador
Desafio Casa H - Insere Tag no Many"), que têm o `tag_id` do ManyChat escrito
à mão (93326298 = turma 08_10) e eram atualizados toda segunda — pararam de
ser atualizados quando a Ressoar assumiu, mas continuaram ligados. Enquanto os
dois sistemas aplicavam a MESMA tag, ninguém via.

**Estado (fechado em 12/08/2026):** o ManyChat foi limpo (34 compradores da
semana, conferidos assinante a assinante, só com a 08_17), o Davi desativou à
mão os nós de tag nos dois workflows, e a varredura final pegou os 2 últimos
que compraram no intervalo. **A planilha de compradores também foi assumida
pela Ressoar** (`desafio_planilha_v1.sql`): automação "[RESSOAR] Desafio —
planilha de compradores" (gatilho `compra_realizada` filtrado por "Desafio
Casa"), escrevendo na aba DA TURMA — o nome da aba sai de `nome_da_turma()`
(o n8n apontava a aba à mão toda segunda, o mesmo ritual que quebrou a tag),
e a função google-sheets **cria a aba com cabeçalho quando ela não existe**.
Provado em produção com aba de rascunho criada e apagada. Com isso os
workflows A/B do n8n podem ser desativados POR INTEIRO. Atenção: as linhas
dos compradores da turma 08_17 escritas pelo n8n durante a semana caíram na
aba errada (CASA_H_2026_08_10).

**O banimento (`banimento_v1.sql` + função `manychat` + tela):** números que
NUNCA recebem tag no ManyChat, por ordem do Davi. Três camadas: trava em
`manychat_aplicar` (motor), trava na Edge Function (tela e External Request),
e monitor `ressoar-banidos-manychat` (cron, 10 em 10 min) que procura cada
banido lá e aplica a escada — exclusão a API **não tem** (404, medido; fica
apontada na tela para fazer à mão) → descadastro melhor-esforço
(`updateSubscriber`, só SMS/e-mail) → **tag ESC WHATSAPP** (id em
`app_config.manychat_tag_esc`), que é a garantia. Os NÚMEROS moram em
`banimento_dados.local.sql` (fora do git — dado pessoal, repo público): 3 da
Tayna Porto, 1 do Marcos Medeiros, 1 da Ruth Eloi. Gerência na tela ManyChat →
"Banidos do ManyChat". A Tayna não deve ter tag de comprador NUNCA — regra
dita pelo dono.

---

## O essencial em cinco linhas

- **O ActiveCampaign foi desligado e a Ressoar entrou em operação real**: o
  envio de e-mail foi destravado em 05/08/2026, por decisão explícita do dono.
- O motor roda sozinho: sete tarefas agendadas dentro do próprio Postgres,
  quatro delas a cada minuto. Os pedidos da Hotmart chegam por webhook em
  tempo real; só estado aprovado vira compra, entra em lista, ganha tag de
  turma e pode marcar a pessoa no ManyChat.
- O **histórico completo de vendas** está dentro: 10.178 transações
  (ago/2025–ago/2026) conferidas uma a uma. Faturamento em reais:
  R$ 1.770.234,87 em compras aprovadas.
- `executar_webhooks` foi **ligado em 05/08/2026** por decisão do Davi: os
  POSTs para n8n/Boost.space herdados das automações do AC voltam a sair
  quando os gatilhos (listas/tags de lançamento) receberem gente.
- 44 armadilhas conhecidas estão em [06-PROBLEMAS-CONHECIDOS.md](06-PROBLEMAS-CONHECIDOS.md).
  Vale ler antes de mexer em qualquer coisa; várias custaram horas. As cinco últimas são de
  06/08/2026 e tratam de identidade da pessoa: telefone, fusão de cadastro e que evento
  pode falar com o cliente.

---

## Travas e configurações agora

| Onde | Estado | O que significa |
|---|---|---|
| `envio_so_para` | **vazio** | Sem filtro de destinatário. Para testar, coloque seu e-mail aí antes — e tire depois. |
| `envio_pausado` | **LIGADO** (06/08/2026) | A fila NÃO escoa: nenhum e-mail sai enquanto isso valer, por ordem do dono. Nada se perde — os envios ficam `queued` e saem quando despausar. |
| `executar_webhooks` | **ligado** | Automações com passo de webhook chamam n8n/Boost.space de verdade. |
| `reply_to_padrao` | contato@drapatriciadomingos.com.br | Quem responder um e-mail cai numa caixa real. |
| `provedor_email` | resend | Remetente: contato@mkt.drapatriciadomingos.com.br. |

**Atenção redobrada em teste:** com o envio destravado, QUALQUER linha
`queued` na tabela `envios` sai em até 60 segundos. Antes de testar
qualquer coisa que toque a fila, preencha `envio_so_para` com o seu
endereço (armadilha 28) — e esvazie de novo ao terminar.

---

## Quem é a pessoa, e por onde se fala com ela (06/08/2026)

Um dia inteiro em cima de uma pergunta simples do dono — *"quem compra o
Desafio está entrando na tag da turma?"* — que destravou cinco defeitos e
duas regras novas de plataforma.

### As regras que ele ditou

**Só a APROVAÇÃO da compra move automação.** `PURCHASE_COMPLETE` é o aviso
de que a garantia venceu sem reembolso: a venda virou definitiva. Isso é
controle interno. Palavras dele: *"Pouco importa pras automações (...) O
que importa mesmo pras automações (email e manychat, inserir tags pra
essas automações) é o evento de compra aprovada."* O prazo nem é fixo —
sete dias é o mínimo do Código de Defesa do Consumidor, e o vendedor pode
dar mais, então amarrar lógica a ele seria errado em qualquer prazo.

**A comunicação de um produto sai pelo contato daquela compra.**
*"E-mails sempre devem ir para o email da compra, independente do email
antigo. Podemos, com cpf e telefone, identificar uma pessoa e garantir a
ela a possibilidade de ter 2 emails ou mais na base, mas as comunicações
relativas a um produto sempre serão com o email da compra desse
produto."* E, no mesmo dia, estendida ao telefone: *"Mesma regra pode
valer para quando a pessoa tiver mais de um celular."*

**Fundir nunca apaga.** *"Vc nunca pode deletar uma pessoa que comprou
algo. No máximo fundir o cadastro com outro que tenhamos certeza (...) não
deleta informações, some informações."* Cadastro absorvido tem tudo
movido — compras, tags, listas, histórico —, e a pessoa fica com os dois
e-mails, os dois telefones e os dois nomes.

**Identidade é CPF e telefone**, não e-mail. E-mail a pessoa troca.

### O que estava quebrado

| Defeito | O que causava |
|---|---|
| Fim de garantia movia automação | Quem comprou na semana passada caía na turma desta semana e recebia o WhatsApp errado. Aconteceu com 21 pessoas. |
| Boleto atrasado rebaixava compra paga | O aviso de boleto que falhou voltava minutos depois, já com a compra aprovada, e a regravava como `pendente`. O comprador sumia da lista de compradores **sem nada denunciar**. |
| ManyChat recusava quem já existia | A busca só olhava o campo personalizado; quem entrou por lá tem o número no campo de SISTEMA. A criação era recusada com *"WhatsApp já existe"* e a pessoa ficava sem a tag. |
| Order bump perdia item | Dois webhooks no mesmo segundo, ambos tentando criar a pessoa; o segundo esbarrava na chave única e a função desistia. |
| O 55 do Brasil em número de fora | `+41 79 598 8121` (Suíça) virou `5541795988121`. Ver a seção do telefone, abaixo. |

### A turma que originou tudo

`CASA_H_2026_08_10` tinha **29 pessoas: 8 certas e 21 erradas**. Fechou com
**86, todas conferidas contra o histórico da Hotmart**, transação a
transação, sem diferença.

### O que ficou na base

- **CPF recuperado para 5.998 pessoas.** A Hotmart manda o documento em
  100% das compras; a coluna existia desde a migração e estava **zerada**.
- **E-mail e telefone de cada compra**, guardados na própria compra:
  10.397 e 10.072 das 10.432. Antes se perdiam — quem comprava com
  endereço novo era casado pelo WhatsApp com o cadastro antigo, a pessoa
  certa e o contato errado.
- **107 cadastros duplicados fundidos** (34 por CPF, 73 por telefone), sem
  perder uma única compra: faturamento idêntico antes e depois
  (R$ 1.771.192,78). Hoje **não existe CPF nem telefone repetido na base**.
- `lead_emails` e `lead_telefones` guardam tudo que se sabe de uma pessoa,
  com o nome que veio junto de cada contato.

### Onde isso vive

`email_para_contato(pessoa, produto)` e `whatsapp_para_contato(pessoa,
produto)` respondem para onde mandar. A automação diz de qual produto fala
pelo campo **produto** (Automações → a caixinha "Fala de:" ao lado do
nome); vazio, a mensagem vai para o contato principal — que é o certo para
o que não é sobre um produto. O endereço é escolhido no enfileiramento e
**gravado no envio**, então o relatório mostra para onde cada e-mail
realmente foi.

Compra feita pela própria equipe não define contato de cliente: os
endereços da casa estão em `emails_da_operacao`.

---

## Decisões do Davi em 05/08/2026

- **Marcação no ManyChat é POR PRODUTO, e a maioria NÃO marca.** Correção
  do mesmo dia: a primeira leitura ("espelhar tag de todo produto") estava
  ERRADA e foi revertida — "não é pra mandar assim todos os leads pro
  manychat; só os leads que teremos fluxo de onboarding da api oficial do
  whatsapp". A regra que vale: cada produto tem o campo `tag_manychat`
  (Produtos → regra do produto) — vazio = a compra não toca o ManyChat;
  preenchido = marca. E "marcar" significa sempre as duas possibilidades
  (`manychat_aplicar` com `criar=true`): acha o contato e aplica a tag, ou
  **cria o contato e aplica** quando ele não existe lá. Hoje só o Desafio
  marca (tag semanal de turma `CASA_H_{AA}_{MM}_{DD} - COMPROU INGRESSO
  CASA_H`, virada segunda 7h São Paulo).
- **Webhooks ligados** (`executar_webhooks = true`).
- **Imersão Terapêutica não ganha regra**: o produto não é mais vendido
  ativamente (1 venda residual nos últimos 7 dias; as 2.303 são históricas).
- **Sem sincronização final do AC**: "já subi todos os leads; se perdeu
  alguém, perdeu."
- **"Cria lista Compradores produto tal"**: os cinco produtos que vendiam
  sem regra ganharam regra completa (`operacao/regras_produtos_2.sql`) —
  Livro Físico da Formação, Ímã da Prosperidade, Black Ressonante,
  Desintoxicação e Desparasitação, Alinhamento de Chakras. Cada um: lista
  "Compradores …" + tag `COMPROU_*`, reembolso/cancelamento no padrão das
  outras, ManyChat de fora. Vale para compras novas — e o mapa de produto
  voltou a rodar na noite de 05/08 (armadilha 38; o represado do período
  mudo é a pendência 5).
- **Captação por API fechada com chave.** O POST em `/formulario` **sem**
  `form_slug` — o que escolhe `lista_id`/`tag_id` no corpo — passou a exigir a
  chave `formulario_api_key` (cofre `public.segredos`), no cabeçalho
  `x-api-key` ou no campo `api_key`. Antes, qualquer anônimo inscrevia
  qualquer e-mail em qualquer lista, e com o envio destravado isso disparava
  e-mail real (armadilha 37). Formulários publicados (com `form_slug`)
  continuam públicos. A chave se troca em Configurações → API e webhooks; o
  valor atual está no `.env` local (`FORMULARIO_API_KEY`), fora do
  repositório. Ninguém usava o caminho sem slug (zero `source = form:api` na
  base) — nada quebrou.

## O que está pendente

1. **Nó "Formatar telefone" do n8n** (workflows `ySkiGv6PY1l3TPRu` e
   `d9ZmqxI1vbj80GHb`) ainda tem a regra antiga que inventa nono dígito em
   telefone fixo. A Ressoar já foi corrigida; o n8n é do Davi. Com os
   webhooks ligados, o risco voltou a ser real — pendência viva.
2. **Povoar as listas "Compradores …" com quem já comprou?** As regras
   novas valem para compras futuras; os compradores históricos (Livro
   Físico 181, Chakras 166, Black 163, Desintoxicação 106, Ímã 5 — ~620
   pessoas) ficam fora das listas até o Davi decidir. Inserir retroativo é
   seguro: lista recém-criada não tem automação pendurada, nenhum e-mail
   nem webhook sai.
3. **Verificar o primeiro disparo real de webhook.** Os gatilhos das
   automações com webhook (que moram AQUI na Ressoar e chamam n8n/Boost)
   são listas/tags de lançamento, hoje sem tráfego — o primeiro POST real
   deve acontecer no próximo lançamento. Nada a fazer; só conferir quando
   houver.
4. **Página das lives semanais sem destino.** Com o AC desligado, a inscrição
   das lives está postando para um sistema morto. As peças para ela apontar
   para cá já existem e estão testadas — ver a seção logo abaixo.
5. **Reprocessar as 227 compras aprovadas que ficaram mudas (02–05/08) —
   SÓ com o aval do Davi.** O mapa de produto ficou mudo de 02/08 16h24 a
   05/08 à noite (armadilha 38: três assinaturas de `aplicar_mapa_produto`
   conviviam; o PostgREST respondia `PGRST203` e a `venda` engolia o erro e
   carimbava processado). O conserto entrou em 05/08 à noite
   (`hotmart_v4_um_mapa_so.sql` + `venda` lendo `error`): compra nova volta
   a entrar em lista, ganhar tag e turma sozinha — e a marcar ManyChat
   onde a regra manda (hoje, só a turma do Desafio). O que NÃO foi feito,
   de propósito: reprocessar o represado — 118 compras do Desafio,
   52 da Formação, 22 do Curso energia, 13 do Livro, 8 do Manual, 5 do Ímã,
   4 da Black, 2 da Desintoxicação, 1 de Origem, 1 de Chakras, 1 do
   Acompanhamento (todas gravadas em `tabela_4_alunos`; os corpos crus
   estão em `hotmart_eventos`). Reprocessar não é neutro: os 118 do
   Desafio seriam marcados no ManyChat de uma vez (tag de turma, criando
   contato quando faltar — fluxo de WhatsApp), as listas antigas (17, 21,
   22, 23, 24, 25) podem ter automação pendurada e `executar_webhooks`
   está ligado — decisão do Davi, não de sessão. Os compradores do período
   mudo dos 5 produtos novos são um subconjunto do retroativo da pendência
   2 — as duas decisões conversam. Detalhe técnico:
   `reprocessar_evento_hotmart` calcula a turma com `now()`, então
   reprocessar antes de segunda 10/08 7h põe todo mundo na turma
   `CASA_H_2026_08_10`; depois disso, na seguinte.

---

## Campos: os dois órfãos da atribuição ganharam nome (06/08/2026)

A página Campos avisava que "2 campos aparecem nos dados mas não estão
cadastrados aqui" e oferecia dois botões, `hotmart_xcod` (248 contatos) e
`hotmart_sck` (202). Não havia nada quebrado: são os dois parâmetros crus de
origem da Hotmart, que chegam pela URL da landing (`?xcod=…&sck=…`) e pelo
webhook de venda. O `atribuicao_v1` já desempacota os dois em campos legíveis
e cadastrou **só** os desempacotados; os crus ficaram no JSON sem nome, e a
comparação "o que existe nos dados × o que está cadastrado" acusou.

`atribuicao_v3_campos_brutos.sql` cadastra os dois como **ocultos** no grupo
"Atribuição da venda" — "Origem bruta da Hotmart (xcod)" e "(sck)" — e dá
ordem de leitura ao grupo inteiro, que estava todo em `ordem = 0` e por isso
abria pela chave em ordem alfabética, com "ID do anúncio" antes de "Origem do
tráfego". Agora vai do legível ao técnico (10 a 80) e os crus fecham a lista
(90 e 91). O rótulo diz "bruta" de propósito: **não se segmenta por eles** —
o construtor compara o campo inteiro, e o valor é um JSON ou uma string
`m=paid|s=ig|utm_id=…`. Quem segmenta é a dupla desempacotada.

Conferido no mesmo passo, e está saudável: dos 251 contatos com dado cru,
**zero** ficaram sem desempacotar (rodei `extrair_atribuicao` em todos e
comparei chave a chave — nenhuma chave nova apareceria). Sobram duas
sujeirinhas de origem, pequenas e conhecidas:

- **8 contatos com `sck` que não é `chave=valor`** e sim um nome interno da
  Hotmart (`HOTMART_SALES_AGENT`, `HOTMART_CLUB_TRENDRECOMMENDERC`,
  `NEW_CLUB_SALES_PAGE_FROM_SHOWCASE_C`). A venda veio de dentro da própria
  Hotmart, não de anúncio. Hoje o extrator ignora e eles caem em "(sem
  origem)" nos relatórios.
- **4 contatos com `xcod` igual à string `"undefined"`**, escrita por alguma
  página que mandou o parâmetro vazio como texto.

As duas foram resolvidas no mesmo dia, por ordem do Davi, em
`atribuicao_v4_origem_interna.sql`:

- **O `sck` sem `=` virou origem.** `extrair_atribuicao` passou a ler o nome
  inteiro como `origem_trafego` (em minúsculas, do tamanho dos valores que já
  moram lá, tipo `paid_metaads`) quando o xcod não tiver dito nada — entre os
  dois, o xcod é o mais específico e continua com a palavra final. Isso não
  era detalhe: os 8 estavam escondidos dentro de "(sem origem)" carregando
  **R$ 8.754,78 em compras aprovadas**, quase todo ele do recomendador do
  Hotmart Club (R$ 6.013,66 + R$ 2.509,76). Vitrine e recomendação da própria
  Hotmart vendem, e o relatório de atribuição não sabia disso.
- **A string "undefined" saiu do banco e não volta.** A migração apaga a
  chave onde o valor é `undefined`/`null`/vazio, e as duas Edge Functions que
  gravam atributo (`formulario` e `venda`) ganharam um `semLixo()` antes de
  montar o JSON — vale para qualquer campo, não só o xcod.

Depois disso: `sem_leitura = 0` (nenhum contato com dado cru fica sem origem
identificada), `campos_orfaos = 0`, e o `rel_atribuicao('origem_trafego')`
mostra as quatro origens internas da Hotmart como linhas próprias.

---

## O eixo de venda: pontuação, faixas e próxima oferta (06/08/2026)

O Davi olhou a "Saúde do engajamento" e pediu para aprofundar o lead
scoring "sempre pensando em vender". A regra que ele deu e que governa o
desenho: **"vendas é uma coisa e engajamento com e-mail é outra"** — são
dois eixos, e não se misturam.

O eixo antigo (`lead_pontuacao.pontos`) continua intacto, cuidando da
saúde de envio. O novo (`pontuacao_venda_v1.sql`) responde a pergunta de
venda: tabela `lead_venda` com **pontos_venda 0–100 contínuo** (recência
da última compra com decaimento exponencial de meia-vida ~31 dias +
frequência + gasto em BRL; sem compra, vale o tempo de base; Lives soma;
reembolso derruba; **nenhum sinal de e-mail entra**), **faixa por
percentil dos alcançáveis** (prontíssimo = top 5%, nunca satura) e
**próxima oferta** — o passo da esteira carimbado por lead, com o motivo
escrito por extenso. Recalcula às 03:44 (cron `pontuacao-venda-diaria`) e
no instante da compra (trigger em `tabela_4_alunos`, erro engolido em
warning para nunca travar a ingestão de venda).

Por que a esteira manda: medido no histórico, **79% dos alunos da
Formação compraram um produto de entrada antes**, com mediana de 5,6 a
10,8 dias entre a entrada e a Formação — a janela quente dura ~2 semanas.
O eixo antigo não via nada disso (57% da base empatada no "topo", 2.604
pessoas com os mesmos 11 pontos); o novo tem 83 valores distintos e o
topo é quem deve ser (ex.: "Comprou 13x · R$ 4.428 · última há 0 d").

`leads_do_segmento` ganhou quatro condições: `comprou` aceita `dias`
(janela), `pontuacao_venda` (operador/valor), `proxima_oferta` (slug) e
`alcancavel` (e-mail válido + lista ativa + fora da supressão — o mesmo
filtro do painel, para segmento e painel contarem IGUAL; sem ela o
segmento da janela quente dava 860 contra 720 do painel, porque incluía
gente sem lista ativa que não deve receber campanha).

No painel, Relatórios ganhou a aba **"Prontos pra comprar"**: as nove
jogadas com contagem viva (janela quente 720 · segunda chamada 1.611 ·
aluno→Black/Acomp 399 · Lives→Desafio 3.551 · novos→Desafio 827 ·
reativar esteira 2.556 · VIP 21 · aquecer 1.682 · fora de oferta 1),
botão "Criar segmento" (gateado por `podePreparar`; "aquecer" e "fora de
oferta" não têm botão de propósito) e o top-50 ranqueado com faixa e
motivo. RPCs: `rel_vendas_jogadas()` e `rel_melhores_leads(oferta,
limite)` — ambas com execute revogado de anon.

Decisões do Davi (respostas 1A/2A/3A): eixos separados; **automação da
janela quente fica para outra leva** (enviaria e-mail real — os textos
têm que ser dele); nada dispara sozinho — segmento é regra inerte até
alguém disparar campanha. ManyChat intocado. Spec e plano em
`docs/superpowers/`.

**Segunda leva no mesmo dia ("faz tudo!"):** o eixo chegou na página
Leads (coluna **Venda** com cor da faixa e a próxima oferta no hover; o
`montarQuery` também não buscava `lead_pontuacao` no caminho normal — a
coluna Pontos ficava vazia — e foi corrigido de carona), o construtor
ganhou as condições novas na tela (Pontuação de venda, Próxima oferta,
Pode receber e-mail, e `comprou` com "nos últimos N dias"), tooltips ❔
explicam cada coluna e cada jogada (textos compartilhados em
`app/painel/src/lib/venda.ts`), o tour ganhou o passo "Quem está pronto
pra comprar" (navega para `/relatorios?aba=prontos` — a página passou a
aceitar `?aba=`), e a jogada nº 1 virou automação de verdade:
**"[RESSOAR] Formação — janela quente (revisar e ligar)"**
(`janela_quente_v1.sql`), DESLIGADA, gatilho `compra_realizada`
(qualquer produto), passo `condicao` "já comprou a Formação? → encerra"
na porta E antes de cada um dos 3 e-mails (D+1/D+4/D+8) — quem compra no
meio sai sozinho. Os e-mails são `[RASCUNHO] Janela quente 1..3/3` na
página Mensagens, com marcador `COLE-AQUI-O-LINK-DA-FORMACAO`,
`[DEPOIMENTO — …]` e `[CONDIÇÃO — …]` para o Davi preencher antes de
ligar. Nenhuma mudança de motor foi necessária: gatilho de compra e
passo condicao já existiam no executor vivo.

**Terceira leva no mesmo dia ("FAZ TUDO!") — a automação foi LIGADA**
(`janela_quente_v2_ligada.sql`): os três e-mails viraram versão final
`[Janela quente 1..3/3]` com o link real da página de vendas
(`drapatriciadomingos.com.br/inscricoes-formacao`, conferida viva) e
promessas garimpadas dos e-mails da própria conta (AC #31/#34: método
para identificar a origem das queixas, mais de 1.300 alunos, certificado
MEC/ABRATH, comunidade, mentorias, 2 anos de acesso) — sem prazo falso e
sem bônus de lançamento, porque a sequência é perpétua; o rascunho do
"depoimento" saiu (não se inventa depoimento) e virou prova social
agregada. `avaliar_condicao` ganhou `dias` opcional no tipo `comprou`
(sem `dias` = comportamento antigo), e a porta ganhou a **trava de
idade**: só segue quem tem compra aprovada nos últimos 21 dias — é a
proteção para o caso de a pendência 5 (reprocessar as 227 compras mudas)
ser executada um dia: evento antigo reprocessado não dispara e-mail de
"ontem". Testado no banco: comprador recente passa, antigo é barrado.
Estado no ato da ativação: 11 passos, 0 execuções, fila de envios vazia
— o primeiro e-mail real sai ~24h depois da primeira compra que entrar.

**Quarta leva no mesmo dia — arrumação das telas (pedidos do Davi):**
(1) o lead scoring ganhou **página própria** ("Lead scoring", Contatos →
Gerenciar, rota `/leadscoring`), com aba **Venda** (jogadas + ranking, o
que era "Prontos pra comprar") e aba **Engajamento** (a "Saúde do
engajamento", que saiu de Relatórios) — razão: uso operacional diário
não é relatório, e o nome é o que o mercado chama; links antigos
`/relatorios?aba=prontos` redirecionam. (2) A aba **Campanhas saiu de
Relatórios**: era DUPLICADA — a página Campanhas (Email) já tinha a
tabela por campanha; ela só ganhou os percentuais de abertura/clique que
faltavam. (3) **"De onde vem o dinheiro" foi reescrita** depois do Davi
dizer que não entendia: o diagnóstico mediu 3% de cobertura de origem no
histórico (21% nos últimos 30 dias) com "(sem origem)" de R$ 232 mil
esmagando a primeira linha, jargão cru (`paid_metaads`,
`hotmart_club_trendrecommenderc`) e "conversão de 100%" sobre 1 pessoa.
Agora a aba abre com a COBERTURA ("X de Y compras têm origem conhecida"),
período padrão de 30 dias (`rel_atribuicao`/`rel_anuncios` ganharam
`p_dias` — com **DROP antes de recriar**, senão a assinatura nova vira
sobrecarga e PGRST203, armadilha 38; `rel_dinheiro_resumo(p_dias)` é
nova), origens traduzidas para português no painel (rótulo de exibição —
o dado cru continua no banco), "(sem origem)" e "(sem anúncio)" fora dos
rankings (viraram o cartão de cobertura), e a coluna de conversão saiu
(era ilusão com denominador só de compradores). O `App.tsx` desta leva
carrega também a refatoração de rotas de outra sessão (rotas derivadas
dos grupos), auditada e buildada junto.

---

## A operação vira máquina: telemetria, rampa e recuperação (06/08/2026)

Pergunta do Davi: "algo mais a fazer pra isso virar uma nave da SpaceX?".
Os seis buracos que apareceram durante a construção foram fechados na
ordem 1→2→4→3→5→6.

**1. Telemetria de venda** (`telemetria_v1.sql`). Até aqui a plataforma
media abertura e clique — nenhuma das duas paga boleto.
`rel_resultado_envios(dias, janela)` cruza envios com compras aprovadas e
mostra, por automação e por campanha: pessoas, e-mails, aberturas,
cliques, **compradores, receita e receita por e-mail**. A regra de
atribuição é o detalhe que a torna honesta: só conta compra
**posterior** ao `sent_at`, dentro de 14 dias — assim a compra que
**dispara** a janela quente nunca é creditada a ela (sem isso, a
automação "converteria" 100% no primeiro dia). Tela: Lead scoring → aba
**Resultado**.

**2. Rampa de aquecimento com freio** (`aquecimento_v1.sql`). O risco
real: 11.434 alcançáveis e o domínio tinha mandado **10 e-mails em 30
dias**. Disparar para milhares de uma vez queima o domínio inteiro, não
só a campanha. Agora existe `envio_limite_diario` (começou em **200**);
`processar_fila_envios` para ao bater o teto e a fila **espera** (nada se
perde). `subir_rampa()` (cron 6h51) sobe um degrau por dia —
200→500→1000→2000→4000→8000→sem teto — mas só se o teto anterior tiver
sido **usado** (70%) e a saúde estiver boa: teto que sobe sem volume
entregue não aquece nada. `freio_entregabilidade()` (cron de hora em
hora) pausa o envio e derruba o teto pela metade se bounce > 2% ou
reclamação > 0,1% nos últimos 7 dias, **com volume mínimo de 50** — com
11 e-mails, um bounce vira "9%" e pausaria a operação por estatística de
nada (foi exatamente o que os dados mostraram no dia). Tabela `alertas` +
`registrar_alerta()` com silenciamento por tipo (alerta repetido vira
ruído, e ruído treina a pessoa a ignorar alerta). Tela: Envios.

**4. Recuperação de pagamento** (`recuperacao_e_jogadas_v1.sql`). A
Hotmart vinha avisando e ninguém escutava: **135 boletos/PIX gerados, 27
carrinhos abandonados, 13 pagamentos atrasados** em `eventos_sistema` sem
automação pendurada. Agora: **[RESSOAR] Pagamento não caiu** (gatilho
ARRAY — `boleto_gerado` + `pagamento_atrasado` —, e-mails em 4h e 24h,
saindo na hora em que a compra é aprovada) e **[RESSOAR] Carrinho
abandonado** (2h). Os textos usam `{{evento.produto}}` (o `personalizar`
de 3 argumentos lê o contexto do evento) numa frase que **funciona
vazia**: "Você começou a compra {{evento.produto}} e o pagamento ainda
não foi confirmado".

**3. As outras jogadas viraram automação**: **Aluno → Black /
Acompanhamento** (gatilho = compra da Formação; sai quem já tem),
**Lives → Desafio** (gatilho = entrada na lista 6), **segunda chamada**
(fase 2 da própria janela quente, passos 12–14, D+30) e **Reativar
esteira** (sem gatilho de evento: `enfileirar_reativacao(teto)` roda às
terças com **teto de 150**, porque 2.556 de uma vez é o disparo que queima
domínio). Nenhum link inventado: só `drapatriciadomingos.com.br/inscricoes-formacao`,
`biopatriciadomingos.com.br` (a página que 97 compradores do Desafio
usaram) e o WhatsApp do suporte — todos conferidos com HTTP 200 no dia.

**5. Radar**: montador de link rastreado na aba do dinheiro. Escreve
`utm_source`/`utm_medium`/`utm_campaign` **e o `sck`**, que é o formato
que a Hotmart carrega do clique até a compra. Os valores de origem são os
que já existem na base (`organic_bio`, `paid_metaads`…) para o link novo
cair na MESMA linha do relatório em vez de criar origem paralela.

**6. Mission control** (`resumo_diario_v1.sql`): `enviar_resumo_diario()`
às 8h de São Paulo com compras/receita/leads/e-mails das últimas 24h,
saúde do envio, o que as automações venderam em 7 dias e os alertas
abertos. **Não passa pela fila de envios** de propósito: o dia em que o
freio pausar a fila é justamente o dia em que o aviso precisa chegar.
Destinatário em `app_config.resumo_diario_para` (endereço de pessoa não
entra em repositório; a migração cria a chave vazia).

**Prova ponta a ponta feita em produção**: o lead do Davi foi inscrito na
reativação, o motor executou a porteira, enfileirou e o Resend
**entregou** (`delivered`, 17h06). É a primeira vez que a cadeia
automação → porteira → fila → provedor foi provada inteira com e-mail
real. Também foi disparado um resumo diário de teste.

### PARADO no mesmo dia, por ordem do Davi

Logo depois: **"calma, pois não mandaremos email pra ninguém por
enquanto"**. Estado deixado (tudo em banco, nada de código):

| O quê | Estado |
|---|---|
| `envio_pausado` | **true** — trava global; nenhum e-mail sai, de nenhuma origem |
| Fila (`envios` queued) | **0** |
| As 6 automações ligadas hoje | **desativadas** |
| Execuções em voo nelas | **encerradas** (7 pessoas: 6 na janela quente, 1 no pagamento) |
| `resumo_diario_para` | **vazio** — o resumo das 8h não sai para ninguém |

Nenhum e-mail chegou a sair para lead nenhum: a fila estava vazia quando
a pausa entrou, e o único envio do dia foi o teste para o próprio Davi.

Duas coisas que quem religar precisa saber:

1. **Encerrar a execução em voo foi necessário, não zelo.** O
   `executar_automacoes()` seleciona por `status` da EXECUÇÃO e **não
   confere se a automação está ativa** — desativar sozinho não pararia
   quem já estava dentro; a pessoa seguiria avançando os passos e
   enfileirando e-mail (que ficaria preso na fila pausada, para sair em
   avalanche no dia em que alguém despausasse).
2. **Seis automações HERDADAS do ActiveCampaign continuam ativas e têm
   passo de e-mail**: `16LC_CADASTRADOS`, `18LC_NOV25_BLACK - Inscritos`,
   `Hotmart Purchase Confirmation Email`, `Lives Semanais`,
   `LP_COMPROU_INGRESSO_IMER_TERAP`, `LSHT_DEZ25`. Elas não foram
   tocadas — já estavam assim desde a entrada em operação (05/08). Hoje
   a trava global segura todas; **no dia em que o envio for despausado,
   elas voltam a mandar sozinhas.** Conferir uma a uma antes.

A única `[RESSOAR]` que ficou ativa é a **Lives Semanais — tag no
ManyChat**: ela não manda e-mail (marca ManyChat e escreve na planilha).

### O espelho público voltou a ficar em dia (06/08/2026)

Estava 126 commits atrás. Antes de empurrar, a varredura das 7.500 linhas
novas achou coisa que **não podia ir para um repositório aberto**:

| O quê | Onde | Tratamento |
|---|---|---|
| 9 CPFs **com nome completo** de clientes | `cpf_nao_fundir_v1.sql` | valores foram para `cpf_nao_fundir_dados.local.sql` |
| 5 e-mails pessoais (Patrícia e equipe) | `email_da_compra_v3_operacao.sql` | valores foram para `emails_da_operacao_dados.local.sql` |
| ~14 telefones reais (BR, Suíça, Alemanha, Austrália) | `venda/telefone.test.ts` | trocados por fictícios de mesma forma |

O `.gitignore` ganhou `*.local.sql`: o **porquê e a estrutura** da
migração continuam versionados; só os **valores** ficam na máquina. Quem
reconstruir o banco do zero precisa rodar o par local depois da migração
— está escrito dentro dos dois arquivos, porque sem isso a tabela nasce
vazia e a regra volta a não existir. Produção não foi tocada: as duas
tabelas já tinham os dados (9 e 6 linhas, conferidas).

Os testes de telefone continuam passando (16 de 16) com os números
fictícios: eles preservam a forma que cada caso prova — DDD, quantidade
de dígitos, o 9 do celular, o assinante suíço começando em 7.

**Sobre a mecânica do espelho, que não é óbvia:** `publico/main` **não
tem ancestral comum** com o repositório privado — são duas histórias
paralelas (60 commits lá, 128 cá). Atualizar não é `push` nem
`force-push`: monta-se um commit cujo *tree* é o do HEAD e cujo *pai* é o
topo público, e empurra-se esse commit. Nada é reescrito, o histórico
público é preservado, e como a árvore vem do Git, tudo que o `.gitignore`
segura fica de fora por construção.

    TREE=$(git rev-parse HEAD^{tree})
    C=$(git commit-tree "$TREE" -p publico/main -m "…")
    git push publico "$C:refs/heads/main"

Conferido depois de publicar, pela API do GitHub: o arquivo dos CPFs tem
só o `00000000000` do exemplo, nenhum nome de cliente, e a árvore
publicada é byte a byte a mesma do HEAD (`8e8922b4`). O histórico público
antigo também foi varrido: nunca teve nenhum desses dados.

### Sem teto: a decisão e o que ela custa (06/08/2026)

Duas sessões trabalharam a mesma peça no mesmo dia e chegaram a desenhos
diferentes: esta criou a rampa **com** teto diário; a outra removeu o
teto (`aquecimento_v2_sem_teto.sql`, "a operação não trabalha com teto de
e-mail por dia"). O Davi confirmou: **sem teto**.

Consequência aplicada em `sem_teto_v1_1.sql`: o relógio
`ressoar-rampa-aquecimento` foi **desagendado** — com o teto em 0,
`subir_rampa()` devolvia "rampa concluída" sem escrever nada, e relógio
que acorda todo dia para não fazer nada engana quem for ler o sistema
depois. A função ficou (com `comment on` explicando), caso um teto volte
a fazer sentido.

**O que isso custa, e é bom estar escrito:** sem teto, o freio de
entregabilidade deixa de ser rede secundária e passa a ser a **única**
proteção — e ele age *depois* que o bounce já aconteceu, não antes. Com a
fila vazia hoje isso é teórico; no primeiro lançamento grande, não é.
Quem retomar o envio deve olhar `saude_envio(7)` logo depois do primeiro
lote, não no dia seguinte.

As telas foram alinhadas com a decisão no mesmo commit: a caixa de Envios
virou "Saúde do envio" (sem falar em rampa), e a aba Resultado do Lead
scoring passou a dizer que as seis sequências estão **desligadas
esperando revisão** — antes ela afirmava que "seis automações trabalham
sozinhas", o que virou mentira no minuto em que o Davi mandou parar.

---

## O nome "Active" acabou (06/08/2026)

O Davi achou "Active" numa tela e mandou varrer o resto. A palavra
significava três coisas diferentes aqui, e só uma delas estava errada:

| Onde aparece | O que é | O que fiz |
|---|---|---|
| "pro seu Active" | nome antigo **deste** projeto | virou "pra sua Ressoar" |
| "ActiveCampaign", "AC" | o sistema de onde a base veio | **fica** — é história real |
| `isActive` | propriedade do React Router | **fica** — é código |

Como nome do projeto sobrava em quatro lugares: uma frase na tela
(Configurações → API e webhooks → Endereços de entrada), os **quatro
relógios do pg_cron**, que se chamavam `active-*`, o `motor_v1.sql` que
criava esses nomes, e um docstring. Os relógios agora são `ressoa-*`
(`renomear_cron_ressoa_v1.sql`, atômica e repetível — o jobid muda, o
que eles fazem não). Quem for procurar tarefa agendada no banco procura
por `ressoa-`, não por `active-`.

O banco vivo foi varrido junto — mensagens, listas, tags, formulários,
automações, campanhas, segmentos, `app_config` e o código das funções:
zero ocorrência. O payload dos webhooks já não dizia `active-proprio`
desde o motor v9.

**Na mesma conversa, a tela passou a se explicar (06/08/2026).** Reclamação
do Davi: "é difícil saber pra que serve cada ferramenta". A tela listava
treze endereços com o nome técnico e o comando pronto, e nada dizia em que
situação cada um se usa — quem não montou o sistema não adivinha que o
postback do Resend é o que impede a base inteira de perder entrega. Agora
cada um tem "?" no padrão do componente `Ajuda`: as três abas, os sete
endereços de entrada, a chave-geral e os quatro exemplos de API. Cada texto
responde as mesmas três coisas: para que serve, quando se usa, e o que
acontece de ruim se for usado errado.

**Consertado no caminho: a lista "Eventos disponíveis" estava incompleta.**
Citava cinco eventos e o motor emite treze — faltavam os seis de venda
(`compra_realizada`, `compra_cancelada`, `boleto_gerado`,
`carrinho_abandonado`, `pagamento_atrasado`, `pagamento_expirou`), os dois de
comportamento (`email_aberto`, `email_clicado`) e o `lista_descadastrada`.
Quem cadastrasse webhook guiando-se por ela nunca receberia aviso de compra.
Atenção para a próxima varredura: `lead_descadastrado` **existe**, mas quem
emite é a Edge Function `descadastro`, não um gatilho do banco — procurar só
no SQL dá falso negativo, e ele tinha zero linhas em `eventos_sistema`
apenas porque ninguém havia clicado no link do rodapé ainda.

**O que NÃO foi mexido e ainda merece decisão:** três textos da tela
falam do ActiveCampaign no presente, como se ele estivesse ligado — o
aviso de "pode gerar disparo duplicado" ao ligar os webhooks, o "só saem
com a chave-geral LIGADA — pra não duplicar com o AC enquanto ele
existir" e o "enquanto o ActiveCampaign ainda estiver rodando, deixe
desligados" em Configurações. O AC morreu em 05/08 e os webhooks estão
ligados: hoje esses avisos justificam uma trava com um motivo que não
existe mais.

---

## Lives semanais: a planilha fecha o ciclo (06/08/2026)

Conta Google conectada (a conta pessoal do Davi, projeto Cloud "Ressoar") e o
passo de planilha plantado na automação das lives, apontando para
"[PATRÍCIA DOMINGOS] Lives semanais - inscritos". Uma inscrição real
percorreu: lista → tag → ManyChat (01:10) → **linha na planilha (01:11)**.

**Corrigido no caminho: a coluna "ID do Contato" recebia o uuid da Ressoar.**
Aquela planilha sempre guardou ali o identificador do **ManyChat**
(`1347252605`), que é o que permite cruzar com a conta de lá. O pacote que o
motor manda aos passos (`payload_contato`) não levava esse número — agora
leva (`payload_manychat_id.sql`), o mapeador oferece **ID no ManyChat**, e a
adivinhação de coluna entende que "ID do Contato" numa planilha de chatbot é
o id de lá, não o daqui. Vale também para webhook e Drive.

**Ritmo esperado (não é lentidão):** cada passo espera o ciclo seguinte do
cron, que roda de minuto em minuto. Inscrição → tag no mesmo minuto →
ManyChat no minuto seguinte → planilha no outro. Cerca de 2 a 3 minutos até
a linha aparecer. Um fluxo com cinco passos leva cinco minutos.

**Linhas de teste:** quatro linhas escritas durante os testes (o uuid errado
e um "TESTE Ressoar") foram apagadas da planilha em 06/08 01:05.

---

## Automações: vários gatilhos e passos arrastáveis (06/08/2026)

Duas coisas que o AC tinha e aqui faltavam:

**Mais de um gatilho por automação.** No quadro, o botão "+ outro gatilho"
acrescenta portas de entrada, ligadas por um "OU" — qualquer uma inicia o
fluxo, e a pessoa entra uma vez só mesmo que duas aconteçam juntas (o
`distinct` no casamento garante). No banco, `automacoes.gatilho` aceita
objeto (um gatilho — formato das automações herdadas, intocadas) ou array
(vários). Quem normaliza é `public.gatilhos_de()`, e as QUATRO funções que
leem o campo passaram por ela (`gatilhos_multiplos_v1.sql`):
`processar_eventos_sistema`, `verificar_datas`, `mesclar_tags` e `rel_tags`.
Esquecer uma delas seria automação que parece montada e não dispara — ou
mesclagem de tag deixando gatilho órfão. Provado em produção: automação de
teste com lista 6 + tag 85 salvou como array, o motor leu os dois, e as 13
ativas continuaram legíveis.

**Arrastar as caixinhas — passos E gatilhos.** Os dois têm alça (⠿) e se reordenam
por arrasto, com linha roxa mostrando onde a caixinha vai cair; as setas
↑/↓ da gaveta continuam para quem prefere clique. Detalhe de implementação
que importa: a posição de origem viaja no `dataTransfer` do próprio evento,
não no estado do React — entre o "peguei" e o "soltei" pode não haver
re-render, e ler o estado ali derrubava a solta. Gatilhos e passos são
zonas separadas, cada arrasto viaja com um tipo próprio
(`application/x-ressoar-gatilho` / `-passo`) e o navegador recusa a solta na
zona errada — testado: gatilho não cai no meio dos passos.

---

## Lives semanais: FUNCIONANDO de ponta a ponta (06/08/2026, 23h25)

Uma inscrição real na página publicada (`biopatriciadomingos.com.br/livessemanais`)
percorreu a corrente inteira, cronometrada:

| Etapa | Prova |
|---|---|
| Página → base | lead na lista 6 com `source = form:lives-semanais` |
| Tag | `LIVES SEMANAIS - INSCRITOS` aplicada |
| E-mail | "✅ Inscrição confirmada" — `sent` pelo Resend às 23:25 |
| WhatsApp | ManyChat marcado às 23:24 (`manychat_log`, sucesso) |

**O que estava quebrado e foi consertado no meio do caminho:** a automação
"Lives Semanais" (réplica do AC, gatilho lista 6) tinha o passo de e-mail com
o config `{"assunto": "...", "mensagem": "inscricao - live semanal"}` — só o
**nome** da mensagem, herdado do AC. O executor precisa de `mensagem_id`, e sem
ele o passo passava em branco: **ninguém que se inscrevia recebia
confirmação**, e nada no painel denunciava isso (o passo aparecia montado).
Agora aponta para a mensagem `20d3fec7…` ("✅ Inscrição confirmada", que já
estava na biblioteca, vinda do AC).

**A varredura achou mais cinco no mesmo estado — todas ligadas em 06/08** a
pedido do Davi, casando pelo assunto que estava guardado no config:

| Automação ativa | Dispara quando | Agora envia |
|---|---|---|
| Hotmart Purchase Confirmation Email | ganha a tag `ALUNO_IMERSÃO_TERAPÊUTICA` | 🎉 Sua vaga na Imersão Terapêutica está confirmada! |
| LP_COMPROU_INGRESSO_IMER_TERAP | entra na lista de comprador do ingresso | Boas-vindas à Imersão Terapêutica |
| 16LC_CADASTRADOS | entra na lista `16LC_SET25` | Confirme a sua inscrição |
| 18LC_NOV25_BLACK - Inscritos | entra na lista `18LC_NOV25_BLACK` | Finalize a sua inscrição |
| LSHT_DEZ25 | entra na lista `LSHT_DEZ25` | Confirme a sua inscrição na live exclusiva |

Seguem mudas, de propósito, as duas **desligadas**: `DESAFIO_CASA_HARMONIZADA`
e `LP_2026_01_03_COMPRADORES_INGRESSO`.

> **⚠️ Texto vencido em duas delas — revisar antes que recebam tráfego.**
> As mensagens vieram do AC como estavam:
> - **Confirmação de Compra (Imersão):** diz "Data de Início: **Sábado
>   28/03/2026 09:00**" — data que já passou. É a mais urgente: o gatilho é
>   uma compra, que pode acontecer a qualquer momento.
> - **16LC_CADASTRADOS:** diz "aulas nos dias **08, 10 e 12 de Setembro, às
>   08:00**" — datas de setembro/2025.
> - **18LC_NOV25_BLACK:** manda entrar num grupo de WhatsApp com link direto
>   (`chat.whatsapp.com/HPL5…`), de novembro/2025 — pode estar cheio ou morto.
>
> As outras duas envelhecem bem: **AC #95** (Imersão) e **AC #71** (live
> exclusiva) não citam data e usam links permanentes
> (`links.drapatriciadomingos.com.br/grupo`).

A consulta que encontra passos mudos:

```sql
select a.nome, a.ativa from automacao_passos p
join automacoes a on a.automacao_id = p.automacao_fk
where p.tipo = 'enviar_email' and p.config->>'mensagem_id' is null;
```

**Horário corrigido (06/08):** o e-mail dizia "quarta-feira às 12:37" e
"às 12h37" — erro de digitação herdado do AC, enquanto a landing sempre disse
**13h**. As quatro ocorrências (HTML e texto puro) viraram `13h` a pedido do
Davi. Nenhuma outra mensagem da biblioteca citava esse horário: as duas com
"12h00" são da Formação em Biorressonância, outro assunto.

---

## Lives semanais: as peças prontas para assumir do n8n

Como era: página de inscrição → ActiveCampaign (lista "Lives Semanais") → uma
automação de lá chamava um fluxo no n8n, que marcava a pessoa no ManyChat (tag
`LIVES SEMANAIS - INSCRITOS`), criava o assinante quando faltava e somava uma
linha numa planilha do Google. Com o AC desligado esse caminho parou de
receber gente — a última execução do fluxo foi na madrugada de 05/08.

O que já existe aqui (criado e testado em 05/08/2026):

- **Tag 85 `LIVES SEMANAIS - INSCRITOS`** — o espelho, na base, da tag que o
  n8n aplicava no ManyChat.
- **Formulário publicado `lives-semanais`** — inscreve na lista 6 (Lives
  Semanais) e aplica a tag 85. Tem página própria em
  `ressoar.drapatriciadomingos.com.br/f/lives-semanais`, e aceita POST direto
  com `form_slug=lives-semanais` + `nome`, `email`, `whatsapp`. (O endereço
  `…supabase.co/functions/v1/formulario?f=slug` **não** serve como página: o
  domínio de funções devolve HTML como `text/plain`, e o visitante veria o
  código cru. Como destino de POST, é o certo.)
- **Automação "[RESSOAR] Lives Semanais — tag no ManyChat"** — gatilho: tag 85
  adicionada; passo único: marcar `LIVES SEMANAIS - INSCRITOS` no ManyChat,
  criando o assinante se não existir. Nasceu **desativada**, de propósito.

O teste de 05/08: GET da página do formulário, POST no formato acima com um
lead real — achado pelo WhatsApp sem criar duplicata, tag aplicada, nenhuma
lista alterada, nenhum e-mail disparado.

A receita genérica para repetir isto em qualquer captação nova está em
[10 — Criar uma captação](10-CRIAR-UMA-CAPTACAO.md).

A ordem para concluir (revista em 05/08 à noite, com `executar_webhooks`
ligado e a decisão do Davi de manter a planilha como segurança):

1. ~~**Apontar a página de inscrição para cá.**~~ **FEITO em 06/08.** A landing
   fica no Lovable (projeto `d13360ee-f9c0-40a6-9ea8-62d5214c35e7`,
   `harmonized-home-flow`, rota `/livessemanais`); só o componente
   `src/components/LivesSemanaisLanding.tsx` foi alterado, e o formulário faz
   POST com `form_slug: lives-semanais`. Testado no navegador (card de
   confirmação + contador `formularios.envios` subindo) e **publicado pelo
   Davi**. Ao entrar na lista 6, a automação réplica "Lives Semanais" (ativa)
   manda o e-mail "Inscrição confirmada" — envio real, no lugar do que o AC
   mandava. Falta só a prova com uma pessoa NOVA (não feita de propósito:
   exigiria inventar um telefone, e número inventado pode ser de terceiro real).
2. ~~**Planilha sem n8n.**~~ **FEITO E PROVADO em 06/08 (madrugada).** A conta
   Google (a conta pessoal do Davi) foi conectada em Configurações → Planilhas —
   agora é um botão só; o app OAuth ("Ressoar", projeto Google Cloud
   `ressoa-504702`, consentimento Em produção) mora nos secrets da função
   (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), não na tela. O passo
   `google_sheets` nativo foi plantado na automação "[RESSOAR] Lives
   Semanais" (ordem 2, depois do ManyChat) apontando para a planilha real
   "[PATRÍCIA DOMINGOS] Lives semanais - inscritos" (`1l3wE_XQ…`, aba
   Página1, colunas ID do Contato | WhatsApp | Nome | E-mail; "ID do
   Contato" agora recebe o lead_id da Ressoar — antes era o assinante do
   ManyChat). Prova real: `executar_passo_planilha` com o lead do Davi
   escreveu a linha 487 na planilha (as 486 anteriores são do n8n), com
   sucesso registrado em `google_sheets_log`. A réplica "Automação 19"
   (webhook `livessemanais/inscrito`) foi DESATIVADA — o flow do n8n fica
   de reserva, parado. Migração: `supabase/lives_passo_planilha_v1.sql`.
   No caminho, dois consertos na função `google-sheets`: o callback do
   OAuth agora REDIRECIONA para o painel (`/config?google=ok`) porque o
   Supabase não serve HTML de `*.supabase.co` (text/plain + nosniff), e a
   porta do motor aceita os DOIS jogos de chave do projeto (env
   `sb_secret_…` E `segredos.service_key` JWT) — só com o env, todo passo
   de planilha levava 403 silencioso.
3. ~~**Ativar a automação "[RESSOAR] Lives Semanais — tag no ManyChat"**~~
   **ATIVADA E PROVADA em 06/08, 02h.** O teste foi o completo, sem simulação:
   tag 85 aplicada no lead do Davi → evento na fila → `processar_eventos_sistema`
   às 02:05:00 → `executar_automacoes` chamou o passo → ManyChat marcado às
   02:06:01 (`manychat_log`: acao "marcou", tag `LIVES SEMANAIS - INSCRITOS`,
   sucesso, assinante 1347252605), e a conta do ManyChat confirma a tag no
   assinante. **É o primeiro passo `manychat_tag` executado pelo MOTOR em
   produção** — até aqui só a tela tinha feito isso (armadilha 33).
   O `google_sheets` nativo continua sem estreia: depende da conta Google.
4. **Nada de arquivar o n8n**: decisão do Davi em 05/08 — os fluxos ficam
   como reserva. A planilha das lives passa a ser alimentada pela própria
   Ressoar (passo 2), e o registro-mestre é a base (Leads → tag 85).

Correção do mesmo dia: a nota anterior dizia que a tabela `segredos` estava
vazia — era um erro de leitura (consulta com `limit=0`, que devolve vazio por
definição). `manychat_api_key` e `service_key` estão lá desde 02/08.

---

## Importação histórica concluída

Em 02–03/08/2026, os relatórios anuais definitivos da Hotmart foram conferidos
e importados diretamente no Supabase (`scripts/importar_vendas_hotmart_csv.py`).
Eles contêm 10.178 transações únicas entre 02/08/2025 e 02/08/2026. Destas,
2.600 já estavam no Ressoar; a carga acrescentou 7.578 vendas e criou 183 leads.
Uma transação válida de um relatório anterior, imediatamente anterior ao horário
inicial do relatório anual, também foi preservada — por isso a origem
`hotmart_csv` tem 10.179 transações.

Todas as 10.178 transações dos arquivos foram reconferidas depois da carga
(em 03/08 e de novo em 05/08): faltando zero, todas com lead vinculado.
O casamento foi feito por e-mail exato sem diferença entre maiúsculas e
minúsculas; telefone conflitante foi descartado em vez de juntar pessoas
diferentes. Nenhuma automação nem e-mail foi disparado. Os CSVs e os SQLs
com dados pessoais ficaram fora do repositório.

**Moedas (corrigido em 05/08/2026):** 59 vendas foram pagas em moeda
estrangeira (CLP, COP, MXN, EUR, GBP, CHF, USD, AUD) e ficam registradas
**na moeda original** — a carga havia gravado a moeda de recebimento no
lugar da moeda da compra, o que fazia 68.304 pesos chilenos valerem
R$ 68.304. A regra de relatório (`moeda_relatorios_v1.sql`): contagem de
compras e compradores considera todo mundo; soma de dinheiro considera
só BRL.

---

## Como testar sem estragar nada

**E-mail:** o envio está DESTRAVADO. Antes de qualquer teste, coloque seu
endereço em `envio_so_para` (Configurações → E-mail) e confira com
`select public.cfg('envio_so_para')`. Ao terminar, esvazie de novo.

**ManyChat:** não há modo simulação, de propósito — o objetivo do teste é ver
a pessoa aparecendo na conta. A precaução é outra: **crie uma tag nova para
testar**. Tag recém-criada não tem automação pendurada, então nada de WhatsApp
sai. Depois apague (`removeTagByName` no assinante, `removeTag` na conta).

Toda a integração foi validada assim, e a conta ficou como estava.

A página **Automações → ManyChat** separa as operações para não haver efeito
colateral escondido:

- pessoa é procurada **somente pelo WhatsApp completo**;
- quando a busca não encontra a pessoa, a própria tela oferece a criação do
  usuário; criar não aplica tag nem roda regra de produto e impede duplicar um
  WhatsApp que já existe no campo configurado;
- "Criar tag" só cria a tag na conta;
- "Excluir" remove a tag da conta e de todos os assinantes, exige confirmação e
  só é aceito pelo servidor para um admin autenticado;
- aplicar uma tag específica não cria usuário por conta própria: primeiro é
  preciso buscar ou criar a pessoa.

Na página **Leads**, cada linha e o detalhe do lead têm a ação "ManyChat". A
gaveta procura automaticamente pelo WhatsApp da Ressoar, oferece a criação se o
usuário não existir e, quando encontra, permite aplicar ou remover tags. Leads
sem WhatsApp precisam receber o número na Ressoar antes dessas operações.

---

## Telefone: a regra que custou dois erros

O número é a chave que liga a Ressoar ao ManyChat. Errar o casamento é aplicar
tag na pessoa errada — e tag no ManyChat dispara mensagem de WhatsApp.

**A forma canônica é `DDI + DDD (sem o zero) + número`:** `5551999990000`.

Duas coisas que parecem inofensivas e não são:

1. **Comparar só o final do número junta gente diferente.** `5521 90000-0000` e
   `5511 90000-0000` têm os mesmos 10 últimos dígitos. Normalize os dois lados
   e compare inteiro — nunca trunque.
2. **Telefone fixo não ganha o nono dígito.** Desde 14/02/2017 todo celular do
   Brasil tem o 9, em todos os DDDs; não existe exceção. Então um número de 12
   dígitos ou é fixo, ou é cadastro velho de celular. Quem decide é o primeiro
   dígito depois do DDD: **2,3,4,5 = fixo** (não tem WhatsApp), **6,7,8,9 =
   celular**. Enfiar um 9 num fixo inventa o número de outra pessoa.

A regra vive em três lugares e os três precisam concordar:
`public.normalizar_telefone` (SQL), `formatarTelefone` (Edge Function do
ManyChat) e o nó "Formatar telefone" do n8n — **este último ainda tem a regra
antiga e adiciona 9 em fixo.**

---

## Mapa rápido do sistema

```
Hotmart  ──webhook──►  /functions/v1/venda
                            │
                            ├─► registra o pedido e seu estado
                            ├─► se aprovado, aplicar_mapa_produto:
                            │      lista + tag de turma + tag no ManyChat
                            └─► eventos (carrinho abandonado, boleto…)
                                    │
pg_cron (todo minuto) ──────────────┴─► processar_eventos_sistema
                                        executar_automacoes
                                        processar_fila_envios ──► Resend
                                        processar_campanhas
```

- **Motor:** `supabase/motor_v*.sql`. A ordem de aplicação está em
  `supabase/ordem.txt` — é a fonte única, lida pelos dois instaladores.
- **Funções públicas:** `app/functions/`, onze delas. Função nova precisa da
  entrada `[functions.nome]` com `entrypoint` em `supabase/config.toml` — sem
  ela o deploy falha com "Entrypoint path does not exist".
- **Painel:** `app/painel/`, React + Vite, publicado no Cloudflare Pages.

---

## Regras de trabalho que valem sempre

1. **A conta do ActiveCampaign foi desligada e continua intocável.** O que
   sobrou de acesso é somente leitura — os dados de lá são o backup histórico.
2. **Nada de dado pessoal no GitHub.** Sem `.env`, sem chave, sem `.csv`, sem
   telefone ou e-mail de gente real — nem em exemplo de documentação. O
   repositório é público.
3. **Produção é tudo junto:** GitHub, Supabase e Cloudflare atualizados na
   mesma leva. São três repositórios, e os três ficam com a mesma árvore.
4. **Não teste com leads reais.** Foi assim que quatro pessoas receberam um
   e-mail cujo corpo era a letra "a" (armadilha 28). O cron escoa a fila em
   até 60 segundos — menos do que o intervalo entre rodar o teste e ler o
   resultado. Com o envio destravado, isso vale em dobro.
5. **Tela que salva não prova que o motor executa.** Dois passos de automação
   estavam quebrados justamente porque só a tela tinha sido conferida
   (armadilha 33).
