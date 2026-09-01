/** Server copy for Readest Cloud object storage (see `/storage/upload`). */
export const INSUFFICIENT_STORAGE_QUOTA = 'Insufficient storage quota';

export const isInsufficientStorageQuotaMessage = (message: string): boolean =>
  message.toLowerCase().includes('insufficient storage quota');

export const isInsufficientStorageQuotaError = (error: unknown): boolean =>
  error instanceof Error && isInsufficientStorageQuotaMessage(error.message);

/**
 * Metadata push of books that already exist on the server, or Cloud object
 * storage over plan quota. Expected for a large local library; not a crash.
 */
export const isBenignReadestCloudSyncMessage = (message: string): boolean =>
  isInsufficientStorageQuotaMessage(message) ||
  /duplicate key|books_pkey/i.test(message);

export const isBenignReadestCloudSyncError = (error: unknown): boolean =>
  error instanceof Error && isBenignReadestCloudSyncMessage(error.message);

export const areReadestCloudQuotaNoticesMuted = (settings?: {
  muteReadestCloudQuotaNotices?: boolean;
}): boolean => !!settings?.muteReadestCloudQuotaNotices;

/** Transfer manager → StorageQuotaNoticeDialog (not a toast). */
export const STORAGE_QUOTA_NOTICE_EVENT = 'storage-quota-notice';
