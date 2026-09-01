import { describe, expect, test } from 'vitest';
import { parseDriveShareUrl } from '@/services/sync/providers/gdrive/parseDriveShareUrl';

describe('parseDriveShareUrl', () => {
  test('parses folder share links', () => {
    expect(
      parseDriveShareUrl('https://drive.google.com/drive/folders/1abcDEF_ghi-0123456789?usp=sharing'),
    ).toEqual({ type: 'folder', id: '1abcDEF_ghi-0123456789' });
    expect(
      parseDriveShareUrl('https://drive.google.com/drive/u/0/folders/1abcDEF_ghi-0123456789'),
    ).toEqual({ type: 'folder', id: '1abcDEF_ghi-0123456789' });
  });

  test('parses file links', () => {
    expect(
      parseDriveShareUrl('https://drive.google.com/file/d/1fileId_abcDEF0123/view?usp=drive_link'),
    ).toEqual({ type: 'file', id: '1fileId_abcDEF0123' });
    expect(parseDriveShareUrl('https://drive.google.com/open?id=1fileId_abcDEF0123')).toEqual({
      type: 'file',
      id: '1fileId_abcDEF0123',
    });
  });

  test('treats a bare Drive id as a folder pointer', () => {
    expect(parseDriveShareUrl('1abcDEF_ghi-0123456789')).toEqual({
      type: 'folder',
      id: '1abcDEF_ghi-0123456789',
    });
  });

  test('rejects junk', () => {
    expect(parseDriveShareUrl('')).toBeNull();
    expect(parseDriveShareUrl('https://example.com/x')).toBeNull();
    expect(parseDriveShareUrl('not-an-id')).toBeNull();
  });
});
