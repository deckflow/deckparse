import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IR_RETENTION_MS,
  locallyExpired,
  normalizeParseParams,
  parseHit,
  readManifest,
  sameParams,
  viewHit,
  writeManifest,
} from '../../src/artifact/manifest.js';
import type { Manifest } from '../../src/types.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'deckparse-manifest-'));

const manifest = (overrides: Partial<Manifest['parse']> = {}): Manifest => ({
  manifestVersion: 1,
  source: { name: 'a.pdf', sha256: 'abc' },
  parse: {
    taskId: 't1',
    type: 'pdf.pdfParse',
    irKey: '2026-08/aa/ir.json',
    irSchemaVersion: 'result.v3',
    params: normalizeParseParams({}),
    createdAt: new Date().toISOString(),
    ...overrides,
  },
  views: {},
  assets: {},
  producer: { deckparse: '0.1.0', sdk: '0.8.0-next.0' },
});

describe('param normalization', () => {
  it('defaults and explicit defaults are the same request', () => {
    expect(sameParams({}, { parseProfile: 'balanced', includeImages: true })).toBe(true);
    expect(sameParams({}, { parseProfile: 'quality' })).toBe(false);
    expect(sameParams({ password: 'x' }, { password: 'x' })).toBe(true);
  });
});

describe('hit detection', () => {
  it('parse hit needs same bytes, same request, ir.json on disk', () => {
    const dir = tmp();
    const m = manifest();
    expect(parseHit(dir, m, 'abc', {})).toBe(false); // no ir.json yet
    fs.writeFileSync(path.join(dir, 'ir.json'), '{}');
    expect(parseHit(dir, m, 'abc', {})).toBe(true);
    expect(parseHit(dir, m, 'other', {})).toBe(false);
    expect(parseHit(dir, m, 'abc', { parseProfile: 'quality' })).toBe(false);
    expect(parseHit(dir, m, undefined, {})).toBe(false); // links never hit
  });

  it('view hit needs same params and every registered file present', () => {
    const dir = tmp();
    const view = { taskId: 't2', params: { splitPages: true }, files: ['views/markdown/index.md'], createdAt: 'x' };
    expect(viewHit(dir, view, { splitPages: true })).toBe(false); // file missing
    fs.mkdirSync(path.join(dir, 'views/markdown'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'views/markdown/index.md'), '# hi');
    expect(viewHit(dir, view, { splitPages: true })).toBe(true);
    expect(viewHit(dir, view, {})).toBe(false); // different params
    expect(viewHit(dir, undefined, {})).toBe(false);
  });
});

describe('retention fast-fail', () => {
  it('flags an IR older than 7 days, tolerates a fresh one', () => {
    const fresh = manifest();
    expect(locallyExpired(fresh)).toBe(false);
    const stale = manifest({ createdAt: new Date(Date.now() - IR_RETENTION_MS - 60_000).toISOString() });
    expect(locallyExpired(stale)).toBe(true);
  });
});

describe('read / write', () => {
  it('round-trips atomically and rejects damage precisely', async () => {
    const dir = tmp();
    const m = manifest();
    await writeManifest(dir, m);
    expect(await readManifest(dir)).toEqual(m);
    expect(fs.existsSync(path.join(dir, 'manifest.json.tmp'))).toBe(false);

    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ not json');
    await expect(readManifest(dir)).rejects.toMatchObject({ code: 'input_error' });

    const empty = tmp();
    await expect(readManifest(empty)).rejects.toMatchObject({ code: 'input_error' });
  });
});
