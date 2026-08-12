-- =====================================================================
-- MOTOR v9 — integrações e entrada manual em automação.
--
-- Dois defeitos consertados aqui:
--
--   1. A CHAVE-GERAL DOS WEBHOOKS NÃO VALIA PARA AS AUTOMAÇÕES. A opção
--      "webhooks desligados" existe justamente para não duplicar disparo
--      enquanto o ActiveCampaign ainda está vivo — mas o passo de webhook
--      dentro da automação chamava a URL de qualquer jeito. Hoje há 8
--      passos de webhook e 3 de Google Sheets em automações ativas: com o
--      gatilho certo, o n8n receberia duas vezes o mesmo contato, uma do
--      AC e outra daqui.
--
--   2. O corpo enviado dizia origem "active-proprio", nome antigo do
--      projeto. Quem recebe no n8n não tem como saber de onde veio.
--
-- E entra a função de colocar contato dentro de automação já rodando.
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
    where status = 'ativa' and coalesce(agendado_para, now()) <= now()
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
        -- respeita a chave-geral: desligada, nenhum POST sai. É a trava
        -- que evita disparo duplicado enquanto o AC ainda está no ar.
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
      -- um passo com erro para a execução daquele contato, não a fila toda
      update public.automacao_execucoes
      set status = 'erro', erro = sqlerrm, finalizado_em = now()
      where execucao_id = v_exec.execucao_id;
    end;
  end loop;
  return v_qtd;
end $$;

-- ------------------------------------------------------------------
-- Colocar contatos dentro de uma automação já existente.
-- Serve para testar sem esperar o gatilho e para reprocessar quem ficou
-- de fora. A automação não precisa estar ativa: quem entra por aqui é
-- decisão explícita de uma pessoa, não do gatilho.
-- ------------------------------------------------------------------
create or replace function public.adicionar_a_automacao(
  p_automacao uuid, p_leads uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_novos int := 0;
  v_ja int := 0;
begin
  if not exists (select 1 from public.automacoes where automacao_id = p_automacao) then
    return jsonb_build_object('erro', 'automação não encontrada');
  end if;

  select count(*) into v_ja
  from public.automacao_execucoes
  where automacao_fk = p_automacao and lead_fk = any(p_leads) and status = 'ativa';

  insert into public.automacao_execucoes (automacao_fk, lead_fk, passo_atual, status, iniciado_em, agendado_para)
  select p_automacao, l, 1, 'ativa', now(), now()
  from unnest(p_leads) l
  where not exists (
    select 1 from public.automacao_execucoes ax
    where ax.automacao_fk = p_automacao and ax.lead_fk = l and ax.status = 'ativa');
  get diagnostics v_novos = row_count;

  return jsonb_build_object('adicionados', v_novos, 'ja_estavam', v_ja);
end $$;

grant execute on function public.adicionar_a_automacao(uuid, uuid[]) to authenticated;

commit;

-- prova: a chave-geral agora vale, e os três tipos de integração existem
select position('v_webhooks' in prosrc) > 0 as respeita_chave_geral,
       position('google_drive' in prosrc) > 0 as tem_drive,
       position('active-proprio' in prosrc) = 0 as nome_antigo_removido
from pg_proc where proname = 'executar_automacoes';
