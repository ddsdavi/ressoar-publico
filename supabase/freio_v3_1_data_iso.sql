-- =====================================================================
-- FREIO v3.1 — a hora da travada em formato que o navegador entende.
--
-- `now()::text` no Postgres dá "2026-08-30 13:07:00+00": espaço no lugar
-- do T e fuso sem os minutos. O Date() do navegador devolve NaN para isso
-- e some com a hora do aviso — calado, como sempre. Passa a gravar ISO
-- 8601 de verdade (to_json(now()) já entrega "…T13:07:00+00:00").
-- =====================================================================

begin;

create or replace function public.marcar_religamento_envio()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_agora text := to_json(now())#>>'{}';
begin
  -- gente tem auth.uid(); o freio roda pelo cron, sem sessão nenhuma
  if auth.uid() is null then return new; end if;
  if coalesce(new.valor, '') = coalesce(old.valor, '') then return new; end if;

  if new.valor = 'false' then
    update public.app_config set valor = v_agora, updated_at = now()
     where chave = 'envio_religado_em';
    update public.app_config set valor = '', updated_at = now()
     where chave in ('envio_pausa_motivo', 'envio_pausa_em');
    update public.app_config set valor = 'false', updated_at = now()
     where chave = 'envio_pausa_automatica';
  else
    update public.app_config set valor = 'pausa manual', updated_at = now()
     where chave = 'envio_pausa_motivo';
    update public.app_config set valor = v_agora, updated_at = now()
     where chave = 'envio_pausa_em';
    update public.app_config set valor = 'false', updated_at = now()
     where chave = 'envio_pausa_automatica';
  end if;
  return new;
end $$;

create or replace function public.freio_entregabilidade()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_religado timestamptz := nullif(public.cfg('envio_religado_em'), '')::timestamptz;
  v_desde    timestamptz := greatest(now() - interval '7 days',
                                     coalesce(v_religado, '-infinity'::timestamptz));
  v_s        jsonb := public.saude_envio_desde(v_desde);
  v_limite   int := coalesce(nullif(public.cfg('envio_limite_diario'), ''), '0')::int;
  v_enviados int := coalesce((v_s->>'enviados')::int, 0);
  v_bounces  int := coalesce((v_s->>'bounces')::int, 0);
  v_motivo   text := null;
begin
  if coalesce(public.cfg('envio_pausado'), 'false') = 'true' then
    return jsonb_build_object('acao', 'nada', 'motivo', 'já pausado', 'saude', v_s);
  end if;

  if v_enviados < 50 and v_bounces < 10 then
    return jsonb_build_object('acao', 'nada', 'motivo', 'amostra pequena', 'saude', v_s);
  end if;

  if coalesce((v_s->>'taxa_bounce')::numeric, 0) > 2.0 then
    v_motivo := 'devolução em ' || replace((v_s->>'taxa_bounce'), '.', ',') || '% (limite 2%)';
  elsif coalesce((v_s->>'taxa_reclamacao')::numeric, 0) > 0.1 then
    v_motivo := 'reclamação de spam em ' || replace((v_s->>'taxa_reclamacao'), '.', ',') || '% (limite 0,1%)';
  elsif v_bounces >= 10 and v_enviados < 50 then
    v_motivo := v_bounces || ' devoluções em ' || v_enviados || ' envios';
  end if;

  if v_motivo is null then
    return jsonb_build_object('acao', 'nada', 'saude', v_s);
  end if;

  update public.app_config set valor = 'true', updated_at = now() where chave = 'envio_pausado';

  if v_limite > 0 then
    update public.app_config
       set valor = greatest(50, (v_limite / 2))::text, updated_at = now()
     where chave = 'envio_limite_diario';
  end if;

  update public.app_config set valor = v_motivo, updated_at = now()
   where chave = 'envio_pausa_motivo';
  update public.app_config set valor = to_json(now())#>>'{}', updated_at = now()
   where chave = 'envio_pausa_em';
  update public.app_config set valor = 'true', updated_at = now()
   where chave = 'envio_pausa_automatica';

  perform public.registrar_alerta(
    'entregabilidade',
    'Envio pausado automaticamente',
    'O freio de entregabilidade parou a fila: ' || v_motivo ||
    '. Nada se perdeu — os e-mails continuam na fila. Antes de religar em '
    || 'Configurações → E-mail, olhe Envios e exclusões: devolução alta costuma ser '
    || 'lista antiga; reclamação alta costuma ser mensagem que não combinou com o público.',
    'critico', v_s, 24);

  return jsonb_build_object('acao', 'pausou', 'motivo', v_motivo, 'saude', v_s);
end $$;

-- a travada real de hoje, no formato certo
update public.app_config set valor = '2026-08-30T13:07:00+00:00', updated_at = now()
 where chave = 'envio_pausa_em';

commit;

select jsonb_pretty(jsonb_build_object(
  'pausa_em', public.cfg('envio_pausa_em'),
  'freio_agora', public.freio_entregabilidade()->>'motivo')) as prova;
