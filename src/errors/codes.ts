/**
 * Error codes and exit codes. Single source of truth — see docs/rfc.md §5.4.
 *
 * `ir_*` and `asset_error` share exit code 5 with `input_error` (the user can
 * fix them without touching us), but `--json` keeps the precise `error.code`.
 */

export const ERROR_CODES = [
  'usage_error',
  'unsupported',
  'auth_error',
  'input_error',
  'ir_not_found',
  'ir_expired',
  'ir_schema_unsupported',
  'ir_invalid',
  'asset_error',
  'backend_error',
  'not_implemented',
  'quota_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const EXIT_CODES: Record<ErrorCode, number> = {
  usage_error: 2,
  unsupported: 3,
  auth_error: 4,
  input_error: 5,
  ir_not_found: 5,
  ir_expired: 5,
  ir_schema_unsupported: 5,
  ir_invalid: 5,
  asset_error: 5,
  backend_error: 6,
  not_implemented: 7,
  quota_error: 8,
};
