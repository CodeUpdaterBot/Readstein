import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { parseWebViewInfo } from '@/utils/ua';
import { getAppVersion } from '@/utils/version';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import { FORK_AUTHOR, FORK_AUTHOR_SITE, FORK_GITHUB, UPSTREAM_GITHUB } from '@/utils/fork';
import SupportLinks from './SupportLinks';
import LegalLinks from './LegalLinks';
import Dialog from './Dialog';
import Link from './Link';

export const setAboutDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('about_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const AboutWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [browserInfo, setBrowserInfo] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setBrowserInfo(parseWebViewInfo(appService));

    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('about_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    setIsOpen(false);
  };

  const versionInfo = `${_('Version {{version}}', { version: getAppVersion() })} (${browserInfo})`;

  // Mobile users can't select the version string to paste it into a bug
  // report, so the label itself copies it.
  const handleCopyVersion = async () => {
    const copied = await writeTextToClipboard(versionInfo);
    if (!copied) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to clipboard'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });
  };

  return (
    <Dialog
      id='about_window'
      isOpen={isOpen}
      title={_('About Readstein')}
      onClose={handleClose}
      boxClassName='sm:!w-[480px] sm:!max-w-screen-sm sm:h-auto'
    >
      {isOpen && (
        <div className='about-content flex flex-col items-center justify-center gap-2 pb-8 sm:pb-0'>
          <div className='flex flex-1 flex-col items-center justify-end gap-1 px-6 pb-1 pt-3'>
            <div className='-translate-y-2.5'>
              <Image src='/icon.png' alt='App Logo' className='h-20 w-20' width={80} height={80} />
            </div>
            <div className='flex select-text flex-col items-center'>
              <h2 className='text-2xl font-bold'>{_("It's Readest, Unlimited")}</h2>
              <p className='text-neutral-content mt-0.5 text-xs'>
                {_('a fork of Readest, by')}{' '}
                <Link href={FORK_AUTHOR_SITE} className='text-blue-500 underline'>
                  {FORK_AUTHOR}
                </Link>
              </p>
              <button
                type='button'
                title={_('Copy')}
                className='text-neutral-content mt-1 text-center text-sm'
                onClick={handleCopyVersion}
              >
                {versionInfo}
              </button>
            </div>
            <ul className='text-neutral-content mt-2 max-w-[26rem] space-y-1.5 text-left text-xs leading-snug'>
              <li>
                <span className='text-base-content font-medium'>{_('Home Library.')}</span>{' '}
                {_(
                  'Run the desktop app as a local library server so phones on the same Wi‑Fi can sync books while both apps are open — with no Readest Cloud storage quota.',
                )}
              </li>
              <li>
                <span className='text-base-content font-medium'>{_('Cloud import.')}</span>{' '}
                {_(
                  'Bring in Google Drive and other cloud providers without a paid Readest subscription.',
                )}
              </li>
              <li>
                <span className='text-base-content font-medium'>{_('Kokoro TTS.')}</span>{' '}
                {_('On-device neural voices, plus extra playback controls for smoother listening.')}
              </li>
            </ul>
          </div>

          <hr aria-hidden='true' className='border-base-300 my-8 w-full sm:my-3' />

          <div
            className='flex flex-1 flex-col items-center justify-start gap-1.5 px-4 text-center'
            dir='ltr'
          >
            <p className='text-neutral-content text-xs'>
              {_('Based on Readest by Bilingify LLC')}. {_('Licensed under the')}{' '}
              <Link
                href='https://www.gnu.org/licenses/agpl-3.0.html'
                className='text-blue-500 underline'
              >
                GNU AGPL v3.0
              </Link>
              .{' '}
              {_(
                'This fork is independently modified and does not install official Readest updates.',
              )}
            </p>
            <p className='text-neutral-content text-xs'>
              {_('Original source:')}{' '}
              <Link href={UPSTREAM_GITHUB} className='text-blue-500 underline'>
                GitHub
              </Link>
              .
            </p>
            <p className='text-neutral-content text-xs'>
              {_('New source:')}{' '}
              <Link href={FORK_GITHUB} className='text-blue-500 underline'>
                GitHub
              </Link>
              .
            </p>

            <LegalLinks />
          </div>
          <SupportLinks />
        </div>
      )}
    </Dialog>
  );
};
