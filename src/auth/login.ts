import http from 'node:http';
import { DeckParseError } from '../errors/index.js';

/**
 * Browser login. URL shape, callback port and query parameter names are copied
 * verbatim from deckrender (which copied the DeckOps CLI): a token minted here
 * must be the same token every DeckFlow tool would obtain, or the shared
 * credential file would be useless.
 */
export const DEFAULT_CALLBACK_PORT = 3737;
const LOGIN_TIMEOUT_MS = 300_000;

export interface LoginResult {
  token: string;
  spaceId?: string;
}

export interface LoginOptions {
  apiBase: string;
  port?: number;
  /** Called with the login URL, so callers can print it if the browser fails. */
  onUrl?: (url: string) => void;
}

/** Strip the API version segment: login pages live at the site root, not under /v1. */
export function normalizeLoginBase(apiBase: string): string {
  const url = new URL(apiBase);
  url.pathname = url.pathname.replace(/\/v1\/?$/, '/');
  return `${url.origin}${url.pathname}`.replace(/\/$/, '');
}

export function buildLoginUrl(apiBase: string, callbackUrl: string): string {
  return `${normalizeLoginBase(apiBase)}/cli/auth?redirect_url=${encodeURIComponent(callbackUrl)}`;
}

export async function runLoginFlow(options: LoginOptions): Promise<LoginResult> {
  const port = options.port ?? DEFAULT_CALLBACK_PORT;
  const callbackUrl = `http://localhost:${port}`;
  const loginUrl = buildLoginUrl(options.apiBase, callbackUrl);

  options.onUrl?.(loginUrl);

  const pending = awaitCallback(port, (params) => {
    const token = params.get('token');
    if (!token) {
      return null;
    }
    const spaceId = params.get('spaceId') ?? params.get('space_id');
    return { token, ...(spaceId ? { spaceId } : {}) };
  });

  await openBrowser(loginUrl);
  return pending;
}

/**
 * Serve a one-shot callback endpoint. `extract` returns the payload to resolve
 * with, or null to keep waiting — browsers hit `/favicon.ico` and similar,
 * which must not settle the promise.
 */
function awaitCallback<T>(port: number, extract: (params: URLSearchParams) => T | null): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const payload = extract(url.searchParams);

      if (payload === null) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Missing token parameter');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(successPage(req.headers['accept-language']));
      finish(() => resolve(payload));
    });

    const timer = setTimeout(() => {
      finish(() => reject(DeckParseError.auth('Login timed out after 5 minutes.')));
    }, LOGIN_TIMEOUT_MS);
    timer.unref?.();

    const finish = (settle: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.close();
      settle();
    };

    server.on('error', (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          error.code === 'EADDRINUSE'
            ? DeckParseError.auth(`Port ${port} is already in use.`, {
                hint: 'Close whatever is listening on that port and retry.',
              })
            : DeckParseError.auth(`Local callback server failed: ${error.message}`, { cause: error })
        )
      );
    });

    server.listen(port);
  });
}

async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch {
    // Headless environments have no browser; the caller already printed the URL.
  }
}

function successPage(acceptLanguage: string | string[] | undefined): string {
  const raw = Array.isArray(acceptLanguage) ? acceptLanguage.join(',') : (acceptLanguage ?? '');
  const zh = raw.toLowerCase().includes('zh');
  const title = zh ? '登录成功' : 'Login Successful';
  const description = zh
    ? '你可以关闭此窗口并返回终端。'
    : 'You can close this window and return to your terminal.';

  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             display: flex; align-items: center; justify-content: center; height: 100vh;
             margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
      .card { background: #fff; padding: 3rem; border-radius: 1rem; text-align: center;
              box-shadow: 0 20px 60px rgba(0,0,0,.3); max-width: 420px; }
      .icon { font-size: 4rem; margin-bottom: 1rem; }
      h1 { color: #111827; margin: 0 0 1rem; }
      p { color: #6b7280; margin: 0; }
    </style>
  </head>
  <body><div class="card"><div class="icon">✓</div><h1>${title}</h1><p>${description}</p></div></body>
</html>`;
}
