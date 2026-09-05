-- =====================================================================
-- DOMÍNIO IMPOSSÍVEL — a trava passa a ser estrutural, na porta
--
-- Por que existe: em 04/09/2026, com a fila liberada, a devolução dos
-- envios NOVOS ficou em 2,27% — acima do limite de 2% que o freio usa.
-- Só que a causa já não era a base velha do ActiveCampaign (essa foi
-- limpa no mesmo dia por `higiene_dominios_v1.sql`): eram endereços
-- digitados errado AGORA, no formulário de inscrição, chegando a cada
-- hora. `gmail.com9`, `gmail.con`, `gnail.com`. Limpar de tempos em
-- tempos é enxugar gelo: enquanto a porta aceitar, a devolução volta, o
-- freio pausa, e as confirmações de quem se inscreveu ficam represadas.
--
-- O que este roteiro faz, em três peças:
--
--   1. `dominio_impossivel(email)` — UMA fonte para o padrão. Antes ele
--      vivia escrito dentro do roteiro de higiene; agora a higiene, o
--      gatilho e qualquer tela perguntam à mesma função. Padrão que mora
--      em dois lugares vira duas verdades no primeiro conserto.
--
--   2. um gatilho em `tabela_1_leads`: lead que entra (ou que muda de
--      e-mail) com domínio impossível já nasce na supressão, com motivo
--      `dominio_invalido`.
--
--   3. nada de rejeitar o cadastro. O lead ENTRA — o WhatsApp, o
--      ManyChat e a venda dele continuam funcionando; o que não acontece
--      é a tentativa de entrega num endereço que não existe. Recusar a
--      inscrição perderia a pessoa inteira por causa de um erro de
--      digitação; suprimir perde só o canal que não tinha como funcionar.
--
-- Conservador de propósito, como a higiene: só domínio IMPOSSÍVEL entra
-- aqui. `gmail.com.br` é um domínio real e registrado — pode ser engano
-- do lead, mas pode receber e-mail, e sumir com um lead bom é pior do
-- que uma devolução. Na dúvida, fica de fora.
--
-- Reversível: `drop trigger trg_dominio_impossivel on public.tabela_1_leads;`
-- e apagar da supressão as linhas com motivo 'dominio_invalido'.
-- =====================================================================

begin;

-- ---- 1. o padrão, num lugar só -------------------------------------
create or replace function public.dominio_impossivel(p_email text)
returns boolean
language sql immutable as $$
  select case
    when coalesce(btrim(p_email), '') = '' then false
    else split_part(lower(btrim(p_email)), '@', 2) ~
         ('(^gmail\.(co|con|comc|comd|comi|coml|comm|comn|comr|coms|com\.com|comgmail)$'
       || '|^gmail\.com[0-9]$'
       || '|^gm\.com$'
       || '|hotmial|hotiimail|gnail|gmial|yahho|outllook'
       || '|\.con$|\.cim$)')
  end
$$;

comment on function public.dominio_impossivel(text) is
  'Domínio que não existe e nunca vai entregar (erro de digitação). Fonte única do padrão: higiene_dominios_v1.sql e o gatilho da porta usam esta função.';

-- ---- 2. a porta -----------------------------------------------------
create or replace function public.tg_dominio_impossivel()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if public.dominio_impossivel(new.email) then
    insert into public.supressao (email, motivo)
    values (lower(btrim(new.email)), 'dominio_invalido')
    on conflict (email) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_dominio_impossivel on public.tabela_1_leads;
create trigger trg_dominio_impossivel
after insert or update of email on public.tabela_1_leads
for each row execute function public.tg_dominio_impossivel();

commit;

-- ---- provas ---------------------------------------------------------
-- 1. a função conhece os casos reais desta base, e não passa do ponto
select public.dominio_impossivel('alguem@gmail.con')     as pega_con,
       public.dominio_impossivel('alguem@gmail.com9')    as pega_digito,
       public.dominio_impossivel('alguem@gnail.com')     as pega_gnail,
       public.dominio_impossivel('alguem@gmail.com')     as deixa_gmail,
       public.dominio_impossivel('alguem@gmail.com.br')  as deixa_com_br,
       public.dominio_impossivel('alguem@empresa.com')   as deixa_empresa,
       public.dominio_impossivel(null)                   as aguenta_nulo,
       public.dominio_impossivel('')                     as aguenta_vazio;

-- 2. o gatilho está de pé
select count(*) as gatilho_na_porta from pg_trigger
 where tgname = 'trg_dominio_impossivel' and not tgisinternal;

-- 3. quantos da base já estão barrados por este motivo
select count(*) as suprimidos_por_dominio
  from public.supressao where motivo = 'dominio_invalido';
