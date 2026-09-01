import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { DEFAULT_LAN_HOME_SETTINGS } from '@/services/constants';
import { getLanHomeHostStatus, startLanHomeHost, stopLanHomeHost } from '@/services/lanHome/native';
import { LAN_HOME_DEFAULT_PORT, newLanHomeToken } from '@/services/lanHome/protocol';
import { syncFromLanHome } from '@/services/lanHome/sync';

/**
 * Keep the LAN home-library host running when the desktop setting is on,
 * and pull from a configured PC when this device is a client (library
 * open / window focus). Failures stay quiet after the first toast-less warn.
 */
export const useLanHome = (enabled: boolean) => {
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const lan = { ...DEFAULT_LAN_HOME_SETTINGS, ...settings.lanHome };
  const syncing = useRef(false);

  useEffect(() => {
    if (!enabled || !isTauriAppPlatform() || !appService?.isDesktopApp) return;
    if (!lan.hostEnabled) {
      void stopLanHomeHost().catch(() => undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const already = await getLanHomeHostStatus();
        if (already.running || cancelled) return;
        const latest = useSettingsStore.getState().settings;
        const slice = { ...DEFAULT_LAN_HOME_SETTINGS, ...latest.lanHome };
        let token = slice.token;
        if (!token) {
          token = newLanHomeToken();
          const next = { ...latest, lanHome: { ...slice, token } };
          setSettings(next);
          await saveSettings(envConfig, next);
        }
        const booksDir = latest.localBooksDir;
        if (!booksDir) return;
        await startLanHomeHost({
          booksDir,
          token,
          port: slice.hostPort || LAN_HOME_DEFAULT_PORT,
          name: slice.hostName || 'Readest PC',
        });
      } catch (e) {
        console.warn('[lan-home] host start failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    lan.hostEnabled,
    lan.hostPort,
    lan.token,
    appService,
    envConfig,
    saveSettings,
    setSettings,
  ]);

  useEffect(() => {
    if (!enabled || !isTauriAppPlatform()) return;
    if (!lan.clientEnabled || !lan.clientHost || !(lan.clientToken || lan.token)) return;

    const run = async () => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        const app = await envConfig.getAppService();
        await syncFromLanHome({
          host: lan.clientHost!,
          port: lan.clientPort || LAN_HOME_DEFAULT_PORT,
          token: (lan.clientToken || lan.token).trim(),
          appService: app,
          settings: useSettingsStore.getState().settings,
          isLoggedIn: !!user,
        });
      } catch (e) {
        console.warn('[lan-home] client sync failed', e);
      } finally {
        syncing.current = false;
      }
    };

    void run();
    const onFocus = () => void run();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [
    enabled,
    lan.clientEnabled,
    lan.clientHost,
    lan.clientPort,
    lan.clientToken,
    lan.token,
    envConfig,
    user,
  ]);
};
