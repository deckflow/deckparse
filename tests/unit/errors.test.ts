import { APIError } from '@deckops/sdk';
import { describe, expect, it } from 'vitest';
import { translate } from '../../src/cloud/client.js';
import { EXIT_CODES } from '../../src/errors/index.js';

describe('error translation', () => {
  it('maps backend body codes to precise ir_* codes with actionable hints', () => {
    const cases = [
      ['irExpired', 'ir_expired', 5],
      ['irNotFound', 'ir_not_found', 5],
      ['irSchemaUnsupported', 'ir_schema_unsupported', 5],
      ['irInvalid', 'ir_invalid', 5],
      ['guestTaskOverLimit', 'quota_error', 8],
    ] as const;
    for (const [bodyCode, code, exit] of cases) {
      const translated = translate(new APIError('boom', 422, { code: bodyCode } as never));
      expect(translated.code).toBe(code);
      expect(translated.exitCode).toBe(exit);
    }
  });

  it('falls back to HTTP status when the body carries no code', () => {
    expect(translate(new APIError('x', 401)).code).toBe('auth_error');
    expect(translate(new APIError('x', 410)).code).toBe('ir_expired');
    expect(translate(new APIError('x', 429)).code).toBe('quota_error');
    expect(translate(new APIError('x', 500)).code).toBe('backend_error');
  });

  it('names the backend version when parse returns no irKey', () => {
    const translated = translate(new Error('pptx.parse returned no irKey. …'));
    expect(translated.code).toBe('backend_error');
    expect(translated.hint).toMatch(/0\.22\.0/);
  });

  it('exit codes cover every error code exactly once', () => {
    expect(Object.values(EXIT_CODES).every((code) => code >= 2 && code <= 8)).toBe(true);
  });
});
