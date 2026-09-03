-- Reversão emergencial de manychat_v5_motor_automacoes.sql.
-- Não faz parte de ordem.txt: execute apenas se for necessário desfazer.
begin;

do $$
declare
  v_oid oid;
  v_src text;
  v_src_novo text;
  v_def text;
  v_def_nova text;
  v_ramo constant text :=
    'elsif v_passo.tipo = ''manychat_tag'' then' || E'\n' ||
    '            perform public.executar_passo_manychat(v_exec.lead_fk, v_passo.config);' || E'\n\n' ||
    '          elsif v_passo.tipo = ''aplicar_tag'' then';
begin
  select p.oid, p.prosrc, pg_get_functiondef(p.oid)
    into v_oid, v_src, v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'executar_automacoes'
    and p.pronargs = 0;

  if v_oid is null then
    raise exception 'executar_automacoes() nao existe';
  end if;

  if position(v_ramo in v_src) = 0 then
    raise exception 'nao achei o ramo exato criado pela v5; nada foi alterado';
  end if;

  v_src_novo := replace(v_src, v_ramo, 'elsif v_passo.tipo = ''aplicar_tag'' then');
  v_def_nova := replace(v_def, v_src, v_src_novo);
  execute v_def_nova;
end $$;

commit;

