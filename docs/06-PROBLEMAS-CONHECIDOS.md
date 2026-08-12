# Armadilhas conhecidas

Cada item aqui custou tempo real de depuração. Leia antes de mexer na parte correspondente.

---

## 1. A API do banco corta em 1.000 linhas — nunca some no navegador

**Sintoma:** contagens absurdamente erradas nas telas de Listas e Tags.

**Causa:** o painel buscava todos os vínculos (`lead_listas`, N linhas) para contar no
navegador. O PostgREST devolve no máximo **1.000 linhas** por requisição, silenciosamente.
A conta saía feita sobre 7% dos dados.

**Regra:** qualquer contagem, soma ou média **é feita no banco** — com função SQL
(`contagem_listas()`, `contagem_tags()`) ou `count: 'exact', head: true`.
Nunca traga linhas para contar no front.

---

## 2. Acento vira `?` quando gravado via `curl` no Windows

**Sintoma:** "a dona da conta" gravada como `Patr<?>cia` (bytes `efbfbd` = caractere de erro).

**Causa:** JSON inline no `curl` pelo Bash do Windows converte o texto para cp1252 e perde o acento.

**Regra:** para gravar texto com acento, use **arquivo `.sql` em UTF-8**
(`python scripts/run_sql_file.py arquivo.sql`) ou Python com
`json.dumps(..., ensure_ascii=False).encode('utf-8')`. Nunca `-d '{"nome":"a dona da conta"}'`.

**Como detectar:** `select ... where campo like '%' || chr(65533) || '%'`

---

## 3. Tabela criada pela API não tem permissão para o PostgREST

**Sintoma:** `permission denied for table X` mesmo com as políticas certas.

**Causa:** tabelas criadas via Management API não herdam os `grant` que o painel do Supabase
aplica automaticamente.

**Solução:** depois de criar tabelas, rode:

```sql
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
```

Quem protege os dados são as **policies** (RLS), não a ausência de grant.

---

## 4. A Management API do Supabase bloqueia o User-Agent padrão do Python

**Sintoma:** `HTTP 403: error code: 1010` em toda chamada.

**Causa:** o Cloudflare na frente da `api.supabase.com` bloqueia o User-Agent do `urllib`.

**Solução:** mande um User-Agent qualquer:
```python
headers={"User-Agent": "ressoa/1.0", ...}
```

---

## 5. `id_greater` da API do ActiveCampaign devolve ordem aleatória

**Sintoma:** exportação de contatos trouxe 201 de N e parou.

**Causa:** o parâmetro `id_greater` não garante ordenação — a paginação entra em loop.

**Solução:** pagine por **`offset`**. Confira o total pelo `meta.total` da resposta.

---

## 6. O endpoint global `/contactTags` do AC pula registros

**Sintoma:** faltaram 4.462 associações de tag (28% do total), com repetição de itens.

**Causa:** paginação instável no endpoint global.

**Solução:** busque **tag por tag** (`/contacts?tagid=X`) e confira cada uma contra o
`subscriber_count` oficial da tag. Foi assim que fechamos N associações, 1:1 com o AC.

---

## 7. Personalização do e-mail de login exige SMTP próprio

**Sintoma:** `Email template modification is not available for free tier projects`.

**Causa:** o Supabase só deixa personalizar os e-mails de autenticação com SMTP próprio.
Além disso, o serviço de e-mail padrão dele é limitado a poucos envios por hora.

**Solução adotada:** o Ressoar **não usa** o e-mail do Supabase para recuperar senha.
Tem fluxo próprio (`conta-email` → código de 6 dígitos → e-mail da marca pelo webhook).

---

## 8. Link de recuperação do Supabase loga direto, sem pedir senha nova

**Sintoma:** clicar no link do e-mail entrava na conta sem trocar a senha.

**Causa:** o fluxo PKCE (`?code=`) troca o código por sessão automaticamente.

**Solução:** fluxo próprio com código digitado (item 7). A tela de login também detecta
links antigos (`type=recovery` ou `?code=`), desloga e manda pedir um código novo.

---

## 9. Escala de texto: `zoom` está errado

**Sintoma:** aumentar a fonte dava zoom na tela inteira, incluindo menus e espaçamentos.

**Solução:** escalar **só o texto**, com a variável `--escala-texto` multiplicando todo
`font-size` (`calc(14px * var(--escala-texto))`), inclusive os estilos embutidos nos
componentes. Layout, ícones e larguras ficam intactos.

---

## 10. Conta Cloudflare do domínio ≠ conta do projeto

**Sintoma:** `Authentication error [code: 10000]` ao publicar ou anexar domínio.

**Causa:** o wrangler estava logado numa conta e a zona do domínio estava em outra.

**Solução:** `npx wrangler login` e escolher a conta **dona do domínio**; criar o projeto
Pages nessa mesma conta. O token OAuth do wrangler **lê** zonas mas **não escreve DNS** —
o registro CNAME precisa ser criado à mão no painel.

---

## 11. Uma regra de CSS do mobile escondia controles

**Sintoma:** o "A" do seletor de tamanho de texto sumia no celular.

**Causa:** `.ac-topbar .direita span { display: none }` escondia **todos** os spans, não só o nome.

**Solução:** usar filho direto — `.ac-topbar .direita > span`.

---

## 12. Balão do tour fugia da tela em alvos altos

**Sintoma:** no passo da barra lateral, o balão saía do campo de visão.

**Causa:** a posição era calculada só como "abaixo ou acima" do alvo. Alvo do tamanho da
tela não deixa espaço em nenhum dos dois.

**Solução:** tentar abaixo → acima → ao lado → centro, e **travar dentro da tela** no fim.

---

## 13. Automação "concluída" que nunca executou nada

**Sintoma:** execuções aparecem com status **concluída** e nenhum passo aconteceu. Nenhum
erro, nenhum alerta.

**Causa:** `automacao_execucoes.passo_atual` tinha `default 0`, mas os passos são numerados
a partir de **1**. Toda execução criada por gatilho procurava o passo 0, não achava, e se
marcava concluída na hora.

**Por que é grave:** terminava com status de **sucesso**. O relatório mostrava execuções
concluídas e ninguém desconfiava. Nenhuma automação por gatilho jamais funcionou até isso
ser descoberto.

**Como detectar:**
```sql
select passo_atual, status, count(*) from public.automacao_execucoes group by 1,2;
```
Se houver `passo_atual = 0` com `concluida`, é este bug.

**Regra:** ao mudar o filtro de status ou o contador do executor, rode
`supabase/teste_automacao.sql` — ele prova a cadeia inteira e não manda e-mail.

---

## 14. Variável CSS que não existe vira transparente, sem avisar

**Sintoma:** o quadro da automação aparecia **por cima da lista**, com as duas telas
visíveis ao mesmo tempo.

**Causa:** `background: var(--fundo)` com `--fundo` inexistente. O navegador não reclama —
simplesmente não aplica cor. Os nomes reais tinham prefixo `--ac-`.

**Regra:** antes de usar uma variável, confira que ela existe:
```bash
grep -o "var(--[a-z0-9-]*" src/**/*.tsx | sort -u
grep -o "^\s*--[a-z0-9-]*:" src/index.css | sort -u
```
A segunda lista precisa conter a primeira.

---

## 15. Caixa de marcar gigante

**Sintoma:** cada `checkbox` virava um quadrado de 38 px ocupando a linha toda.

**Causa:** a regra `input, select, textarea { width: 100%; height: 38px }` vale para
**todo** input, inclusive checkbox e radio.

**Solução:** regra própria depois da genérica, com `width: auto; height: auto`.

---

## 16. HTML servido por Edge Function não renderiza

**Sintoma:** a página do formulário voltava como **código-fonte** em vez de página.

**Causa:** o Supabase força `Content-Type: text/plain` e `nosniff` em HTML servido pelo
domínio de funções — proteção contra hospedarem página falsa lá.

**Solução:** servir a página pelo domínio do próprio painel. Ficou melhor: endereço próprio
passa mais confiança numa página de captação.

---

## 17. Hotmart manda o DDD separado

**Sintoma:** telefone do comprador chegando sem DDD e virando contato duplicado.

**Causa:** para brasileiros, a Hotmart manda `buyer.checkout_phone_code` (o DDD) e
`buyer.checkout_phone` (o resto) em **campos diferentes**.

**Solução:** concatenar antes de normalizar.

---

## 18. `price` não é o que o cliente pagou

**Sintoma:** total gasto por cliente subestimado em toda compra parcelada.

**Causa:** `purchase.price` é o valor da oferta. `purchase.full_price` é o que a pessoa
**realmente pagou**, com taxas e juros. Num teste: 197 contra 227,50.

**Regra:** para receita e total gasto, use sempre `full_price`.

---

## 19. Taxa de conversão com denominador enviesado

**Sintoma:** "97% de conversão" no relatório de origem — número bom demais.

**Causa:** a origem só era gravada quando vinha **junto com a compra**. O denominador
continha apenas quem já tinha convertido, então qualquer percentual dava perto de 100%.

**Por que é grave:** leva a colocar mais verba com base numa conta que não significa nada.

**Solução:** capturar a origem também na **captação** (formulário lê `utm_*`, `sck` e
`xcod` da URL). Enquanto não houver leads sem compra com origem, o painel exibe o aviso em
vez do número.

---

## 20. Nunca ligue validação de token sem confirmar o valor

**Sintoma potencial:** o sistema passa a recusar vendas reais.

**Regra:** ativar uma verificação com o valor errado é **pior** do que o risco que ela
evita — perder venda é dano imediato e silencioso.

**Caminho seguro, nesta ordem:**
1. capturar o token recebido sem exigir nada
2. conferir que todas as requisições trazem o **mesmo** valor
3. conferir que **nenhuma** requisição chega sem token depois que a captura entrou no ar
4. só então ativar, e testar os três casos: sem token, token errado, token certo

---

## 21. Upsert de reembolso apagando dados da venda

**Sintoma:** depois do reembolso, a venda ficava sem forma de pagamento e sem parcelas.

**Causa:** o evento de reembolso não traz esses campos, e o upsert gravava nulo por cima
do que a venda original tinha. O status ficava certo e o resto sumia.

**Regra:** em upsert de evento parcial, o que chega vazio precisa **preservar** o que já
estava lá — leia a linha existente e faça o merge.

---

## 22. Chave errada no JSON do segmento passa despercebida

**Sintoma:** um segmento devolvia a base inteira para qualquer valor de filtro.

**Causa:** o construtor espera `{"campo": "..."}`; foi enviado `{"tipo": "..."}`. Sem
correspondência, o predicado vira nulo e a condição é **descartada em silêncio** — não dá
erro, só devolve tudo.

**Como detectar:** teste com dois ou três valores diferentes. Se o número não mudar, a
condição não está sendo aplicada.

---

## 23. Chave de serviço em tabela que o painel lê

**Sintoma:** nenhum. Esse é o ponto.

**Causa:** para o agendamento chamar uma Edge Function, a chave de serviço foi guardada
em `app_config`. Só que a tela de Configurações carrega `app_config` **inteiro** — ou seja,
a chave que ignora todo o RLS passaria a trafegar para o navegador de quem é admin.

**Regra:** segredo não mora em tabela que alguém lê pelo PostgREST. Vai para
`public.segredos`, que tem RLS ligado e **nenhuma policy** — sem policy, ninguém passa —
e é lido só por função `security definer`.

**Como conferir:**

```bash
curl -s "$SUPABASE_URL/rest/v1/segredos?select=*" -H "apikey: $SUPABASE_ANON_KEY"
```

Tem que responder `permission denied`. Se devolver linha, pare tudo e conserte.

---

## 24. Contador regressivo não pode ser JavaScript

**Sintoma:** o contador fica parado, ou some.

**Causa:** cliente de e-mail não executa JavaScript. Gmail, Outlook e Apple Mail
descartam `<script>` inteiro.

**Regra:** contador em e-mail é **imagem**, pedida ao servidor a cada abertura. É por isso
que `/contador` devolve PNG com `Cache-Control: no-store` — com cache, a segunda abertura
mostraria o tempo da primeira.

---

## 25. Variável de evento que não existe vaza para o assinante

**Sintoma:** o assinante recebe "Você deixou %EVENTO.produto% para trás".

**Causa:** a automação foi disparada por um gatilho que não carrega aquele dado, e o
texto saiu cru.

**Regra:** depois de substituir o que existe, **apague o que sobrou**. É o que
`personalizar()` faz com as duas expressões regulares no fim — melhor uma frase com um
buraco do que uma frase com código.

---

## 26. `\n` literal em script de instalação

**Sintoma:** o instalador falha dizendo que não achou o arquivo `n`.

**Causa:** o arquivo foi escrito com `\n` literal em vez de quebra de linha real. Em
shell, `\n` fora de aspas é só a letra `n` — cada um vira um argumento solto.

**Por que passou:** `bash -n` valida **sintaxe**, e a sintaxe estava correta. Só um teste
que confira se cada caminho da lista existe pega isso:

```bash
sed -n '/for sql in/,/^  do/p' instalar.sh | grep -o 'supabase/[a-z0-9_]*\.sql' \
  | while read f; do [ -f "$f" ] || echo "INEXISTENTE: $f"; done
```

---

## 27. Extensão do navegador bloqueando o painel

**Sintoma:** página em branco no domínio próprio; `#root` sem filhos e **nenhum erro** no
console. O mesmo endereço abre normalmente em outro navegador.

**Causa:** uma extensão (bloqueador de anúncios ou de rastreadores) barrou o download do
bundle naquele domínio. O sinal é `Failed to fetch dynamically imported module` com o
arquivo respondendo HTTP 200 no `curl`.

**Como separar do problema real:** abra o endereço `.pages.dev` do mesmo deploy. Se ele
funciona e o domínio próprio não, o problema é do navegador, não da publicação.

---

## 28. Testar o motor de envio com leads reais

**O que aconteceu:** uma prova do teste A/B enfileirou dez contatos reais da base. O
comentário no próprio arquivo dizia "nenhum e-mail sai, porque `processar_fila_envios`
não é chamado aqui". Estava errado — o **cron** chama, de minuto em minuto. Quatro
pessoas receberam um e-mail cujo corpo era a letra "a" ou a letra "b".

**Por que a intuição falha:** num sistema comum, nada acontece até você mandar
acontecer. Aqui não: existe um agendamento rodando o tempo todo. Qualquer linha em
`envios` com status `queued` **vai sair**, e o tempo entre enfileirar e enviar é de
até sessenta segundos — menos do que o intervalo entre rodar o teste e ler o resultado.

**A correção não é cuidado, é freio.** Duas travas em `app_config`, respeitadas por
`processar_fila_envios`:

| Chave | Efeito |
|---|---|
| `envio_pausado` | `true` para a fila inteira. Nada escoa, nada se perde. |
| `envio_so_para` | Enquanto tiver endereços, só eles recebem. O resto vira `retido`. |

**Antes de qualquer teste que toque na fila:**

```sql
update public.app_config set valor = 'seu@email.com' where chave = 'envio_so_para';
```

E confira que pegou, antes de enfileirar:

```sql
select public.cfg('envio_so_para');
```

**Detalhe que só aparece testando:** `retido` precisou entrar na restrição
`envios_status_check`. Sem isso, a trava derrubava a transação inteira — o que, por
sorte, também segurava o envio. Uma trava que falha fechada é uma trava; uma que falha
aberta é um enfeite.

---

## 29. `.ps1` em UTF-8 sem BOM: o travessão vira aspa

**Sintoma:** `instalar.ps1` não rodava em nenhuma máquina Windows. Erro de sintaxe numa
linha que estava visivelmente correta.

**Causa:** o Windows PowerShell 5.1 lê arquivo `.ps1` sem BOM como **ANSI**, não UTF-8.
O travessão `—` é `E2 80 94` em UTF-8; lido como cp1252, o último byte (`0x94`) é a aspa
dupla de fechamento `"`. O PowerShell aceita aspas tipográficas como delimitador de
string — então a string terminava no meio da frase, e todo o resto do arquivo passava a
ser interpretado errado.

**Correção:** gravar `.ps1` como **UTF-8 com BOM**.

**Como conferir sem uma máquina Windows à mão:**

```bash
head -c 3 instalar.ps1 | xxd | grep -q "efbb bf" && echo "tem BOM" || echo "SEM BOM"
```

**Por que passou tanto tempo:** o `instalar.sh` era testado com `bash -n`; o `.ps1`
nunca foi testado com nada. Agora é, com o próprio parser do PowerShell:

```powershell
$e = $null
[System.Management.Automation.Language.Parser]::ParseFile("instalar.ps1", [ref]$null, [ref]$e)
$e.Count   # tem que ser 0
```

---

## 30. `<>` contra NULL não protege nada

**Sintoma:** nenhum. A função parecia checar permissão e não checava.

```sql
if public.papel_atual() <> 'admin' then
  raise exception 'só admin muda segredo';
end if;
```

Para quem não está logado, `papel_atual()` devolve `NULL`. Em SQL, `NULL <> 'admin'`
não é verdadeiro nem falso — é `NULL`. O `if` só dispara com verdadeiro, então **a
exceção nunca era levantada** e qualquer um com a chave pública (que vai dentro do
JavaScript do painel, visível para o mundo) podia gravar o segredo.

**Correção:** `is distinct from`, que trata NULL como valor:

```sql
if public.papel_atual() is distinct from 'admin' then
```

`coalesce(public.papel_atual(), '') <> 'admin'` também resolve.

**Como achar os outros:** procure comparações de papel/permissão com `<>` ou `!=`.

```bash
grep -rn "papel_atual() *<>\|papel_atual() *!=" supabase/
```

**Como testar:** um `curl` anônimo, com a chave pública, contra a função. Se ele
consegue fazer algo, qualquer visitante consegue.

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/SUA_FUNCAO" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{...}'
```

Esperado: erro de permissão. Foi assim que este apareceu — o teste devolveu
`"guardado"` onde deveria devolver recusa.

---

## 31. ManyChat: a busca por e-mail/telefone não acha ninguém

**Sintoma:** `findBySystemField` responde `{"data":[]}` para todo mundo — inclusive para
um assinante cujo número você acabou de ler na própria API.

**Três causas empilhadas, e todas precisam ser resolvidas:**

1. **`data` é uma LISTA**, não um objeto. Ler `data.id` devolve `undefined` mesmo quando
   encontrou. Use `data[0].id`.

2. **A API aceita só `phone` ou `email`.** Qualquer outro parâmetro devolve
   `"Only phone or email can be specified"`.

3. **Numa conta de WhatsApp/Instagram, esses dois campos vêm vazios.** O número fica em
   `whatsapp_phone`, que **não é pesquisável**. Então não existe formato de telefone que
   funcione — o problema não é o `+55`.

**A saída é inverter o sentido.** Quem sabe quem é a pessoa é o ManyChat. Dentro do fluxo
dele, uma ação **External Request** manda o `subscriber_id` para a Ressoar, que guarda em
`tabela_1_leads.manychat_id`. Daí em diante marcar é direto, sem busca:

- URL: `POST https://SEU-PROJETO.supabase.co/functions/v1/manychat`
- Corpo:

```json
{"subscriber_id":"{{user_id}}","email":"{{email}}",
 "whatsapp":"{{phone}}","nome":"{{first_name}} {{last_name}}"}
```

A Ressoar casa por `manychat_id`, depois por e-mail, depois por WhatsApp — e cria o
contato se não achar nenhum. Foi assim que um assinante real da conta foi reconhecido
**pelo WhatsApp** e ligado ao lead que já existia aqui.

---

## 32. `addTagByName` não cria a tag

**Sintoma:** `{"message":"Tag does not exist"}`, e a tag não é aplicada.

Ao contrário do que o nome sugere, o endpoint só aplica tag que já existe. É preciso
`POST /fb/page/createTag` antes.

**Ordem que vale a pena:** tentar aplicar primeiro e criar só ao esbarrar no erro. O caso
comum é a tag já existir, e criar antes gastaria uma chamada em toda marcação.

**Cuidado ao testar:** aplicar uma tag pode disparar uma automação no ManyChat e mandar
mensagem de WhatsApp para uma pessoa real. Teste com uma tag **inédita** — tag recém-criada
não tem automação pendurada — e apague depois (`removeTagByName` no assinante e
`removeTag` na conta).

---

## 33. Tipo de passo desencontrado entre a tela, a tabela e o motor

Um passo de automação existe em três lugares, e nada garante que os três combinem:

1. o catálogo da tela (`ACOES` em `FluxoAutomacao.tsx`);
2. a restrição `automacao_passos_tipo_check`;
3. os `elsif` dentro de `executar_automacoes()`.

Dois estragos diferentes, conforme onde a lista fura:

**A tela oferece e a tabela recusa** → erro ao salvar. Chato, mas aparece na cara de quem
está montando. Era o caso de `manychat_tag` e `google_drive`.

**A tela oferece, a tabela aceita, e o motor não conhece** → o passo é salvo, a automação
roda, o passo é **pulado sem fazer nada** e marcado como concluído. Ninguém fica sabendo.
Era o caso de "Descadastra de uma lista": a tela salvava `desinscrever_lista` e o motor só
procurava por `remover_lista`.

O segundo é muito pior, porque a automação parece saudável.

**Como conferir os três de uma vez:**

```sql
with tela as (select unnest(array['enviar_email','esperar','manychat_tag','…']) as tipo)
select t.tipo,
       (select position('''' || t.tipo || '''' in prosrc) > 0
        from pg_proc where proname = 'executar_automacoes')   as o_motor_conhece,
       position('''' || t.tipo || '''' in
         (select pg_get_constraintdef(oid) from pg_constraint
          where conname = 'automacao_passos_tipo_check')) > 0 as a_tabela_aceita
from tela t;
```

Tudo tem que ser `true`. Foi assim que os dois apareceram.

**A lição maior:** conferir na tela que o passo aparece e salva não prova nada. Só montar a
automação inteira e ver o efeito do outro lado — no caso, a tag chegando no ManyChat —
prova que o caminho existe.

---

## 34. Casar telefone pelos últimos dígitos junta gente diferente

**Sintoma:** procurar por um número inventado do DDD 11 devolve uma pessoa real do DDD 21.

**Causa:** o casamento comparava os **10 últimos dígitos**. Em número brasileiro isso
descarta o primeiro dígito do DDD:

```
5521 90000-0000  →  últimos 10 = 1900000000
5511 90000-0000  →  últimos 10 = 1900000000
```

Duas pessoas, dois estados, o mesmo resultado.

**Por que é grave aqui:** o número é a chave que liga a Ressoar ao ManyChat. Um casamento
errado aplica a tag na pessoa errada — e tag no ManyChat dispara mensagem de WhatsApp.
Alguém que não comprou recebe a mensagem de quem comprou.

**Correção:** normalizar os dois lados para a **mesma forma canônica** antes de comparar,
com as mesmas regras que a ponte com o ManyChat usa (`public.normalizar_telefone`). Se as
regras divergirem, a Ressoar passa a achar uma pessoa e o ManyChat outra.

**Como conferir:**

```sql
select public.normalizar_telefone('5521900000000')
    <> public.normalizar_telefone('5511900000000');   -- tem que ser true
```

**A lição:** "pegar só o final do número" parece resolver o problema de formato e cria um
pior. Formato se resolve normalizando, não truncando.

---

## 35. Telefone fixo não ganha o nono dígito

**Sintoma:** um contato com telefone fixo vira um celular que não é dele.

**Causa:** a regra dizia "12 dígitos começando com 55? Então falta o 9 — enfia depois do
DDD". Aplicada a um fixo, `5551 3333-4444` vira `5551 9 3333-4444`, que é um número
diferente e pode ser de outra pessoa.

**Como a numeração brasileira funciona de verdade:**

| | Formato | Primeiro dígito depois do DDD |
|---|---|---|
| Fixo | 55 + DDD + **8** dígitos | 2, 3, 4 ou 5 |
| Celular | 55 + DDD + **9** dígitos | sempre 9 |

Desde **14/02/2017** todo celular do país tem o nono dígito, em todos os DDDs — não
existe exceção regional. Então um número de 12 dígitos ou é fixo (e não tem WhatsApp), ou
é cadastro de celular anterior a 2017.

**Correção:** olhar o primeiro dígito depois do DDD antes de decidir. Na base havia 206
números de 12 dígitos: 185 eram celulares velhos, **21 eram fixos**.

**Por que é grave:** o número é a chave que liga a Ressoar ao ManyChat. Número inventado
aplica tag na pessoa errada, e tag no ManyChat dispara WhatsApp.

**A regra vive em três lugares e os três precisam concordar:**
`public.normalizar_telefone`, `formatarTelefone` na função do ManyChat, e o nó
"Formatar telefone" do n8n. Se divergirem, a Ressoar acha uma pessoa e o ManyChat outra.

```sql
select public.normalizar_telefone('551133334444') is null;   -- fixo: tem que ser true
```

### E cuidado com o DDD 55

Santa Maria/RS é o **DDD 55** — os mesmos dois dígitos do código do Brasil. Um número de
lá começa com `55` tanto com DDI quanto sem, e as regras olham justamente os dois
primeiros dígitos.

O que salva é a decisão **não sair do prefixo sozinho**: ela sai do dígito que vem depois
do DDD presumido, junto com o comprimento do número.

| Entra | É | Sai |
|---|---|---|
| `5555999990000` | celular de lá, com DDI | `5555999990000` |
| `55999990000` | o mesmo, sem DDI | `5555999990000` |
| `555533334444` | fixo de lá | *(recusado)* |

Há 213 pessoas com DDD 55 na base. Se alguém "simplificar" a regra para um
`startsWith('55')`, são elas que quebram primeiro — e `555533334444` volta a virar
celular de outra pessoa. Os casos estão na prova no fim de `telefone_v2_fixo.sql`
justamente para isso.

---

## 36. Pedido da Hotmart não é sinônimo de compra

**Sintoma:** alguém que apenas emitiu um boleto — ou cujo pedido expirou — aparece na
linha do tempo como “Comprou” e pode produzir o evento `compra_realizada`.

**Causa:** havia três presunções independentes: evento/status desconhecido caía em
`aprovada`; o gatilho do banco tratava toda linha nova de pedido como compra; e a linha do
tempo escrevia “Comprou” sem olhar o status. Bastava receber `PURCHASE_EXPIRED` para criar
uma falsa venda que não existia no relatório da Hotmart.

**Correção:** os nove eventos e os dezessete estados oficiais estão mapeados em
`app/functions/venda/estados.ts`. Estado desconhecido falha fechado e continua auditável
em `hotmart_eventos`. Só `status = 'aprovada'` dispara compra, satisfaz a condição
“comprou”, recebe tag/lista de produto ou aparece como “Comprou”. Os outros estados são
mostrados como boleto, pagamento pendente/expirado, cancelamento, reembolso ou chargeback.

**Limpeza aplicada:** foram removidos apenas eventos derivados `compra_realizada`
comprovadamente falsos, sem apagar pedidos nem corpos brutos dos webhooks. Histórico de
compra seguida de reembolso ou chargeback foi preservado.

---

## 37. Porta pública que aceita `lista_id` do corpo é disparo anônimo

**Sintoma:** nenhum — como na 23, o furo não avisa.

**Causa:** o POST em `/formulario` sem `form_slug` lia `lista_id` e `tag_id` do próprio
corpo. Qualquer pessoa, sem chave nenhuma, podia inscrever qualquer e-mail em qualquer
lista — e, com o envio real destravado, lista com automação dispara e-mail de verdade,
em nome da casa, para quem nunca pediu. O comentário no topo da função descrevia o
risco… e protegia só o caminho com slug.

**Regra:** porta de entrada pública só aceita do corpo o que diz respeito à própria
pessoa (nome, e-mail, WhatsApp). O **destino** (lista, tag) ou vem do banco
(`form_slug`), ou exige chave. A chamada por API confere `formulario_api_key` — cofre
`public.segredos`, cabeçalho `x-api-key` ou campo `api_key`, trocável em Configurações →
API e webhooks. Sem chave guardada o caminho fica **fechado**: trava que falha aberta é
enfeite (armadilha 28).

**Como conferir:**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/formulario" \
  -H "Content-Type: application/json" -d '{"email":"x@y.com","lista_id":6}'
```

Tem que responder recusa (401). Se inscrever, pare tudo e conserte.

---

## 38. `create or replace` com assinatura nova não substitui — sobrecarrega

**Sintoma:** de 02/08/2026 à tarde a 05/08 à noite, toda compra aprovada foi gravada
normalmente (`hotmart_eventos` com `processado=true`, linha em `tabela_4_alunos`), mas
ninguém entrou em lista de comprador, nenhuma tag de turma nasceu (`CASA_H_2026_08_10`
nunca foi criada) e o `manychat_log` parou. Nenhum log de erro em lugar algum.

**Causa (duas camadas):**

1. `aplicar_mapa_produto` tinha **três assinaturas convivendo** — (uuid,text,text) de
   `hotmart_v1.sql`, (uuid,text,text,text) de `hotmart_v1_1.sql` e a completa de cinco
   parâmetros de `turmas_v1.sql`. Em Postgres, `create or replace function` só substitui
   quando a assinatura é IGUAL; mudou parâmetro, nasce uma sobrecarga ao lado da antiga.
   A Edge Function `venda` chama via PostgREST com 4 argumentos nomeados — conjunto que
   serve tanto à versão de 4 (exata) quanto à de 5 (`p_quando` tem default). O PostgREST
   se recusa a escolher: HTTP 300, `PGRST203 Could not choose the best candidate
   function`. Em SQL puro a dupla também quebrava `reprocessar_evento_hotmart`
   (4 argumentos posicionais → `function ... is not unique`, 42725).
2. A `venda` lia só `data` do retorno do `rpc()`: `const { data: mapa } = await
   supabase.rpc(...)`. O supabase-js **não lança exceção** — devolve `{ data, error }` —
   então o 300 morreu num campo que ninguém olhava e o evento ganhou o carimbo de
   processado como se tudo tivesse dado certo.

O recurso de turma-por-compra **nasceu quebrado**: a sobrecarga de 5 parâmetros entrou
em produção na mesma tarde (02/08), e a partir dela a chamada da `venda` nunca mais
resolveu. As tags `CASA_H_*` existentes vieram da importação de 01/08 e do ensaio pela
tela (que chama a função por SQL com 5 argumentos posicionais — sem ambiguidade; por
isso o ensaio funcionava e o webhook não).

**Correção:** `hotmart_v4_um_mapa_so.sql` derruba as duas assinaturas velhas e trava a
instalação se um dia existir mais de uma; a `venda` passou a olhar o `error` do rpc — se
o mapa falhar, o evento fica **sem** `processado`, com o erro escrito, visível em
`hotmart_pendentes()` para reprocesso.

**Regra que fica:** função nova com parâmetro novo = `drop function` da assinatura velha
no mesmo arquivo. E toda chamada `supabase.rpc(...)` cujo resultado importa precisa ler
`error`, não só `data`.

---

## 39. Publicar o painel deixava a tela branca (ou sem estilo nenhum)

**Sintoma:** logo depois de publicar, quem já tinha o painel aberto via a tela em
branco, ou a página crua sem CSS. Recarregar não resolvia; só limpar o cache do
navegador na mão.

**Causa:** cada build gera nomes novos para o JavaScript e o CSS
(`index-ABC123.js`), e o `index.html` aponta para eles. O navegador guardava o
`index.html` **velho**, que pedia um arquivo que não existia mais. E como o
`_redirects` manda tudo que não existe para o `index.html`, o navegador recebia
**HTML no lugar do JavaScript** — daí o silêncio: nenhum erro no console, porque
o arquivo respondeu 200.

**Correção:** `app/painel/public/_headers` com a regra padrão de aplicação de
página única — `index.html` nunca fica em cache, e os arquivos com nome
versionado ficam para sempre (o nome muda quando o conteúdo muda, então não há o
que invalidar).

**Como reconhecer de novo:** peça o JavaScript e olhe o tipo da resposta.

```js
const s = [...document.querySelectorAll('script[src]')].map(x => x.src).find(u => u.includes('/assets/'));
(await (await fetch(s)).text()).startsWith('<!doctype')   // true = é este problema
```

**Enquanto o cache velho não expira**, o jeito de destravar sem pedir para o
usuário limpar nada:

```js
const html = await (await fetch('/index.html', { cache: 'reload' })).text();
for (const a of new Set([...html.matchAll(/\/assets\/[\w.-]+\.(?:js|css)/g)].map(m => m[0])))
  await fetch(a, { cache: 'reload' });
location.reload();
```

---

## 40. O 55 do Brasil não é o 55 de Santa Maria

**Sintoma:** uma compradora da Suíça ficou com o telefone `5541795988121` na base — um
número que não existe. O original era `+41 79 598 8121`.

**Causa:** o código colava `55` na frente de qualquer número com 10 ou 11 dígitos. O DDI do
Brasil é 55; o DDD de Santa Maria (RS) **também** é 55. Tratados como a mesma coisa, um
número suíço de 11 dígitos vira "celular brasileiro sem DDI".

**O que separa um do outro não é o "55"**: é o comprimento do número inteiro e o que vem
depois dele.

```
55 9 9999-9999        11 dígitos  ->  DDD 55 + celular. Falta o DDI.
55 55 9 9999-9999     13 dígitos  ->  DDI 55 + DDD 55 + celular. Completo.
```

**As regras oficiais, que agora estão no código** (Anatel / Plano de Numeração Brasileiro):

- Existem **67 DDDs**, e não a faixa de 11 a 99. Estes 22 números NÃO são DDD: 20, 23, 25,
  26, 29, 30, 36, 39, 40, 50, 52, 56, 57, 58, 59, 60, 70, 72, 76, 78, 80 e 90.
- Celular tem 9 dígitos e começa com **9**. Fixo tem 8 e começa com **2 a 5**.
- O mapa de DDI cobre o mundo inteiro por código ISO do país, não só os países que já
  apareceram em compra. Quem compra de Portugal com 9 dígitos ganha o `351` — antes o
  número era **descartado** por ser "curto demais".

**O maldito zero do DDD.** Antigamente se discava `0` + DDD (`017`, `011`), e muita gente
digita assim até hoje. Com o DDI junto vira `55` + `017` + número — 14 dígitos que não
existem. Tira-se o zero: `55017997921200` é `5517997921200`. Sem ambiguidade possível,
porque **DDD 50 não existe** — nenhum número válido começa com `550`.

**Onde vive:** `app/functions/venda/telefone.ts`, com 16 testes em `telefone.test.ts`,
incluindo o caso que dói (`55999887766` de Santa Maria vira `5555999887766`, e quem já tem
o DDI não ganha um terceiro).

**A lição que quase custou caro:** antes da regra correta, 337 telefones começando com
`5555` pareciam quebrados e uma "padronização" foi cogitada. Pela regra oficial, **208
deles estavam certos** — gaúchos de Santa Maria com o número completo. A varredura teria
destruído o telefone dessas pessoas. Em telefone, na dúvida, não mexer.

---

## 41. Copiar campo único de um cadastro que ainda existe

**Sintoma:** sete fusões de cadastro morreram no meio com
`duplicate key value violates unique constraint "tabela_1_leads_whatsapp_key"`.

**Causa:** a fusão movia tudo, e no fim copiava para o cadastro que fica o que faltava nele
(`whatsapp`, `cpf`, `manychat_id`) — **antes** de retirar o cadastro absorvido. Como esses
três campos são únicos na tabela, o número colidia **com ele mesmo**: ainda estava no
registro que só sairia na linha seguinte.

**Correção:** inverter a ordem. Retira o cadastro vazio primeiro, completa depois. Os
valores vêm de um `record` lido em memória no início da função, que sobrevive ao `delete`.

**Regra que fica:** ao mover dados entre linhas com restrição de unicidade, **libere o valor
antes de reusá-lo**. E vale para qualquer campo único, não só telefone.

---

## 42. Evento de controle interno não pode acionar o cliente

**Sintoma:** 21 pessoas que compraram o Desafio em 29/07 foram jogadas na turma de 10/08 e
marcadas no ManyChat, recebendo o WhatsApp de uma turma que não era a delas.

**Causa:** `PURCHASE_COMPLETE` — o aviso de que a garantia venceu sem reembolso — era
tratado como entrada de comprador. Ele chega **sete dias depois** da compra, e a turma era
calculada com a data de hoje.

**Duas travas, não uma:** o aviso de fim de garantia deixou de chamar o mapa de produto (a
venda continua sendo atualizada — é o registro do dinheiro), e a chamada do mapa passou a
levar a **data da compra**. São a mesma coisa quando o aviso chega em tempo real, e coisas
muito diferentes quando chega atrasado ou quando alguém reprocessa histórico.

**Regra que fica:** antes de ligar um evento a uma automação, pergunte *quando* ele chega e
*o que ele significa*. Fim de garantia, confirmação de acesso e conclusão de módulo são
controle interno. Quem manda em comunicação é a **aprovação da compra**.

---

## 43. Ordem de chegada não é ordem dos fatos

**Sintoma:** três compras aprovadas do Desafio apareciam como `pendente` na base. O
comprador sumia da lista de compradores e nada denunciava — o painel mostrava a venda,
só que com o estado errado.

**Causa:** os avisos da Hotmart não chegam em ordem. Um aviso de boleto que falhou é
reenviado ~13 minutos depois, quando a compra **já foi aprovada**, e o upsert regravava o
estado antigo por cima do novo.

**Correção:** compra aprovada não volta a ser `pendente` nem `expirada`. Depois da
aprovação, só reembolso, chargeback e cancelamento mudam o estado. O mesmo aviso atrasado
também deixou de gerar evento de recuperação de boleto — que pediria pagamento a quem já
pagou.

**Como achar de novo:** cruze o estado da base com o histórico exportado da Hotmart. Foi
assim que os três apareceram: a planilha dizia "Aprovado" onde a base dizia "pendente".

---

## 44. Order bump: dois webhooks no mesmo segundo

**Sintoma:** oito compras entre 03 e 06/08/2026 registraram
`duplicate key value violates unique constraint "tabela_1_leads_whatsapp_key"` e o item
sumia.

**Causa:** order bump e upsell são vendidos no mesmo checkout, e a Hotmart manda **um
webhook por item**. Os dois chegam no mesmo segundo, ambos procuram a pessoa, nenhum acha,
ambos tentam criar — e o segundo esbarra na chave única. A função desistia.

**Correção:** ao esbarrar, procurar de novo. Quem acabou de criar a pessoa foi o outro item
da mesma compra; cada um segue como a operação distinta que é.

**Regra que fica:** onde há criação concorrente, `insert` que falha por duplicidade não é
erro — é sinal de que outro processo chegou primeiro. Buscar de novo, não desistir.
