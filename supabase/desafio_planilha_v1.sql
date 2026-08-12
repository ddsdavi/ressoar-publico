-- =====================================================================
-- PLANILHA DE COMPRADORES DO DESAFIO — a Ressoar assume do n8n
--
-- A planilha "[PATRÍCIA] Compradores Desafio Casa Harmonizada"
-- (1rcOw0HgMZ83hp2aQ0tRB2cnNi-QkjiSPgJ6mKqSLVxk) era alimentada pelos
-- workflows A/B do n8n — os mesmos da tag dupla de turma (ver o diário,
-- 11/08/2026). Ela tem UMA ABA POR TURMA (CASA_H_2026_08_10, …), e o nó
-- do n8n apontava a aba da semana À MÃO, toda segunda — o mesmo ritual
-- manual que produziu a tag errada quando parou de ser feito.
--
-- Aqui o ritual morre de vez, em duas peças:
--
--   1. executar_passo_planilha aprende a calcular a aba pela TURMA: se o
--      config tiver `aba_turma_padrao`, o nome da aba sai de
--      nome_da_turma() — a mesma função da tag de turma, mesma virada
--      (segunda 7h São Paulo). Config com `aba` fixa segue como era
--      (a automação das Lives não muda).
--   2. a Edge Function google-sheets cria a aba quando ela não existir
--      (com o cabeçalho), em vez de falhar — é isso que mata a tarefa
--      de segunda-feira.
--
-- A turma é calculada com now(): o passo roda 1–2 minutos depois da
-- compra, então agora e o momento da compra são a mesma turma. A exceção
-- é REPROCESSAR evento antigo (pendência 5 do diário): a linha cairia na
-- aba de hoje, não na da época — igual à tag. Quem reprocessar histórico
-- precisa saber disso.
--
-- O gatilho é compra_realizada com filtro de produto ("Desafio Casa",
-- o padrao_nome da regra do produto). O casamento do motor já dispensa
-- o resto: order bump gera dois eventos, mas só o do Desafio casa; e
-- comprador repetido meses depois gera execução nova — linha nova,
-- como no n8n.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. o passo de planilha aprende a aba por turma
-- ------------------------------------------------------------------
create or replace function public.executar_passo_planilha(
  p_lead uuid, p_config jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_key  text := public.segredo('service_key');
  v_aba  text;
begin
  if coalesce(public.segredo('google_refresh_token'), '') = '' then
    return 'conta Google não conectada';
  end if;
  if coalesce(v_base, '') = '' or coalesce(v_key, '') = '' then
    return 'falta base_url_tracking ou service_key';
  end if;

  -- aba fixa (formato original) ou calculada pela turma da semana
  v_aba := case
    when coalesce(p_config->>'aba_turma_padrao', '') <> '' then
      public.nome_da_turma(
        p_config->>'aba_turma_padrao',
        coalesce((p_config->>'turma_dia')::int, 1),
        coalesce((p_config->>'turma_hora')::int, 7),
        coalesce(p_config->>'turma_fuso', 'America/Sao_Paulo'),
        now())
    else p_config->>'aba'
  end;

  if coalesce(p_config->>'planilha_id', '') = '' or coalesce(v_aba, '') = '' then
    return 'passo sem planilha ou aba';
  end if;

  perform net.http_post(
    url := v_base || '/google-sheets',
    body := jsonb_build_object(
      'acao', 'acrescentar',
      'planilha_id', p_config->>'planilha_id',
      'aba', v_aba,
      'colunas', coalesce(p_config->'colunas', '[]'::jsonb),
      'mapeamento', coalesce(p_config->'mapeamento', '{}'::jsonb),
      'contato', public.payload_contato(p_lead)),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return 'enviado';
end $$;

grant execute on function public.executar_passo_planilha(uuid, jsonb)
  to authenticated, service_role;

-- ------------------------------------------------------------------
-- 2. a automação, LIGADA: compra do Desafio → linha na aba da turma
--
-- As colunas seguem o cabeçalho real das abas (conferido em
-- 12/08/2026): ID do Contato | WhatsApp | Nome | E-mail. "ID do
-- Contato" é o assinante do ManyChat, como o n8n sempre gravou.
-- ------------------------------------------------------------------
do $$
declare v_auto uuid;
begin
  if exists (select 1 from public.automacoes
              where nome = '[RESSOAR] Desafio — planilha de compradores') then
    raise notice 'automação já existe — nada a fazer';
    return;
  end if;

  insert into public.automacoes (nome, ativa, gatilho, nota)
  values (
    '[RESSOAR] Desafio — planilha de compradores',
    true,
    '{"tipo": "compra_realizada", "produto": "Desafio Casa"}'::jsonb,
    'Assumiu do n8n (workflows A/B) em 12/08/2026. Cada compra aprovada do '
    || 'Desafio vira uma linha na planilha [PATRÍCIA] Compradores Desafio '
    || 'Casa Harmonizada, na ABA DA TURMA da semana — a aba é calculada '
    || 'pela mesma régua da tag de turma e criada sozinha na virada de '
    || 'segunda. Ninguém mais aponta aba à mão.')
  returning automacao_id into v_auto;

  insert into public.automacao_passos (automacao_fk, ordem, tipo, config)
  values (v_auto, 1, 'google_sheets', jsonb_build_object(
    'planilha_id', '1rcOw0HgMZ83hp2aQ0tRB2cnNi-QkjiSPgJ6mKqSLVxk',
    'aba_turma_padrao', 'CASA_H_{AAAA}_{MM}_{DD}',
    'turma_dia', 1,
    'turma_hora', 7,
    'turma_fuso', 'America/Sao_Paulo',
    'colunas', jsonb_build_array('ID do Contato', 'WhatsApp', 'Nome', 'E-mail'),
    'mapeamento', jsonb_build_object(
      'ID do Contato', 'manychat_id',
      'WhatsApp', 'whatsapp',
      'Nome', 'nome',
      'E-mail', 'email')));
end $$;

commit;

-- prova: a aba calculada segue a virada da turma, e a automação está de pé
select
  public.nome_da_turma('CASA_H_{AAAA}_{MM}_{DD}', 1, 7, 'America/Sao_Paulo',
    timestamptz '2026-08-10 06:59-03')  as antes_da_virada,   -- CASA_H_2026_08_10
  public.nome_da_turma('CASA_H_{AAAA}_{MM}_{DD}', 1, 7, 'America/Sao_Paulo',
    timestamptz '2026-08-10 07:00-03')  as depois_da_virada,  -- CASA_H_2026_08_17
  (select ativa from public.automacoes
    where nome = '[RESSOAR] Desafio — planilha de compradores') as automacao_ativa,
  (select config->>'aba_turma_padrao' from public.automacao_passos p
    join public.automacoes a on a.automacao_id = p.automacao_fk
    where a.nome = '[RESSOAR] Desafio — planilha de compradores') as padrao_da_aba;
