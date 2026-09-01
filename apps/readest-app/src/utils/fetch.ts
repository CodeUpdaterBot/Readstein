import { getAccessToken } from './access';
import { isInsufficientStorageQuotaMessage } from './cloudErrors';

export const fetchWithTimeout = (url: string, options: RequestInit = {}, timeout = 10000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort('Request timed out'), timeout);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(id));
};

export const fetchWithAuth = async (url: string, options: RequestInit) => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const errorData = await response.json();
    const logMessage = errorData.error || response.statusText;
    if (!isInsufficientStorageQuotaMessage(String(logMessage || ''))) {
      console.error('Error:', logMessage);
    }
    throw new Error(errorData.error || 'Request failed');
  }

  return response;
};
