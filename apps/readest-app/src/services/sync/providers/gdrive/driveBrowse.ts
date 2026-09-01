/**
 * Drive folder browser + download helper for *importing* books into the local
 * library. Separate from {@link GoogleDriveProvider}: that backend only sees
 * the app-created `/Readest` tree (`drive.file`). Import needs the user's
 * own folders, which the connect flow now also requests via drive.readonly.
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { FileSyncError } from '@/services/sync/file/provider';
import { browseListUrl, childrenQuery, FOLDER_MIME, mediaDownloadUrl, metadataUrl } from './driveRest';
import { createGoogleDriveAuth } from './googleDriveAuth';
import { WebDriveAuth } from './WebDriveAuth';
import { createDriveTokenPersistence } from './driveTokenStore';
import { getGoogleClientId, getGoogleWebClientId } from './buildGoogleDriveProvider';
import type { DriveAuth, FetchFn } from './GoogleDriveProvider';

export type DriveBrowseEntry = {
  id: string;
  name: string;
  isDirectory: boolean;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
};

type DriveFileRow = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
};

type DriveFileListPage = {
  files?: DriveFileRow[];
  nextPageToken?: string;
};

const resolveFetch = (): FetchFn =>
  (isTauriAppPlatform() ? tauriFetch : globalThis.fetch.bind(globalThis)) as unknown as FetchFn;

export const createDriveBrowseSession = async (): Promise<{
  auth: DriveAuth;
  fetchFn: FetchFn;
} | null> => {
  if (isWebAppPlatform()) {
    if (!getGoogleWebClientId()) return null;
    const fetchFn = globalThis.fetch.bind(globalThis) as unknown as FetchFn;
    return { auth: new WebDriveAuth(fetchFn), fetchFn };
  }
  const clientId = getGoogleClientId();
  if (!clientId) return null;
  const persistence = await createDriveTokenPersistence();
  if (!persistence) return null;
  const fetchFn = resolveFetch();
  return { auth: createGoogleDriveAuth({ clientId, fetchFn, persistence }), fetchFn };
};

const authedGet = async (
  session: { auth: DriveAuth; fetchFn: FetchFn },
  url: string,
): Promise<Response> => {
  const token = await session.auth.getAccessToken();
  const res = await session.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    throw new FileSyncError('Google Drive authentication failed', 'AUTH_FAILED', res.status);
  }
  if (!res.ok) {
    throw new FileSyncError(`Google Drive request failed (${res.status})`, 'NETWORK', res.status);
  }
  return res;
};

export const listDriveFolder = async (
  session: { auth: DriveAuth; fetchFn: FetchFn },
  parentId: string,
): Promise<DriveBrowseEntry[]> => {
  const entries: DriveBrowseEntry[] = [];
  let pageToken: string | undefined;
  do {
    const res = await authedGet(session, browseListUrl(childrenQuery(parentId), pageToken));
    const data = (await res.json()) as DriveFileListPage;
    for (const file of data.files ?? []) {
      if (!file.id || !file.name) continue;
      const mime = file.mimeType ?? '';
      const isShortcut = mime === 'application/vnd.google-apps.shortcut';
      if (isShortcut) continue;
      const isDirectory = mime === FOLDER_MIME;
      entries.push({
        id: file.id,
        name: file.name,
        isDirectory,
        mimeType: mime,
        size: file.size !== undefined ? Number(file.size) : undefined,
        modifiedTime: file.modifiedTime,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return entries;
};

export const getDriveFileMeta = async (
  session: { auth: DriveAuth; fetchFn: FetchFn },
  fileId: string,
): Promise<DriveBrowseEntry | null> => {
  const token = await session.auth.getAccessToken();
  const res = await session.fetchFn(metadataUrl(fileId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new FileSyncError('Google Drive authentication failed', 'AUTH_FAILED', res.status);
  }
  if (!res.ok) {
    throw new FileSyncError(`Google Drive request failed (${res.status})`, 'NETWORK', res.status);
  }
  const file = (await res.json()) as DriveFileRow;
  if (!file.id || !file.name) return null;
  const mime = file.mimeType ?? '';
  return {
    id: file.id,
    name: file.name,
    isDirectory: mime === FOLDER_MIME,
    mimeType: mime,
    size: file.size !== undefined ? Number(file.size) : undefined,
    modifiedTime: file.modifiedTime,
  };
};

export const driveDownloadUrl = (fileId: string): string => mediaDownloadUrl(fileId);

export const driveAuthHeader = async (session: { auth: DriveAuth }): Promise<Record<string, string>> => {
  const token = await session.auth.getAccessToken();
  return { Authorization: `Bearer ${token}` };
};
