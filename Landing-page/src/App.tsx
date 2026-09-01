import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Cloud,
  Database,
  FolderOpen,
  GitFork,
  HardDrive,
  Laptop,
  Menu,
  Moon,
  Pause,
  Play,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Tablet,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import {
  covers,
  GoogleDriveMock,
  HomeLibrarySettingsMock,
  InteractiveLibraryWindow,
  ReaderSettingsMock,
  TTSPlayerMock,
} from './components/ShowcaseMocks';
import KokoroWaves from './components/KokoroWaves';
import { toggleVoiceSample, useVoiceSample, voiceSamples } from './voiceSamples';
const GITHUB_URL = 'https://github.com/CodeUpdaterBot/StreamStein';
const RELEASES_API = 'https://api.github.com/repos/CodeUpdaterBot/StreamStein/releases/latest';
const RELEASES_PAGE = `${GITHUB_URL}/releases/latest`;
const LibraryFlowScene = lazy(() => import('./components/LibraryFlowScene'));

function WindowsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.5 10.2 4.4v6.9H3V5.5Zm8.4-1.3L21 3v8.3h-9.6V4.2ZM3 13.3h7.2v6.9L3 18.9v-5.6Zm8.4 0H21V21l-9.6-1.4v-6.3Z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.3 9.2c-.7 0-1.2.5-1.2 1.2v5.4c0 .7.5 1.2 1.2 1.2s1.2-.5 1.2-1.2v-5.4c0-.7-.5-1.2-1.2-1.2Zm11.4 0c-.7 0-1.2.5-1.2 1.2v5.4c0 .7.5 1.2 1.2 1.2s1.2-.5 1.2-1.2v-5.4c0-.7-.5-1.2-1.2-1.2ZM8.2 8.4h7.6c.5 0 .9.4.9.9v8.2c0 .8-.7 1.5-1.5 1.5h-.4v1.7c0 .7-.5 1.2-1.2 1.2s-1.2-.5-1.2-1.2V19H11v1.5c0 .7-.5 1.2-1.2 1.2s-1.2-.5-1.2-1.2V19h-.4c-.8 0-1.5-.7-1.5-1.5V9.3c0-.5.4-.9.9-.9Zm1.1-3.2.6 1.1c.7-.3 1.4-.4 2.1-.4s1.4.1 2.1.4l.6-1.1.9.5-.6 1.1A5.4 5.4 0 0 1 17.4 8H6.6c.4-.7.9-1.3 1.6-1.8L7.6 5.1l.9-.5.8 1.6ZM9.6 6.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Zm4.8 0a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.7 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9-.7 0-1.9-.8-3.1-.8-1.6 0-3.1 1-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.4 1.2 0 1.6-.8 3.1-.8s1.8.8 3.1.8c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.6-3.9ZM14.8 6.3c.7-.8 1.1-1.9 1-3-.9 0-2 .6-2.7 1.4-.6.7-1.2 1.9-1 3 1 .1 2 .5 2.7.6Z" />
    </svg>
  );
}

function DownloadButtons() {
  const [windowsUrl, setWindowsUrl] = useState(RELEASES_PAGE);
  const [androidUrl, setAndroidUrl] = useState(RELEASES_PAGE);
  const [appleOpen, setAppleOpen] = useState(false);

  useEffect(() => {
    if (!appleOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAppleOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appleOpen]);

  useEffect(() => {
    let cancelled = false;
    fetch(RELEASES_API)
      .then((response) => (response.ok ? response.json() : null))
      .then((release) => {
        if (cancelled || !release?.assets) return;
        const assets = release.assets as Array<{ name: string; browser_download_url: string }>;
        const exe =
          assets.find((asset) => /\.exe$/i.test(asset.name) && /x64|setup|windows/i.test(asset.name)) ??
          assets.find((asset) => /\.exe$/i.test(asset.name));
        const apk = assets.find((asset) => /\.apk$/i.test(asset.name));
        if (exe) setWindowsUrl(exe.browser_download_url);
        if (apk) setAndroidUrl(apk.browser_download_url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="hero-actions download-actions">
        <a className="button button-warm" href={windowsUrl} {...(windowsUrl.includes('/download/') ? { download: true } : {})}>
          <WindowsIcon />
          Windows
        </a>
        <a className="button button-warm" href={androidUrl} {...(androidUrl.includes('/download/') ? { download: true } : {})}>
          <AndroidIcon />
          Android
        </a>
        <button type="button" className="button button-warm" onClick={() => setAppleOpen(true)}>
          <AppleIcon />
          Apple
        </button>
        <a className="button button-warm" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <GitFork size={15} />
          GitHub
        </a>
      </div>
      {appleOpen ? (
        <div className="apple-modal-backdrop" role="presentation" onClick={() => setAppleOpen(false)}>
          <div
            className="apple-modal"
            role="dialog"
            aria-labelledby="apple-build-title"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="apple-build-title">Build Apple apps from source</h3>
            <p>
              There is no prebuilt Mac or iPhone installer here. Apple requires a Mac and signing
              certificates, so install by cloning the repository and building from source.
            </p>
            <div className="hero-actions">
              <a className="button button-warm" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GitFork size={15} />
                Open GitHub
              </a>
              <button type="button" className="button button-ghost-light" onClick={() => setAppleOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: 'light' | 'dark';
  onToggle: () => void;
}) {
  return (
    <button
      className="icon-button"
      onClick={onToggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function Header({
  theme,
  onThemeToggle,
}: {
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="ReadStein home">
        <span className="brand-mark">
          <BookOpen size={18} strokeWidth={1.8} />
        </span>
        <span>ReadStein</span>
      </a>

      <nav className={menuOpen ? 'nav-links nav-links-open' : 'nav-links'} aria-label="Main">
        <a href="#story" onClick={() => setMenuOpen(false)}>
          Philosophy
        </a>
        <a href="#home-library" onClick={() => setMenuOpen(false)}>
          Home Library
        </a>
        <a href="#features" onClick={() => setMenuOpen(false)}>
          Features
        </a>
        <a href="#download" onClick={() => setMenuOpen(false)}>
          Download
        </a>
      </nav>

      <div className="header-actions">
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        <a className="nav-github" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <GitFork size={16} />
          <span>GitHub</span>
        </a>
        <button
          className="mobile-menu-button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </header>
  );
}

function HeroStory() {
  return (
    <section id="hero-story" className="hero-story">
      <div className="hero-sticky" id="top">
        <img className="hero-image" src="/images/hero-library.png" alt="" />
        <div className="hero-shade" />
        <div className="hero-grain" />
        <Suspense fallback={null}>
          <LibraryFlowScene />
        </Suspense>

        <motion.div
          className="hero-copy hero-copy-first"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="eyebrow light-eyebrow">A home for everything you read</p>
          <h1>
            Build a library.
            <br />
            <em>Keep it for good.</em>
          </h1>
          <p className="hero-lede">
            ReadStein turns your computer into a private, enduring home for your books—then carries
            them to every device in the house.
          </p>
          <DownloadButtons />
        </motion.div>
        <div className="scroll-cue">
          <span>Scroll to enter the library</span>
          <ArrowDown size={16} />
        </div>
      </div>
    </section>
  );
}

const showcaseSlides = [
  {
    id: 'shelf',
    eyebrow: 'Your shelf',
    title: 'A library that starts with your books.',
    description:
      'Browse covers, then click Home Library to watch this PC share the collection across the local network.',
    render: () => <InteractiveLibraryWindow />,
  },
  {
    id: 'reader',
    eyebrow: 'Reader controls',
    title: 'Shape every page around the way you read.',
    description:
      'Zoom, spread, auto-scroll, paragraph mode, dark inversion, and sharing stay in the same menu you use while reading.',
    render: () => <ReaderSettingsMock />,
  },
  {
    id: 'listen',
    eyebrow: 'Modern comforts',
    title: 'With modern features & comforts.',
    description:
      'Choose typefaces and sizes for long sessions, then listen in place. On-device Kokoro TTS turns any EPUB or PDF into a private audiobook—voices, speeds, engines, and sleep timers stay on this machine.',
    render: () => <TTSPlayerMock />,
  },
  {
    id: 'drive',
    eyebrow: 'Your cloud',
    title: 'Import from Drive without giving up the shelf.',
    description:
      'Connect Google Drive, browse a folder, and leave backup off until you want it. The local library remains the source of truth.',
    render: () => <GoogleDriveMock />,
  },
  {
    id: 'home',
    eyebrow: 'Home Library',
    title: 'Your computer becomes the library server.',
    description:
      'Share over Wi-Fi, pair by code, find nearby PCs, and silence cloud-quota notices. Books stay on this machine.',
    render: () => <HomeLibrarySettingsMock />,
  },
] as const;

const slideTransition = {
  duration: 0.52,
  ease: [0.22, 1, 0.36, 1] as const,
};

function AppWindow() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [direction, setDirection] = useState(1);
  const dragX = useRef<number | null>(null);
  const active = showcaseSlides[activeSlide]!;

  const navigate = (delta: number) => {
    setDirection(delta);
    setActiveSlide((current) => (current + delta + showcaseSlides.length) % showcaseSlides.length);
  };

  const goTo = (index: number) => {
    if (index === activeSlide) return;
    setDirection(index > activeSlide ? 1 : -1);
    setActiveSlide(index);
  };

  return (
    <div
      className="showcase-carousel"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') navigate(-1);
        if (event.key === 'ArrowRight') navigate(1);
      }}
      aria-roledescription="carousel"
      aria-label="ReadStein product views"
    >
      <div className="showcase-stage">
        <button
          className="showcase-arrow showcase-arrow-left"
          onClick={() => navigate(-1)}
          aria-label="Previous product view"
        >
          <ArrowLeft size={18} />
        </button>
        <div
          className="showcase-viewport"
          aria-live="polite"
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            const target = event.target as HTMLElement;
            if (target.closest('button, input, a, .view-menu, .settings-modal, .tts-sheet, .voice-chip')) return;
            dragX.current = event.clientX;
          }}
          onPointerUp={(event) => {
            if (dragX.current == null) return;
            const delta = event.clientX - dragX.current;
            dragX.current = null;
            if (delta > 56) navigate(-1);
            if (delta < -56) navigate(1);
          }}
          onPointerCancel={() => {
            dragX.current = null;
          }}
        >
          <AnimatePresence initial={false} custom={direction}>
            <motion.div
              className="showcase-slide"
              key={active.id}
              custom={direction}
              initial={{ opacity: 0, x: direction > 0 ? 88 : -88 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction > 0 ? -88 : 88 }}
              transition={slideTransition}
            >
              {active.render()}
            </motion.div>
          </AnimatePresence>
        </div>
        <button
          className="showcase-arrow showcase-arrow-right"
          onClick={() => navigate(1)}
          aria-label="Next product view"
        >
          <ArrowRight size={18} />
        </button>
      </div>

      <div className="showcase-caption">
        <div className="showcase-index">
          <span>{String(activeSlide + 1).padStart(2, '0')}</span>
          <i />
          <span>{String(showcaseSlides.length).padStart(2, '0')}</span>
        </div>
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            className="showcase-caption-copy"
            key={`caption-${activeSlide}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            <small>{active.eyebrow}</small>
            <h3>{active.title}</h3>
            <p>{active.description}</p>
          </motion.div>
        </AnimatePresence>
        <div className="showcase-dots" role="tablist" aria-label="Product views">
          {showcaseSlides.map((slide, index) => (
            <button
              key={slide.id}
              className={index === activeSlide ? 'active' : ''}
              onClick={() => goTo(index)}
              aria-label={`Show ${slide.eyebrow}`}
              aria-selected={index === activeSlide}
              role="tab"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductProof() {
  return (
    <section className="section product-proof" id="story">
      <div className="section-heading split-heading">
        <div>
          <p className="eyebrow">Designed around ownership</p>
          <h2>
            A reader that feels
            <br />
            like <em>your library.</em>
          </h2>
        </div>
        <p>
          The calm, focused reading experience of Readest—reframed around a simple idea: the books
          you collect should remain under your control. Browse the shelf, open the reader, listen
          with Kokoro, then look at Drive and Home Library.
        </p>
      </div>
      <AppWindow />
    </section>
  );
}

const deviceCards = [
  { icon: Laptop, label: 'Laptop', note: 'Coped from Master Library' },
  { icon: Smartphone, label: 'Your phone', note: 'Reads and tracks progress' },
  { icon: Tablet, label: 'Your tablet', note: 'Another seat in the library' },
];

function HomeNetwork() {
  return (
    <section className="home-library-band" id="home-library">
      <div className="home-library-rule" aria-hidden="true" />
      <div className="section home-network">
      <div className="network-copy">
        <p className="eyebrow">Home Library</p>
        <h2>
          One collection.
          <br />
          <em>Every room.</em>
        </h2>
        <p className="section-lede">
          Keep the desktop app open with sharing on and it becomes a quiet library server.
          ReadStein devices open on the same network discover it, copy missing books, and reconcile
          reading progress.
        </p>
        <ul className="check-list">
          <li>
            <Check size={16} /> No hosted-storage quota
          </li>
          <li>
            <Check size={16} /> No separate server to maintain
          </li>
          <li>
            <Check size={16} /> Book files move over your LAN
          </li>
          <li>
            <Check size={16} /> Sync when both apps are open
          </li>
        </ul>
      </div>

      <div className="network-orbit" aria-label="Home Library network diagram">
        <div className="orbit-ring orbit-ring-one" />
        <div className="orbit-ring orbit-ring-two" />
        <div className="orbit-core">
          <div className="core-glow" />
          <Server size={31} />
          <strong>Home Library</strong>
          <small>Holds the master library</small>
        </div>
        {deviceCards.map(({ icon: Icon, label, note }, index) => (
          <motion.div
            className={`orbit-device orbit-device-${index + 1}`}
            key={label}
            initial={{ opacity: 0, scale: 0.85 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-10%' }}
            transition={{ delay: 0.18 + index * 0.12 }}
          >
            <Icon size={21} />
            <div>
              <strong>{label}</strong>
              <small>{note}</small>
            </div>
          </motion.div>
        ))}
        <div className="orbit-pulse pulse-one" />
        <div className="orbit-pulse pulse-two" />
      </div>
      </div>
    </section>
  );
}

function ImageStatement() {
  return (
    <section className="image-statement">
      <img
        src="/images/home-library-lifestyle-clean.png"
        alt="A home library shared from a computer to a phone and tablet"
      />
      <div className="image-statement-shade" />
      <div className="image-statement-copy">
        <p className="eyebrow light-eyebrow">Private by proximity</p>
        <h2>
          The cloud is convenient.
          <br />
          <em>Home is yours.</em>
        </h2>
        <p>
          Use your own computer as the center of the reading experience. Your library can remain
          useful even when you choose not to rent space for it elsewhere.
        </p>
      </div>
    </section>
  );
}

function CloudSection() {
  return (
    <section className="section cloud-section" id="features">
      <div className="section-heading centered-heading">
        <p className="eyebrow">Bring your own cloud</p>
        <h2>
          Open doors,
          <br />
          <em>not paywalls.</em>
        </h2>
        <p>
          Import books from services you already use. Google Drive, WebDAV, S3-compatible storage,
          and OneDrive sit alongside Home Library—not in front of it.
        </p>
      </div>
      <div className="provider-rail">
        {[
          { icon: Cloud, name: 'Google Drive', detail: 'Browse, import & optional backup' },
          { icon: FolderOpen, name: 'WebDAV', detail: 'Your server, your credentials' },
          { icon: Database, name: 'S3 storage', detail: 'R2, S3, MinIO and more' },
          { icon: HardDrive, name: 'OneDrive', detail: 'Personal app-folder sync' },
        ].map(({ icon: Icon, name, detail }, index) => (
          <motion.article
            className="provider-card"
            key={name}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-8%' }}
            transition={{ delay: index * 0.07 }}
          >
            <span className="provider-icon">
              <Icon size={23} />
            </span>
            <h3>{name}</h3>
            <p>{detail}</p>
          </motion.article>
        ))}
      </div>
      <div className="cloud-note">
        <ShieldCheck size={19} />
        <p>
          <strong>Connect without changing your shelf.</strong> Imports become ordinary local
          books; backup remains an explicit choice.
        </p>
      </div>
    </section>
  );
}

function VoiceChip({
  id,
  name,
  detail,
}: {
  id: (typeof voiceSamples)[number]['id'];
  name: string;
  detail: string;
}) {
  const playing = useVoiceSample(id);

  return (
    <div className={playing ? 'voice-chip is-playing' : 'voice-chip'}>
      <button
        type="button"
        aria-label={playing ? `Pause ${name}` : `Play ${name} sample`}
        onClick={() => toggleVoiceSample(id)}
      >
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
      <span>
        <strong>Kokoro • {name}</strong>
        <small>{detail}</small>
      </span>
      <span className={playing ? 'mini-wave is-playing' : 'mini-wave'}>
        {Array.from({ length: 18 }, (_, index) => (
          <i key={index} style={{ height: `${5 + ((index * 7) % 14)}px` }} />
        ))}
      </span>
    </div>
  );
}

function ListenSection() {
  return (
    <section className="listen-section">
      <div className="listen-image">
        <img src="/images/kokoro-tts-clean.png" alt="" />
      </div>
      <div className="listen-overlay" />
      <KokoroWaves />
      <div className="listen-copy">
        <span className="feature-symbol">
          <Volume2 size={22} />
        </span>
        <p className="eyebrow light-eyebrow">Kokoro neural TTS</p>
        <h2>
          Listen locally.
          <br />
          <em>Library locally.</em>
        </h2>
        <p>
          Natural English voices synthesized on-device, thoughtfully buffered playback, and
          controls that stay close without getting between you and the page. Press play to hear
          Heart, Bella, and Michael.
        </p>
        <div className="voice-stack">
          {voiceSamples.map((voice) => (
            <VoiceChip key={voice.id} id={voice.id} name={voice.name} detail={voice.detail} />
          ))}
        </div>
      </div>
    </section>
  );
}

const integrationRows = [
  { icon: Cloud, name: 'Google Drive', status: 'Connected', active: true },
  { icon: FolderOpen, name: 'WebDAV', status: 'Not connected', active: false },
  { icon: Database, name: 'S3 Storage', status: 'Not connected', active: false },
  { icon: HardDrive, name: 'OneDrive', status: 'Not connected', active: false },
];

function MiniSwitch({ active = false }: { active?: boolean }) {
  return (
    <span className={active ? 'mini-switch mini-switch-active' : 'mini-switch'}>
      <i />
    </span>
  );
}

function ProductTour() {
  return (
    <section className="section product-tour">
      <div className="section-heading split-heading">
        <div>
          <p className="eyebrow">The details matter</p>
          <h2>
            Useful power,
            <br />
            <em>quietly arranged.</em>
          </h2>
        </div>
        <p>
          Every capability lives in the same calm interface—from pairing the computer in your study
          to choosing the neural voice in your pocket.
        </p>
      </div>

      <div className="product-tour-grid">
        <motion.article
          className="tour-card integrations-tour"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
        >
          <div className="tour-card-heading">
            <div>
              <span className="tour-kicker">DESKTOP</span>
              <h3>Every connection in one place.</h3>
            </div>
            <span className="tour-badge">
              <Cloud size={13} /> No subscription
            </span>
          </div>
          <div className="settings-shell">
            <div className="settings-tabs">
              {[BookOpen, Sparkles, ShieldCheck, Wifi, Volume2].map((Icon, index) => (
                <span className={index === 3 ? 'active' : ''} key={index}>
                  <Icon size={16} />
                </span>
              ))}
            </div>
            <div className="settings-content">
              <div className="settings-title">
                <div>
                  <small>INTEGRATIONS</small>
                  <h4>Cloud Sync</h4>
                </div>
                <button aria-label="Close settings">×</button>
              </div>
              <div className="settings-group">
                {integrationRows.map(({ icon: Icon, name, status, active }) => (
                  <div className="settings-row" key={name}>
                    <span className="settings-row-icon">
                      <Icon size={16} />
                    </span>
                    <div>
                      <strong>{name}</strong>
                      <small>{status}</small>
                    </div>
                    <MiniSwitch active={active} />
                    <i className="row-arrow">›</i>
                  </div>
                ))}
              </div>
              <small className="settings-label">HOME LIBRARY</small>
              <div className="settings-group">
                <div className="settings-row">
                  <span className="settings-row-icon home">
                    <Server size={16} />
                  </span>
                  <div>
                    <strong>This PC / local network</strong>
                    <small>Sharing • 82 books</small>
                  </div>
                  <MiniSwitch active />
                  <i className="row-arrow">›</i>
                </div>
              </div>
            </div>
          </div>
        </motion.article>

        <motion.article
          className="tour-card tts-tour"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ delay: 0.1 }}
        >
          <div className="tour-card-heading">
            <div>
              <span className="tour-kicker">MOBILE</span>
              <h3>A voice that lives on-device.</h3>
            </div>
          </div>
          <div className="phone-frame">
            <div className="phone-island" />
            <div className="phone-header">
              <span>‹</span>
              <strong>Read Aloud</strong>
              <span>•••</span>
            </div>
            <div className="phone-setting-title">VOICE ENGINE</div>
            <div className="phone-settings">
              <div>
                <span>
                  <strong>Engine</strong>
                  <small>Run speech locally</small>
                </span>
                <b>On-device⌄</b>
              </div>
              <div>
                <span>
                  <strong>Model Size</strong>
                  <small>86 MB download</small>
                </span>
                <b>Small⌄</b>
              </div>
              <div>
                <span>
                  <strong>Acceleration</strong>
                  <small>Available</small>
                </span>
                <b className="gpu-chip">GPU · WebGPU</b>
              </div>
            </div>
            <div className="phone-setting-title">PLAYBACK</div>
            <div className="phone-settings">
              <div>
                <span>
                  <strong>Voice</strong>
                  <small>American English</small>
                </span>
                <b>Heart⌄</b>
              </div>
              <div>
                <span>
                  <strong>Start position</strong>
                  <small>When Listen is tapped</small>
                </span>
                <b>Visible page⌄</b>
              </div>
            </div>
            <div className="phone-player">
              <button aria-label="Play">
                <Play size={14} fill="currentColor" />
              </button>
              <span>
                <strong>The Orchard</strong>
                <small>Kokoro • Heart</small>
              </span>
              <b>1.0×</b>
            </div>
          </div>
        </motion.article>

        <motion.article
          className="tour-card appearance-tour"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
        >
          <div className="appearance-copy">
            <span className="tour-kicker">APPEARANCE</span>
            <h3>At home in every light.</h3>
            <p>
              Warm in the afternoon, focused after dark. Reader themes and the library interface
              adapt without losing their sense of place.
            </p>
            <div className="appearance-pills">
              <span>
                <Sun size={13} /> Light
              </span>
              <span>
                <Moon size={13} /> Dark
              </span>
            </div>
          </div>
          <div className="theme-previews">
            <div className="theme-window theme-window-light">
              <div className="theme-window-bar">
                <i />
                <span>My Library</span>
                <b>•••</b>
              </div>
              <div className="theme-books">
                {covers.slice(0, 4).map(([title, , className]) => (
                  <div key={title}>
                    <span className={className} />
                    <small>{title}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="theme-window theme-window-dark">
              <div className="theme-window-bar">
                <i />
                <span>My Library</span>
                <b>•••</b>
              </div>
              <div className="theme-books">
                {covers.slice(4, 8).map(([title, , className]) => (
                  <div key={title}>
                    <span className={className} />
                    <small>{title}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.article>
      </div>
    </section>
  );
}

function Principles() {
  return (
    <section className="section principles">
      <div className="section-heading split-heading">
        <div>
          <p className="eyebrow">Made to last</p>
          <h2>
            Software for a
            <br />
            <em>long-lived shelf.</em>
          </h2>
        </div>
        <p>
          Collections grow slowly. ReadStein is designed to respect that timescale: local-first,
          interoperable, and transparent.
        </p>
      </div>
      <div className="principle-grid">
        {[
          {
            number: '01',
            icon: HardDrive,
            title: 'Local by default',
            copy: 'Books live on hardware you control. Cloud services are additions, never prerequisites.',
          },
          {
            number: '02',
            icon: Wifi,
            title: 'Close-range sync',
            copy: 'At home, devices meet directly across your Wi-Fi and pull what is missing.',
          },
          {
            number: '03',
            icon: Sparkles,
            title: 'Quietly capable',
            copy: 'Neural narration and thoughtful controls arrive without turning reading into a dashboard.',
          },
          {
            number: '04',
            icon: GitFork,
            title: 'Open source',
            copy: 'Built as an independent fork of Readest under the GNU AGPL, with upstream credited.',
          },
        ].map(({ number, icon: Icon, title, copy }) => (
          <article className="principle-card" key={number}>
            <div className="principle-top">
              <span>{number}</span>
              <Icon size={22} />
            </div>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="final-cta" id="download">
      <img src="/images/warm-study-library.png" alt="" />
      <div className="final-cta-shade" />
      <div className="final-cta-content">
        <img className="cta-icon" src="/images/app-icon.png" alt="ReadStein book icon" />
        <p className="eyebrow light-eyebrow">The next chapter is yours</p>
        <h2>
          Bring your library
          <br />
          <em>home again.</em>
        </h2>
        <p>
          Begin on your desktop. Add the devices you read on. Keep the collection you build.
        </p>
        <DownloadButtons />
        <small>Windows and Android installers download directly. Apple apps are built from source.</small>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <span className="brand-mark">
          <BookOpen size={18} strokeWidth={1.8} />
        </span>
        <div>
          <strong>ReadStein</strong>
          <small>Your library, kept close.</small>
        </div>
      </div>
      <div className="footer-links">
        <a href="#story">Philosophy</a>
        <a href="#home-library">Home Library</a>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          Source
        </a>
      </div>
      <p>
        An independent fork of{' '}
        <a href="https://github.com/readest/readest" target="_blank" rel="noreferrer">
          Readest
        </a>
        . Licensed under GNU AGPL v3.
      </p>
    </footer>
  );
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('readstein-theme') ?? localStorage.getItem('reedagain-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('readstein-theme', theme);
  }, [theme]);

  return (
    <>
      <Header theme={theme} onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <main>
        <HeroStory />
        <ProductProof />
        <HomeNetwork />
        <ImageStatement />
        <CloudSection />
        <ListenSection />
        <ProductTour />
        <Principles />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
