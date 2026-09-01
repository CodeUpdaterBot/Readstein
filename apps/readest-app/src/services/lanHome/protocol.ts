/** Home-library LAN protocol constants shared by the Tauri host and JS client. */

export const LAN_HOME_DEFAULT_PORT = 17432;
export const LAN_HOME_DISCOVERY_PORT = 17433;
export const LAN_HOME_PROTOCOL = 1;
export const LAN_HOME_DISCOVERY_MAGIC = 'READEST-LAN1';

export type LanHomeHello = {
  protocol: number;
  name: string;
  bookCount: number;
};

export type LanHomeBookSummary = {
  hash: string;
  title: string;
  author?: string;
  format?: string;
  filename?: string;
  size?: number;
  updatedAt?: number;
  hasCover: boolean;
  hasConfig: boolean;
  /** False when library.json lists the book but the file is missing on the PC. */
  hasFile?: boolean;
  /** Partial MD5 of the host cover.png — phones re-pull when this differs. */
  coverHash?: string | null;
  /** cover.png mtime in ms, used when the host has no coverHash yet. */
  coverMtime?: number | null;
  coverUpdatedAt?: number | null;
  metadataUpdatedAt?: number | null;
  tags?: string[];
};

export type LanHomeBookList = {
  books: LanHomeBookSummary[];
  /** False when library.json is missing or unreadable — clients must not wipe. */
  complete?: boolean;
};

export type LanHomePeer = {
  name: string;
  host: string;
  port: number;
};

export const lanHomeHelloUrl = (host: string, port: number): string =>
  `http://${host}:${port}/v1/hello`;

export const lanHomeBooksUrl = (host: string, port: number): string =>
  `http://${host}:${port}/v1/books`;

export const lanHomeBookFileUrl = (host: string, port: number, hash: string): string =>
  `http://${host}:${port}/v1/books/${encodeURIComponent(hash)}/file`;

export const lanHomeBookCoverUrl = (host: string, port: number, hash: string): string =>
  `http://${host}:${port}/v1/books/${encodeURIComponent(hash)}/cover`;

export const lanHomeBookConfigUrl = (host: string, port: number, hash: string): string =>
  `http://${host}:${port}/v1/books/${encodeURIComponent(hash)}/config`;

export const lanHomeAuthHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
});

export const newLanHomeToken = (): string => {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (const b of bytes) out += alphabet[b! % alphabet.length];
  return out;
};
