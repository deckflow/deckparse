import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignFileNames, localizeImages, rewriteLinks } from '../../src/assets/localize.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'deckparse-assets-'));

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const md5 = (data: Buffer): string => createHash('md5').update(data).digest('hex');

const image = (over: Partial<{ ref: string; key: string; suggestedPath: string; hash: string }> = {}) => ({
  ref: 'https://signed.example/img?sig=1',
  key: '2026-08/aa/one.png',
  suggestedPath: 'assets/one.png',
  bytes: png.length,
  hash: md5(png),
  ...over,
});

const okFetch = (body: Buffer = png): typeof fetch =>
  (async () => new Response(new Uint8Array(body))) as unknown as typeof fetch;

describe('file naming', () => {
  it('same key twice downloads once; same basename for different keys gets a suffix', () => {
    const names = assignFileNames([
      image(),
      image({ ref: 'https://signed.example/img?sig=2' }),
      image({ key: 'other/one.png', suggestedPath: 'assets/one.png', ref: 'r3' }),
    ]);
    expect(names.size).toBe(2);
    expect(names.get('2026-08/aa/one.png')).toBe('one.png');
    expect(names.get('other/one.png')).toMatch(/^one-[0-9a-f]{8}\.png$/);
  });
});

describe('localizeImages', () => {
  it('downloads, verifies, and yields exact-string rewrites', async () => {
    const dir = tmp();
    const result = await localizeImages({
      images: [image()],
      destDir: dir,
      linkPrefix: '../../assets/',
      fetchImpl: okFetch(),
    });
    expect(fs.readFileSync(path.join(dir, 'one.png'))).toEqual(png);
    expect(result.rewrites.get('https://signed.example/img?sig=1')).toBe('../../assets/one.png');
    expect(result.saved['one.png']).toMatchObject({ key: '2026-08/aa/one.png', bytes: png.length });
    expect(result.warnings).toEqual([]);
  });

  it('a corrupted download fails the run — a wrong image is worse than a missing one', async () => {
    await expect(
      localizeImages({
        images: [image({ hash: 'not-the-md5' })],
        destDir: tmp(),
        linkPrefix: 'a/',
        fetchImpl: okFetch(),
      })
    ).rejects.toMatchObject({ code: 'asset_error' });
  });

  it('download failure fails by default, degrades to a warning only with keepRemote', async () => {
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(
      localizeImages({ images: [image()], destDir: tmp(), linkPrefix: 'a/', fetchImpl: failing })
    ).rejects.toMatchObject({ code: 'asset_error' });

    const tolerant = await localizeImages({
      images: [image()],
      destDir: tmp(),
      linkPrefix: 'a/',
      keepRemote: true,
      fetchImpl: failing,
    });
    expect(tolerant.warnings).toHaveLength(1);
    expect(tolerant.rewrites.size).toBe(0); // the remote link stays in the text
  });
});

describe('rewriteLinks', () => {
  it('rewrites by exact string, no URL normalization', () => {
    const rewrites = new Map([['https://s.example/a?Expires=1&sig=x', 'assets/a.png']]);
    const text = '![](https://s.example/a?Expires=1&sig=x) and ![](https://s.example/a?Expires=2)';
    expect(rewriteLinks(text, rewrites)).toBe('![](assets/a.png) and ![](https://s.example/a?Expires=2)');
  });
});
