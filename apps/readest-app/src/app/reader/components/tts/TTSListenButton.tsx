import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdMic, MdPlayArrow, MdSettings } from 'react-icons/md';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';
import { getTTSMiniPlayerBottomOffset } from '../../utils/ttsMiniPlayerPosition';
import { isForcedMobileLayout } from '../../utils/mobileLayout';

type TTSListenButtonProps = {
  bookKey: string;
  gridInsets: Insets;
  /** True while a TTS session is active (mini player owns transport). */
  sessionActive: boolean;
  isPlaying: boolean;
  onOpenSettings: () => void;
};

/**
 * Idle listen control. A microphone FAB splits into Play (start TTS) and
 * Settings (engine / voice / speed) so listeners can configure before
 * speaking. During a session the mini player owns transport, so this hides.
 */
const TTSListenButton: React.FC<TTSListenButtonProps> = ({
  bookKey,
  gridInsets,
  sessionActive,
  onOpenSettings,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const { hoveredBookKey, getView, getViewState, getViewSettings, getProgress, bottomBarTab } =
    useReaderStore();
  const iconSize = useResponsiveSize(26);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const viewSettings = getViewSettings(bookKey);
  const viewState = getViewState(bookKey);
  const barVisible = hoveredBookKey === bookKey;
  const forceMobileLayout = isForcedMobileLayout(appService?.isMobile);
  const usesMobileBar = forceMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;
  const safeAreaMargin = appService?.hasSafeAreaInset
    ? (gridInsets.bottom || safeAreaInsets?.bottom || 0) * 0.33
    : 0;

  const bottomOffset = viewSettings
    ? getTTSMiniPlayerBottomOffset(viewSettings, { barVisible, usesMobileBar }) + safeAreaMargin
    : 16 + safeAreaMargin;

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setExpanded(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [expanded]);

  useEffect(() => {
    if (sessionActive) setExpanded(false);
  }, [sessionActive]);

  const startSpeak = useCallback(() => {
    const view = getView(bookKey);
    const progress = getProgress(bookKey);
    if (!view || !progress || !viewState) return;

    if (viewState.ttsEnabled) {
      eventDispatcher.dispatch('tts-stop', { bookKey });
      return;
    }

    let range: Range | undefined;
    let index: number | undefined;
    for (const content of view.renderer.getContents() ?? []) {
      const doc = content.doc as Document | undefined;
      if (!doc || content.index == null) continue;
      const sel = doc.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed && (sel.toString().trim().length ?? 0) > 0) {
        range = sel.getRangeAt(0).cloneRange();
        index = content.index;
        break;
      }
    }

    eventDispatcher.dispatch('tts-speak', {
      bookKey,
      ...(range ? { range, index } : {}),
    });
  }, [bookKey, getProgress, getView, viewState]);

  const handleMicClick = useCallback(() => {
    setExpanded(true);
  }, []);

  const handlePlay = useCallback(() => {
    setExpanded(false);
    startSpeak();
  }, [startSpeak]);

  const handleSettings = useCallback(() => {
    setExpanded(false);
    onOpenSettings();
  }, [onOpenSettings]);

  if (sessionActive) return null;

  const chipClass = clsx(
    'pointer-events-auto flex h-12 w-12 items-center justify-center',
    'bg-base-100 text-base-content',
    'transition-transform active:scale-95',
    'hover:bg-base-200',
  );

  return (
    <div
      ref={rootRef}
      className={clsx(
        'pointer-events-none absolute end-3 z-40 flex',
        bottomBarTab && barVisible ? 'mb-0' : '',
      )}
      style={{ bottom: `${bottomOffset}px` }}
    >
      {expanded ? (
        <div
          className={clsx(
            'pointer-events-auto flex overflow-hidden rounded-full',
            'bg-base-100 shadow-lg',
            'border-base-200/80 border',
          )}
          role='group'
          aria-label={_('Listen')}
        >
          <button
            type='button'
            onClick={handlePlay}
            aria-label={_('Play')}
            title={_('Play')}
            className={chipClass}
          >
            <MdPlayArrow size={iconSize} aria-hidden />
          </button>
          <div className='bg-base-200 w-px self-stretch' aria-hidden />
          <button
            type='button'
            onClick={handleSettings}
            aria-label={_('Speech settings')}
            title={_('Speech settings')}
            className={chipClass}
          >
            <MdSettings size={iconSize} aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type='button'
          onClick={handleMicClick}
          aria-label={_('Listen')}
          title={_('Listen')}
          aria-expanded={false}
          className={clsx(
            chipClass,
            'rounded-full shadow-lg',
            'border-base-200/80 border',
          )}
        >
          <MdMic size={iconSize} aria-hidden />
        </button>
      )}
    </div>
  );
};

export default TTSListenButton;
