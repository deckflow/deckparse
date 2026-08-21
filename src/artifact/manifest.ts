import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DeckParseError } from '../errors/index.js';
import type { Manifest, ManifestView } from '../types.js';
import { manifestPath } from './layout.js';

/**
 * Manifest reading, writing and hit detection (docs/rfc.md §3.2, §4.5).
 *
 * Write order is the crash-safety story: data files first, manifest last,
 * atomically (tmp + rename). Registered in the manifest ⇒ the file exists;
 * the reverse is not guaranteed — orphans are harmless and get overwritten.
 */

/** Cloud IR retention (upstream contract C4). Local pre-check only; the server is the authority. */
export const IR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function readManifest(dir: string): Promise<Manifest> {
  const file = manifestPath(dir);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    throw DeckParseError.input(`${dir} is not an artifact: no ${path.basename(file)}.`, {
      hint: 'Run `deckparse parse <source>` to create one.',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw DeckParseError.input(`${file} is not valid JSON.`, {
      hint: 'The artifact is damaged. Re-run `deckparse parse <source> --force`.',
    });
  }
  const manifest = parsed as Manifest;
  if (manifest.manifestVersion !== 1 || !manifest.parse?.irKey) {
    throw DeckParseError.input(`${file} is not a deckparse manifest (or from an incompatible version).`);
  }
  return manifest;
}

export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  const file = manifestPath(dir);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, file);
}

/**
 * Normalize parse params for hit comparison: fill defaults, drop undefined,
 * sort keys — `{profile:'balanced'}` and `{}` are the same request.
 */
export function normalizeParseParams(params: Record<string, unknown>): Record<string, unknown> {
  const withDefaults: Record<string, unknown> = {
    parseProfile: 'balanced',
    includeImages: true,
    ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)),
  };
  return Object.fromEntries(Object.entries(withDefaults).sort(([a], [b]) => a.localeCompare(b)));
}

export function sameParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(normalizeParseParams(a)) === JSON.stringify(normalizeParseParams(b));
}

/** A parse hit means zero cloud calls: same content, same request, IR present. */
export function parseHit(
  dir: string,
  manifest: Manifest,
  sha256: string | undefined,
  params: Record<string, unknown>
): boolean {
  if (!sha256 || manifest.source.sha256 !== sha256) {
    return false;
  }
  if (!sameParams(manifest.parse.params, params)) {
    return false;
  }
  return existsSync(path.join(dir, 'ir.json'));
}

/** A view hit: same target, same view params, every registered file present. */
export function viewHit(dir: string, view: ManifestView | undefined, params: Record<string, unknown>): boolean {
  if (!view) {
    return false;
  }
  if (JSON.stringify(sortKeys(view.params)) !== JSON.stringify(sortKeys(params))) {
    return false;
  }
  return view.files.length > 0 && view.files.every((file) => existsSync(path.join(dir, file)));
}

/**
 * Local fast-fail for the 7-day retention (docs/rfc.md §4.2). Saves a round
 * trip when clearly expired; the server remains the authority.
 */
export function locallyExpired(manifest: Manifest, now: number = Date.now()): boolean {
  const createdAt = Date.parse(manifest.parse.createdAt);
  return Number.isFinite(createdAt) && now - createdAt > IR_RETENTION_MS;
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}
