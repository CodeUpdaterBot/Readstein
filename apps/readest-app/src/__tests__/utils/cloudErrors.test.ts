import { describe, expect, it } from 'vitest';
import {
  INSUFFICIENT_STORAGE_QUOTA,
  areReadestCloudQuotaNoticesMuted,
  isBenignReadestCloudSyncError,
  isBenignReadestCloudSyncMessage,
  isInsufficientStorageQuotaError,
  isInsufficientStorageQuotaMessage,
} from '@/utils/cloudErrors';

describe('cloudErrors', () => {
  it('detects Readest Cloud plan quota copy', () => {
    expect(isInsufficientStorageQuotaMessage(INSUFFICIENT_STORAGE_QUOTA)).toBe(true);
    expect(isInsufficientStorageQuotaError(new Error(INSUFFICIENT_STORAGE_QUOTA))).toBe(true);
    expect(isInsufficientStorageQuotaMessage('network boom')).toBe(false);
  });

  it('treats duplicate book-key pushes as benign', () => {
    expect(
      isBenignReadestCloudSyncMessage(
        'Failed to push changes: duplicate key value violates unique constraint "books_pkey"',
      ),
    ).toBe(true);
    expect(isBenignReadestCloudSyncError(new Error('network boom'))).toBe(false);
  });

  it('reads the mute flag', () => {
    expect(areReadestCloudQuotaNoticesMuted()).toBe(false);
    expect(areReadestCloudQuotaNoticesMuted({ muteReadestCloudQuotaNotices: true })).toBe(true);
  });
});
