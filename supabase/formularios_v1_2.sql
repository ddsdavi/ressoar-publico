-- O formulário passa a ser servido pelo domínio do Ressoar, não pelo
-- domínio de funções do Supabase — que força text/plain em HTML (proteção
-- contra hospedarem página falsa lá) e mostraria o código em vez da página.
--
-- Ganho de tabela: o endereço fica ressoar.seudominio.com.br/f/slug.
-- Domínio próprio em formulário de captação passa mais confiança e não
-- depende de infraestrutura de terceiro aparecer na barra de endereço.
--
-- Para isso o visitante (anônimo) precisa LER o formulário ativo. Só isso:
-- a leitura devolve título, campos e cor. Lista e tag de destino continuam
-- protegidas — quem as aplica é a função pública, que lê do banco com
-- chave de servidor.
begin;

drop policy if exists form_publico on public.formularios;
create policy form_publico on public.formularios
  for select to anon using (ativo);

grant select on public.formularios to anon;

commit;

select 'anon pode ler formulario ativo' as politica,
       count(*) as formularios_ativos from public.formularios where ativo;
