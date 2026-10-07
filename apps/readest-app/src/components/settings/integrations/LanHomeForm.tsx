import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { DEFAULT_LAN_HOME_SETTINGS } from '@/services/constants';
import {
  getLanHomeHostStatus,
  scanLanHomePeers,
  startLanHomeHost,
  stopLanHomeHost,
} from '@/services/lanHome/native';
import LanHomeSyncDialog from './LanHomeSyncDialog';
import { isLanHomeSyncing, startLanHomeSync, subscribeLanHomeSync } from '@/services/lanHome/sync';
import {
  LAN_HOME_DEFAULT_PORT,
  newLanHomeToken,
  type LanHomePeer,
} from '@/services/lanHome/protocol';
import { BoxedList, SettingsInput, SettingsRow, SettingsSwitchRow, Tips } from '../primitives';

/**
 * Almost every home router hands out 192.168.1.x, so start the address there and
 * leave the caret at the end: the only thing the user then types is the last group.
 */
const LAN_HOME_ADDRESS_PREFIX = '192.168.1.';

const primaryButtonClass = clsx(
  'btn btn-contrast',
  'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
);

/**
 * Home Library: this PC shares Books/ on the LAN; phones mirror that shelf
 * (adds, titles, covers, deletions) and exchange progress. Separate from
 * Readest Cloud and from Drive import.
 */
const LanHomeForm: React.FC = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const lan = { ...DEFAULT_LAN_HOME_SETTINGS, ...settings.lanHome };
  const isDesktop = !!appService?.isDesktopApp;
  const tauri = isTauriAppPlatform();

  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('');
  const [peers, setPeers] = useState<LanHomePeer[]>([]);
  const [scanning, setScanning] = useState(false);

  const persist = async (patch: Partial<typeof lan>) => {
    const latest = useSettingsStore.getState().settings;
    const next = {
      ...latest,
      lanHome: { ...DEFAULT_LAN_HOME_SETTINGS, ...latest.lanHome, ...patch },
    };
    setSettings(next);
    await saveSettings(envConfig, next);
    return next.lanHome;
  };

  const ensureToken = async () => {
    if (lan.token) return lan.token;
    const token = newLanHomeToken();
    await persist({ token });
    return token;
  };

  const refreshHostStatus = async () => {
    if (!tauri) return;
    try {
      const st = await getLanHomeHostStatus();
      if (st.running) {
        const ip = st.addrs[0] || 'this PC';
        setStatusLine(_('Sharing at {{addr}}:{{port}}', { addr: ip, port: st.port }));
      } else if (lan.hostEnabled) {
        setStatusLine(_('Not sharing yet'));
      } else {
        setStatusLine('');
      }
    } catch {
      setStatusLine('');
    }
  };

  useEffect(() => {
    void refreshHostStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lan.hostEnabled, tauri]);

  // A blank address is the one field nobody can guess, and 192.168.1.x is what almost
  // every home router hands out, so start it there: the caret lands after the prefix and
  // the user types only the last group. They can still clear or replace it entirely.
  useEffect(() => {
    if (isDesktop || !tauri) return;
    if ((lan.clientHost ?? '').trim()) return;
    void persist({ clientHost: LAN_HOME_ADDRESS_PREFIX });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, tauri, lan.clientHost]);

  const startHost = async () => {
    if (!tauri) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Home library sharing needs the desktop app (not the browser).'),
      });
      return;
    }
    setBusy(true);
    try {
      const token = await ensureToken();
      const booksDir = settings.localBooksDir;
      if (!booksDir) throw new Error('Books folder not found');
      const name =
        lan.hostName?.trim() ||
        (typeof window !== 'undefined' ? window.location.hostname : '') ||
        'Readest PC';
      const st = await startLanHomeHost({
        booksDir,
        token,
        port: lan.hostPort || LAN_HOME_DEFAULT_PORT,
        name,
      });
      await persist({ hostEnabled: true, hostPort: st.port, hostName: name, token });
      const ip = st.addrs[0] || 'this PC';
      setStatusLine(_('Sharing at {{addr}}:{{port}}', { addr: ip, port: st.port }));
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Home library is sharing on your network.'),
      });
    } catch (e) {
      await persist({ hostEnabled: false });
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const stopHost = async () => {
    setBusy(true);
    try {
      if (tauri) await stopLanHomeHost();
      await persist({ hostEnabled: false });
      setStatusLine('');
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    if (!tauri) return;
    setScanning(true);
    try {
      setPeers(await scanLanHomePeers());
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setScanning(false);
    }
  };

  const connectPeer = async (peer: LanHomePeer) => {
    await persist({
      clientEnabled: true,
      clientHost: peer.host,
      clientPort: peer.port,
      clientToken: lan.clientToken || lan.token,
    });
  };

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(() => isLanHomeSyncing());

  // The run itself lives in the sync service, so this only mirrors its state — closing the
  // dialog or leaving this screen does not stop it.
  useEffect(() => subscribeLanHomeSync((s) => setSyncing(s.running)), []);

  const openSync = () => {
    if (syncing) {
      setSyncOpen(true);
      return;
    }
    const host = (lan.clientHost ?? '').trim();
    const token = (lan.clientToken || lan.token || '').trim();
    if (!host || !token) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Enter the PC address and pairing code first.'),
      });
      return;
    }
    void persist({ clientEnabled: true });
    setSyncOpen(true);
    void startLanHomeSync({
      host,
      port: lan.clientPort || LAN_HOME_DEFAULT_PORT,
      token,
      appService: appService!,
      settings: useSettingsStore.getState().settings,
      isLoggedIn: !!user,
    });
  };

  return (
    <div className='space-y-5'>
      {isDesktop && (
        <BoxedList>
          <SettingsSwitchRow
            label={_('Share this library on the network')}
            description={
              statusLine ||
              _(
                'Phones on the same Wi-Fi can import books from this PC. Your local shelf stays the source of truth.',
              )
            }
            checked={lan.hostEnabled}
            disabled={busy}
            onChange={() => void (lan.hostEnabled ? stopHost() : startHost())}
          />
          <SettingsRow label={_('Pairing code')}>
            <SettingsInput
              readOnly
              value={lan.token}
              placeholder={_('Generated when sharing starts')}
            />
          </SettingsRow>
          <SettingsRow label={_('Port')}>
            <SettingsInput
              type='text'
              inputMode='numeric'
              pattern='[0-9]*'
              value={String(lan.hostPort || LAN_HOME_DEFAULT_PORT)}
              className='w-20 min-w-0 max-w-[34%] tabular-nums'
              onChange={(e) => {
                const digits = e.target.value.replaceAll(/[^0-9]/g, '').slice(0, 5);
                void persist({ hostPort: digits ? Number(digits) : LAN_HOME_DEFAULT_PORT });
              }}
            />
          </SettingsRow>
        </BoxedList>
      )}

      <BoxedList>
        <SettingsSwitchRow
          label={_('Connect to a home PC')}
          description={_(
            'Match this phone to the PC library on this Wi-Fi — new books, title and cover edits, and removals.',
          )}
          checked={lan.clientEnabled}
          onChange={() => void persist({ clientEnabled: !lan.clientEnabled })}
        />
        <SettingsRow label={_('PC address')}>
          <SettingsInput
            value={lan.clientHost ?? ''}
            placeholder={LAN_HOME_ADDRESS_PREFIX + '10'}
            inputMode='decimal'
            autoComplete='off'
            spellCheck={false}
            className='w-40 min-w-0 max-w-[52%] tabular-nums'
            onChange={(e) => void persist({ clientHost: e.target.value.trim() })}
            // Prefilled with the prefix, so the caret belongs after it: the user only
            // ever types the last group and should not have to move the cursor first.
            onFocus={(e) => {
              const el = e.currentTarget;
              const at = el.value.length;
              requestAnimationFrame(() => el.setSelectionRange(at, at));
            }}
          />
        </SettingsRow>
        <SettingsRow label={_('Port')}>
          <SettingsInput
            type='text'
            inputMode='numeric'
            pattern='[0-9]*'
            value={String(lan.clientPort || LAN_HOME_DEFAULT_PORT)}
            // `min-w-0` matters: a flex item defaults to min-width:auto, so without it the
            // input refuses to shrink below its intrinsic width and the row overflows the
            // card — which is what pushed the port digits off the right edge on phones.
            className='w-20 min-w-0 max-w-[34%] tabular-nums'
            onChange={(e) => {
              const digits = e.target.value.replaceAll(/[^0-9]/g, '').slice(0, 5);
              void persist({ clientPort: digits ? Number(digits) : LAN_HOME_DEFAULT_PORT });
            }}
          />
        </SettingsRow>
        <SettingsRow label={_('Pairing code')}>
          <SettingsInput
            value={lan.clientToken ?? ''}
            placeholder={_('Code shown on the PC')}
            autoComplete='off'
            autoCapitalize='characters'
            spellCheck={false}
            className='w-40 min-w-0 max-w-[52%] uppercase'
            onChange={(e) => void persist({ clientToken: e.target.value.toUpperCase() })}
          />
        </SettingsRow>
      </BoxedList>

      <div className='flex flex-wrap justify-end gap-2'>
        {tauri && (
          <button
            type='button'
            className='eink-bordered h-10 rounded-lg px-4 text-sm font-medium'
            onClick={() => void scan()}
            disabled={scanning}
          >
            {scanning ? _('Looking…') : _('Find PCs on this network')}
          </button>
        )}
        <button
          type='button'
          className={primaryButtonClass}
          onClick={openSync}
          data-testid='lan-home-sync-now'
        >
          {syncing ? _('View sync progress') : _('Sync now')}
        </button>
      </div>

      {peers.length > 0 && (
        <ul className='border-base-200 divide-base-200 divide-y overflow-hidden rounded-lg border'>
          {peers.map((p) => (
            <li key={`${p.host}:${p.port}`}>
              <button
                type='button'
                className='hover:bg-base-200/60 flex w-full items-center justify-between px-4 py-3 text-left'
                onClick={() => void connectPeer(p)}
              >
                <span>
                  <span className='block text-sm'>{p.name}</span>
                  <span className='text-base-content/60 text-[0.85em]'>
                    {p.host}:{p.port}
                  </span>
                </span>
                <span className='text-[0.85em]'>{_('Use this PC')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <BoxedList>
        <SettingsSwitchRow
          label={_('Silence cloud storage notices')}
          description={_(
            'Hide plan-quota alerts. A large local library is not an error when you sync over Home Library.',
          )}
          checked={!!settings.muteReadestCloudQuotaNotices}
          onChange={() => {
            const latest = useSettingsStore.getState().settings;
            const next = {
              ...latest,
              muteReadestCloudQuotaNotices: !latest.muteReadestCloudQuotaNotices,
            };
            setSettings(next);
            void saveSettings(envConfig, next);
          }}
        />
      </BoxedList>

      <Tips>
        <li>
          {_(
            'Keep this desktop app running while you sync from a phone. Windows may ask to allow Readest through the firewall.',
          )}
        </li>
        <li>
          {_(
            'This PC is the home library. Phones match its shelf on sync — adds, title and cover edits, and deletions. Reading progress still merges both ways. There is no Readest Cloud quota.',
          )}
        </li>
      </Tips>

      {syncOpen && (
        <LanHomeSyncDialog
          host={(lan.clientHost ?? '').trim()}
          port={lan.clientPort || LAN_HOME_DEFAULT_PORT}
          onClose={() => setSyncOpen(false)}
        />
      )}
    </div>
  );
};

export default LanHomeForm;
