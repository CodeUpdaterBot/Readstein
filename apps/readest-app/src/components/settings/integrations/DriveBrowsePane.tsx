import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MdArrowBack,
  MdCheck,
  MdDownload,
  MdFolder,
  MdLink,
  MdRefresh,
} from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriDownload } from '@/utils/transfer';
import { eventDispatcher } from '@/utils/event';
import { ingestFile } from '@/services/ingestService';
import { FileSyncError } from '@/services/sync/file/provider';
import {
  createDriveBrowseSession,
  driveAuthHeader,
  driveDownloadUrl,
  getDriveFileMeta,
  listDriveFolder,
  type DriveBrowseEntry,
} from '@/services/sync/providers/gdrive/driveBrowse';
import { parseDriveShareUrl } from '@/services/sync/providers/gdrive/parseDriveShareUrl';
import {
  formatLastModified,
  formatSize,
  isSupportedBookExt,
} from './webdavBrowseUtils';
import { SettingLabel } from '../primitives';

const ROOT_ID = 'root';

type DownloadStatus = 'downloading' | 'done' | 'error';

/**
 * Browse a connected Google Drive account and import book files into the
 * local library. Does not replace or rebase the shelf — ingestFile dedupes
 * by hash the same way folder import and WebDAV browse do.
 */
const DriveBrowsePane: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { user } = useAuth();
  const { settings: globalSettings } = useSettingsStore();

  const [folderId, setFolderId] = useState(ROOT_ID);
  const [crumbs, setCrumbs] = useState<Array<{ id: string; name: string }>>([
    { id: ROOT_ID, name: 'My Drive' },
  ]);
  const [entries, setEntries] = useState<DriveBrowseEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [linkValue, setLinkValue] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<Record<string, DownloadStatus>>({});

  const library = useLibraryStore((s) => s.library);

  const loadFolder = useCallback(async (id: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const session = await createDriveBrowseSession();
      if (!session) throw new Error('Google Drive is not available here');
      const listed = await listDriveFolder(session, id);
      setEntries(listed);
    } catch (e) {
      const auth = e instanceof FileSyncError && e.code === 'AUTH_FAILED';
      setLoadError(
        auth
          ? _('Reconnect Google Drive to browse your folders.')
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [_]);

  useEffect(() => {
    void loadFolder(folderId);
  }, [folderId, reloadTick, loadFolder]);

  const openFolder = (entry: DriveBrowseEntry) => {
    if (!entry.isDirectory) return;
    setCrumbs((prev) => [...prev, { id: entry.id, name: entry.name }]);
    setFolderId(entry.id);
    setDownloadStatus({});
  };

  const goBack = () => {
    if (crumbs.length <= 1) return;
    const next = crumbs.slice(0, -1);
    setCrumbs(next);
    setFolderId(next[next.length - 1]!.id);
    setDownloadStatus({});
  };

  const handleOpenLink = async () => {
    const target = parseDriveShareUrl(linkValue);
    if (!target) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Not a Google Drive folder or file link.'),
      });
      return;
    }
    try {
      const session = await createDriveBrowseSession();
      if (!session) throw new Error('Google Drive is not available here');
      const meta = await getDriveFileMeta(session, target.id);
      if (!meta) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Could not open that Drive item. Check sharing and reconnect if needed.'),
        });
        return;
      }
      if (meta.isDirectory || target.type === 'folder') {
        setCrumbs([
          { id: ROOT_ID, name: 'My Drive' },
          { id: meta.id, name: meta.name },
        ]);
        setFolderId(meta.id);
        setLinkValue('');
        return;
      }
      await importEntry(meta);
      setLinkValue('');
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const importEntry = async (entry: DriveBrowseEntry) => {
    if (entry.isDirectory) return;
    if (!isSupportedBookExt(entry.name)) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('This file type cannot be imported.'),
      });
      return;
    }
    if (downloadStatus[entry.id] === 'downloading' || downloadStatus[entry.id] === 'done') return;

    if (!isTauriAppPlatform()) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('File download is only supported on the desktop and mobile apps.'),
      });
      return;
    }

    const appService = await envConfig.getAppService();
    if (!appService) return;

    setDownloadStatus((prev) => ({ ...prev, [entry.id]: 'downloading' }));
    try {
      const session = await createDriveBrowseSession();
      if (!session) throw new Error('Google Drive is not available here');
      const headers = await driveAuthHeader(session);
      const safeName = entry.name.replaceAll(/[/\\:*?"<>|]/g, '_').slice(0, 200) || 'download';
      const dst = await appService.resolveFilePath(`gdrive-${Date.now()}-${safeName}`, 'Cache');
      await tauriDownload(driveDownloadUrl(entry.id), dst, undefined, headers);

      const { library: storeLibrary, libraryLoaded, setLibrary } = useLibraryStore.getState();
      const books = libraryLoaded ? [...storeLibrary] : await appService.loadLibraryBooks();
      const imported = await ingestFile(
        { file: dst, books, sourceFileName: entry.name },
        { appService, settings: globalSettings, isLoggedIn: !!user },
      );
      try {
        await appService.deleteFile(dst, 'None');
      } catch {
        /* cache GC */
      }
      if (!imported) throw new Error('Import returned null');
      await appService.saveLibraryBooks(books);
      setLibrary(books);
      setDownloadStatus((prev) => ({ ...prev, [entry.id]: 'done' }));
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Imported "{{title}}" into your library.', {
          title: imported.title || entry.name,
        }),
      });
    } catch (e) {
      console.warn('[gdrive] import failed', entry.name, e);
      setDownloadStatus((prev) => ({ ...prev, [entry.id]: 'error' }));
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to import "{{name}}": {{error}}', {
          name: entry.name,
          error: e instanceof Error ? e.message : String(e),
        }),
      });
    }
  };

  const visibleEntries = useMemo(
    () => entries.filter((e) => e.isDirectory || isSupportedBookExt(e.name)),
    [entries],
  );

  const alreadyInLibrary = useMemo(() => {
    const names = new Set((library ?? []).map((b) => (b.title || '').toLowerCase()));
    return names;
  }, [library]);

  return (
    <div className='space-y-3'>
      <div className='flex gap-2'>
        <input
          type='text'
          value={linkValue}
          onChange={(e) => setLinkValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleOpenLink();
          }}
          placeholder={_('Paste a Drive folder or file link')}
          className={clsx(
            'input input-sm bg-base-200/60 h-9 min-w-0 flex-1 rounded-md border-0',
            'focus:outline-none focus:ring-0',
          )}
        />
        <button
          type='button'
          className='btn btn-ghost btn-sm h-9 min-h-9 px-3'
          onClick={() => void handleOpenLink()}
          aria-label={_('Open link')}
        >
          <MdLink className='h-5 w-5' />
        </button>
      </div>

      <div className='flex items-center gap-2'>
        <button
          type='button'
          className='btn btn-ghost btn-sm h-8 min-h-8 px-2'
          onClick={goBack}
          disabled={crumbs.length <= 1 || isLoading}
          aria-label={_('Back')}
        >
          <MdArrowBack className='h-5 w-5' />
        </button>
        <SettingLabel className='min-w-0 flex-1 truncate'>
          {crumbs.map((c) => c.name).join(' / ')}
        </SettingLabel>
        <button
          type='button'
          className='btn btn-ghost btn-sm h-8 min-h-8 px-2'
          onClick={() => setReloadTick((n) => n + 1)}
          disabled={isLoading}
          aria-label={_('Refresh')}
        >
          <MdRefresh className={clsx('h-5 w-5', isLoading && 'animate-spin')} />
        </button>
      </div>

      {loadError && <p className='text-error text-[0.85em]'>{loadError}</p>}

      <div className='border-base-200 max-h-72 overflow-y-auto rounded-lg border'>
        {isLoading && entries.length === 0 ? (
          <div className='flex justify-center py-8'>
            <span className='loading loading-spinner loading-sm' />
          </div>
        ) : visibleEntries.length === 0 ? (
          <p className='text-base-content/60 px-3 py-6 text-center text-[0.85em]'>
            {_('No folders or book files in this location.')}
          </p>
        ) : (
          <ul className='divide-base-200 divide-y'>
            {visibleEntries.map((entry) => {
              const status = downloadStatus[entry.id];
              const book = !entry.isDirectory && isSupportedBookExt(entry.name);
              return (
                <li key={entry.id} className='flex items-center gap-2 px-3 py-2'>
                  <button
                    type='button'
                    className='flex min-w-0 flex-1 items-center gap-2 text-left'
                    onClick={() => (entry.isDirectory ? openFolder(entry) : void importEntry(entry))}
                  >
                    {entry.isDirectory ? (
                      <MdFolder className='text-base-content/60 h-5 w-5 shrink-0' />
                    ) : (
                      <MdDownload className='text-base-content/60 h-5 w-5 shrink-0' />
                    )}
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate text-sm'>{entry.name}</span>
                      <span className='text-base-content/55 block text-[0.75em]'>
                        {[
                          entry.size ? formatSize(entry.size) : '',
                          entry.modifiedTime ? formatLastModified(entry.modifiedTime) : '',
                          book && alreadyInLibrary.has(entry.name.replace(/\.[^.]+$/, '').toLowerCase())
                            ? _('May already be in library')
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                  {book && (
                    <span className='shrink-0'>
                      {status === 'downloading' && (
                        <span className='loading loading-spinner loading-xs' />
                      )}
                      {status === 'done' && <MdCheck className='text-success h-5 w-5' />}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default DriveBrowsePane;
