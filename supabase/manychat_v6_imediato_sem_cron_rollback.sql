-- Reversão emergencial da camada SQL de manychat_v6_imediato_sem_cron.sql.
-- O formulário síncrono continua seguro mesmo após esta reversão.
begin;

drop trigger if exists trg_manychat_evento_imediato on public.eventos_sistema;
drop trigger if exists trg_manychat_execucao_imediata on public.automacao_execucoes;
drop function if exists public.trg_manychat_evento_imediato();
drop function if exists public.trg_manychat_execucao_imediata();

do $$
declare
  v_oid oid;
  v_src text;
  v_novo text;
  v_def text;
begin
  select p.oid, p.prosrc, pg_get_functiondef(p.oid)
    into v_oid, v_src, v_def
  from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname = 'processar_eventos_sistema' and p.pronargs = 0;
  v_novo := replace(v_src,
    '        and not public.automacao_manychat_imediata(a.automacao_id)' || E'\n', '');
  if v_novo <> v_src then execute replace(v_def, v_src, v_novo); end if;

  select p.oid, p.prosrc, pg_get_functiondef(p.oid)
    into v_oid, v_src, v_def
  from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname = 'executar_automacoes' and p.pronargs = 0;
  v_novo := replace(v_src,
    'raise exception ''manychat_tag chegou ao cron; o passo deve ser imediato'';',
    'perform public.executar_passo_manychat(v_exec.lead_fk, v_passo.config);');
  if v_novo <> v_src then execute replace(v_def, v_src, v_novo); end if;
end $$;

drop function if exists public.automacao_manychat_imediata(uuid);
drop function if exists public.automacao_gatilho_corresponde(jsonb, text, jsonb);

commit;

