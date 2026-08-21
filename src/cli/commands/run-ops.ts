import { resolveCredentials } from '../../config/index.js';
import { createCloudClient, translate } from '../../cloud/client.js';
import { runConvert } from '../../core/convert-op.js';
import { resolveInput } from '../../core/input.js';
import { runParse } from '../../core/parse-op.js';
import { validateConvertFlags, validateParseFlags } from '../../core/validation.js';
import { DeckParseError } from '../../errors/index.js';
import type { CommonFlags, ConvertFlags, ParseFlags } from '../../types.js';
import { printEnvelope, printError, type OutputContext } from '../output.js';

/**
 * Shared command driver for the two verbs: resolve input, validate flags,
 * build the client, run, render, exit. Exit codes come from the error code
 * table — the process exits non-zero on any failure.
 */

export interface RawCliOptions {
  from?: string;
  output?: string;
  json?: boolean;
  quiet?: boolean;
  force?: boolean;
  space?: string;
  timeout?: string;
  apiKey?: string;
  token?: string;
  apiBase?: string;
  // parse-side
  profile?: string;
  password?: string;
  images?: boolean;
  stayImageAreaRate?: string;
  mode?: string;
  // convert-side
  to?: string;
  anchors?: boolean;
  splitPages?: boolean;
  strict?: boolean;
  keepRemoteImages?: boolean;
}

export function parseFlagsOf(options: RawCliOptions): ParseFlags {
  const flags: ParseFlags = {};
  if (options.profile !== undefined) flags.profile = options.profile as NonNullable<ParseFlags['profile']>;
  if (options.password !== undefined) flags.password = options.password;
  // commander's --no-images sets images: false; only forward the negation.
  if (options.images === false) flags.includeImages = false;
  if (options.stayImageAreaRate !== undefined) flags.stayImageAreaRate = Number(options.stayImageAreaRate);
  if (options.mode !== undefined) flags.mode = options.mode as NonNullable<ParseFlags['mode']>;
  return flags;
}

export function convertFlagsOf(options: RawCliOptions): ConvertFlags {
  const flags: ConvertFlags = {};
  if (options.to !== undefined) flags.to = options.to as NonNullable<ConvertFlags['to']>;
  if (options.anchors !== undefined) flags.anchors = options.anchors;
  if (options.splitPages !== undefined) flags.splitPages = options.splitPages;
  if (options.strict !== undefined) flags.strict = options.strict;
  if (options.keepRemoteImages !== undefined) flags.keepRemoteImages = options.keepRemoteImages;
  return flags;
}

export function commonFlagsOf(options: RawCliOptions): CommonFlags {
  return {
    ...(options.space !== undefined ? { spaceId: options.space } : {}),
    ...(options.timeout !== undefined ? { timeout: Number(options.timeout) } : {}),
    ...(options.force !== undefined ? { force: options.force } : {}),
  };
}

async function clientFor(options: RawCliOptions) {
  const credentials = await resolveCredentials({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.token ? { token: options.token } : {}),
    ...(options.apiBase ? { apiBase: options.apiBase } : {}),
    ...(options.space ? { spaceId: options.space } : {}),
  });
  return createCloudClient(credentials);
}

export async function runParseCommand(inputArg: string, options: RawCliOptions): Promise<void> {
  const ctx: OutputContext = { json: Boolean(options.json), quiet: Boolean(options.quiet) };
  try {
    const input = await resolveInput(inputArg, options.from ? { from: options.from } : {});
    const flags = parseFlagsOf(options);
    validateParseFlags(input, flags);
    rejectConvertFlagsOnParse(options);

    const envelope = await runParse({
      input,
      inputLabel: inputArg,
      ...(options.output ? { out: options.output } : {}),
      flags,
      common: commonFlagsOf(options),
      client: await clientFor(options),
    });
    printEnvelope(envelope, ctx);
  } catch (error) {
    fail(error, 'parse', ctx);
  }
}

export async function runConvertCommand(inputArg: string, options: RawCliOptions): Promise<void> {
  const ctx: OutputContext = { json: Boolean(options.json), quiet: Boolean(options.quiet) };
  try {
    const input = await resolveInput(inputArg, options.from ? { from: options.from } : {});
    const parseFlags = parseFlagsOf(options);
    const convertFlags = convertFlagsOf(options);
    validateParseFlags(input, parseFlags);
    validateConvertFlags(input, convertFlags);

    const envelope = await runConvert({
      input,
      inputLabel: inputArg,
      ...(options.output ? { out: options.output } : {}),
      flags: convertFlags,
      parseFlags,
      common: commonFlagsOf(options),
      client: await clientFor(options),
    });
    printEnvelope(envelope, ctx);
  } catch (error) {
    fail(error, 'convert', ctx);
  }
}

/** `deckparse parse doc.pdf --anchors` is a category error, not a silent no-op. */
function rejectConvertFlagsOnParse(options: RawCliOptions): void {
  const set = (['to', 'anchors', 'splitPages', 'strict', 'keepRemoteImages'] as const).filter(
    (name) => options[name] !== undefined && options[name] !== false
  );
  if (set.length > 0) {
    throw DeckParseError.usage(
      `${set.map((name) => `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).join(', ')} are view options — they belong to \`deckparse convert\`.`
    );
  }
}

function fail(error: unknown, op: 'parse' | 'convert', ctx: OutputContext): never {
  const translated = error instanceof DeckParseError ? error : translate(error);
  printError(translated, op, ctx);
  process.exit(translated.exitCode);
}
