import { useEffect, useState } from 'react';
import type { TTSPlayerStyle } from '@/services/tts/types';

/**
 * Whether the TTS mini player should be on screen.
 *
 * The mini player stays visible for the whole session so Listen controls stay
 * reachable without hunting for the footer hover zone. `playerStyle` only
 * changes visual density (full vs minimal card), not visibility.
 *
 * `mounted` gates the card: when false (sheet open / no session) we still
 * report visible so remounting hands back an on-screen card immediately.
 */
export const useMiniPlayerAutoHide = (
  _bookKey: string,
  _playerStyle: TTSPlayerStyle,
  mounted: boolean,
) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (mounted) setVisible(true);
  }, [mounted]);

  return visible;
};
