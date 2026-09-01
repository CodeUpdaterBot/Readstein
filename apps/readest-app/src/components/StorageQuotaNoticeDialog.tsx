'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RiHomeWifiLine } from 'react-icons/ri';

import ModalPortal from '@/components/ModalPortal';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { STORAGE_QUOTA_NOTICE_EVENT } from '@/utils/cloudErrors';

/**
 * Shown when Readest Cloud object storage rejects uploads (plan quota).
 * Points at Home Library LAN sync instead of a red error toast, and can
 * be silenced for a large local shelf.
 */
const StorageQuotaNoticeDialog: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onNotice = () => {
      const muted = !!useSettingsStore.getState().settings.muteReadestCloudQuotaNotices;
      if (muted) return;
      setOpen(true);
    };
    eventDispatcher.on(STORAGE_QUOTA_NOTICE_EVENT, onNotice);
    return () => eventDispatcher.off(STORAGE_QUOTA_NOTICE_EVENT, onNotice);
  }, []);

  const persistMute = useCallback(async () => {
    const store = useSettingsStore.getState();
    const latest = store.settings;
    if (!latest?.version) return;
    const next = { ...latest, muteReadestCloudQuotaNotices: true };
    store.setSettings(next);
    await store.saveSettings(envConfig, next);
  }, [envConfig]);

  const close = () => setOpen(false);

  const silence = async () => {
    await persistMute();
    close();
  };

  const openHomeLibrary = () => {
    const { setRequestedPanel, setRequestedSubPage, setSettingsDialogOpen } =
      useSettingsStore.getState();
    setRequestedPanel('Integrations');
    setRequestedSubPage('lan-home');
    setSettingsDialogOpen(true);
    close();
  };

  if (!open) return null;

  return (
    <ModalPortal>
      <dialog className='modal modal-open' aria-labelledby='storage-quota-notice-title'>
        <div className='modal-box bg-base-100 w-[min(420px,calc(100vw-2rem))] max-h-[min(90vh,40rem)] overflow-y-auto rounded-2xl p-0'>
          <div className='border-base-content/10 flex flex-col items-center gap-3 border-b px-6 pb-5 pt-7 text-center'>
            <div
              className='eink-bordered bg-base-200 text-base-content/80 flex h-12 w-12 items-center justify-center rounded-full'
              aria-hidden='true'
            >
              <RiHomeWifiLine size={22} />
            </div>
            <h3
              id='storage-quota-notice-title'
              className='text-base-content text-base font-semibold tracking-tight'
            >
              {_('Readest Cloud storage is full')}
            </h3>
            <p className='text-base-content/65 text-[13px] leading-relaxed'>
              {_(
                'Your books stay on this device. Home Library on your PC has no Cloud plan limit — phones on the same Wi-Fi copy titles from this computer.',
              )}
            </p>
          </div>

          <div className='space-y-4 px-6 py-5 text-left'>
            <StepBlock title={_('On this computer')}>
              <Step n={1} text={_('Settings → Integrations → Home Library')} />
              <Step n={2} text={_('Turn on "Share this library on the network"')} />
              <Step
                n={3}
                text={_('Allow Readest in Windows Firewall if asked, and note the pairing code')}
              />
            </StepBlock>
            <StepBlock title={_('On your phone')}>
              <Step n={1} text={_('Use this same Readest app (not the store build)')} />
              <Step n={2} text={_('Settings → Integrations → Home Library')} />
              <Step
                n={3}
                text={_(
                  'Connect to a home PC: enter the PC address, port 17432, and the pairing code, then Sync now',
                )}
              />
            </StepBlock>
            <p className='text-base-content/55 text-[12px] leading-relaxed'>
              {_('Keep the desktop app running on the same Wi-Fi while you sync.')}
            </p>
          </div>

          <div className='border-base-content/10 flex flex-col gap-2 border-t px-6 py-4'>
            <button
              type='button'
              onClick={openHomeLibrary}
              className='btn btn-contrast h-10 min-h-0 rounded-xl text-sm font-medium'
            >
              {_('Open Home Library')}
            </button>
            <button
              type='button'
              onClick={() => void silence()}
              className='eink-bordered text-base-content hover:bg-base-200 h-10 rounded-xl border border-transparent text-sm font-medium transition-colors'
            >
              {_("Don't remind me about Cloud storage")}
            </button>
            <button
              type='button'
              onClick={close}
              className='text-base-content/70 hover:text-base-content h-8 text-center text-[13px] font-medium'
            >
              {_('Close')}
            </button>
          </div>
        </div>
      </dialog>
    </ModalPortal>
  );
};

const StepBlock: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <p className='text-base-content mb-2 text-[13px] font-semibold'>{title}</p>
    <ol className='space-y-2'>{children}</ol>
  </div>
);

const Step: React.FC<{ n: number; text: string }> = ({ n, text }) => (
  <li className='flex items-start gap-2.5'>
    <span className='eink-bordered bg-base-200 text-base-content/80 mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold'>
      {n}
    </span>
    <span className='text-base-content/75 text-[13px] leading-relaxed'>{text}</span>
  </li>
);

export default StorageQuotaNoticeDialog;
