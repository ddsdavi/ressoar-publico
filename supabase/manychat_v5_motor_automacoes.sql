-- Liga o passo manychat_tag ao executor real de automações.
--
-- A tela e a restrição da tabela já aceitavam esse tipo, mas o executor o
-- pulava e ainda encerrava a execução como concluída. Esta migração altera
-- somente o ramo que faltava e preserva o restante da função viva.
begin;

do $$
declare
  v_oid oid;
  v_src text;
  v_src_novo text;
  v_def text;
  v_def_nova text;
  v_anchor constant text := 'elsif v_passo.tipo = ''aplicar_tag'' then';
  v_ramo constant text :=
    'elsif v_passo.tipo = ''manychat_tag'' then' || E'\n' ||
    '            perform public.executar_passo_manychat(v_exec.lead_fk, v_passo.config);' || E'\n\n' ||
    '          elsif v_passo.tipo = ''aplicar_tag'' then';
begin
  if to_regprocedure('public.executar_passo_manychat(uuid,jsonb)') is null then
    raise exception 'executar_passo_manychat(uuid,jsonb) nao existe';
  end if;

  select p.oid, p.prosrc, pg_get_functiondef(p.oid)
    into v_oid, v_src, v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'executar_automacoes'
    and p.pronargs = 0;

  if v_oid is null then
    raise exception 'executar_automacoes() nao existe';
  end if;

  if position('''manychat_tag''' in v_src) > 0
     and position('executar_passo_manychat' in v_src) > 0 then
    raise notice 'manychat_tag ja esta ligado ao executor';
    return;
  end if;

  if position('''manychat_tag''' in v_src) > 0
     or position('executar_passo_manychat' in v_src) > 0 then
    raise exception 'executor contem uma correcao parcial do ManyChat; revisao manual necessaria';
  end if;

  v_src_novo := replace(v_src, v_anchor, v_ramo);
  if v_src_novo = v_src then
    raise exception 'nao achei o ramo aplicar_tag; o executor mudou de forma';
  end if;

  v_def_nova := replace(v_def, v_src, v_src_novo);
  if v_def_nova = v_def then
    raise exception 'nao consegui reconstruir executar_automacoes()';
  end if;

  execute v_def_nova;
end $$;

commit;

-- Prova local da migração. Falha o release se o ramo não tiver entrado.
do $$
declare
  v_src text;
begin
  select prosrc into v_src
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'executar_automacoes'
    and pronargs = 0;

  if position('''manychat_tag''' in coalesce(v_src, '')) = 0
     or position('executar_passo_manychat' in coalesce(v_src, '')) = 0 then
    raise exception 'manychat_tag continuou desligado do executor';
  end if;
end $$;

