-- =====================================================================
-- RESUMO DIÁRIO v1 — a operação vai até você.
--
-- Painel só informa quem abre o painel. Quem cuida de uma operação que
-- roda sozinha precisa saber que ela rodou — e, principalmente, quando
-- ela PAROU.
--
-- Duas decisões que fazem diferença:
--
--   1. Este e-mail NÃO passa pela fila de envios. Se passasse, o dia em
--      que o freio de entregabilidade pausasse a fila seria justamente o
--      dia em que o aviso não chegaria. Alerta que depende do sistema
--      que ele vigia não é alerta.
--
--   2. O destinatário mora em `app_config.resumo_diario_para` e NÃO no
--      código: endereço de pessoa não entra em repositório.
--      Vazio = ninguém recebe (e a função avisa isso no retorno).
--
--   3. O endereço do painel (o botão do fim) vem de `app_config.url_painel`,
--      gravado pelo instalador a partir do .env (VITE_OG_URL). Uma cópia da
--      plataforma nunca deve apontar para o painel de outra operação; até
--      03/09/2026 o domínio estava escrito aqui dentro. Vazio = sem botão.
-- =====================================================================
begin;

insert into public.app_config (chave, valor) values ('resumo_diario_para', '')
on conflict (chave) do nothing;

insert into public.app_config (chave, valor) values ('url_painel', '')
on conflict (chave) do nothing;

create or replace function public.resumo_diario_dados()
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'leads_novos', (select count(*) from public.tabela_1_leads
                    where created_at > now() - interval '24 hours'),
    'compras', (select count(*) from public.tabela_4_alunos
                where status = 'aprovada'
                  and coalesce(data_compra, created_at) > now() - interval '24 hours'),
    'receita', (select round(coalesce(sum(valor) filter (where moeda = 'BRL'), 0))
                from public.tabela_4_alunos
                where status = 'aprovada'
                  and coalesce(data_compra, created_at) > now() - interval '24 hours'),
    'emails', (select count(*) from public.envios
               where sent_at > now() - interval '24 hours'
                 and status in ('sent', 'delivered')),
    'fila', (select count(*) from public.envios where status = 'queued'),
    'aberturas', (select count(distinct lead_fk) from public.eventos_email
                  where tipo = 'open' and occurred_at > now() - interval '24 hours'),
    'cliques', (select count(distinct lead_fk) from public.eventos_email
                where tipo = 'click' and occurred_at > now() - interval '24 hours'),
    'saude', public.saude_envio(7),
    'janela_quente', (select count(*) from public.lead_venda
                      where alcancavel and proxima_oferta = 'formacao_janela_quente'),
    'em_automacao', (select count(*) from public.automacao_execucoes
                     where status in ('em_andamento', 'aguardando', 'ativa')),
    'automacoes_ativas', (select count(*) from public.automacoes where ativa),
    'alertas', (select coalesce(jsonb_agg(jsonb_build_object(
                   'titulo', titulo, 'gravidade', gravidade, 'detalhe', detalhe)), '[]'::jsonb)
                from public.alertas where visto_em is null
                  and criado_em > now() - interval '7 days'),
    'vendas_por_automacao', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'nome', nome, 'emails', emails, 'compradores', compradores, 'receita', receita)), '[]'::jsonb)
      from public.rel_resultado_envios(7, 14) where compradores > 0))
$$;

revoke execute on function public.resumo_diario_dados() from public, anon;
grant execute on function public.resumo_diario_dados() to authenticated, service_role;

create or replace function public.enviar_resumo_diario()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_d jsonb := public.resumo_diario_dados();
  v_para text := coalesce(public.cfg('resumo_diario_para'), '');
  v_painel text := rtrim(btrim(coalesce(public.cfg('url_painel'), '')), '/');
  v_key text := public.cfg('resend_api_key');
  v_de text := coalesce(public.cfg('from_name_padrao'), 'Ressoar') || ' <'
               || coalesce(public.cfg('from_email_padrao'), '') || '>';
  v_html text;
  v_alertas text := '';
  v_vendas text := '';
  v_a jsonb;
  v_req bigint;
begin
  if btrim(v_para) = '' then
    return jsonb_build_object('enviado', false,
      'motivo', 'ninguém em resumo_diario_para', 'dados', v_d);
  end if;
  if coalesce(v_key, '') = '' then
    return jsonb_build_object('enviado', false, 'motivo', 'sem chave de envio');
  end if;

  for v_a in select * from jsonb_array_elements(v_d->'alertas') loop
    v_alertas := v_alertas || '<li><b>' || (v_a->>'titulo') || '</b><br>'
                 || coalesce(v_a->>'detalhe', '') || '</li>';
  end loop;
  if v_alertas <> '' then
    v_alertas := '<h3 style="color:#b3261e">Precisa de você</h3><ul>' || v_alertas || '</ul>';
  end if;

  for v_a in select * from jsonb_array_elements(v_d->'vendas_por_automacao') loop
    v_vendas := v_vendas || '<li>' || (v_a->>'nome') || ' — '
                || (v_a->>'compradores') || ' compraram, R$ ' || (v_a->>'receita') || '</li>';
  end loop;
  if v_vendas <> '' then
    v_vendas := '<h3>O que os e-mails venderam (7 dias)</h3><ul>' || v_vendas || '</ul>';
  end if;

  v_html :=
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#3c3646;max-width:600px">'
    || '<h2 style="color:#6b4ea8;margin-bottom:2px">Ressoar · resumo do dia</h2>'
    || '<p style="color:#777;margin-top:0">'
    || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '</p>'
    || v_alertas
    || '<h3>Últimas 24 horas</h3><ul>'
    || '<li><b>' || (v_d->>'compras') || '</b> compras aprovadas — <b>R$ '
       || (v_d->>'receita') || '</b></li>'
    || '<li><b>' || (v_d->>'leads_novos') || '</b> leads novos</li>'
    || '<li><b>' || (v_d->>'emails') || '</b> e-mails enviados · '
       || (v_d->>'aberturas') || ' abriram · ' || (v_d->>'cliques') || ' clicaram</li>'
    || '<li><b>' || (v_d->>'em_automacao') || '</b> pessoas dentro de alguma automação agora'
       || ' · <b>' || (v_d->>'fila') || '</b> e-mails na fila</li>'
    || '</ul>'
    || v_vendas
    || '<h3>Saúde do envio</h3><ul>'
    || '<li>Bounce: <b>' || coalesce(v_d->'saude'->>'taxa_bounce', '0') || '%</b>'
       || ' (limite 2%) · Spam: <b>' || coalesce(v_d->'saude'->>'taxa_reclamacao', '0') || '%</b>'
       || ' (limite 0,1%)</li>'
    || '<li>Teto de hoje: <b>' || coalesce(v_d->'saude'->>'limite_diario', '0')
       || '</b> e-mails · usados nas últimas 24h: <b>'
       || coalesce(v_d->'saude'->>'enviados_24h', '0') || '</b></li>'
    || '<li>Envio ' || case when (v_d->'saude'->>'pausado')::boolean
                            then '<b style="color:#b3261e">PAUSADO</b>'
                            else 'liberado' end || '</li>'
    || '</ul>'
    || '<h3>Pronto para vender</h3>'
    || '<p><b>' || (v_d->>'janela_quente') || '</b> pessoas estão na janela quente agora.</p>'
    || case when v_painel <> '' then
         '<p style="margin-top:22px"><a href="' || v_painel || '/leadscoring"'
         || ' style="background:#6b4ea8;color:#fff;padding:10px 18px;border-radius:8px;'
         || 'text-decoration:none">Abrir o Lead scoring</a></p>'
       else '' end
    || '<p style="color:#999;font-size:12px;margin-top:20px">Resumo automático da sua operação. '
    || 'Para trocar quem recebe, mude “resumo_diario_para” em Configurações.</p></div>';

  v_req := net.http_post(
    url := 'https://api.resend.com/emails',
    body := jsonb_build_object(
      'from', v_de,
      'to', (select jsonb_agg(btrim(x)) from unnest(string_to_array(v_para, ',')) x
             where btrim(x) <> ''),
      'subject', 'Ressoar · ' || (v_d->>'compras') || ' compras, R$ ' || (v_d->>'receita')
                 || ' nas últimas 24h',
      'html', v_html),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key,
                                  'Content-Type', 'application/json'));

  return jsonb_build_object('enviado', true, 'req', v_req, 'para', v_para, 'dados', v_d);
end $$;

grant execute on function public.enviar_resumo_diario() to service_role;

-- 8h de São Paulo = 11h UTC
select cron.schedule('ressoar-resumo-diario', '0 11 * * *',
                     'select public.enviar_resumo_diario()')
where not exists (select 1 from cron.job where jobname = 'ressoar-resumo-diario');

commit;

select public.resumo_diario_dados() as dados_de_hoje;
