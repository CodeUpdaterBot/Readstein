import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdClose, MdDownload } from 'react-icons/md';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { kokoroModelStore, type KokoroModelState } from '@/services/tts/kokoro/modelStore';
import { shouldShowDownloadProgress } from '@/services/tts/kokoro/downloadProgress';
import {
  downloadSizeMB,
  isOnDeviceLanguageSupported,
  resolveOnDeviceModel,
} from '@/services/tts/onDeviceCatalog';

type TTSModelBannerProps = {
  bookKey: string;
};

/**
 * Non-blocking prompt to download the on-device Kokoro voice. Shown when the
 * book language is English, the model is not yet downloaded, and the user has
 * not dismissed the banner. Play always continues on Cloud/System meanwhile.
 */
const TTSModelBanner: React.FC<TTSModelBannerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { safeAreaInsets } = useThemeStore();
  const { getViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const [state, setState] = useState<KokoroModelState>(kokoroModelStore.getState());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => kokoroModelStore.subscribe(setState), []);

  useEffect(() => {
    setDismissed(kokoroModelStore.isBannerDismissed());
  }, []);

  const book = getBookData(bookKey)?.book;
  const viewSettings = getViewSettings(bookKey);
  const lang = book?.primaryLanguage || 'en';
  const engine = viewSettings?.ttsEngine ?? 'auto';
  const sizeMB = downloadSizeMB(resolveOnDeviceModel(state.size));

  const shouldShow =
    !dismissed &&
    isOnDeviceLanguageSupported(state.size, lang) &&
    (engine === 'auto' || engine === 'kokoro') &&
    !kokoroModelStore.isModelDownloaded() &&
    state.status !== 'downloading' &&
    state.status !== 'ready';

  const showProgress = shouldShowDownloadProgress(
    state.status,
    kokoroModelStore.isModelDownloaded(),
  );

  if (!shouldShow && !showProgress) return null;

  const handleDownload = () => {
    void kokoroModelStore.ensureLoaded();
  };

  const handleDismiss = () => {
    kokoroModelStore.dismissBanner();
    setDismissed(true);
  };

  return (
    <div
      className={clsx(
        'absolute left-1/2 z-40 w-[min(420px,calc(100%-2rem))] -translate-x-1/2',
        'pointer-events-auto',
      )}
      style={{ top: `${(safeAreaInsets?.top || 0) + 52}px` }}
    >
      <div
        className={clsx(
          'bg-base-100 border-base-200/80 flex items-start gap-3 rounded-xl border px-3 py-2.5 shadow-lg',
        )}
      >
        <MdDownload className='text-base-content/70 mt-0.5 shrink-0' size={20} aria-hidden />
        <div className='min-w-0 flex-1'>
          {showProgress ? (
            <>
              <p className='text-sm font-medium'>{_('Downloading on-device voice…')}</p>
              <div className='bg-base-300 mt-2 h-1.5 w-full overflow-hidden rounded-full'>
                <div
                  className='bg-primary h-full transition-[width] duration-200'
                  style={{ width: `${Math.round(state.progress * 100)}%` }}
                />
              </div>
              <p className='text-base-content/60 mt-1 text-xs'>
                {Math.round(state.progress * 100)}%
                {state.adapterName
                  ? ` · ${state.adapterName}`
                  : state.gpuAvailable
                    ? ` · ${_('WebGPU')}`
                    : ''}
              </p>
            </>
          ) : (
            <>
              <p className='text-sm font-medium'>
                {_('Download on-device voice (~{{size}} MB) for offline listening', {
                  size: sizeMB,
                })}
              </p>
              <div className='mt-2 flex gap-2'>
                <button type='button' className='btn btn-primary btn-xs' onClick={handleDownload}>
                  {_('Download')}
                </button>
                <button type='button' className='btn btn-ghost btn-xs' onClick={handleDismiss}>
                  {_('Not now')}
                </button>
              </div>
            </>
          )}
        </div>
        {!showProgress && (
          <button
            type='button'
            className='btn btn-ghost btn-xs btn-square shrink-0'
            aria-label={_('Dismiss')}
            onClick={handleDismiss}
          >
            <MdClose size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

export default TTSModelBanner;
