-- =====================================================================
-- HIGIENE DE DOMÍNIOS — aplicado em 04/09/2026, a pedido do Davi.
--
-- Roda quando quiser: varre a base e joga na supressão o que a função
-- `public.dominio_impossivel` reconhece. Depois de 04/09/2026 é rede de
-- segurança, não a defesa principal — a defesa é o gatilho da porta, em
-- `dominio_impossivel_v1.sql`, que barra na entrada.
--
-- Ao aplicar, apareceram DOIS defeitos que nunca tinham sido exercidos:
--   1. o insert citava uma coluna `criado_em` que não existe (a tabela tem
--      `created_at`, com default `now()`) — morria no 42703;
--   1b. e o select ainda trazia um terceiro valor para a coluna que
--      acabara de sair (42601);
--   2. o padrão do regex era montado com `||` SEM parênteses. No Postgres
--      moderno `~` e `||` têm a mesma precedência e associam à esquerda,
--      então `campo ~ 'a' || 'b'` vira `(campo ~ 'a') || 'b'`: booleano
--      concatenado com texto, e o `and` recebia texto (42804).
-- Escrito em 30/08, nunca rodou até aqui — a prova de que roteiro guardado
-- sem rodar é roteiro não testado. As duas correções estão abaixo.
--
-- Por que existe: em 30/08/2026 a taxa de devolução dos últimos 7 dias
-- ficou em 13,45% e travou o envio. Os endereços que voltaram eram erro
-- de digitação vindos da migração do ActiveCampaign: gmail.con,
-- gmail.comm, hotiimail.com, gmail.comgmail, gm.com.
--
-- Uma varredura na base achou 153 endereços com domínio impossível em
-- 14.418 — e só 49 deles já estavam na supressão. Os outros ~104 vão
-- devolver de novo no próximo envio, e devolução é o que mancha a
-- reputação do domínio de envio.
--
-- O que este roteiro faz: joga esses endereços na supressão com motivo
-- 'dominio_invalido'. NÃO apaga lead nenhum, NÃO mexe em tag, lista ou
-- histórico — só impede que o motor tente entregar num endereço que não
-- existe. É reversível: apagar a linha da supressão devolve o endereço.
--
-- O que ele NÃO faz de propósito: não mexe em domínio que existe de
-- verdade mas parece estranho. `gmail.com.br` é um domínio brasileiro
-- registrado — pode ser erro de digitação do lead, mas pode aceitar
-- e-mail, e sumir com um lead bom é pior do que uma devolução.
-- =====================================================================

begin;

-- O padrão NÃO mora mais aqui: mora em `public.dominio_impossivel`, que o
-- gatilho da porta (dominio_impossivel_v1.sql) também usa. Padrão escrito
-- em dois lugares vira duas verdades no primeiro conserto — e o conserto
-- veio no mesmo dia, quando apareceu `gmail.com9`.
--
-- `created_at` tem default now(); a coluna não é nomeada de propósito.
insert into public.supressao (email, motivo)
select distinct lower(btrim(l.email)), 'dominio_invalido'
  from public.tabela_1_leads l
 where public.dominio_impossivel(l.email)
   and not exists (select 1 from public.supressao s
                    where lower(s.email) = lower(btrim(l.email)))
on conflict do nothing;

commit;

select jsonb_pretty(jsonb_build_object(
  'suprimidos_agora', (select count(*) from public.supressao where motivo = 'dominio_invalido'),
  'supressao_total', (select count(*) from public.supressao))) as prova;
