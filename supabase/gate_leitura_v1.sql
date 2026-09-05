-- =====================================================================
-- GATE DE STAFF — a função confere por dentro quem está chamando
--
-- Fase 2.1 do docs/10-PLANO-SEGURANCA.md.
--
-- O problema: as funções `security definer` **furam o RLS** por
-- definição — é para isso que existem. Hoje elas estão protegidas por
-- duas coisas de fora: o `anon` perdeu o `execute` (seguranca_rpc_v1) e
-- todos os cinco usuários são admin aprovados. Nenhuma das duas é uma
-- propriedade da função. No dia em que existir uma conta logada e **não
-- aprovada** — ou um papel menor, como assistente — ela chamaria a
-- função pela API e leria o que o RLS teria negado.
--
-- O gate:
--
--   · **motor passa.** Sem sessão de usuário (`auth.uid()` nulo) é o
--     pg_cron, um gatilho ou uma Edge Function com service_role. Barrar
--     aqui pararia o envio, as automações e a pontuação — e não protege
--     nada: quem chega sem sessão pela API é o `anon`, que já não tem
--     `execute` em nenhuma delas.
--   · **staff aprovado passa.** `papel_atual()` devolve o papel de quem
--     está aprovado; devolve nulo para conta pendente, recusada ou
--     excluída.
--   · **o resto leva 42501.** É o código que o PostgREST traduz para 403.
--
-- Por que `perform`, e não um `if` na tela: tela é conveniência, gate é
-- garantia. A mesma função continua chamável pela API por qualquer um
-- que tenha um token — o que muda é que agora ela pergunta quem é.
--
-- Reversível: `create or replace` sem a linha do `perform` em cada
-- função, ou trocar o corpo do gate por `begin return; end`.
-- =====================================================================

begin;

create or replace function public.gate_leitura()
returns void
language plpgsql stable security definer set search_path to 'public' as $$
begin
  -- o motor não tem sessão: cron, gatilho, service_role
  if auth.uid() is null then
    return;
  end if;
  if public.papel_atual() is null then
    raise exception 'Sem permissão: esta conta não está aprovada.'
      using errcode = '42501';
  end if;
end $$;

comment on function public.gate_leitura() is
  'Portão de staff para funções security definer: deixa passar o motor (sem sessão) e quem está aprovado; barra conta logada sem papel. Fase 2.1 do plano de segurança.';

revoke execute on function public.gate_leitura() from public, anon;
grant execute on function public.gate_leitura() to authenticated, service_role;

commit;

-- ---- provas ---------------------------------------------------------
-- As três de uma vez. `void is null` seria sempre falso — o que se mede
-- aqui é se a chamada LEVANTA exceção, não o que ela devolve.
do $$
declare
  v_admin uuid;
  v_motor text := 'nao testado';
  v_sem   text := 'nao testado';
  v_staff text := 'nao testado';
begin
  -- 1. sem sessão, como o cron e os gatilhos chamam: passa
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.gate_leitura();
    v_motor := 'passa (certo)';
  exception when others then
    v_motor := 'BARRADO (errado: pararia o motor)';
  end;

  -- 2. conta logada que não é staff aprovado: barra com 42501
  perform set_config('request.jwt.claims',
                     '{"sub":"00000000-0000-0000-0000-000000000000"}', true);
  begin
    perform public.gate_leitura();
    v_sem := 'PASSOU (errado: o gate não fez nada)';
  exception
    when insufficient_privilege then v_sem := 'barrado com 42501 (certo)';
    when others then v_sem := 'barrado, mas com o código errado: ' || sqlstate;
  end;

  -- 3. um admin de verdade: passa
  select r.user_id into v_admin from public.usuarios_ressoar r
   where r.status = 'aprovado' and r.papel = 'admin' limit 1;
  if v_admin is null then
    v_staff := 'sem admin aprovado para testar';
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_admin)::text, true);
    begin
      perform public.gate_leitura();
      v_staff := 'passa (certo)';
    exception when others then
      v_staff := 'BARRADO (errado: trancaria o painel)';
    end;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'motor: % | conta sem papel: % | staff aprovado: %',
    v_motor, v_sem, v_staff;
  if v_motor not like 'passa%' or v_sem not like 'barrado com 42501%'
     or (v_staff not like 'passa%' and v_staff not like 'sem admin%') then
    raise exception 'O gate não se comportou como devia — ver o notice acima';
  end if;
end $$;

select 'gate conferido nas tres situacoes' as prova;
