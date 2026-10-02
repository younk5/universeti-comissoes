import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function readVercelConfig() {
  return JSON.parse(readFileSync(join(repositoryRoot, 'vercel.json'), 'utf8'));
}

async function importFresh(relativePath, label) {
  const moduleUrl = new URL(relativePath, import.meta.url);
  moduleUrl.searchParams.set('test', `${label}-${Date.now()}`);
  return import(moduleUrl.href);
}

async function importApiHandler() {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  try {
    return await importFresh('../../api/[...path].js', 'api-handler');
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
}

test('Vercel uses filesystem API Functions and explicitly rewrites multi-segment API paths to the catch-all Function', () => {
  const config = readVercelConfig();

  assert.equal(existsSync(join(repositoryRoot, 'api', '[...path].js')), true);
  assert.equal(existsSync(join(repositoryRoot, 'api', 'health.js')), true);
  assert.equal(existsSync(join(repositoryRoot, 'api', 'index.js')), false);
  assert.deepEqual(config.functions['api/*.js'], {
    includeFiles: 'src/server/**',
  });
  assert.deepEqual(config.rewrites, [
    { source: '/health', destination: '/api/health' },
    { source: '/api/(.*)', destination: '/api/[...path]?path=$1' },
  ]);
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.rewrites.some(({ destination }) => destination === '/index.html'), false);
  assert.equal(config.rewrites.some(({ source }) => source === '/(.*)'), false);

  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.check, /node --check src\/server\/config\.js/);
  assert.match(packageJson.scripts.check, /node --check src\/server\/supabase-admin\.js/);
  assert.match(packageJson.scripts.check, /node --check src\/server\/vercel-app\.js/);
  assert.doesNotMatch(packageJson.scripts.check, /firebase|emulator|run-emulator-tests/i);
  assert.equal(Object.hasOwn(packageJson.scripts, 'test:emulators'), false);
  assert.doesNotMatch(JSON.stringify(packageJson), /firebase|emulator|run-emulator-tests/i);

  const headers = config.headers[0].headers;
  assert.deepEqual(headers.map(({ key }) => key), [
    'Content-Security-Policy',
    'Permissions-Policy',
    'Referrer-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
  ]);
  assert.match(headers[0].value, /connect-src 'self'/);
  assert.doesNotMatch(headers[0].value, /supabase\.co|identitytoolkit|securetoken|googleapis/i);
});

test('Vercel production CSP limits images to same-origin sources', () => {
  const config = readVercelConfig();
  const globalHeaders = config.headers.find(({ source }) => source === '/(.*)');
  const cspHeader = globalHeaders?.headers.find(({ key }) => key === 'Content-Security-Policy');

  assert.ok(cspHeader);
  const imgSrc = cspHeader.value.split(';').find((directive) => directive.trimStart().startsWith('img-src '));
  assert.equal(imgSrc?.trim(), "img-src 'self'");
});

test('the static app declares a local favicon to avoid a browser favicon 404', () => {
  const index = readFileSync(join(repositoryRoot, 'index.html'), 'utf8');

  assert.match(index, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  assert.equal(existsSync(join(repositoryRoot, 'public', 'favicon.svg')), true);
});

test('the exported catch-all Vercel handler does not expose public provider config and serves authenticated API paths', async () => {
  const { default: handler, createVercelApp } = await importApiHandler();

  const publicConfig = await request(handler).get('/api/public-config');
  assert.equal(publicConfig.status, 404);

  const actor = { id: 'seller-1', role: 'seller', name: 'Vendas SP', active: true };
  const controlledHandler = createVercelApp({
    config: { nodeEnv: 'test' },
    services: {
      auth: {
        verifyActor: async (token) => {
          assert.equal(token, 'controlled-id-token');
          return actor;
        },
      },
    },
  });
  const authenticatedResponse = await request(controlledHandler)
    .get('/api/me')
    .set('Authorization', 'Bearer controlled-id-token');

  assert.equal(authenticatedResponse.status, 200);
  assert.deepEqual(authenticatedResponse.body, actor);

  const entrypoint = readFileSync(join(repositoryRoot, 'api', '[...path].js'), 'utf8');
  assert.doesNotMatch(entrypoint, /express\.static\(/);
  assert.doesNotMatch(entrypoint, /\.listen\(/);
});

test('the dedicated Vercel health handler returns the documented response', async () => {
  const { default: healthHandler } = await importFresh('../../api/health.js', 'health-handler');
  const response = await request(healthHandler).get('/api/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('production documentation assigns direct static hosting to Vite output and filesystem Functions to API and health', () => {
  const deploymentGuide = readFileSync(join(repositoryRoot, 'docs', 'DEPLOYMENT.md'), 'utf8');
  const readme = readFileSync(join(repositoryRoot, 'README.md'), 'utf8');
  const prd = readFileSync(join(repositoryRoot, 'docs', 'PRD.md'), 'utf8');

  assert.match(deploymentGuide, /`api\/\[\.\.\.path\]\.js`/);
  assert.match(deploymentGuide, /`api\/health\.js`/);
  assert.match(deploymentGuide, /`npm run build` gera `dist`, que a Vercel entrega como arquivos estáticos/);
  assert.doesNotMatch(deploymentGuide, /inclui `dist\/\*\*` na função `server\.js`/);
  assert.match(deploymentGuide, /não existe fallback SPA amplo/i);
  assert.match(readme, /`server\.js`.*somente.*local/i);
  assert.match(readme, /sem fallback SPA/i);
  assert.match(prd, /funções Node\.js `api\/\[\.\.\.path\]\.js` e `api\/health\.js`/);
});
