/**
 * Transformers.js fires progress events when hydrating a cached ONNX model
 * from IndexedDB, and ensureLoaded() used to label that as "downloading".
 * The banner should only appear for a real first-time network fetch.
 */
export function shouldShowDownloadProgress(
  status: string,
  modelAlreadyOnDisk: boolean,
): boolean {
  return status === 'downloading' && !modelAlreadyOnDisk;
}
