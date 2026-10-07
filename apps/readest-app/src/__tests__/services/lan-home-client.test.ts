import { describe, expect, it, vi, beforeEach } from 'vitest';

const tauriFetch = vi.fn();

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => tauriFetch(...args),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

import { lanHomeHello, lanHomeListBooks, LanHomeError } from '@/services/lanHome/client';

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const status = (code: number) =>
  ({ ok: false, status: code, json: async () => ({}) }) as unknown as Response;

beforeEach(() => {
  tauriFetch.mockReset();
});

describe('home library client failures', () => {
  it('returns the hello payload on success', async () => {
    tauriFetch.mockResolvedValue(ok({ protocol: 1, name: 'DESKTOP-PC', bookCount: 193 }));
    await expect(lanHomeHello('192.168.1.107', 17432, 'TEST2345')).resolves.toMatchObject({
      bookCount: 193,
    });
  });

  it('sends the pairing code as a bearer token', async () => {
    tauriFetch.mockResolvedValue(ok({}));
    await lanHomeListBooks('192.168.1.107', 17432, 'TEST2345');
    const [url, init] = tauriFetch.mock.calls[0]!;
    expect(url).toBe('http://192.168.1.107:17432/v1/books');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer TEST2345',
    });
  });

  it('always bounds the request so the UI cannot hang forever', async () => {
    tauriFetch.mockResolvedValue(ok({}));
    await lanHomeHello('192.168.1.107', 17432, 'TEST2345');
    const init = tauriFetch.mock.calls[0]![1] as RequestInit;
    // A request with no deadline is what leaves a sync button stuck on "Syncing…".
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('names a wrong pairing code instead of blaming the network', async () => {
    tauriFetch.mockResolvedValue(status(401));
    const err = await lanHomeHello('192.168.1.107', 17432, 'WRONG999').catch((e) => e);
    expect(err).toBeInstanceOf(LanHomeError);
    expect((err as LanHomeError).kind).toBe('unauthorized');
    expect((err as LanHomeError).message).toMatch(/pairing code/i);
  });

  it('reports an unreachable PC with the address the user typed', async () => {
    tauriFetch.mockRejectedValue(new Error('NetworkError: connection refused'));
    const err = await lanHomeHello('192.168.1.99', 17432, 'TEST2345').catch((e) => e);
    expect((err as LanHomeError).kind).toBe('unreachable');
    expect((err as LanHomeError).message).toContain('192.168.1.99:17432');
    expect((err as LanHomeError).message).toMatch(/same Wi-Fi/i);
  });

  it('separates a policy block from a network failure', async () => {
    tauriFetch.mockRejectedValue(new Error('URL not allowed on the configured scope'));
    const err = await lanHomeHello('192.168.1.107', 17432, 'TEST2345').catch((e) => e);
    expect((err as LanHomeError).kind).toBe('blocked');
  });
});
