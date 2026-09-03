# 11 — Duplicar e vender

Como criar uma **segunda instalação** da Ressoar, independente desta, para
outra operação — e o que decidir antes de vender uma.

Última revisão: 03/09/2026.

---

## O que é uma cópia

Uma cópia é outra Ressoar inteira, em contas que não são as desta operação:
banco, login e funções num projeto **novo** do Supabase; painel num projeto
**novo** do Cloudflare Pages; domínio, provedor de envio e integrações do
comprador. Nada é compartilhado — nem chave, nem base, nem histórico. O que
viaja de uma para a outra é só o **código**, e ele já foi desenhado para isso:
o instalador de um comando lê um `.env` e monta tudo a partir dele.

Não existe "modo multi-cliente" no mesmo banco, e não deve existir: os leads
de uma operação e os de outra nunca ficam no mesmo lugar (LGPD e bom senso).

---

## O que o comprador recebe, e o que não recebe

| Recebe | Não recebe, nunca |
|---|---|
| O código: `app/`, `supabase/`, `scripts/`, os dois instaladores | `.env`, `.secrets.env` e qualquer chave desta operação |
| A documentação (`docs/`) e o `.env.example` | `*.local.sql` — migrações cujos **valores** são dado pessoal |
| O direito de uso combinado em contrato (ver o fim) | `activecampaign-export/`, `vendas-hotmart/`, `operacao/`, `blueprint/` |
| | `PASSAGEM.md` e `docs/10-PLANO-SEGURANCA.md` (ficam fora do espelho público) |
| | A base de leads, as vendas, os envios — os dados desta operação |

---

## De onde sai o código da cópia

**Do espelho público, nunca dos repositórios privados.** Os privados
(`ddsdavi/ressoar` e `patriciadomingos-biorresonancia/ressoar`) carregam nos
commits o histórico inteiro desta operação — nomes, números, decisões. O
público (`ddsdavi/ressoar-publico`) tem a **mesma árvore de arquivos**, sem
esse histórico e sem os arquivos da tabela acima. É ele que se entrega.

```bash
git clone https://github.com/ddsdavi/ressoar-publico.git ressoar-NOME-DO-COMPRADOR
cd ressoar-NOME-DO-COMPRADOR
git remote set-url origin https://github.com/CONTA-DO-COMPRADOR/ressoar.git   # o repositório PRIVADO dele
git push -u origin main
```

Uma pasta por instalação, cada uma com o seu `.env`. **O `.env` decide onde o
instalador escreve**: rodar o instalador de uma pasta com o `.env` de outra
reescreve o banco de outra. Nunca copie um `.env` entre pastas.

O espelho precisa estar em dia com o `main` antes de cada cópia (e antes de
cada atualização de uma cópia). Como: "O espelho público", no fim.

---

## As contas que a nova operação precisa

Tudo em nome do comprador, criado por ele — ou com ele ao lado. Senha dele
não passa por você, e o `.env` dele fica com ele.

| Serviço | Para quê | Onde a doc ensina |
|---|---|---|
| Supabase (projeto novo) | banco, login, funções, o motor | [01](01-INSTALAR.md), passo 1 |
| Cloudflare (a conta **dona do domínio**) | o painel (Pages) e, opcional, o Worker dos links | [01](01-INSTALAR.md), passo 2 · armadilha 10 |
| Domínio próprio | o endereço do painel e dos links de e-mail | [01](01-INSTALAR.md), passo 6 |
| Resend ou Amazon SES | o envio real | [05](05-LIGAR-ENVIO-REAL.md) |
| Um webhook transacional (n8n ou outro) | os códigos de segurança da conta | [01](01-INSTALAR.md), passo 7 |
| Google Cloud (app OAuth) | planilhas nas automações — opcional | `.env.example`, bloco Google |
| ManyChat | WhatsApp — opcional | [08](08-RECUPERACAO-E-CONTEUDO.md) |
| Hotmart | receber vendas — opcional | [07](07-VENDAS-E-HOTMART.md) |

---

## O passo a passo

### 1. O código

O clone acima.

### 2. O `.env`

`cp .env.example .env` e preencher **tudo** — cada linha diz onde achar.
Além das chaves de sempre, quatro linhas decidem a cara da cópia; o
instalador passou a levá-las para o lugar certo em 03/09/2026:

| Linha do `.env` | Vira |
|---|---|
| `VITE_MARCA_NOME`, `VITE_MARCA_RODAPE` | a assinatura no painel e nos e-mails de conta |
| `VITE_OG_URL` | o endereço público do painel: a imagem de compartilhamento, o destino de cortesia de um link de rastreio quebrado (secret `URL_PAINEL`) e o botão do resumo diário (`url_painel`) |
| `REMETENTES_VERIFICADOS` | os "De:" que o provedor aceita — sem isso **nenhuma campanha sai**; a guarda barra e diz o porquê |
| `CLOUDFLARE_PAGES_PROJECT` | o nome do projeto no Pages (vazio = `ressoar`) |

### 3. O instalador

```bash
./instalar.sh        # Linux/Mac
.\instalar.ps1       # Windows
```

Ele aplica as migrações de `supabase/ordem.txt`, grava no banco os valores
desta instalação (`scripts/configurar_instancia.py`: `url_api_interna`,
`url_painel`, `remetentes_verificados`), publica as 11 funções, grava os
secrets que estão no `.env` e sobe o painel.

### 4. Limpar o conteúdo da operação de origem — o passo que só existe na cópia

```bash
python scripts/run_sql_file.py supabase/nova_operacao_v1.sql
```

No Windows, rode no mesmo PowerShell em que rodou o instalador (ele deixa as
variáveis do `.env` carregadas). No Linux/Mac, antes: `set -a; source .env; set +a`.

Por que existe: as migrações são as mesmas para toda instalação, e algumas
criam, junto com a estrutura, o **conteúdo** da operação onde a plataforma
nasceu — sete automações `[RESSOAR] …` (recuperação de pagamento, carrinho
abandonado, janela quente, planilha do Desafio…), doze mensagens de
sequência com os textos e os links daquela casa, e a tag do ManyChat de lá.
Algumas dessas automações nascem **ativas**: sem este passo, o primeiro
carrinho abandonado do comprador receberia o e-mail de outra operação.

O roteiro só roda numa base **vazia** (sem leads e sem envios): a primeira
coisa que ele faz é conferir isso, e recusa se não for. Não mexe em tabela,
função, permissão, relógio, regra de pontuação nem nos valores que o
instalador acabou de gravar. E deixa a marca `conteudo_origem = removido`
em `app_config`: as quatro migrações que semeiam esse conteúdo a veem e
pulam, então rodar o instalador de novo (atualizações) **não** traz nada de
volta. Só uma base reinstalada do zero volta a ter o conteúdo — aí é rodar
este passo de novo.

### 5. Primeiro admin, domínio e Auth

[01](01-INSTALAR.md), passos 5 e 6 — e não esqueça a *URL Configuration* do
Auth no Supabase, com o endereço final do painel.

### 6. Configurações, no painel

- Nome e e-mail do remetente padrão.
- **Endereço dos links** (`base_url_tracking`): o que o lead vê nos links de
  rastreio e descadastro. Com o Worker `em` (passo 9), o domínio dele; sem
  Worker, `https://<ref-do-projeto>.supabase.co/functions/v1`. Sem esse valor
  o motor **não envia** — é a guarda do rodapé legal.
- Provedor de envio e chave, conforme [05](05-LIGAR-ENVIO-REAL.md).

### 7. Secrets que o instalador não grava

Cada função lê os seus do ambiente do Supabase. O instalador leva os que
estão no `.env` (`RESSOAR_EMAIL_*`, `MARCA_NOME`, `URL_PAINEL`, `AWS_*`,
`SES_SEGREDO`); estes vão à mão — pelo painel do Supabase (*Edge Functions →
Secrets*) ou por `python scripts/definir_secret.py NOME` com o valor na
variável de ambiente de mesmo nome, e o valor nunca passa por chat:

| Secret | Função | O que é |
|---|---|---|
| `VENDA_SEGREDO` | `venda` | o *hottok* da Hotmart do comprador ([07](07-VENDAS-E-HOTMART.md)) |
| `RESEND_WEBHOOK_SECRET` | `postback-resend` | o *signing secret* do Resend — só se usar Resend |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `google-sheets` | o app OAuth do comprador; tela de consentimento **em produção** |

A chave do ManyChat e outros segredos de execução vivem na tabela
`public.segredos`, gravados pela tela de Configurações.

### 8. Envio real e aquecimento

[05](05-LIGAR-ENVIO-REAL.md), inteiro. O aquecimento não é opcional — domínio
novo que dispara para base fria vai para o spam por meses.

### 9. Worker `em` (opcional, recomendado)

Os links de e-mail com a cara da marca, em vez de `supabase.co`. Três linhas
falam desta operação e precisam virar as do comprador:

| Arquivo | Linha | Trocar por |
|---|---|---|
| `app/workers/em/wrangler.toml` | `pattern = "em.…"` | o subdomínio dele (a zona tem de estar na conta Cloudflare que publica) |
| `app/workers/em/index.js` | `const ORIGEM = "https://….supabase.co/functions/v1"` | o projeto Supabase dele |
| `app/workers/em/index.js` | `Response.redirect("https://…/", 302)` | o painel dele |

Depois, `cd app/workers/em && npx wrangler deploy` na conta dele, e
`base_url_tracking` = `https://<o subdomínio>`.

### 10. Integrações

Hotmart ([07](07-VENDAS-E-HOTMART.md)), ManyChat ([08](08-RECUPERACAO-E-CONTEUDO.md)),
o webhook transacional ([01](01-INSTALAR.md), passo 7) e o Google — tudo com
as contas do comprador, e cada uma testada como a doc manda.

### 11. A prova

Antes de entregar, no SQL Editor do projeto **dele**:

```sql
select chave, valor from public.app_config
 where chave in ('url_api_interna', 'url_painel', 'remetentes_verificados', 'base_url_tracking');
-- tudo com o projeto, o domínio e o remetente DELE

select count(*) from public.automacoes where nome like '[RESSOAR]%';   -- 0
```

E de fora:

```bash
curl -sI "https://<ref-dele>.supabase.co/functions/v1/rastreio?t=c" | grep -i location
# 302 para o painel dele — nunca para o desta operação
```

Por fim, um envio de teste com `envio_so_para` preenchido com o e-mail dele
(armadilha 28: o cron escoa a fila em 60 segundos — nunca enfileire lead real
para testar).

---

## O que continua falando desta operação depois de tudo

| Onde | O quê | O que fazer |
|---|---|---|
| `supabase/pontuacao_venda_v1.sql` | a **esteira do lead scoring de venda**: os degraus (`formacao_janela_quente`, `desafio_lives`…) e os nomes de produto (`Formação em Biorressonância`, `Black Ressonante`) são desta operação | A cópia roda, mas a "próxima oferta" só faz sentido depois de reescrever a régua para os produtos do comprador. **É a maior adaptação por operação**, e é trabalho de programação. |
| `[RESSOAR]` nos relógios do cron, `usuarios_ressoar`, `.ressoar-form` | o nome do **produto**, não do cliente | Fica. |
| `app/painel/src/pages/Landing.tsx` | o WhatsApp e o Instagram de quem construiu, como crédito | Decisão de quem vende: manter o crédito ou trocar. |
| `docs/09-ONDE-PAREI.md`, `docs/superpowers/` | a história desta operação | Pode apagar na cópia. |
| `instalar.ps1`, `scripts/definir_secret.py` | comentários citam um nome como exemplo de acento corrompido | Inofensivo. |
| Mensagens `AC #…`, listas, tags, regras de produto | **não vêm**: são dados, não código | Nada. O comprador monta as dele pela tela ([10](10-CRIAR-UMA-CAPTACAO.md)). |

---

## Manutenção depois da venda

- **Atualizações.** Quem vende publica no espelho público; na cópia,
  `git pull` seguido de `./instalar.sh` (é seguro repetir). Antes de puxar,
  ler o [09](09-ONDE-PAREI.md) e o [06](06-PROBLEMAS-CONHECIDOS.md) da versão
  nova. Uma migração nova entra em `ordem.txt` e o instalador a aplica; o
  passo 4 **não** precisa ser repetido.
- **Cada instalação tem o seu `.env`**, e cada `.env` é do dono da instalação.
  O de uma nunca entra na pasta da outra.
- **`nova_operacao_v1.sql` é roteiro de primeira hora.** Ele recusa base com
  gente, mas não trate isso como a única barreira.

---

## Antes de vender: o que não é código

Nada disto se resolve no repositório. É contrato, e vale um advogado — esta
lista é o que ele precisa saber.

1. **Direito de licenciar.** A plataforma nasceu para uma operação
   específica. Confirme por escrito, com quem pagou o desenvolvimento, que
   você pode licenciá-la a terceiros, e em que termos (exclusividade, nicho,
   região).
2. **Licença de uso, não venda do código.** O README diz "uso interno, sem
   licença aberta", e continua valendo: o comprador recebe uma licença **por
   instalação**. Definir: pode revender ou sublicenciar? recebe atualizações
   por quanto tempo? suporte incluído? o que acontece se parar de pagar?
3. **Dados e LGPD.** O comprador é o controlador dos dados da operação dele.
   Você nunca recebe a base dele, e ele nunca recebe a desta operação. Deixar
   escrito — inclusive quem responde por um vazamento em cada instalação.
4. **Quem instala e quem guarda as chaves.** Se você instala por ele, as
   contas e as chaves são dele e ficam com ele ao final; nada de `.env` dele
   guardado com você.
5. **Nome e marca.** "Ressoar" é o nome do produto. Combinar se a cópia usa o
   nome ou marca própria (`VITE_MARCA_*`), e quem responde pela marca.

---

## O espelho público

O espelho (`ddsdavi/ressoar-publico`) não compartilha histórico com o `main`:
cada publicação é **um** commit em cima de `publico/main` cuja árvore é a
árvore do `main`, menos o que fica de fora (`docs/10-PLANO-SEGURANCA.md` —
lista o que ainda não está protegido, e isso não se publica). O `.gitignore`
já segura o resto (`.env`, `.csv`, `*.local.sql`, `PASSAGEM.md`, `operacao/`…).

```bash
scripts/publicar_espelho.sh                # monta o commit e mostra o que mudaria
MSG="Poe o espelho em dia: ..." scripts/publicar_espelho.sh --publicar
```

Ele recusa qualquer árvore com arquivo proibido, e imprime as linhas novas
com cara de e-mail ou telefone para você olhar uma a uma antes de publicar
(README, "Antes de publicar"). Foi assim que o espelho voltou a andar em
03/09/2026, depois de 20 dias parado.
