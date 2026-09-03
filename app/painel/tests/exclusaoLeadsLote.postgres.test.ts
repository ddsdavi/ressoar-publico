import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

function dividirDeclaracoes(sql: string): string[] {
  const semComentarios = sql.replace(/--[^\r\n]*/g, "");
  const declaracoes: string[] = [];
  let atual = "";
  let emString = false;
  let emBlocoDollar = false;

  for (let i = 0; i < semComentarios.length; i += 1) {
    const caractere = semComentarios[i];
    const proximo = semComentarios[i + 1];

    if (!emString && caractere === "$" && proximo === "$") {
      emBlocoDollar = !emBlocoDollar;
      atual += "$$";
      i += 1;
      continue;
    }

    if (!emBlocoDollar && caractere === "'") {
      if (emString && proximo === "'") {
        atual += "''";
        i += 1;
        continue;
      }
      emString = !emString;
    }

    atual += caractere;
    if (caractere === ";" && !emString && !emBlocoDollar) {
      declaracoes.push(atual.replace(/\s+/g, " ").trim());
      atual = "";
    }
  }

  assert.equal(emString, false, "string SQL sem fechamento");
  assert.equal(emBlocoDollar, false, "bloco $$ sem fechamento");
  assert.equal(atual.trim(), "", "declaração SQL sem ponto e vírgula");
  return declaracoes;
}

const migrationPath = fileURLToPath(
  new URL("../../../supabase/exclusao_leads_lote_v1.sql", import.meta.url),
);
const rollbackPath = fileURLToPath(
  new URL("../../../supabase/rollback_exclusao_leads_lote_v1.sql", import.meta.url),
);
const ordemPath = fileURLToPath(new URL("../../../supabase/ordem.txt", import.meta.url));

test("a migration recusa acesso indevido e exclui lotes atomicamente", () => {
  const laboratorio = mkdtempSync(join(tmpdir(), "ressoar-leads-lote-"));
  const dataDir = join(laboratorio, "data");

  try {
    const initdb = spawnSync("initdb", [
      "-D", dataDir, "-A", "trust", "--no-locale", "-E", "UTF8",
    ], { encoding: "utf8" });
    assert.equal(
      initdb.status,
      0,
      initdb.error?.message || initdb.stderr || initdb.stdout || "initdb não está disponível",
    );

    const fixture = [
      "create role anon nologin;",
      "create role authenticated nologin;",
      "create schema auth;",
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid; $$;",
      "create table public.test_leads (lead_id uuid primary key, nome text not null);",
      "create table public.test_exclusoes (ordem bigint generated always as identity, lead_id uuid not null);",
      "create function public.papel_atual() returns text language sql stable as $$ select nullif(current_setting('test.role', true), ''); $$;",
      "create function public.excluir_lead_ressoar(p_lead_id uuid) returns jsonb language plpgsql as $$ begin if p_lead_id::text = nullif(current_setting('test.fail_id', true), '') then raise exception 'falha simulada'; end if; insert into public.test_exclusoes(lead_id) values (p_lead_id); delete from public.test_leads where lead_id = p_lead_id; return jsonb_build_object('lead_id', p_lead_id); end; $$;",
    ];
    const migration = dividirDeclaracoes(readFileSync(migrationPath, "utf8"));
    const rollback = dividirDeclaracoes(readFileSync(rollbackPath, "utf8"));
    const verificacoes = [
      "do $$ begin perform public.excluir_leads_ressoar(array['00000000-0000-0000-0000-000000000001'::uuid]); raise exception 'anon deveria ser recusado'; exception when insufficient_privilege then null; end; $$;",
      "select set_config('test.uid', '10000000-0000-0000-0000-000000000001', false);",
      "select set_config('test.role', 'terapeuta', false);",
      "do $$ begin perform public.excluir_leads_ressoar(array['00000000-0000-0000-0000-000000000001'::uuid]); raise exception 'nao-admin deveria ser recusado'; exception when insufficient_privilege then null; end; $$;",
      "select set_config('test.role', 'admin', false);",
      "do $$ begin perform public.excluir_leads_ressoar(null::uuid[]); raise exception 'argumento null deveria ser recusado'; exception when sqlstate '22023' then null; end; $$;",
      "do $$ begin perform public.excluir_leads_ressoar(array[]::uuid[]); raise exception 'lote vazio deveria ser recusado'; exception when sqlstate '22023' then null; end; $$;",
      "do $$ begin perform public.excluir_leads_ressoar(array[null]::uuid[]); raise exception 'lote nulo deveria ser recusado'; exception when sqlstate '22023' then null; end; $$;",
      "do $$ begin perform public.excluir_leads_ressoar(array_fill(null::uuid, array[101])); raise exception 'array bruto de nulos deveria ser recusado'; exception when sqlstate '22023' then null; end; $$;",
      "do $$ begin perform public.excluir_leads_ressoar(array_fill('00000000-0000-0000-0000-000000000001'::uuid, array[101])); raise exception 'array bruto de duplicatas deveria ser recusado'; exception when sqlstate '22023' then null; end; $$;",
      "do $$ begin perform public.excluir_leads_ressoar(array(select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 101) i)); raise exception 'lote acima do limite deveria ser recusado'; exception when sqlstate '22023' then null; end; $$;",
      "insert into public.test_leads(lead_id, nome) values ('00000000-0000-0000-0000-000000000003', 'tres'), ('00000000-0000-0000-0000-000000000001', 'um'), ('00000000-0000-0000-0000-000000000002', 'dois');",
      "do $$ declare v_resultado jsonb; v_ordem uuid[]; begin v_resultado := public.excluir_leads_ressoar(array['00000000-0000-0000-0000-000000000003'::uuid, null, '00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid]); if (v_resultado->>'quantidade')::integer <> 2 then raise exception 'duplicatas nao foram eliminadas: %', v_resultado; end if; select array_agg(lead_id order by ordem) into v_ordem from public.test_exclusoes; if v_ordem <> array['00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000003'::uuid] then raise exception 'ids nao foram processados em ordem: %', v_ordem; end if; if (select count(*) from public.test_leads) <> 1 then raise exception 'quantidade restante inesperada'; end if; end; $$;",
      "truncate public.test_leads;",
      "truncate public.test_exclusoes restart identity;",
      "insert into public.test_leads(lead_id, nome) values ('00000000-0000-0000-0000-000000000010', 'dez'), ('00000000-0000-0000-0000-000000000020', 'vinte');",
      "select set_config('test.fail_id', '00000000-0000-0000-0000-000000000020', false);",
      "do $$ begin begin perform public.excluir_leads_ressoar(array['00000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000020'::uuid]); raise exception 'falha simulada nao ocorreu'; exception when others then if sqlerrm = 'falha simulada nao ocorreu' then raise; end if; end; if (select count(*) from public.test_leads) <> 2 or (select count(*) from public.test_exclusoes) <> 0 then raise exception 'a exclusao nao foi atomica'; end if; end; $$;",
      "do $$ declare v_security_definer boolean; v_public_execute boolean; v_authenticated_execute boolean; begin select p.prosecdef, exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'), exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a join pg_roles r on r.oid = a.grantee where r.rolname = 'authenticated' and a.privilege_type = 'EXECUTE') into v_security_definer, v_public_execute, v_authenticated_execute from pg_proc p where p.oid = 'public.excluir_leads_ressoar(uuid[])'::regprocedure; if not v_security_definer then raise exception 'funcao deveria ser security definer'; end if; if v_public_execute then raise exception 'public nao deveria executar a funcao'; end if; if not v_authenticated_execute then raise exception 'authenticated deveria executar a funcao'; end if; end; $$;",
      "select 'SQL_TESTS_OK' as resultado;",
    ];

    const execucao = spawnSync("postgres", ["--single", "-D", dataDir, "postgres"], {
      encoding: "utf8",
      input: [
        ...fixture,
        ...migration,
        ...verificacoes,
        ...rollback,
        "do $$ begin if to_regprocedure('public.excluir_leads_ressoar(uuid[])') is not null then raise exception 'rollback nao removeu a funcao'; end if; end; $$;",
        "select 'ROLLBACK_OK' as resultado;",
      ].join("\n"),
      maxBuffer: 10 * 1024 * 1024,
    });
    const saida = `${execucao.stdout}\n${execucao.stderr}`;
    assert.equal(execucao.status, 0, saida);
    assert.doesNotMatch(saida, /\bERROR:/, saida);
    assert.match(saida, /SQL_TESTS_OK/, saida);
    assert.match(saida, /ROLLBACK_OK/, saida);
  } finally {
    rmSync(laboratorio, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("a ordem canônica aplica a função em lote após a exclusão individual", () => {
  const linhas = readFileSync(ordemPath, "utf8").split(/\r?\n/);
  const individual = linhas.indexOf("supabase/exclusao_lead_v1.sql");
  const lote = linhas.indexOf("supabase/exclusao_leads_lote_v1.sql");

  assert.notEqual(individual, -1);
  assert.notEqual(lote, -1);
  assert.equal(lote, individual + 1);
  assert.equal(linhas.indexOf("supabase/rollback_exclusao_leads_lote_v1.sql"), -1);
});
