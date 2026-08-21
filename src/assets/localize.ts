import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import type { ConvertImage } from '@deckops/sdk';
import { DeckParseError } from '../errors/index.js';
import type { ManifestAsset } from '../types.js';

/**
 * Image localization (docs/rfc.md §4.4). The markdown a convert returns embeds
 * signed URLs that expire in hours; a durable markdown needs the bytes on disk
 * and the links rewritten. Download failures FAIL the run by default — silently
 * shipping links that will rot is the worst outcome — with `keepRemote` as the
 * explicit escape hatch.
 */

export interface LocalizeOptions {
  images: ConvertImage[];
  /** Directory the image files are written into. */
  destDir: string;
  /** Prefix links get in the rewritten text, e.g. `../../assets/` or `doc.assets/`. */
  linkPrefix: string;
  /** Accept expiring remote links instead of failing; failures become warnings. */
  keepRemote?: boolean;
  concurrency?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export interface LocalizedAssets {
  /** Exact-string link rewrites: signed URL → local link. */
  rewrites: Map<string, string>;
  /** Written files: dest-relative name → identity, for the manifest. */
  saved: Record<string, ManifestAsset & { file: string }>;
  warnings: string[];
}

const RETRIES = 3;

/**
 * Pick unique on-disk names. `suggestedPath` basenames are unique in practice
 * (uuid- or page-derived); a collision between *different* keys gets a short
 * key-hash suffix rather than silently overwriting the other image.
 */
export function assignFileNames(images: ConvertImage[]): Map<string, string> {
  const byKey = new Map<string, string>();
  const taken = new Map<string, string>();
  for (const image of images) {
    if (byKey.has(image.key)) {
      continue;
    }
    const base = path.basename(image.suggestedPath || image.key) || 'asset.bin';
    const owner = taken.get(base);
    if (owner === undefined) {
      taken.set(base, image.key);
      byKey.set(image.key, base);
      continue;
    }
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    const suffix = createHash('md5').update(image.key).digest('hex').slice(0, 8);
    const name = `${stem}-${suffix}${ext}`;
    taken.set(name, image.key);
    byKey.set(image.key, name);
  }
  return byKey;
}

export async function localizeImages(options: LocalizeOptions): Promise<LocalizedAssets> {
  const { images, destDir, linkPrefix, keepRemote = false, concurrency = 4 } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  const rewrites = new Map<string, string>();
  const saved: LocalizedAssets['saved'] = {};
  const warnings: string[] = [];
  if (images.length === 0) {
    return { rewrites, saved, warnings };
  }

  await fs.mkdir(destDir, { recursive: true });
  const names = assignFileNames(images);
  const limit = pLimit(concurrency);
  const downloaded = new Map<string, Promise<void>>();

  const fetchOne = async (image: ConvertImage, fileName: string): Promise<void> => {
    const target = path.join(destDir, fileName);
    const data = await downloadWithRetry(fetchImpl, image.ref, image.key);
    // A wrong image is worse than a missing one: verify when the identity is known.
    if (image.hash) {
      const md5 = createHash('md5').update(data).digest('hex');
      if (md5 !== image.hash) {
        throw DeckParseError.asset(`Image ${image.key} arrived corrupted (md5 mismatch).`, {
          hint: 'Retry the convert; if it persists, report the key upstream.',
        });
      }
    }
    await fs.writeFile(target, data);
    saved[fileName] = { file: fileName, key: image.key, hash: image.hash ?? '', bytes: data.length };
  };

  const results = await Promise.allSettled(
    images.map((image) =>
      limit(async () => {
        const fileName = names.get(image.key);
        if (!fileName) {
          return;
        }
        // Same key referenced twice: download once, rewrite both refs.
        let pending = downloaded.get(image.key);
        if (!pending) {
          pending = fetchOne(image, fileName);
          downloaded.set(image.key, pending);
        }
        await pending;
        rewrites.set(image.ref, `${linkPrefix}${fileName}`);
      })
    )
  );

  for (const result of results) {
    if (result.status !== 'rejected') {
      continue;
    }
    if (!keepRemote) {
      throw result.reason instanceof DeckParseError
        ? result.reason
        : DeckParseError.asset(`Image download failed: ${String(result.reason)}`);
    }
    warnings.push(
      result.reason instanceof Error ? result.reason.message : `image download failed: ${String(result.reason)}`
    );
  }

  return { rewrites, saved, warnings };
}

/**
 * Rewrite links by exact string match. `ref` is the very string the server
 * rendered into the text (upstream contract C3) — no URL normalization.
 */
export function rewriteLinks(text: string, rewrites: Map<string, string>): string {
  let result = text;
  for (const [ref, local] of rewrites) {
    result = result.split(ref).join(local);
  }
  return result;
}

async function downloadWithRetry(fetchImpl: typeof fetch, url: string, key: string): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }
  }
  throw DeckParseError.asset(
    `Failed to download image ${key} after ${RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { hint: 'Pass --keep-remote-images to accept expiring remote links instead.' }
  );
}
