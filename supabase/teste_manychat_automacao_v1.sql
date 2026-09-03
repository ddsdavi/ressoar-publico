-- Prova regressiva, somente leitura: o executor vivo precisa conhecer o passo
-- manychat_tag e encaminhá-lo à função que fala com a Edge Function.
do $$
declare
  v_src text;
begin
  select prosrc into v_src
  from pg_proc
  where proname = 'executar_automacoes'
    and pronamespace = 'public'::regnamespace;

  if position('''manychat_tag''' in coalesce(v_src, '')) = 0 then
    raise exception 'REGRESSAO: executar_automacoes nao reconhece manychat_tag';
  end if;

  if position('executar_passo_manychat' in coalesce(v_src, '')) = 0 then
    raise exception 'REGRESSAO: executar_automacoes nao chama executar_passo_manychat';
  end if;
end $$;
