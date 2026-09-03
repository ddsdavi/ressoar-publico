-- =====================================================================
-- HIGIENE DE DOMÍNIOS — **NÃO APLICADO**. Espera decisão do Davi.
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

insert into public.supressao (email, motivo, criado_em)
select distinct lower(btrim(l.email)), 'dominio_invalido', now()
  from public.tabela_1_leads l
 where coalesce(l.email, '') <> ''
   and split_part(lower(btrim(l.email)), '@', 2) ~
       '(^gmail\.(co|con|comc|comd|comi|coml|comm|comn|comr|coms|com\.com|comgmail)$'
    || '|hotmial|hotiimail|gnail|gmial|yahho|outllook|^gm\.com$|\.con$|\.cim$)'
   and not exists (select 1 from public.supressao s
                    where lower(s.email) = lower(btrim(l.email)))
on conflict do nothing;

commit;

select jsonb_pretty(jsonb_build_object(
  'suprimidos_agora', (select count(*) from public.supressao where motivo = 'dominio_invalido'),
  'supressao_total', (select count(*) from public.supressao))) as prova;
