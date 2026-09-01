import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isWebAppPlatform } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import {
  runGoogleDriveConnect,
  runGoogleDriveDisconnect,
} from '@/services/sync/providers/gdrive/googleDriveConnect';
import { hasValidWebDriveToken } from '@/services/sync/providers/gdrive/auth/webTokenStore';
import { Tips } from '../primitives';
import FileSyncForm from './FileSyncForm';
import DriveBrowsePane from './DriveBrowsePane';
import { persistCloudProviderEnabled } from './cloudSync';

const disconnectButtonClass = clsx(
  'eink-bordered',
  'h-10 rounded-lg px-4 text-sm font-medium',
  'text-error hover:bg-error/10',
  'transition-colors duration-150',
  'focus-visible:ring-error/40 focus-visible:outline-none focus-visible:ring-2',
);

const primaryButtonClass = clsx(
  'btn btn-contrast',
  'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
  'focus-visible:ring-base-content/40 focus-visible:outline-none focus-visible:ring-2',
);

const ghostButtonClass = clsx(
  'eink-bordered',
  'h-10 rounded-lg px-4 text-sm font-medium',
  'hover:bg-base-200',
  'transition-colors duration-150',
);

/**
 * Google Drive panel: connect an account, import books from a folder or share
 * link into the local library, and optionally enable two-way library backup
 * (the existing file-sync engine). Import is the default; backup stays off
 * until the user turns the Cloud Sync checkbox on.
 */
const GoogleDriveForm: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.googleDrive;
  const isSyncing = !!stored?.enabled;
  const isConfigured = !!stored?.accountLabel;
  const [isConnecting, setIsConnecting] = useState(false);
  const [showBackup, setShowBackup] = useState(isSyncing);

  const sessionExpired = isSyncing && isWebAppPlatform() && !hasValidWebDriveToken();

  const persistGDrive = async (patch: Partial<typeof stored>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, googleDrive: { ...latest.googleDrive, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const persistAccount = async (accountLabel?: string) => {
    const latest = useSettingsStore.getState().settings;
    const next = {
      ...latest,
      googleDrive: {
        ...latest.googleDrive,
        ...(accountLabel !== undefined ? { accountLabel } : {}),
      },
    };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const activateBackup = async () => {
    await persistCloudProviderEnabled(envConfig, 'gdrive', true);
    setShowBackup(true);
  };

  const handleConnect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const { accountLabel } = await runGoogleDriveConnect();
      await persistAccount(accountLabel ?? undefined);
      eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
    } catch (e) {
      console.warn('[gdrive] connect failed', e);
      eventDispatcher.dispatch('toast', { type: 'error', message: _('Failed to connect') });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await runGoogleDriveDisconnect();
    await persistCloudProviderEnabled(envConfig, 'gdrive', false, (s) => ({
      ...s,
      googleDrive: { ...s.googleDrive, accountLabel: undefined },
    }));
    setShowBackup(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  if (!isConfigured) {
    return (
      <div className='space-y-5'>
        <div className='flex justify-end pt-1'>
          <button
            type='button'
            onClick={handleConnect}
            disabled={isConnecting}
            className={clsx(primaryButtonClass, isConnecting && 'opacity-60')}
          >
            {isConnecting ? (
              <>
                <span className='loading loading-spinner loading-sm' />
                {_('Waiting for sign-in…')}
              </>
            ) : (
              _('Connect')
            )}
          </button>
        </div>
        <Tips>
          <li>{_('Sign-in opens in your browser.')}</li>
          <li>
            {_(
              'Import copies books from a Drive folder or share link into your library. It does not replace your local shelf.',
            )}
          </li>
        </Tips>
      </div>
    );
  }

  return (
    <div className='space-y-5'>
      <p className='text-base-content/70 text-[0.85em]'>
        {_('Connected as {{account}}', { account: stored.accountLabel })}
      </p>

      {sessionExpired ? (
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={handleConnect}
            disabled={isConnecting}
            className={clsx(primaryButtonClass, isConnecting && 'opacity-60')}
          >
            {isConnecting ? _('Waiting for sign-in…') : _('Reconnect')}
          </button>
        </div>
      ) : (
        <DriveBrowsePane />
      )}

      {(isSyncing || showBackup) && (
        <FileSyncForm
          kind='gdrive'
          stored={stored}
          persist={persistGDrive}
          syncNowDisabled={sessionExpired}
        />
      )}

      <div className='flex flex-wrap justify-end gap-2'>
        {!isSyncing && !showBackup && (
          <button type='button' onClick={activateBackup} className={ghostButtonClass}>
            {_('Also back up library to Drive')}
          </button>
        )}
        <button type='button' onClick={handleDisconnect} className={disconnectButtonClass}>
          {_('Disconnect')}
        </button>
      </div>
    </div>
  );
};

export default GoogleDriveForm;
