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

const requireOk = async (res: Response, action: string): Promise<Response> => {
  if (res.status === 401 || res.status === 403) {
    throw new Error('Wrong pairing code, or the home library is not sharing.');
  }
  if (!res.ok) {
    throw new Error(`${action} failed (${res.status})`);
  }
  return res;
};

export const lanHomeHello = async (
  host: string,
  port: number,
  token: string,
): Promise<LanHomeHello> => {
  const res = await requireOk(
    await httpFetch(lanHomeHelloUrl(host, port), { headers: lanHomeAuthHeaders(token) }),
    'Connect',
  );
  return (await res.json()) as LanHomeHello;
};

export const lanHomeListBooks = async (
  host: string,
  port: number,
  token: string,
): Promise<LanHomeBookList> => {
  const res = await requireOk(
    await httpFetch(lanHomeBooksUrl(host, port), { headers: lanHomeAuthHeaders(token) }),
    'List books',
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
  const res = await httpFetch(lanHomeBookConfigUrl(host, port, hash), {
    headers: lanHomeAuthHeaders(token),
  });
  if (res.status === 404) return null;
  await requireOk(res, 'Read progress');
  return (await res.json()) as BookConfig;
};

export const lanHomePutConfig = async (
  host: string,
  port: number,
  token: string,
  hash: string,
  config: BookConfig,
): Promise<void> => {
  const res = await httpFetch(lanHomeBookConfigUrl(host, port, hash), {
    method: 'PUT',
    headers: {
      ...lanHomeAuthHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  await requireOk(res, 'Save progress');
};
