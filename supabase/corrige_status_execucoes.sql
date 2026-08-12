-- =====================================================================
-- CORREÇÃO URGENTE — regressão que eu introduzi no motor v9.
--
-- O executor original pegava execuções com status 'em_andamento' ou
-- 'aguardando'. Ao reescrever a função para consertar a chave-geral dos
-- webhooks, troquei o filtro por status = 'ativa'.
--
-- Só que o DEFAULT da coluna é 'em_andamento'. Ou seja: toda execução
-- criada por gatilho nascia 'em_andamento' e o executor procurava
-- 'ativa' — nenhuma automação disparada por gatilho rodaria jamais, sem
-- erro nenhum aparecendo. Silencioso, que é o pior tipo.
--
-- Aqui o filtro volta a aceitar os dois nomes, e a entrada manual passa a
-- usar o mesmo nome do default. Aceitar ambos evita que execuções criadas
-- entre o v9 e agora fiquem órfãs.
-- =====================================================================
begin;

create or replace function public.executar_automacoes() returns int
language plpgsql security definer as $$
declare
  v_exec record;
  v_passo record;
  v_msg uuid;
  v_qtd int := 0;
  v_webhooks boolean := coalesce(public.cfg('executar_webhooks'), 'false') = 'true';
begin
  for v_exec in
    select * from public.automacao_execucoes
    where status in ('em_andamento', 'aguardando', 'ativa')
      and coalesce(agendado_para, now()) <= now()
    order by iniciado_em
    limit 200
    for update skip locked
  loop
    select * into v_passo from public.automacao_passos
    where automacao_fk = v_exec.automacao_fk and ordem = v_exec.passo_atual;

    if not found then
      update public.automacao_execucoes
      set status = 'concluida', finalizado_em = now()
      where execucao_id = v_exec.execucao_id;
      continue;
    end if;

    begin
      if v_passo.tipo = 'esperar' then
        update public.automacao_execucoes
        set agendado_para = now() + (v_passo.config->>'duracao')::interval,
            passo_atual = passo_atual + 1
        where execucao_id = v_exec.execucao_id;
        v_qtd := v_qtd + 1;
        continue;

      elsif v_passo.tipo = 'enviar_email' then
        v_msg := nullif(v_passo.config->>'mensagem_id', '')::uuid;
        if v_msg is not null then
          perform public.enfileirar_email(v_exec.lead_fk, v_msg,
                    null, v_exec.automacao_fk, v_passo.passo_id);
        end if;

      elsif v_passo.tipo in ('webhook', 'google_sheets', 'google_drive') then
        if v_webhooks
           and v_passo.config ? 'url'
           and (v_passo.config->>'url') not like '%(TRUNCADO)%' then
          perform net.http_post(
            url := v_passo.config->>'url',
            body := jsonb_build_object(
              'origem', 'ressoar',
              'passo', v_passo.tipo,
              'automacao', v_exec.automacao_fk,
              'contato', public.payload_contato(v_exec.lead_fk)),
            headers := jsonb_build_object('Content-Type', 'application/json'));
        end if;

      elsif v_passo.tipo = 'aplicar_tag' then
        insert into public.lead_tags (lead_fk, tag_fk)
        values (v_exec.lead_fk, (v_passo.config->>'tag_id')::int)
        on conflict do nothing;

      elsif v_passo.tipo = 'remover_tag' then
        delete from public.lead_tags
        where lead_fk = v_exec.lead_fk and tag_fk = (v_passo.config->>'tag_id')::int;

      elsif v_passo.tipo = 'inscrever_lista' then
        insert into public.lead_listas (lead_fk, lista_fk, status, source)
        values (v_exec.lead_fk, (v_passo.config->>'lista_id')::int, 1, 'automation')
        on conflict (lead_fk, lista_fk) do update set status = 1, updated_at = now();

      elsif v_passo.tipo = 'desinscrever_lista' then
        update public.lead_listas set status = 2, updated_at = now()
        where lead_fk = v_exec.lead_fk and lista_fk = (v_passo.config->>'lista_id')::int;
      end if;

      update public.automacao_execucoes
      set passo_atual = passo_atual + 1, agendado_para = now()
      where execucao_id = v_exec.execucao_id;
      v_qtd := v_qtd + 1;

    exception when others then
      update public.automacao_execucoes
      set status = 'erro', erro = sqlerrm, finalizado_em = now()
      where execucao_id = v_exec.execucao_id;
    end;
  end loop;
  return v_qtd;
end $$;

-- a entrada manual passa a usar o mesmo nome do default da tabela
create or replace function public.adicionar_a_automacao(
  p_automacao uuid, p_leads uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_novos int := 0; v_ja int := 0;
begin
  if not exists (select 1 from public.automacoes where automacao_id = p_automacao) then
    return jsonb_build_object('erro', 'automação não encontrada');
  end if;

  select count(*) into v_ja
  from public.automacao_execucoes
  where automacao_fk = p_automacao and lead_fk = any(p_leads)
    and status in ('em_andamento', 'aguardando', 'ativa');

  insert into public.automacao_execucoes (automacao_fk, lead_fk, passo_atual, status, iniciado_em, agendado_para)
  select p_automacao, l, 1, 'em_andamento', now(), now()
  from unnest(p_leads) l
  where not exists (
    select 1 from public.automacao_execucoes ax
    where ax.automacao_fk = p_automacao and ax.lead_fk = l
      and ax.status in ('em_andamento', 'aguardando', 'ativa'));
  get diagnostics v_novos = row_count;

  return jsonb_build_object('adicionados', v_novos, 'ja_estavam', v_ja);
end $$;

-- resgata execuções que nasceram órfãs entre o v9 e agora
update public.automacao_execucoes
set agendado_para = now()
where status = 'em_andamento' and agendado_para is null;

commit;

-- prova: o executor aceita o status que o banco realmente grava
select position('em_andamento' in prosrc) > 0 as aceita_padrao_da_tabela,
       position('''ativa''' in prosrc) > 0 as aceita_o_nome_do_v9
from pg_proc where proname = 'executar_automacoes';
