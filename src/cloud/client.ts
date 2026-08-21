import { statSync } from 'node:fs';
import path from 'node:path';
import {
  APIError,
  createDeck,
  type ConvertOptions as SdkConvertOptions,
  type ConvertRef,
  type ConvertResult,
  type DeckClient,
  type ParseOptions as SdkParseOptions,
  type ParseResult,
  type ParseSource,
} from '@deckops/sdk';
import { DeckParseError, type ErrorCode } from '../errors/index.js';
import type { ResolvedCredentials } from '../config/index.js';

/**
 * Thin wrapper over the SDK: inject resolved credentials, translate errors.
 * DeckParse adds no cloud semantics of its own (docs/rfc.md §1 rule 1).
 */

export interface CloudClient {
  parse<R = unknown>(source: ParseSource, options?: SdkParseOptions): Promise<ParseResult<R>>;
  convert(ref: ConvertRef, options?: SdkConvertOptions): Promise<ConvertResult>;
}

/**
 * Files at or above this size are uploaded to storage first (chunked, via
 * presigned URLs) and the task references the fileId. Inlining a large
 * multipart body into task creation trips gateway timeouts, and the SDK's
 * network-level retry of that POST is not idempotent — the real backend showed
 * one 9 MB pptx spawning eight duplicate tasks. Found by conformance with real
 * fixtures; small synthetic files never hit it.
 */
export const PRE_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

export function createCloudClient(credentials: ResolvedCredentials): CloudClient {
  const deck: DeckClient = createDeck({
    root: credentials.apiBase,
    ...(credentials.token ? { token: credentials.token } : {}),
    ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
    ...(credentials.spaceId ? { spaceId: credentials.spaceId } : {}),
  });

  return {
    parse: async (source, options) => {
      try {
        return await deck.parse(await preUploadLarge(deck, source), options);
      } catch (error) {
        throw translate(error);
      }
    },
    convert: async (ref, options) => {
      try {
        return await deck.convert(ref, options);
      } catch (error) {
        throw translate(error);
      }
    },
  };
}

async function preUploadLarge(deck: DeckClient, source: ParseSource): Promise<ParseSource> {
  const large = largeUpload(source);
  if (!large) {
    return source;
  }
  const uploaded = await deck.files.upload(large.input, { name: large.name });
  return { fileId: uploaded.id, name: large.name };
}

function largeUpload(source: ParseSource): { input: string | Uint8Array; name: string } | undefined {
  if (typeof source === 'string') {
    try {
      if (statSync(source).size >= PRE_UPLOAD_THRESHOLD) {
        return { input: source, name: path.basename(source) };
      }
    } catch {
      // Missing files fail later with the SDK's own message.
    }
    return undefined;
  }
  if (typeof source === 'object' && source !== null && 'file' in source) {
    const { file } = source;
    if (typeof file === 'string') {
      return largeUpload(file);
    }
    if (typeof file === 'object' && file !== null && 'input' in file) {
      const nested = file as { input: unknown; name?: string };
      if (nested.input instanceof Uint8Array && nested.input.byteLength >= PRE_UPLOAD_THRESHOLD) {
        return { input: nested.input, name: nested.name ?? source.name ?? 'upload.bin' };
      }
    }
  }
  return undefined;
}

/** Backend body codes → our codes. The precise `ir_*` codes pass through verbatim. */
const BODY_CODE_MAP: Record<string, ErrorCode> = {
  irNotFound: 'ir_not_found',
  irExpired: 'ir_expired',
  irSchemaUnsupported: 'ir_schema_unsupported',
  irInvalid: 'ir_invalid',
  guestTaskOverLimit: 'quota_error',
};

const HINTS: Partial<Record<ErrorCode, string>> = {
  ir_expired: 'The IR is past its 7-day retention. Re-run `deckparse parse <source> --force` and retry.',
  ir_not_found: 'The reference is wrong or belongs to another space. Re-run `deckparse parse <source>`.',
  ir_schema_unsupported: 'The IR was produced by an incompatible parser version. Re-parse the source.',
  quota_error: 'Guest quota exhausted for today. Run `deckparse auth login` for higher limits.',
  auth_error: 'Run `deckparse auth login`, or check `deckparse config list` for a stale credential.',
};

/**
 * The five-level chain resolves each field independently, so a token from one
 * environment can combine with a spaceId another tool stored for a different
 * one — the backend then 404s on the space. Point at the diagnosis command.
 */
const NOT_FOUND_HINT =
  'A 404 on task creation often means a spaceId inherited from another environment — `deckparse config list` shows every value and where it came from.';

export function translate(error: unknown): DeckParseError {
  if (error instanceof DeckParseError) {
    return error;
  }

  if (error instanceof APIError) {
    const body = error.responseData as { code?: string; message?: string } | undefined;
    const bodyCode = typeof body === 'object' && body !== null ? body.code : undefined;
    const mapped = bodyCode ? BODY_CODE_MAP[bodyCode] : undefined;
    const code: ErrorCode =
      mapped ??
      (error.statusCode === 401
        ? 'auth_error'
        : error.statusCode === 410
          ? 'ir_expired'
          : error.statusCode === 429
            ? 'quota_error'
            : 'backend_error');
    const hint = HINTS[code] ?? (code === 'backend_error' && error.statusCode === 404 ? NOT_FOUND_HINT : undefined);
    return new DeckParseError(code, error.message, { ...(hint ? { hint } : {}), cause: error });
  }

  if (error instanceof Error) {
    // The SDK refuses parse results without an irKey: backend older than the split.
    if (/returned no irKey/.test(error.message)) {
      return DeckParseError.backend(error.message, {
        hint: 'The backend needs @deckflow/platform-slave >= 0.22.0.',
        cause: error,
      });
    }
    if (/did not complete within/.test(error.message)) {
      return DeckParseError.backend(error.message, {
        hint: 'Raise --timeout, or check the task later with its taskId.',
        cause: error,
      });
    }
    return DeckParseError.backend(error.message, { cause: error });
  }

  return DeckParseError.backend(String(error));
}
