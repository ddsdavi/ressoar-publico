-- =====================================================================
-- LIVES SEMANAIS — o passo de planilha entra na automação da Ressoar.
--
-- A planilha "[PATRÍCIA DOMINGOS] Lives semanais - inscritos" era
-- alimentada pelo flow do n8n (workflow X8vmCXUkeqXQQ1Nk). Agora quem
-- escreve é a própria Ressoar: passo google_sheets NATIVO na automação
-- "[RESSOA] Lives Semanais — tag no ManyChat" (gatilho tag 85), logo
-- depois do passo que marca o ManyChat. O flow do n8n fica de reserva,
-- parado — decisão do Davi em 05/08.
-- =====================================================================
begin;

-- 1. o passo, na ordem 2. As colunas seguem a ordem EXATA do cabeçalho
-- real da planilha (o executor escreve posicionalmente a partir do A).
-- "ID do Contato" recebia o assinante do ManyChat no n8n; agora recebe
-- o lead_id da Ressoar — o dono do contato passou a ser a base.
insert into public.automacao_passos (automacao_fk, ordem, tipo, config)
select '80750fda-1235-4443-bed0-730a633925a3', 2, 'google_sheets',
       jsonb_build_object(
         'planilha_id', '1l3wE_XQ8frelkN3UA0ExogwLNGAapP1LkW3kKAu3uyY',
         'aba', 'Página1',
         'colunas', jsonb_build_array('ID do Contato','WhatsApp','Nome','E-mail'),
         'mapeamento', jsonb_build_object(
           'ID do Contato', 'lead_id',
           'WhatsApp', 'whatsapp',
           'Nome', 'nome',
           'E-mail', 'email'))
 where not exists (
   select 1 from public.automacao_passos
    where automacao_fk = '80750fda-1235-4443-bed0-730a633925a3'
      and tipo = 'google_sheets');

-- 2. a réplica "Automação 19" só existia para chamar o webhook do n8n
-- das lives. Com o passo nativo no lugar, cada inscrição geraria uma
-- execução quebrada lá. Sai de cena; o flow continua guardado no n8n.
update public.automacoes set ativa = false
 where automacao_id = '0bc3db12-6fe7-4817-8fb1-4261b2825509';

commit;

-- prova: o passo existe com a config certa, a réplica dormiu, e o
-- executor conhece o ramo nativo
select a.nome, a.ativa, p.ordem, p.tipo,
       p.config->>'aba'      as aba,
       p.config->'colunas'   as colunas,
       (select position('executar_passo_planilha' in prosrc) > 0
          from pg_proc where proname = 'executar_automacoes') as executor_nativo
  from public.automacoes a
  left join public.automacao_passos p on p.automacao_fk = a.automacao_id
 where a.automacao_id in ('80750fda-1235-4443-bed0-730a633925a3',
                          '0bc3db12-6fe7-4817-8fb1-4261b2825509')
 order by a.nome, p.ordem;
