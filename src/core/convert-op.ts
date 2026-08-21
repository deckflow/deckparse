import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConvertResult, IrFormat } from '@deckops/sdk';
import { localizeImages, rewriteLinks } from '../assets/localize.js';
import { assetsDir, viewDir } from '../artifact/layout.js';
import { locallyExpired, viewHit, writeManifest } from '../artifact/manifest.js';
import type { CloudClient } from '../cloud/client.js';
import { DeckParseError } from '../errors/index.js';
import type { CommonFlags, ConvertEnvelope, ConvertFlags, Manifest, OutputFile, ParseFlags } from '../types.js';
import type { ResolvedInput } from './input.js';

/**
 * convert (docs/rfc.md §4.2–4.4).
 *
 * Standard path: artifact in, view out — the IR is referenced by irKey, the
 * source is never re-parsed (`reusedParse: true` is an assertion, not a hope).
 * One-shot path: source document in, portable markdown out — parse + convert
 * chained, no artifact left behind.
 */

export interface ConvertOpOptions {
  input: ResolvedInput;
  inputLabel: string;
  out?: string;
  flags: ConvertFlags;
  /** One-shot path only: parse-side flags riding along on the convert command. */
  parseFlags?: ParseFlags;
  common: CommonFlags;
  client: CloudClient;
}

export async function runConvert(options: ConvertOpOptions): Promise<ConvertEnvelope> {
  const to = options.flags.to ?? 'markdown';
  if (to !== 'markdown') {
    throw DeckParseError.unsupported(`--to ${String(to)} is not supported yet. v1 converts to markdown only.`);
  }
  if (options.input.kind === 'artifact') {
    return convertArtifact(options, options.input.dir, options.input.manifest);
  }
  return convertOneShot(options);
}

// ------------------------------------------------------------ standard path

async function convertArtifact(options: ConvertOpOptions, dir: string, manifest: Manifest): Promise<ConvertEnvelope> {
  const { flags, common, client } = options;
  const startedAt = Date.now();
  const viewParams = viewParamsFor(flags);

  // Same view, same params, files intact → zero cloud calls.
  if (!common.force && viewHit(dir, manifest.views.markdown, viewParams)) {
    const view = manifest.views.markdown;
    if (!view) {
      throw DeckParseError.backend('unreachable: view hit without a view');
    }
    return envelope(options, {
      startedAt,
      engine: 'local-cache',
      format: formatOf(manifest),
      taskId: null,
      reusedParse: true,
      outputs: view.files.map((file) => ({ file: path.join(dir, file), bytes: 0 })),
      warnings: [],
    });
  }

  // Local fast-fail on retention; the server stays the authority (§4.2).
  if (locallyExpired(manifest)) {
    throw new DeckParseError('ir_expired', `The IR behind ${dir} is past its 7-day cloud retention.`, {
      hint: `Re-run \`deckparse parse ${manifest.source.name} --force\` and retry.`,
    });
  }

  const result = await callConvert(client, { irKey: manifest.parse.irKey }, flags, common);
  const { outputs, warnings, files, savedAssets } = await materialize(dir, result, flags);

  manifest.views.markdown = {
    taskId: result.taskId,
    params: viewParams,
    files,
    createdAt: new Date().toISOString(),
  };
  for (const [file, asset] of Object.entries(savedAssets)) {
    manifest.assets[`assets/${file}`] = { key: asset.key, hash: asset.hash, bytes: asset.bytes };
  }
  await writeManifest(dir, manifest);

  // -o also writes a portable copy next to wherever the user asked.
  if (options.out) {
    const copied = await writePortable(options.out, result, flags);
    outputs.push(...copied.outputs);
    warnings.push(...copied.warnings);
  }

  return envelope(options, {
    startedAt,
    engine: 'cloud',
    format: result.format,
    taskId: result.taskId,
    reusedParse: true,
    outputs,
    warnings,
  });
}

// ------------------------------------------------------------- one-shot path

async function convertOneShot(options: ConvertOpOptions): Promise<ConvertEnvelope> {
  const { input, inputLabel, flags, common, client } = options;
  const startedAt = Date.now();

  // Implicit parse ∘ convert: two tasks, IR never lands on the user's disk.
  const parsed = await runParseInMemory(options);
  const result = await callConvert(client, { irKey: parsed.irKey }, flags, common);

  const target = options.out ?? defaultPortableName(input, inputLabel);
  const { outputs, warnings } = await writePortable(target, result, flags);

  return {
    ok: true,
    op: 'convert',
    input: inputLabel,
    to: 'markdown',
    engine: 'cloud',
    format: result.format,
    taskId: result.taskId,
    parseTaskId: parsed.taskId,
    reusedParse: false,
    outputs,
    warnings,
    durationMs: Date.now() - startedAt,
  };
}

async function runParseInMemory(options: ConvertOpOptions): Promise<{ irKey: string; taskId: string }> {
  const { input, common, client } = options;
  const parseFlags = oneShotParseFlags(options);
  const source =
    input.kind === 'document'
      ? input.file
      : input.kind === 'stdin'
        ? { file: { input: input.data, name: input.name }, name: input.name }
        : input.kind === 'link'
          ? { url: input.url }
          : undefined;
  if (source === undefined) {
    throw DeckParseError.usage('unreachable: artifact handled by the standard path');
  }
  const parsed = await client.parse(source, {
    ...parseFlags,
    ...(common.spaceId ? { spaceId: common.spaceId } : {}),
    ...(common.timeout ? { wait: { timeout: common.timeout } } : {}),
  });
  return { irKey: parsed.irKey, taskId: parsed.taskId };
}

// ------------------------------------------------------------------- helpers

async function callConvert(
  client: CloudClient,
  ref: { irKey: string },
  flags: ConvertFlags,
  common: CommonFlags
): Promise<ConvertResult> {
  const result = await client.convert(ref, {
    to: 'markdown',
    ...(flags.anchors !== undefined ? { markdownMeta: flags.anchors } : {}),
    ...(flags.splitPages !== undefined ? { markdownPages: flags.splitPages } : {}),
    ...(flags.strict !== undefined ? { markdownStrict: flags.strict } : {}),
    ...(common.spaceId ? { spaceId: common.spaceId } : {}),
    ...(common.timeout ? { wait: { timeout: common.timeout } } : {}),
  });
  // A markdownError means the body is a placeholder, not the document. Failing
  // is the only honest outcome (docs/rfc.md §4.2).
  if (result.markdownError) {
    throw DeckParseError.backend(`Markdown rendering failed: ${result.markdownError}`, { taskId: result.taskId });
  }
  return result;
}

/** Materialize the view inside the artifact: assets/ first, then views/markdown/. */
async function materialize(
  dir: string,
  result: ConvertResult,
  flags: ConvertFlags
): Promise<{
  outputs: OutputFile[];
  warnings: string[];
  files: string[];
  savedAssets: Record<string, { file: string; key: string; hash: string; bytes: number }>;
}> {
  const outputs: OutputFile[] = [];
  const files: string[] = [];

  const localized = await localizeImages({
    images: result.images,
    destDir: assetsDir(dir),
    linkPrefix: '../../assets/',
    ...(flags.keepRemoteImages !== undefined ? { keepRemote: flags.keepRemoteImages } : {}),
  });
  for (const asset of Object.values(localized.saved)) {
    outputs.push({ file: path.join(dir, 'assets', asset.file), bytes: asset.bytes });
  }

  const target = viewDir(dir, 'markdown');
  await fs.mkdir(target, { recursive: true });

  const writePage = async (name: string, text: string): Promise<void> => {
    const body = rewriteLinks(text, localized.rewrites);
    await fs.writeFile(path.join(target, name), body, 'utf-8');
    const rel = path.join('views', 'markdown', name);
    files.push(rel);
    outputs.push({ file: path.join(dir, rel), bytes: Buffer.byteLength(body) });
  };

  await writePage('index.md', result.markdown);
  if (flags.splitPages && result.markdownPages) {
    for (const [index, page] of result.markdownPages.entries()) {
      await writePage(`${String(index + 1).padStart(3, '0')}.md`, page);
    }
  }

  return { outputs, warnings: localized.warnings, files, savedAssets: localized.saved };
}

/**
 * Portable copy: `<name>.md` + sibling `<name>.assets/`, self-contained.
 * `-o -` streams to stdout with remote links kept (the caller warns).
 */
async function writePortable(
  target: string,
  result: ConvertResult,
  flags: ConvertFlags
): Promise<{ outputs: OutputFile[]; warnings: string[] }> {
  if (target === '-') {
    process.stdout.write(result.markdown);
    return { outputs: [], warnings: ['stdout keeps remote image links; they expire in hours.'] };
  }

  const outputs: OutputFile[] = [];
  const base = target.endsWith('.md') ? target.slice(0, -3) : target;
  const mdPath = `${base}.md`;
  const assetsDirName = `${path.basename(base)}.assets`;

  const localized = await localizeImages({
    images: result.images,
    destDir: path.join(path.dirname(mdPath), assetsDirName),
    linkPrefix: `${assetsDirName}/`,
    ...(flags.keepRemoteImages !== undefined ? { keepRemote: flags.keepRemoteImages } : {}),
  });

  await fs.mkdir(path.dirname(path.resolve(mdPath)), { recursive: true });
  const body = rewriteLinks(result.markdown, localized.rewrites);
  await fs.writeFile(mdPath, body, 'utf-8');
  outputs.push({ file: mdPath, bytes: Buffer.byteLength(body) });
  for (const asset of Object.values(localized.saved)) {
    outputs.push({ file: path.join(path.dirname(mdPath), assetsDirName, asset.file), bytes: asset.bytes });
  }

  return { outputs, warnings: localized.warnings };
}

function viewParamsFor(flags: ConvertFlags): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (flags.anchors !== undefined) params.anchors = flags.anchors;
  if (flags.splitPages !== undefined) params.splitPages = flags.splitPages;
  return params;
}

function oneShotParseFlags(options: ConvertOpOptions): Record<string, unknown> {
  const flags = options.parseFlags ?? {};
  const params: Record<string, unknown> = {};
  if (flags.password !== undefined) params.password = flags.password;
  if (flags.profile !== undefined) params.parseProfile = flags.profile;
  if (flags.includeImages !== undefined) params.includeImages = flags.includeImages;
  if (flags.stayImageAreaRate !== undefined) params.stayImageAreaRate = flags.stayImageAreaRate;
  if (options.input.kind === 'link' && flags.mode !== undefined) params.mode = flags.mode;
  return params;
}

function defaultPortableName(input: ResolvedInput, label: string): string {
  if (input.kind === 'document') {
    const ext = path.extname(input.file);
    return input.file.slice(0, input.file.length - ext.length);
  }
  if (input.kind === 'stdin') {
    return 'stdin';
  }
  if (input.kind === 'link') {
    const url = new URL(input.url);
    return `${url.hostname}`.replace(/[^\w.-]+/g, '-') || 'page';
  }
  return label;
}

function formatOf(manifest: Manifest): IrFormat {
  switch (manifest.parse.type) {
    case 'pdf.pdfParse':
      return 'pdf';
    case 'pptx.parse':
      return 'pptx';
    case 'docx.parseTextAndImage':
      return 'docx';
    case 'keynote.parseTextAndImage':
      return 'keynote';
    default:
      return 'html';
  }
}

function envelope(
  options: ConvertOpOptions,
  extra: {
    startedAt: number;
    engine: 'cloud' | 'local-cache';
    format: IrFormat;
    taskId: string | null;
    reusedParse: boolean;
    outputs: OutputFile[];
    warnings: string[];
  }
): ConvertEnvelope {
  return {
    ok: true,
    op: 'convert',
    input: options.inputLabel,
    to: 'markdown',
    engine: extra.engine,
    format: extra.format,
    taskId: extra.taskId,
    reusedParse: extra.reusedParse,
    outputs: extra.outputs,
    warnings: extra.warnings,
    durationMs: Date.now() - extra.startedAt,
  };
}

