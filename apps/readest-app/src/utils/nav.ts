import { redirect, useRouter } from 'next/navigation';
import { currentMonitor, getCurrentWindow, ScrollBarStyle } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isPWA, isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
import { AppService } from '@/types/system';

/**
 * Reader-window labels must be unique for the lifetime of the whole process: Tauri
 * refuses to create a second webview with a label that already exists ("a webview
 * with label `reader-0` already exists"), and the window silently fails to open.
 *
 * A module-level counter cannot guarantee that. It only counts windows *this*
 * module instance created, and a dev-server hot reload re-evaluates this module —
 * resetting the counter to 0 while the already-open reader windows are still
 * alive. The next open then re-uses `reader-0` and is rejected. Derive the suffix
 * from the clock plus a random tail instead, so a label can never be reused.
 * Callers identify reader windows by the `reader` prefix, which is preserved.
 */
/**
 * The size an app window opens at when it has no saved size of its own.
 *
 * 800x600 was a size for testing, not for reading: on a desktop it opened a
 * postage stamp next to the library. Aim at a real reading window instead, but
 * never exceed the display's work area — the screen minus taskbar and dock — so
 * a small laptop gets the largest window that still shows its title bar and
 * window controls, rather than one whose bottom edge lands off-screen.
 */
const WINDOW_TARGET_SIZE = { width: 1600, height: 1200 };
const WINDOW_MIN_SIZE = { width: 800, height: 600 };

const defaultWindowSize = async (): Promise<{ width: number; height: number }> => {
  try {
    const monitor = await currentMonitor();
    if (monitor) {
      // The work area is reported in physical pixels; window sizes are logical.
      const factor = monitor.scaleFactor || 1;
      const available = {
        width: monitor.workArea.size.width / factor,
        height: monitor.workArea.size.height / factor,
      };
      return {
        width: Math.round(
          Math.max(
            WINDOW_MIN_SIZE.width,
            Math.min(WINDOW_TARGET_SIZE.width, available.width * 0.96),
          ),
        ),
        height: Math.round(
          Math.max(
            WINDOW_MIN_SIZE.height,
            Math.min(WINDOW_TARGET_SIZE.height, available.height * 0.96),
          ),
        ),
      };
    }
  } catch {
    // Monitor lookup is unavailable on some platforms; the target size is a fine
    // fallback, since window managers fit an oversized window to the screen.
  }
  return { ...WINDOW_TARGET_SIZE };
};

const createReaderWindow = async (appService: AppService, url: string) => {
  const currentWindow = getCurrentWindow();
  const label = currentWindow.label;
  const newLabelPrefix = label === 'main' ? 'reader' : label;
  const uniqueSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const size = await defaultWindowSize();
  const win = new WebviewWindow(`${newLabelPrefix}-${uniqueSuffix}`, {
    url,
    width: size.width,
    height: size.height,
    center: true,
    resizable: true,
    title: 'Readest',
    decorations: !!appService.isMacOSApp,
    // Linux stays opaque: a transparent WebKitGTK window turns invisible when
    // its web process is busy (#3682). macOS uses native decorations instead.
    transparent: !appService.isMacOSApp && !appService.isLinuxApp,
    shadow: appService.isMacOSApp ? undefined : true,
    titleBarStyle: appService.isMacOSApp ? 'overlay' : undefined,
    // Enum ScrollBarStyle is exported as type by tauri, so it cannot be used directly.
    scrollBarStyle: (appService.osPlatform === 'windows'
      ? 'fluentOverlay'
      : 'default') as unknown as ScrollBarStyle,
  });
  win.once('tauri://created', () => {
    console.log('new window created');
  });
  win.once('tauri://error', (e) => {
    console.error('error creating window', e);
  });
};

export const showReaderWindow = async (
  appService: AppService,
  bookIds: string[],
  queryParams?: string,
) => {
  const ids = bookIds.join(BOOK_IDS_SEPARATOR);
  const params = new URLSearchParams(queryParams || '');
  params.set('ids', ids);
  const url = `/reader?${params.toString()}`;
  await createReaderWindow(appService, url);
};

export const showLibraryWindow = async (appService: AppService, filenames: string[]) => {
  const params = new URLSearchParams();
  filenames.forEach((filename) => params.append('file', filename));
  const url = `/library?${params.toString()}`;
  await createReaderWindow(appService, url);
};

// Bring the main library window back when a reader window asks to "go to library".
// If main was hidden (macOS close-to-hide) we re-show it. If it was destroyed
// (Windows/Linux default close), we recreate a window with the same 'main'
// label so the existing emitTo('main', 'close-reader-window', ...) wiring
// continues to work.
export const ensureMainLibraryWindow = async (appService: AppService) => {
  const existing = await WebviewWindow.getByLabel('main');
  if (existing) {
    await existing.show();
    await existing.unminimize();
    await existing.setFocus();
    return;
  }
  const size = await defaultWindowSize();
  const win = new WebviewWindow('main', {
    url: '/library',
    width: size.width,
    height: size.height,
    center: true,
    resizable: true,
    title: 'Readest',
    decorations: !!appService.isMacOSApp,
    // Linux stays opaque: a transparent WebKitGTK window turns invisible when
    // its web process is busy (#3682). macOS uses native decorations instead.
    transparent: !appService.isMacOSApp && !appService.isLinuxApp,
    shadow: appService.isMacOSApp ? undefined : true,
    titleBarStyle: appService.isMacOSApp ? 'overlay' : undefined,
    scrollBarStyle: (appService.osPlatform === 'windows'
      ? 'fluentOverlay'
      : 'default') as unknown as ScrollBarStyle,
  });
  win.once('tauri://error', (e) => {
    console.error('error recreating main window', e);
  });
};

export const navigateToReader = (
  router: ReturnType<typeof useRouter>,
  bookIds: string[],
  queryParams?: string,
  navOptions?: { scroll?: boolean },
) => {
  const ids = bookIds.join(BOOK_IDS_SEPARATOR);
  if (isWebAppPlatform() && !isPWA()) {
    router.push(`/reader/${ids}${queryParams ? `?${queryParams}` : ''}`, navOptions);
  } else {
    const params = new URLSearchParams(queryParams || '');
    params.set('ids', ids);
    router.push(`/reader?${params.toString()}`, navOptions);
  }
};

export const navigateToLogin = (router: ReturnType<typeof useRouter>) => {
  const pathname = window.location.pathname;
  const search = window.location.search;
  const currentPath = pathname !== '/auth' ? pathname + search : '/';
  router.push(`/auth?redirect=${encodeURIComponent(currentPath)}`);
};

export const navigateToProfile = (router: ReturnType<typeof useRouter>) => {
  router.push('/user');
};

export const navigateToLibrary = (
  router: ReturnType<typeof useRouter>,
  queryParams?: string,
  navOptions?: { scroll?: boolean },
  navBack?: boolean,
) => {
  const lastLibraryParams =
    typeof window !== 'undefined' ? sessionStorage.getItem('lastLibraryParams') : null;
  if (navBack && lastLibraryParams) {
    queryParams = lastLibraryParams;
  }

  router.replace(`/library${queryParams ? `?${queryParams}` : ''}`, navOptions);
};

// Recovery action when a reader has nothing to display — e.g. all books were
// closed, or a book failed to load in a freshly-opened reader window.
// In a dedicated reader window we close the window itself, ensuring the main
// library window is visible first; routing the reader window to /library
// instead would leave a leftover window the user has to close manually.
// In the main window or on web, fall back to /library navigation.
export const closeReaderWindowOrGoToLibrary = async (
  appService: AppService | null,
  router: ReturnType<typeof useRouter>,
) => {
  if (isTauriAppPlatform() && appService?.hasWindow) {
    const currentWindow = getCurrentWindow();
    if (currentWindow.label !== 'main') {
      await ensureMainLibraryWindow(appService);
      await currentWindow.close();
      return;
    }
  }
  navigateToLibrary(router, '', undefined, true);
};

export const redirectToLibrary = () => {
  redirect('/library');
};

export const navigateToResetPassword = (router: ReturnType<typeof useRouter>) => {
  const pathname = window.location.pathname;
  const search = window.location.search;
  const currentPath = pathname !== '/auth' ? pathname + search : '/';
  router.push(`/auth/recovery?redirect=${encodeURIComponent(currentPath)}`);
};

export const navigateToUpdatePassword = (router: ReturnType<typeof useRouter>) => {
  const pathname = window.location.pathname;
  const search = window.location.search;
  const currentPath = pathname !== '/auth' ? pathname + search : '/';
  router.push(`/auth/update?redirect=${encodeURIComponent(currentPath)}`);
};
