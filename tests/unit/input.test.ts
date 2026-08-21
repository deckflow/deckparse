import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extensionOf, resolveInput, routeExtension } from '../../src/core/input.js';
import { DeckParseError } from '../../src/errors/index.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'deckparse-input-'));

describe('extension routing', () => {
  it('mirrors the SDK routing table, case- and query-insensitive', () => {
    expect(routeExtension('a.pdf')).toBe('pdf.pdfParse');
    expect(routeExtension('DECK.PPTX')).toBe('pptx.parse');
    expect(routeExtension('r.docx')).toBe('docx.parseTextAndImage');
    expect(routeExtension('slides.key')).toBe('keynote.parseTextAndImage');
    expect(extensionOf('https://x.com/a.key?v=1#f')).toBe('.key');
  });

  it('rejects unsupported formats with a way out, never a guess', () => {
    for (const [name, hintPattern] of [
      ['old.doc', /docx/],
      ['old.ppt', /pptx/],
      ['sheet.xlsx', /not supported/],
      ['notes.md', /output/],
    ] as const) {
      try {
        routeExtension(name);
        expect.unreachable(`${name} should have been rejected`);
      } catch (error) {
        const e = error as DeckParseError;
        expect(e.code).toBe('unsupported');
        expect(e.hint).toMatch(hintPattern);
      }
    }
  });
});

describe('resolveInput', () => {
  it('classifies links, documents and artifacts', async () => {
    expect((await resolveInput('https://example.com/x')).kind).toBe('link');

    const dir = tmp();
    const doc = path.join(dir, 'a.pdf');
    fs.writeFileSync(doc, 'x');
    expect(await resolveInput(doc)).toMatchObject({ kind: 'document', taskType: 'pdf.pdfParse' });

    const artifact = path.join(dir, 'artifact');
    fs.mkdirSync(artifact);
    fs.writeFileSync(
      path.join(artifact, 'manifest.json'),
      JSON.stringify({ manifestVersion: 1, parse: { irKey: 'k', type: 'pptx.parse', irSchemaVersion: 'pptx.v1', taskId: 't', params: {}, createdAt: new Date().toISOString() }, source: { name: 'a' }, views: {}, assets: {}, producer: { deckparse: '0', sdk: '0' } })
    );
    expect((await resolveInput(artifact)).kind).toBe('artifact');
  });

  it('rejects a directory without a manifest instead of guessing', async () => {
    const dir = tmp();
    await expect(resolveInput(dir)).rejects.toMatchObject({ code: 'input_error' });
  });

  it('rejects a missing path with input_error', async () => {
    await expect(resolveInput('/no/such/file.pdf')).rejects.toMatchObject({ code: 'input_error' });
  });

  it('stdin needs --from, and routes by it', async () => {
    await expect(resolveInput('-')).rejects.toMatchObject({ code: 'usage_error' });
    const resolved = await resolveInput('-', { from: 'pdf', readStdin: () => Buffer.from('x') });
    expect(resolved).toMatchObject({ kind: 'stdin', taskType: 'pdf.pdfParse' });
  });
});
