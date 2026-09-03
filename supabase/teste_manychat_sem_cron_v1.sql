-- Prova regressiva, somente leitura: nenhuma marcação no ManyChat pode ser
-- disparada pelos ciclos de processar/executar automações.
do $$
declare
  v_executor text;
  v_processador text;
begin
  if to_regprocedure('public.automacao_manychat_imediata(uuid)') is null then
    raise exception 'REGRESSAO: falta classificador de automacao ManyChat imediata';
  end if;

  if not public.automacao_gatilho_corresponde(
    '[{"tipo":"tag_adicionada","tag_id":85},{"tipo":"lista_inscrita","lista_id":32}]'::jsonb,
    'lista_inscrita', '{"lista_id":32}'::jsonb) then
    raise exception 'REGRESSAO: gatilho multiplo nao dispara imediatamente';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.oid = 'public.eventos_sistema'::regclass
      and t.tgname = 'trg_manychat_evento_imediato'
  ) then
    raise exception 'REGRESSAO: evento nao dispara ManyChat imediatamente';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.oid = 'public.automacao_execucoes'::regclass
      and t.tgname = 'trg_manychat_execucao_imediata'
  ) then
    raise exception 'REGRESSAO: inclusao manual ainda pode depender do cron';
  end if;

  select prosrc into v_executor from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'executar_automacoes' and pronargs = 0;
  if position('perform public.executar_passo_manychat' in coalesce(v_executor, '')) > 0 then
    raise exception 'REGRESSAO: executar_automacoes ainda envia ao ManyChat pelo cron';
  end if;

  select prosrc into v_processador from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'processar_eventos_sistema' and pronargs = 0;
  if position('automacao_manychat_imediata' in coalesce(v_processador, '')) = 0 then
    raise exception 'REGRESSAO: processador ainda enfileira automacao ManyChat imediata';
  end if;
end $$;
