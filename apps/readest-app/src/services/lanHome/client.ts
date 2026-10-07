import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import {
  lanHomeAuthHeaders,
  lanHomeBookConfigUrl,
  lanHomeBookFileUrl,
  lanHomeBooksUrl,
  lanHomeHelloUrl,
  type LanHomeBookList,
  type LanHomeHello,
} from './protocol';
import type { BookConfig } from '@/types/book';

const httpFetch = (isTauriAppPlatform() ? tauriFetch : globalThis.fetch.bind(globalThis)) as (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * A LAN request that never returns is the worst kind of failure: the friendliest
 * UI just sits on "Syncing…" forever. Every call is bounded so the caller can
 * always say *what* went wrong instead of hanging.
 */
export const LAN_HOME_CONNECT_TIMEOUT_MS = 8000;
export const LAN_HOME_CALL_TIMEOUT_MS = 30000;

export type LanHomeFailure = 'unreachable' | 'unauthorized' | 'blocked' | 'server';

/** Failure that carries a cause the UI can explain to a person. */
export class LanHomeError extends Error {
  readonly kind: LanHomeFailure;

  constructor(kind: LanHomeFailure, message: string) {
    super(message);
    this.name = 'LanHomeError';
    this.kind = kind;
  }
}

const describe = (host: string, port: number, kind: LanHomeFailure): string => {
  const where = `${host}:${port}`;
  switch (kind) {
    case 'unreachable':
      return `Could not reach the PC at ${where}. Check that both devices are on the same Wi-Fi, the desktop app is still running, and the address and port are right.`;
    case 'unauthorized':
      return `The PC rejected the pairing code. Open Home Library on the PC and retype its current code.`;
    case 'blocked':
      return `The app was blocked from contacting ${where} by its own security policy.`;
    default:
      return `The PC answered with an error for ${where}.`;
  }
};

const request = async (
  url: string,
  init: RequestInit,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<Response> => {
  let res: Response;
  try {
    res = await httpFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Tauri's http plugin rejects a URL outside its capability scope, and reports a
    // timed-out fetch and a refused socket the same way, so tell them apart by text
    // rather than sending the user hunting for the wrong fault.
    if (/not allowed|scope|denied|forbidden/i.test(message)) {
      throw new LanHomeError('blocked', `${describe(host, port, 'blocked')} (${message})`);
    }
    throw new LanHomeError('unreachable', describe(host, port, 'unreachable'));
  }
  if (res.status === 401 || res.status === 403) {
    throw new LanHomeError('unauthorized', describe(host, port, 'unauthorized'));
  }
  if (!res.ok) {
    throw new LanHomeError('server', `${describe(host, port, 'server')} (HTTP ${res.status})`);
  }
  return res;
};

export const lanHomeHello = async (
  host: string,
  port: number,
  token: string,
): Promise<LanHomeHello> => {
  const res = await request(
    lanHomeHelloUrl(host, port),
    { headers: lanHomeAuthHeaders(token) },
    host,
    port,
    LAN_HOME_CONNECT_TIMEOUT_MS,
  );
  return (await res.json()) as LanHomeHello;
};

export const lanHomeListBooks = async (
  host: string,
  port: number,
  token: string,
): Promise<LanHomeBookList> => {
  const res = await request(
    lanHomeBooksUrl(host, port),
    { headers: lanHomeAuthHeaders(token) },
    host,
    port,
    LAN_HOME_CALL_TIMEOUT_MS,
  );
  return (await res.json()) as LanHomeBookList;
};

export const lanHomeDownloadHeaders = (token: string): Record<string, string> =>
  lanHomeAuthHeaders(token);

export const lanHomeFileUrl = lanHomeBookFileUrl;

export const lanHomeGetConfig = async (
  host: string,
  port: number,
  token: string,
  hash: string,
): Promise<BookConfig | null> => {
  let res: Response;
  try {
    res = await httpFetch(lanHomeBookConfigUrl(host, port, hash), {
      headers: lanHomeAuthHeaders(token),
      signal: AbortSignal.timeout(LAN_HOME_CALL_TIMEOUT_MS),
    });
  } catch {
    throw new LanHomeError('unreachable', describe(host, port, 'unreachable'));
  }
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new LanHomeError('unauthorized', describe(host, port, 'unauthorized'));
  }
  if (!res.ok) {
    throw new LanHomeError('server', `${describe(host, port, 'server')} (HTTP ${res.status})`);
  }
  return (await res.json()) as BookConfig;
};

export const lanHomePutConfig = async (
  host: string,
  port: number,
  token: string,
  hash: string,
  config: BookConfig,
): Promise<void> => {
  let res: Response;
  try {
    res = await httpFetch(lanHomeBookConfigUrl(host, port, hash), {
      method: 'PUT',
      headers: {
        ...lanHomeAuthHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(LAN_HOME_CALL_TIMEOUT_MS),
    });
  } catch {
    throw new LanHomeError('unreachable', describe(host, port, 'unreachable'));
  }
  if (res.status === 401 || res.status === 403) {
    throw new LanHomeError('unauthorized', describe(host, port, 'unauthorized'));
  }
  if (!res.ok) {
    throw new LanHomeError('server', `${describe(host, port, 'server')} (HTTP ${res.status})`);
  }
};
