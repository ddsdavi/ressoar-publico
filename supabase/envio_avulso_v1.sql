-- =====================================================================
-- ENVIO AVULSO — mandar um e-mail pronto sem criar campanha
--
-- Por que existe: até aqui só havia dois jeitos de um e-mail sair — por
-- campanha (que existe para ser um evento, com relatório e histórico) ou
-- por automação (que fica de plantão esperando um gatilho). Faltava o
-- caso mais simples e mais humano: "manda esse e-mail para a Fulana",
-- ou "manda para quem está nesta lista", agora, sem cerimônia.
--
-- O que este roteiro NÃO faz, de propósito: nenhum caminho novo de
-- envio. Ele só resolve QUEM recebe e entrega a lista para a mesma
-- `enfileirar_email` que campanha e automação usam. Com isso o envio
-- avulso herda tudo o que já protege a casa, sem nada duplicado:
--
--   · a supressão (quem devolveu, reclamou ou pediu para sair não
--     recebe — e o envio fica registrado como 'suppressed', para o
--     relatório mostrar que a pessoa foi pulada, não esquecida);
--   · o endereço certo de contato (quem comprou com outro e-mail recebe
--     naquele, via email_para_contato);
--   · o freio de entregabilidade, o teto diário do aquecimento e o
--     "envio_so_para" de teste, todos dentro de processar_fila_envios;
--   · o pixel de abertura, o rastreio de link, o descadastro e o rodapé,
--     que o motor acrescenta na hora de montar a mensagem.
--
-- Rastreabilidade: cada envio avulso grava contexto
-- {"origem":"avulso","por":<uid de quem clicou>}. Sem campanha_fk e sem
-- automacao_fk, é assim que se sabe depois quem mandou e por quê — e é
-- isso que faz a linha "Envios avulsos" aparecer sozinha na tela de
-- Qualidade da conta.
--
-- Por que a prévia é uma função separada: mandar e-mail não tem desfazer.
-- A tela pergunta ao banco quantas pessoas vão receber ANTES de aparecer
-- o botão — e quem confirma vê o número real, contado do mesmo jeito que
-- o envio vai contar, não uma estimativa parecida.
--
-- Lista x pessoa: escolhendo uma lista, só entra quem está inscrito
-- (status 1) — exatamente o público que uma campanha montaria. Escolhendo
-- pessoas na mão, vai para elas, mesmo que tenham saído de alguma lista:
-- é decisão de quem clicou, e a supressão continua valendo por cima.
--
-- Reversível: `drop function public.enviar_avulso(uuid, uuid[], int, uuid);`
--             `drop function public.previa_avulso(uuid[], int, uuid);`
--             `drop function public.publico_avulso(uuid[], int, uuid);`
-- =====================================================================

begin;

-- ------------------------------------------------------------------
-- Quem recebe. Uma fonte só, usada pela prévia e pelo envio: se as duas
-- contassem por caminhos diferentes, um dia dariam números diferentes e
-- a confirmação viraria mentira.
-- ------------------------------------------------------------------
create or replace function public.publico_avulso(
  p_leads uuid[] default null,
  p_lista int default null,
  p_segmento uuid default null
) returns setof uuid
language plpgsql stable security definer set search_path to 'public' as $fn$
declare v_def jsonb;
begin
  if p_leads is not null and array_length(p_leads, 1) > 0 then
    return query select distinct x from unnest(p_leads) x where x is not null;
  elsif p_lista is not null then
    -- status 1 = inscrito. Quem saiu da lista não volta a receber por
    -- ela; é o mesmo público que a campanha monta
    return query select distinct ll.lead_fk from public.lead_listas ll
                 where ll.lista_fk = p_lista and ll.status = 1;
  elsif p_segmento is not null then
    select definicao into v_def from public.segmentos where segmento_id = p_segmento;
    return query select * from public.leads_do_segmento(coalesce(v_def, '{}'::jsonb));
  end if;
  return;
end $fn$;

-- ------------------------------------------------------------------
-- Prévia: o número que a pessoa vê antes de confirmar.
-- ------------------------------------------------------------------
create or replace function public.previa_avulso(
  p_leads uuid[] default null,
  p_lista int default null,
  p_segmento uuid default null
) returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  with alvo as (select p from public.publico_avulso(p_leads, p_lista, p_segmento) p),
  detalhe as (
    select a.p,
           public.email_para_contato(a.p, null) as email
    from alvo a
  )
  select jsonb_build_object(
    'total', (select count(*) from detalhe),
    'sem_email', (select count(*) from detalhe where coalesce(email, '') = ''),
    'bloqueados', (select count(*) from detalhe d
                   where coalesce(d.email, '') <> ''
                     and exists (select 1 from public.supressao s where s.email = d.email)),
    'vao_receber', (select count(*) from detalhe d
                    where coalesce(d.email, '') <> ''
                      and not exists (select 1 from public.supressao s where s.email = d.email)),
    'pausado', coalesce(public.cfg('envio_pausado'), 'false') = 'true'
  );
$fn$;

-- ------------------------------------------------------------------
-- O envio. Devolve o que aconteceu, não só um "ok": quem clicou precisa
-- saber quantos foram pulados, senão some gente sem explicação.
-- ------------------------------------------------------------------
create or replace function public.enviar_avulso(
  p_mensagem uuid,
  p_leads uuid[] default null,
  p_lista int default null,
  p_segmento uuid default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_lead uuid;
  v_ok int := 0;
  v_pulados int := 0;
  v_ctx jsonb;
begin
  perform public.gate_operacao();

  if not exists (select 1 from public.mensagens where mensagem_id = p_mensagem) then
    raise exception 'Mensagem não encontrada.' using errcode = '22023';
  end if;
  if p_leads is null and p_lista is null and p_segmento is null then
    raise exception 'Escolha para quem enviar.' using errcode = '22023';
  end if;

  -- fica no envio para sempre: sem campanha e sem automação, é o contexto
  -- que responde "quem mandou isso, e por onde"
  v_ctx := jsonb_build_object('origem', 'avulso', 'por', auth.uid());

  for v_lead in select * from public.publico_avulso(p_leads, p_lista, p_segmento) loop
    if public.enfileirar_email(v_lead, p_mensagem, null, null, null, v_ctx) is not null then
      v_ok := v_ok + 1;
    else
      -- bloqueado na supressão ou sem endereço de contato. Os dois casos
      -- já ficaram registrados por enfileirar_email
      v_pulados := v_pulados + 1;
    end if;
  end loop;

  return jsonb_build_object('enfileirados', v_ok, 'pulados', v_pulados,
                            'pausado', coalesce(public.cfg('envio_pausado'), 'false') = 'true');
end $fn$;

revoke execute on function public.publico_avulso(uuid[], int, uuid) from public, anon;
revoke execute on function public.previa_avulso(uuid[], int, uuid) from public, anon;
revoke execute on function public.enviar_avulso(uuid, uuid[], int, uuid) from public, anon;
grant execute on function public.publico_avulso(uuid[], int, uuid) to authenticated, service_role;
grant execute on function public.previa_avulso(uuid[], int, uuid) to authenticated, service_role;
grant execute on function public.enviar_avulso(uuid, uuid[], int, uuid) to authenticated, service_role;

comment on function public.enviar_avulso(uuid, uuid[], int, uuid) is
  'Manda um e-mail da biblioteca para pessoas, uma lista ou um segmento, sem criar campanha.';

commit;
