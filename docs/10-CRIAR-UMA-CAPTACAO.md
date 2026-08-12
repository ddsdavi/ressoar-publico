# 10 — Criar uma captação do zero

A receita completa para colocar uma nova captação no ar: página de inscrição →
lead na base, na lista certa, com a tag certa, marcado no ManyChat e anotado na
planilha. Tudo pela tela, sem tocar em banco nem em código.

É a mesma receita usada nas Lives Semanais em 06/08/2026. Serve para qualquer
evento, aula, lista de espera ou lançamento.

---

## As quatro peças, e por que nesta ordem

| Peça | Para que serve | Onde |
|---|---|---|
| **Lista** | onde a pessoa mora. Uma por evento/produto | Contatos → Listas |
| **Tag** | o que aconteceu com ela. É o gatilho das automações | Contatos → Tags |
| **Formulário** | a porta de entrada: inscreve na lista e aplica a tag | Formulários |
| **Automação** | o que acontece depois: e-mail, ManyChat, planilha | Automações |

A ordem importa: o formulário só consegue escolher listas e tags que **já
existem**, e a automação só consegue escutar uma tag que **já existe**.

**Lista ou tag?** A lista responde "de onde essa pessoa veio"; a tag responde "o
que ela fez". Na prática você quase sempre quer as duas — a lista para segmentar
e mandar e-mail depois, a tag para disparar a automação agora. Tag também é o
que espelha o ManyChat: [08 — ManyChat](08-RECUPERACAO-E-CONTEUDO.md).

---

## Passo 1 · Criar a lista

**Contatos → Listas → + Nova lista.** Nome só. Use um padrão que você reconheça
daqui a seis meses: `LIVES_SEMANAIS`, `IMERSAO_SET26`, `LISTA_ESPERA_FORMACAO`.

Uma lista recém-criada não tem automação pendurada — nada dispara ao criá-la.

## Passo 2 · Criar a tag

**Contatos → Tags → + Nova tag.**

Se essa captação vai marcar a pessoa no ManyChat, **use exatamente o mesmo nome
nos dois lados** — a tag daqui e a tag de lá. Nome diferente cria uma tag
paralela que nenhuma automação do ManyChat escuta: a pessoa fica marcada e nada
acontece. Foi por isso que a das lives se chama `LIVES SEMANAIS - INSCRITOS`
aqui e lá.

## Passo 3 · Criar o formulário

**Formulários → + Novo formulário.**

| Campo | O que preencher |
|---|---|
| Nome interno | só você vê. `Captação Lives Semanais` |
| Endereço da página | vira `…/f/lives-semanais`. Deixe vazio para gerar do nome |
| Título / Frase de apoio | o que a pessoa lê, se usar a página pronta |
| Campos do formulário | nome e e-mail já vêm. Adicione **WhatsApp** se for marcar ManyChat |
| **Inscreve na lista** | a do passo 1 |
| **Aplica a tag** | a do passo 2 |
| Mensagem depois de enviar | ou uma URL em *redirecionar*, para levar a uma página de obrigado |
| No ar | deixe marcado |

O e-mail é obrigatório e não pode ser removido: é ele que identifica a pessoa.

**A lista e a tag ficam guardadas no formulário, não são enviadas pela página.**
Isso não é detalhe de implementação — é o que impede alguém de chamar o endereço
por fora e inscrever gente numa lista que dispara e-mail.

## Passo 4 · Instalar o formulário

São três caminhos, todos no botão **Instalar no site** de cada formulário. O
primeiro não exige site nenhum; os outros dois preservam o visual da sua página.

### Caminho A — usar a página pronta

Cada formulário já nasce com uma página no ar, no domínio da Ressoar:

```
https://ressoar.SEUDOMINIO.com.br/f/lives-semanais
```

**Instalar no site → Só divulgar o link** entrega esse endereço. Serve para link
na bio, anúncio ou mensagem de WhatsApp. O visual é o desta plataforma, com a cor
escolhida — não o do seu site.

> **Não use o endereço `…supabase.co/functions/v1/formulario?f=slug` como
> página.** Ele existe, mas o domínio de funções serve HTML como texto puro (uma
> proteção contra hospedarem página falsa lá) — o visitante veria o código-fonte
> cru. Como *destino de POST* ele é o certo; como *página*, nunca.

### Caminho B — colar um bloco de código no seu site

**Formulários → Instalar no site → Colar no meu site.** Copie e cole onde quiser:

| Onde | Onde colar |
|---|---|
| WordPress | bloco *HTML personalizado* (no Elementor, o widget *HTML*) |
| Lovable, Framer, Webflow | qualquer bloco de código ou *embed* |

**Ele assume a identidade do seu site sozinho.** A fonte, a cor do texto e o
fundo são herdados da página onde ele foi colado (`font: inherit`); só o botão
usa a cor escolhida aqui. Foi testado colando o mesmo bloco numa página de
fonte serifada e fundo escuro: ficou serifado e claro, sem um ajuste sequer.

É por isso que este caminho preserva o visual e o *iframe* não — o iframe é uma
página de fora, com a tipografia dela.

### Caminho C — a página já tem um formulário e você quer manter aquele

**Formulários → Instalar no site → Pedir para a IA / programador.** Copie o
texto e mande para quem cuida da página (ou cole no chat do Lovable). O
formulário continua exatamente como está e só passa a enviar para cá.

**Campos além dos três:** qualquer outro campo enviado dentro de um objeto
`atributos` é gravado no lead. E se a landing receber `?utm_source=…`, a página
pronta captura sozinha — num formulário próprio, quem quiser atribuição precisa
repassar esses parâmetros.

## Passo 5 · A automação

**Automações → + Nova automação.** Ela **nasce desativada**, de propósito.

**Gatilho:** *Tag é adicionada* → a tag do passo 2.

> Por que a tag e não a lista: a tag é aplicada uma vez por pessoa. A lista, se a
> pessoa já estiver nela, não muda nada — e não dispara. Quem se inscreve de novo
> num evento que já participou entraria no fluxo pela tag, e não pela lista.

Depois, os passos. Os três mais usados:

### Enviar um e-mail

Escolha uma mensagem da biblioteca (Mensagens). É o e-mail de confirmação —
"sua inscrição está garantida", com data, hora e link.

### Marcar no ManyChat

| Campo | O que fazer |
|---|---|
| Tag no ManyChat | comece a digitar: a tela lista as tags **reais da sua conta** |
| Se a tag não existir lá | aparece o aviso e o botão **Criar agora no ManyChat** |
| Criar o assinante se não existir | deixe marcado |

Com isso o passo faz as duas coisas: **acha a pessoa pelo WhatsApp e aplica a
tag, ou cria a pessoa e aplica**. A busca é pelo campo personalizado configurado
em Configurações → ManyChat (na conta da Patrícia, `WHATSAPP-ID`) — por isso o
formulário precisa pedir WhatsApp. Sem número, o passo não cria ninguém:
assinante sem número nunca receberia mensagem.

> **A ordem que evita o susto:** crie a tag no ManyChat e pendure o fluxo de
> WhatsApp nela **antes** de ativar a automação. Tag criada na hora pelo passo
> nasce sem fluxo pendurado — a pessoa é marcada e não recebe nada.

### Escrever na planilha

| Campo | O que fazer |
|---|---|
| Link da planilha | cole o endereço e clique em **Carregar** |
| Aba | escolha na lista que aparece |
| Colunas | para cada título do cabeçalho, escolha o que entra |

Precisa da conta Google conectada uma vez em **Configurações → Planilhas**. A
conta conectada tem que ter permissão de edição na planilha.

---

## Antes de ativar: a conferência que evita retrabalho

1. **Abra a página e inscreva você mesmo**, com um e-mail e um celular seus que
   ainda não estejam na base. Com dados que já existem, o sistema reconhece a
   pessoa e **não dispara nada** — o teste passa sem provar nada.
2. **Contatos → Leads:** a pessoa apareceu, na lista certa e com a tag certa?
3. **O e-mail chegou?** Se não, veja Envios — a fila escoa em até 60 segundos.
4. **Automações → ManyChat:** procure a pessoa pelo WhatsApp e veja se a tag
   entrou lá.
5. **A planilha ganhou a linha?**

Só então ative a automação — e, se ela manda e-mail, lembre que o envio está
destravado: vai para gente de verdade.

---

## Armadilhas desta receita

**Nunca invente um número de telefone para testar.** Número inventado pode ser
de uma pessoa real, e com o ManyChat ligado ela receberia WhatsApp indevido.
Teste com um número seu.

**Tag nova no ManyChat não tem fluxo pendurado.** É por isso que ela também é o
jeito seguro de testar: crie uma tag nova só para o teste, veja a pessoa sendo
marcada, e apague depois.

**Duas fontes marcando a mesma pessoa criam assinante repetido.** Se um fluxo do
n8n já marca essa mesma tag, desligue ele antes de ativar a automação daqui.

**Formulário excluído derruba o endereço na hora.** Os leads ficam; o link
quebra. Desmarcar *No ar* é o jeito reversível.

**Se a página não estiver publicada, nada disso acontece.** No Lovable, o
`Publish` é um clique à parte do salvar — o preview já mostra o novo, e o site
público continua servindo o antigo.
