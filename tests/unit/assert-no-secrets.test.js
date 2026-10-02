import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoSecrets } from '../../scripts/assert-no-secrets.js';

const scriptPath = fileURLToPath(new URL('../../scripts/assert-no-secrets.js', import.meta.url));
const configPath = fileURLToPath(new URL('../../src/server/config.js', import.meta.url));

test('assertNoSecrets bloqueia conteúdo de chave privada em arquivo rastreado', () => {
  const privateKeyContent = ['-----BEGIN PRIVATE ', 'KEY-----'].join('');

  assert.throws(
    () => assertNoSecrets({
      files: ['config.txt'],
      readFile: () => privateKeyContent,
    }),
    /Possível segredo encontrado em config\.txt\./,
  );
});

test('assertNoSecrets permite referência incompleta a chave privada', () => {
  const privateKeyReference = ['BEGIN PRIVATE ', 'KEY'].join('');

  assert.doesNotThrow(() => assertNoSecrets({
    files: ['docs/plan.md'],
    readFile: () => privateKeyReference,
  }));
});

test('assertNoSecrets rejeita valor secreto Supabase e permite referências documentais', () => {
  const secretKey = ['sb_', 'secret_', 'a'.repeat(32)].join('');

  assert.throws(
    () => assertNoSecrets({
      files: ['config.txt'],
      readFile: () => secretKey,
    }),
    /Possível segredo encontrado em config\.txt\./,
  );

  for (const reference of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'https://project.supabase.co',
    'sb_secret_placeholder',
    ['sb_', 'secret_', 'your-project-secret-key'].join(''),
    '[REDACTED]',
  ]) {
    assert.doesNotThrow(() => assertNoSecrets({
      files: ['docs/plan.md'],
      readFile: () => reference,
    }));
  }
});

test('assertNoSecrets rejeita valor publicável Supabase e permite placeholder', () => {
  const publishableKey = ['sb_', 'publishable_', 'b'.repeat(32)].join('');

  assert.throws(
    () => assertNoSecrets({
      files: ['config.txt'],
      readFile: () => publishableKey,
    }),
    /Possível segredo encontrado em config\.txt\./,
  );

  assert.doesNotThrow(() => assertNoSecrets({
    files: ['docs/plan.md'],
    readFile: () => 'sb_publishable_placeholder',
  }));
});

test('assertNoSecrets rejeita JWT legado completo e permite seu marcador', () => {
  const legacyJwt = [
    ['eyJ', 'a'.repeat(24)].join(''),
    'b'.repeat(24),
    'c'.repeat(32),
  ].join('.');

  assert.throws(
    () => assertNoSecrets({
      files: ['config.txt'],
      readFile: () => legacyJwt,
    }),
    /Possível segredo encontrado em config\.txt\./,
  );

  assert.doesNotThrow(() => assertNoSecrets({
    files: ['docs/plan.md'],
    readFile: () => 'eyJ...<legacy-key>...',
  }));
});

test('assertNoSecrets permite prefixo incompleto de chave de API Firebase', () => {
  const apiKeyPrefix = ['AI', 'za'].join('');

  assert.doesNotThrow(() => assertNoSecrets({
    files: ['config.txt'],
    readFile: () => apiKeyPrefix,
  }));
});

test('assertNoSecrets rejeita identificadores Firebase em runtime e configuração, mas permite documentação histórica', () => {
  assert.throws(
    () => assertNoSecrets({
      files: ['src/client/runtime.js'],
      readFile: () => 'const endpoint = "https://identitytoolkit.googleapis.com";',
    }),
    /Artefato Firebase não permitido em src\/client\/runtime\.js\./,
  );

  assert.doesNotThrow(() => assertNoSecrets({
    files: ['docs/OPERATIONS.md'],
    readFile: () => 'O rollback preserva a branch Firebase histórica sem tocar os dados Supabase.',
  }));
});

test('assertNoSecrets rejeita identificador Firebase injetado em src/server/config.js', () => {
  assert.throws(
    () => assertNoSecrets({
      files: ['src/server/config.js'],
      readFile: () => 'const endpoint = "https://identitytoolkit.googleapis.com";',
    }),
    /Artefato Firebase não permitido em src\/server\/config\.js\./,
  );
});

test('assertNoSecrets aceita o guard de ambiente legado do config sem identificador Firebase', () => {
  assert.doesNotThrow(() => assertNoSecrets({
    files: ['src/server/config.js'],
    readFile: () => readFileSync(configPath, 'utf8'),
  }));
});

test('assertNoSecrets bloqueia valor de chave privada em variável de ambiente', () => {
  const privateKeyAssignment = ['FIREBASE_ADMIN_PRIVATE', 'KEY=', 'value'].join('');

  assert.throws(
    () => assertNoSecrets({
      files: ['.env'],
      readFile: () => privateKeyAssignment,
    }),
    /Possível segredo encontrado em \.env\./,
  );
});

test('assertNoSecrets permite referência de atribuição sem valor', () => {
  const assignmentReference = ['FIREBASE_ADMIN_PRIVATE', 'KEY=', '`'].join('');

  assert.doesNotThrow(() => assertNoSecrets({
    files: ['docs/plan.md'],
    readFile: () => assignmentReference,
  }));
});

test('assertNoSecrets bloqueia senha de bootstrap atribuída em arquivo rastreado', () => {
  const bootstrapPasswordAssignment = ['BOOTSTRAP_ADMIN_', 'PASSWORD=', 'value'].join('');

  assert.throws(
    () => assertNoSecrets({
      files: ['docs/plan.md'],
      readFile: () => bootstrapPasswordAssignment,
    }),
    /Possível segredo encontrado em docs\/plan\.md\./,
  );
});

test('assertNoSecrets permite o marcador documental [REDACTED]', () => {
  const documentedRedaction = ['FIREBASE_ADMIN_PRIVATE', 'KEY=', '[REDACTED]'].join('');

  assert.doesNotThrow(() => assertNoSecrets({
    files: ['docs/plan.md'],
    readFile: () => documentedRedaction,
  }));
});

test('script falha quando Git rastreia um segredo', async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'assert-no-secrets-'));
  const privateKeyContent = ['-----BEGIN PRIVATE ', 'KEY-----'].join('');

  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: temporaryDirectory });
  await writeFile(join(temporaryDirectory, 'config.txt'), privateKeyContent);
  execFileSync('git', ['add', 'config.txt'], { cwd: temporaryDirectory });

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Possível segredo encontrado em config\.txt\./);
});

test('script falha quando Git rastreia uma variável de chave privada com espaços ao redor do igual na documentação', async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'assert-no-secrets-'));
  const privateKeyAssignment = ['FIREBASE_ADMIN_PRIVATE', 'KEY', ' ', '=', '\t', 'value'].join('');

  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: temporaryDirectory });
  await mkdir(join(temporaryDirectory, 'docs'));
  await writeFile(join(temporaryDirectory, 'docs', 'plan.md'), privateKeyAssignment);
  execFileSync('git', ['add', 'docs/plan.md'], { cwd: temporaryDirectory });

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Possível segredo encontrado em docs[\\/]plan\.md\./);
});

test('script falha quando Git rastreia uma chave de API Firebase completa na documentação', async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'assert-no-secrets-'));
  const apiKey = ['AI', 'za', 'a'.repeat(35)].join('');

  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: temporaryDirectory });
  await mkdir(join(temporaryDirectory, 'docs'));
  await writeFile(join(temporaryDirectory, 'docs', 'plan.md'), apiKey);
  execFileSync('git', ['add', 'docs/plan.md'], { cwd: temporaryDirectory });

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Possível segredo encontrado em docs[\\/]plan\.md\./);
});

test('script permite somente o prefixo de chave de API Firebase na documentação', async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'assert-no-secrets-'));
  const apiKeyMarker = ['AI', 'za'].join('');

  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: temporaryDirectory });
  await mkdir(join(temporaryDirectory, 'docs'));
  await writeFile(join(temporaryDirectory, 'docs', 'plan.md'), apiKeyMarker);
  execFileSync('git', ['add', 'docs/plan.md'], { cwd: temporaryDirectory });

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
});

test('script ignores a Git-tracked file removed from the working tree before staging', async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'assert-no-secrets-'));

  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: temporaryDirectory });
  await writeFile(join(temporaryDirectory, 'obsolete-entrypoint.js'), 'export default null;');
  execFileSync('git', ['add', 'obsolete-entrypoint.js'], { cwd: temporaryDirectory });
  await rm(join(temporaryDirectory, 'obsolete-entrypoint.js'));

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
});
