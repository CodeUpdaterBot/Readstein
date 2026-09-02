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
import { lanHomeHello } from '@/services/lanHome/client';
import { syncFromLanHome } from '@/services/lanHome/sync';
import {
  LAN_HOME_DEFAULT_PORT,
  newLanHomeToken,
  type LanHomePeer,
} from '@/services/lanHome/protocol';
import { BoxedList, SettingsInput, SettingsRow, SettingsSwitchRow, Tips } from '../primitives';

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

  const testAndSync = async () => {
    const host = lan.clientHost?.trim();
    const port = lan.clientPort || LAN_HOME_DEFAULT_PORT;
    const token = (lan.clientToken || lan.token || '').trim();
    if (!host || !token) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Enter the PC address and pairing code first.'),
      });
      return;
    }
    setBusy(true);
    try {
      const hello = await lanHomeHello(host, port, token);
      const app = await envConfig.getAppService();
      const result = await syncFromLanHome({
        host,
        port,
        token,
        appService: app,
        settings: useSettingsStore.getState().settings,
        isLoggedIn: !!user,
      });
      await persist({ lastSyncedAt: Date.now(), clientEnabled: true });
      const extra = result.errors[0] ? ` ${result.errors[0]}` : '';
      eventDispatcher.dispatch('toast', {
        type: result.errors.length ? 'warning' : 'info',
        message: _(
          'Synced with {{name}}: {{n}} added, {{t}} updated, {{c}} covers, {{d}} removed.{{extra}}',
          {
            name: hello.name,
            n: result.imported,
            t: result.titlesUpdated,
            c: result.coversUpdated,
            d: result.removed,
            extra,
          },
        ),
      });
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
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
              type='number'
              value={String(lan.hostPort || LAN_HOME_DEFAULT_PORT)}
              onChange={(e) =>
                void persist({ hostPort: Number(e.target.value) || LAN_HOME_DEFAULT_PORT })
              }
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
            placeholder='192.168.1.10'
            onChange={(e) => void persist({ clientHost: e.target.value })}
          />
        </SettingsRow>
        <SettingsRow label={_('Port')}>
          <SettingsInput
            type='number'
            value={String(lan.clientPort || LAN_HOME_DEFAULT_PORT)}
            onChange={(e) =>
              void persist({ clientPort: Number(e.target.value) || LAN_HOME_DEFAULT_PORT })
            }
          />
        </SettingsRow>
        <SettingsRow label={_('Pairing code')}>
          <SettingsInput
            value={lan.clientToken ?? ''}
            placeholder={_('Code shown on the PC')}
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
          className={clsx(primaryButtonClass, busy && 'opacity-60')}
          onClick={() => void testAndSync()}
          disabled={busy}
        >
          {busy ? _('Syncing…') : _('Sync now')}
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
          label={_('Silence Readest Cloud storage notices')}
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
    </div>
  );
};

export default LanHomeForm;
