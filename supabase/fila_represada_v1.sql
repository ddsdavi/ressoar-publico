-- =====================================================================
-- FILA REPRESADA — quem está esperando, com nome.
--
-- A tela de Configurações dizia só "70 e-mail(s) esperando na fila". Em
-- 30/08/2026 esses 70 eram 62 confirmações de inscrição da Black do
-- próprio dia e 8 avisos de live — gente que se cadastrou e ficou sem
-- resposta. Um número solto não conta isso; um número com nome conta.
-- =====================================================================

begin;

create or replace function public.fila_represada()
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'rotulo', rotulo, 'tipo', tipo, 'n', n, 'desde', desde) order by n desc),
         '[]'::jsonb)
  from (
    select coalesce(a.nome, c.nome, 'avulso') as rotulo,
           case when e.campanha_fk is not null then 'campanha' else 'automação' end as tipo,
           count(*) as n,
           min(e.queued_at) as desde
      from public.envios e
      left join public.automacoes a on a.automacao_id = e.automacao_fk
      left join public.campanhas  c on c.campanha_id  = e.campanha_fk
     where e.status = 'queued'
     group by 1, 2
     order by 3 desc
     limit 12) t;
$$;

revoke all on function public.fila_represada() from public, anon;
grant execute on function public.fila_represada() to authenticated, service_role;

commit;

select jsonb_pretty(public.fila_represada()) as prova;
