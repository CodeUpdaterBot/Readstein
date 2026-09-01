import { describe, expect, test } from 'vitest';
import {
  LAN_HOME_DEFAULT_PORT,
  lanHomeAuthHeaders,
  lanHomeBookCoverUrl,
  lanHomeBookFileUrl,
  lanHomeHelloUrl,
  newLanHomeToken,
} from '@/services/lanHome/protocol';

describe('lan home protocol helpers', () => {
  test('builds authenticated URLs', () => {
    expect(lanHomeHelloUrl('192.168.1.8', LAN_HOME_DEFAULT_PORT)).toBe(
      'http://192.168.1.8:17432/v1/hello',
    );
    expect(lanHomeBookFileUrl('10.0.0.2', 17432, 'abc123')).toBe(
      'http://10.0.0.2:17432/v1/books/abc123/file',
    );
    expect(lanHomeBookCoverUrl('10.0.0.2', 17432, 'abc123')).toBe(
      'http://10.0.0.2:17432/v1/books/abc123/cover',
    );
    expect(lanHomeAuthHeaders('SECRET9')['Authorization']).toBe('Bearer SECRET9');
  });

  test('pairing codes are short and alphanumeric', () => {
    const token = newLanHomeToken();
    expect(token).toMatch(/^[A-Z2-9]{8}$/);
  });
});
