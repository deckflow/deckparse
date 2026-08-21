import fs from 'node:fs';
import path from 'node:path';
import { DeckParseError } from '../errors/index.js';
import type { Manifest, ParseTaskType } from '../types.js';
import { readManifest } from '../artifact/manifest.js';

/**
 * Input classification (docs/rfc.md §3.1). Order matters: `-` → stdin,
 * http(s) → link, directory with a manifest → artifact, file → document.
 * A directory without a valid manifest is an error, not a guess.
 */

/** Extension → task type, mirrored from the SDK's routing table. */
export const EXTENSION_ROUTES: Record<string, ParseTaskType> = {
  '.pdf': 'pdf.pdfParse',
  '.pptx': 'pptx.parse',
  '.docx': 'docx.parseTextAndImage',
  '.key': 'keynote.parseTextAndImage',
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_ROUTES);

/** Clear failures over approximate results: each rejection names its way out. */
const UNSUPPORTED_HINTS: Record<string, string> = {
  '.doc': 'Save it as .docx (File → Save As in Word) and parse that.',
  '.ppt': 'Save it as .pptx and parse that.',
  '.xls': 'Spreadsheets are not supported yet.',
  '.xlsx': 'Spreadsheets are not supported yet.',
  '.pages': 'Export it as .docx or .pdf and parse that.',
  '.numbers': 'Spreadsheets are not supported yet.',
  '.md': 'Markdown is a parse output, not an input.',
};

export type ResolvedInput =
  | { kind: 'document'; file: string; name: string; taskType: ParseTaskType }
  | { kind: 'link'; url: string }
  | { kind: 'stdin'; data: Buffer; name: string; taskType: ParseTaskType }
  | { kind: 'artifact'; dir: string; manifest: Manifest };

export function extensionOf(name: string): string {
  const clean = name.split(/[?#]/)[0] ?? '';
  const base = clean.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export function routeExtension(name: string): ParseTaskType {
  const ext = extensionOf(name);
  const route = EXTENSION_ROUTES[ext];
  if (route) {
    return route;
  }
  const hint = UNSUPPORTED_HINTS[ext];
  throw DeckParseError.unsupported(
    ext
      ? `${ext} files are not supported. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`
      : `Cannot tell the format of "${name}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
    hint ? { hint } : {}
  );
}

export interface ResolveInputOptions {
  /** Extension (e.g. "pdf") for stdin input, where there is no file name. */
  from?: string;
  /** Injected for tests. */
  readStdin?: () => Buffer;
}

export async function resolveInput(input: string, options: ResolveInputOptions = {}): Promise<ResolvedInput> {
  if (input === '-') {
    if (!options.from) {
      throw DeckParseError.usage('Reading from stdin needs --from <ext> to pick a parser (e.g. --from pdf).');
    }
    const ext = options.from.startsWith('.') ? options.from : `.${options.from}`;
    const name = `stdin${ext.toLowerCase()}`;
    const taskType = routeExtension(name);
    const data = options.readStdin ? options.readStdin() : fs.readFileSync(0);
    if (data.length === 0) {
      throw DeckParseError.input('stdin was empty.');
    }
    return { kind: 'stdin', data, name, taskType };
  }

  if (/^https?:\/\//i.test(input)) {
    return { kind: 'link', url: input };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(input);
  } catch {
    throw DeckParseError.input(`No such file or directory: ${input}`);
  }

  if (stat.isDirectory()) {
    const manifest = await readManifest(input);
    return { kind: 'artifact', dir: input, manifest };
  }

  const name = path.basename(input);
  return { kind: 'document', file: input, name, taskType: routeExtension(name) };
}
