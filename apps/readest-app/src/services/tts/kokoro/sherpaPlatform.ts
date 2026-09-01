import { isTauriAppPlatform } from '@/services/environment';

/** True in the Android Tauri WebView — Kokoro runs via sherpa-onnx there. */
export function isAndroidSherpaPlatform(): boolean {
  if (!isTauriAppPlatform()) return false;
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}
