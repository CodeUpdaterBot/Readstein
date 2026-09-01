import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ hoveredBookKey: null }),
}));

const { useMiniPlayerAutoHide } = await import('@/app/reader/components/tts/useMiniPlayerAutoHide');

const BOOK = 'book-1';

describe('useMiniPlayerAutoHide', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps the full player visible for the whole session', () => {
    const { result } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'full', true));
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(true);
  });

  it('keeps the minimal player visible for the whole session', () => {
    const { result } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'minimal', true));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(true);
  });

  it('stays visible when remounted after the sheet closes', () => {
    let mounted = true;
    const { result, rerender } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'full', mounted));

    mounted = false;
    rerender();
    mounted = true;
    rerender();
    expect(result.current).toBe(true);
  });
});
