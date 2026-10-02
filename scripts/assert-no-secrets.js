import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const privateKeyContent = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/;
const firebaseWebApiKey = /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/;
const supabaseSecretKey = /(?<![A-Za-z0-9_-])sb_secret_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g;
const supabasePublishableKey = /(?<![A-Za-z0-9_-])sb_publishable_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g;
const legacyJwt = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/;
const adminPrivateKeyName = ['FIREBASE_ADMIN_PRIVATE', 'KEY'].join('');
const bootstrapAdminPasswordName = ['BOOTSTRAP_ADMIN_', 'PASSWORD'].join('');
const markdownCodeDelimiter = String.fromCharCode(96);
const documentedRedaction = String.raw`\[REDACTED\]`;
const sensitiveEnvironmentAssignments = [
  adminPrivateKeyName,
  bootstrapAdminPasswordName,
].map((name) => new RegExp(
  `${name}[^\\S\\r\\n]*=[^\\S\\r\\n]*(?!${markdownCodeDelimiter}[^\\S\\r\\n]*$)(?!${documentedRedaction}[^\\S\\r\\n]*$)[^\\s\\r\\n]+`,
  'm',
));

const firebaseRuntimeIdentifier = /firebase|firestore|identitytoolkit|securetoken|public-config/i;
const scannerPath = 'scripts/assert-no-secrets.js';
const documentedSupabasePlaceholder = /(?:^|[_-])(?:example|placeholder|redacted|your|replace|project)(?:[_-]|$)/i;

function containsSupabaseKey(content) {
  return [supabaseSecretKey, supabasePublishableKey].some((pattern) => (
    [...content.matchAll(pattern)].some((match) => !documentedSupabasePlaceholder.test(match[0]))
  ));
}

function scansRuntimeOrConfiguration(file) {
  const path = file.replaceAll('\\', '/');
  if (path === scannerPath || path.startsWith('docs/') || path.startsWith('tests/')) return false;
  return path.startsWith('src/')
    || path.startsWith('api/')
    || path.startsWith('scripts/')
    || ['.env.example', 'package.json', 'package-lock.json', 'server.js', 'vercel.json'].includes(path);
}

export function assertNoSecrets({ files, readFile }) {
  for (const file of files) {
    const content = readFile(file);
    const hasSecret = privateKeyContent.test(content)
      || firebaseWebApiKey.test(content)
      || containsSupabaseKey(content)
      || legacyJwt.test(content)
      || sensitiveEnvironmentAssignments.some((pattern) => pattern.test(content));

    if (hasSecret) {
      throw new Error(`Possível segredo encontrado em ${file}.`);
    }
    if (scansRuntimeOrConfiguration(file) && firebaseRuntimeIdentifier.test(content)) {
      throw new Error(`Artefato Firebase não permitido em ${file}.`);
    }
  }
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && existsSync(file));
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    assertNoSecrets({
      files: trackedFiles(),
      readFile: (file) => readFileSync(file, 'utf8'),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
