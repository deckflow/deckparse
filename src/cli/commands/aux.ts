import chalk from 'chalk';
import { runLoginFlow } from '../../auth/login.js';
import {
  displayPath,
  credentialsPath,
  deckopsConfigPath,
  hasCredentials,
  maskSecret,
  resolveCredentials,
  writeSharedCredentials,
} from '../../config/index.js';
import { DeckParseError } from '../../errors/index.js';

/** `deckparse formats` — the support matrix, honest about what fails. */
export function runFormats(options: { json?: boolean }): void {
  const rows = [
    { input: '.pdf', parse: '✅ versioned IR', markdown: '✅', notes: '--profile --password --no-images --anchors' },
    { input: '.pptx', parse: '✅', markdown: '✅', notes: '--split-pages' },
    { input: '.docx', parse: '✅', markdown: '✅', notes: '' },
    { input: '.key', parse: '✅', markdown: '✅', notes: '--stay-image-area-rate, --split-pages' },
    { input: 'http(s) URL', parse: '✅', markdown: '✅', notes: '--mode source|runtime' },
    { input: '.doc .ppt .xls(x) .pages .numbers', parse: '❌ unsupported', markdown: '❌', notes: 'clear error + hint' },
  ];
  if (options.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }
  for (const row of rows) {
    process.stdout.write(
      `${row.input.padEnd(36)} parse ${row.parse.padEnd(18)} markdown ${row.markdown.padEnd(4)} ${chalk.dim(row.notes)}\n`
    );
  }
}

export async function runAuthLogin(options: { apiBase?: string }): Promise<void> {
  const credentials = await resolveCredentials(options.apiBase ? { apiBase: options.apiBase } : {});
  const result = await runLoginFlow({
    apiBase: credentials.apiBase,
    onUrl: (url) => process.stderr.write(`Open this URL to log in:\n  ${url}\n`),
  });
  const file = await writeSharedCredentials({
    token: result.token,
    ...(result.spaceId ? { spaceId: result.spaceId } : {}),
  });
  process.stdout.write(`Logged in. Credentials saved to ${displayPath(file)} (shared across DeckFlow CLIs).\n`);
}

export async function runAuthStatus(options: { apiBase?: string; json?: boolean }): Promise<void> {
  const credentials = await resolveCredentials(options.apiBase ? { apiBase: options.apiBase } : {});
  if (!hasCredentials(credentials)) {
    process.stdout.write('Not logged in — running as guest.\n');
    return;
  }
  const user = await whoami(credentials.apiBase, credentials.token, credentials.apiKey);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...user, apiBase: credentials.apiBase }, null, 2)}\n`);
    return;
  }
  if (!user) {
    throw DeckParseError.auth('Stored credential was rejected by the backend.', {
      hint: 'Run `deckparse auth login`, or check `deckparse config list` for where it came from.',
    });
  }
  process.stdout.write(`Logged in as ${user.name ?? user.id} ${chalk.dim(`(${credentials.apiBase})`)}\n`);
}

export async function runAuthLogout(): Promise<void> {
  const file = await writeSharedCredentials({ token: null, spaceId: null });
  process.stdout.write(`Token removed from ${displayPath(file)}.\n`);
}

export async function runConfigList(options: { json?: boolean }): Promise<void> {
  const credentials = await resolveCredentials();
  const entry = (value: string | undefined, source: string | undefined, secret = false) => ({
    value: value ? (secret ? maskSecret(value) : value) : '(unset)',
    source: source ?? '—',
  });
  const data = {
    credentials: {
      'api-key': entry(credentials.apiKey, credentials.sources.apiKey, true),
      'token': entry(credentials.token, credentials.sources.token, true),
      'space-id': entry(credentials.spaceId, credentials.sources.spaceId),
      'api-base': entry(credentials.apiBase, credentials.sources.apiBase),
    },
    files: {
      'shared credentials': displayPath(credentialsPath()),
      'deckops (read-only)': displayPath(deckopsConfigPath()),
    },
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  process.stdout.write('Credentials\n');
  for (const [key, { value, source }] of Object.entries(data.credentials)) {
    process.stdout.write(`  ${key.padEnd(10)} ${value.padEnd(28)} ${chalk.dim(`(${source})`)}\n`);
  }
  process.stdout.write('\nFiles\n');
  for (const [label, file] of Object.entries(data.files)) {
    process.stdout.write(`  ${label.padEnd(22)} ${file}\n`);
  }
}

const CONFIG_KEYS = new Set(['api-key', 'token', 'space-id', 'api-base']);

export async function runConfigSet(key: string, value: string): Promise<void> {
  if (!CONFIG_KEYS.has(key)) {
    throw DeckParseError.usage(`Unknown config key "${key}". Known: ${[...CONFIG_KEYS].join(', ')}.`);
  }
  const field = key === 'api-key' ? 'apiKey' : key === 'space-id' ? 'spaceId' : key === 'api-base' ? 'apiBase' : 'token';
  const file = await writeSharedCredentials({ [field]: value });
  process.stdout.write(`${key} saved to ${displayPath(file)}.\n`);
}

async function whoami(
  apiBase: string,
  token: string | undefined,
  apiKey: string | undefined
): Promise<{ id: string; name?: string } | undefined> {
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, '')}/user`, {
      headers: {
        ...(token ? { 'X-Auth-Token': token } : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as { id: string; name?: string };
  } catch {
    return undefined;
  }
}
