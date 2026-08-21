import os from 'node:os';
import path from 'node:path';

/**
 * Config locations. Copied from deckrender (docs/rfc.md §6) — two directories
 * on purpose:
 *
 * - `~/.deckflow/` is the organization-wide store shared with DeckRender and
 *   DeckHTML. Log in through any DeckFlow CLI and the others pick it up.
 * - `~/.deckparse/` holds our own defaults, so they never pollute the shared
 *   credential file.
 * - `~/.deckops/config.json` is read as a fallback but **never** written.
 */
export const DECKFLOW_DIR_ENV = 'DECKFLOW_CONFIG_DIR';
export const DECKPARSE_DIR_ENV = 'DECKPARSE_CONFIG_DIR';
export const DECKOPS_DIR_ENV = 'DECKOPS_CONFIG_DIR';

export function deckflowDir(): string {
  return process.env[DECKFLOW_DIR_ENV] ?? path.join(os.homedir(), '.deckflow');
}

export function deckparseDir(): string {
  return process.env[DECKPARSE_DIR_ENV] ?? path.join(os.homedir(), '.deckparse');
}

export function deckopsDir(): string {
  return process.env[DECKOPS_DIR_ENV] ?? path.join(os.homedir(), '.deckops');
}

/** Shared credential file, same format as deckrender's. */
export function credentialsPath(): string {
  return path.join(deckflowDir(), 'credentials');
}

/** DeckParse's own defaults. */
export function configPath(): string {
  return path.join(deckparseDir(), 'config.json');
}

/** DeckOps CLI config, read-only fallback. */
export function deckopsConfigPath(): string {
  return path.join(deckopsDir(), 'config.json');
}

export const DIR_MODE = 0o700;
export const SECRET_FILE_MODE = 0o600;
