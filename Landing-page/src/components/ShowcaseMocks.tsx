import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  Accessibility,
  AlarmClock,
  AudioLines,
  BookOpen,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns2,
  Contrast,
  Download,
  Folder,
  GalleryVertical,
  Headphones,
  Info,
  Languages,
  LayoutGrid,
  Link2,
  Maximize2,
  Menu,
  Minus,
  Moon,
  Palette,
  Pause,
  Play,
  Plus,
  RectangleVertical,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  Share,
  Smartphone,
  StretchHorizontal,
  Sun,
  Type,
  Volume2,
  Wifi,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toggleVoiceSample, useVoiceSample } from '../voiceSamples';

export const covers = [
  ['The Orchard', 'M. C. Wells', 'cover cover-ochre'],
  ['Northward', 'Elena Voss', 'cover cover-night'],
  ['Still Water', 'James Alder', 'cover cover-sage'],
  ['A Field Guide', 'R. E. Moss', 'cover cover-clay'],
  ['Glass Hours', 'Talia Ren', 'cover cover-cream'],
  ['The Long Way', 'I. K. Rowan', 'cover cover-rust'],
  ['Small Worlds', 'Nora Bell', 'cover cover-forest'],
  ['After Light', 'S. D. Hale', 'cover cover-blue'],
] as const;

function CoverGrid({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'cover-grid cover-grid-compact' : 'cover-grid'}>
      {covers.map(([title, author, className]) => (
        <div className='book-tile' key={title}>
          <div className={className}>
            <span className='cover-flourish'>◆</span>
            <strong>{title}</strong>
            <small>{author}</small>
          </div>
          {!compact && (
            <div className='book-meta'>
              <span>{title}</span>
              <small>{author}</small>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function WindowShell({
  children,
  className = '',
  footer,
}: {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <div className='app-window-wrap'>
      <div className='app-window-glow' />
      <div className={`app-window ${className}`.trim()}>{children}</div>
      {footer}
    </div>
  );
}

function LibraryChrome({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <div className='window-bar'>
        <div className='window-brand'>
          <img src='/images/app-icon.png' alt='' />
          <span>ReadStein</span>
        </div>
        <div className='window-search'>Search in 82 books…</div>
        <div className='window-dots'>
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className='app-body'>
        <div className='app-toolbar'>
          <div className='app-breadcrumb'>
            <span>All</span>
            <i>›</i>
            <strong>Books</strong>
          </div>
          <div className='app-toolbar-actions'>{actions}</div>
        </div>
        <main className='app-stage'>{children}</main>
      </div>
    </>
  );
}

function MockSwitch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle?: () => void;
  label: string;
}) {
  return (
    <button
      type='button'
      className={on ? 'mock-switch on' : 'mock-switch'}
      onClick={onToggle}
      aria-pressed={on}
      aria-label={label}
    >
      <i />
    </button>
  );
}

function MenuRow({
  label,
  shortcut,
  checked,
  icon,
  active,
  onClick,
}: {
  label: string;
  shortcut?: string;
  checked?: boolean;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type='button' className={active ? 'view-row is-on' : 'view-row'} onClick={onClick}>
      <span>{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
      {icon ? <span className='view-row-icon'>{icon}</span> : null}
      {checked ? <Check size={14} strokeWidth={2.4} /> : null}
    </button>
  );
}

export function InteractiveLibraryWindow() {
  const [view, setView] = useState<'library' | 'network' | 'listen'>('library');

  return (
    <WindowShell
      footer={<p className='preview-hint'>Click Home Library to see this PC share the shelf</p>}
    >
      <LibraryChrome
        actions={
          <>
            <button
              className={view === 'library' ? 'active' : ''}
              onClick={() => setView('library')}
              aria-label='Show library preview'
              title='Library'
            >
              <BookOpen size={16} />
            </button>
            <button
              className={view === 'network' ? 'active' : ''}
              onClick={() => setView('network')}
              aria-label='Show Home Library preview'
              title='Home Library'
            >
              <Wifi size={16} />
            </button>
            <button
              className={view === 'listen' ? 'active' : ''}
              onClick={() => setView('listen')}
              aria-label='Show listening preview'
              title='Listen'
            >
              <Headphones size={16} />
            </button>
            <button aria-label='Theme preview' title='Appearance'>
              <Sun size={16} />
            </button>
          </>
        }
      >
        {view === 'library' && (
          <motion.div
            key='library'
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className='app-view'
          >
            <div className='app-view-heading'>
              <div>
                <small>ALL BOOKS</small>
                <h3>Your Library</h3>
              </div>
              <span className='app-count'>82 books</span>
            </div>
            <CoverGrid compact />
          </motion.div>
        )}
        {view === 'network' && (
          <motion.div
            key='network'
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className='app-view network-view'
          >
            <div className='app-view-heading'>
              <div>
                <small>HOME LIBRARY</small>
                <h3>This PC / local network</h3>
              </div>
              <span className='status-pill'>
                <i /> Sharing
              </span>
            </div>
            <div className='network-panel'>
              <div className='network-server'>
                <Server size={26} />
                <strong>Home PC</strong>
                <small>82 books available</small>
              </div>
              <div className='network-beam'>
                <span />
                <Wifi size={22} />
                <span />
              </div>
              <div className='network-device'>
                <Smartphone size={26} />
                <strong>Your phone</strong>
                <small>Last sync: now</small>
              </div>
            </div>
            <p className='network-note'>
              Both devices stay yours. Books travel only across your local network.
            </p>
          </motion.div>
        )}
        {view === 'listen' && (
          <motion.div
            key='listen'
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className='app-view listen-view'
          >
            <div className='reader-page'>
              <small>CHAPTER FOUR</small>
              <h3>The shape of a quiet afternoon</h3>
              <p>
                The room had grown still enough that every turning page seemed to carry its own
                weather…
              </p>
              <p>
                Along the window, afternoon light traced the books that had waited there for years.
              </p>
            </div>
            <div className='listen-player'>
              <button aria-label='Play preview'>
                <Play size={18} fill='currentColor' />
              </button>
              <div>
                <strong>Kokoro • Heart</strong>
                <span className='waveform'>
                  {Array.from({ length: 26 }, (_, index) => (
                    <i key={index} style={{ height: `${7 + ((index * 13) % 17)}px` }} />
                  ))}
                </span>
              </div>
              <span>1.0×</span>
            </div>
          </motion.div>
        )}
      </LibraryChrome>
    </WindowShell>
  );
}

export function ReaderSettingsMock() {
  const [spread, setSpread] = useState<'single' | 'double' | 'scroll'>('double');
  const [cover, setCover] = useState(true);
  const [invert, setInvert] = useState(true);

  return (
    <WindowShell className='reader-window'>
      <header className='reader-topbar'>
        <div className='reader-top-left'>
          <Bookmark size={15} />
          <Headphones size={15} />
        </div>
        <div className='reader-title'>
          <strong>The Orchard</strong>
          <span>M. C. Wells</span>
        </div>
        <div className='reader-top-right'>
          <Search size={15} />
          <Menu size={15} />
          <X size={15} />
        </div>
      </header>

      <div className='reader-stage'>
        <div className='reader-spread'>
          <article className='spread-page'>
            <small>186 · THE ORCHARD</small>
            <h4>IV</h4>
            <p>
              The shelves had learned the house’s weather. Morning light arrived first at the west
              wall, then settled into the spines as if it had always belonged there.
            </p>
            <p>
              She did not inventory the collection so much as visit it. Each title kept a private
              hour: some for rain, some for the last of winter, some for the evenings when the
              windows were left unlatched.
            </p>
            <p>
              Ownership, she had decided, was not the act of purchase. It was the decision to keep a
              book close enough that it could be found in the dark.
            </p>
          </article>
          <article className='spread-page'>
            <small>WELLS · 187</small>
            <p>
              In the next room the lamp made a smaller library of its own—one chair, one table, one
              open page. The rest of the house could wait.
            </p>
            <p>
              A reader who keeps a library is not collecting objects. They are keeping a room they
              can return to, even when the room itself has changed.
            </p>
            <p>That was the quiet work: not more books, but a place the books could remain.</p>
          </article>
        </div>

        <aside className='view-menu' aria-label='Reader settings'>
          <div className='view-zoom'>
            <button type='button' aria-label='Zoom out'>
              <ZoomOut size={15} />
            </button>
            <span>100%</span>
            <button type='button' aria-label='Zoom in'>
              <ZoomIn size={15} />
            </button>
          </div>
          <div className='view-zoom'>
            <button type='button' aria-label='Decrease contrast'>
              <Minus size={15} />
            </button>
            <span>
              <Contrast size={13} /> 100%
            </span>
            <button type='button' aria-label='Increase contrast'>
              <Plus size={15} />
            </button>
          </div>

          <div className='view-layout'>
            <button
              type='button'
              className={spread === 'single' ? 'active' : ''}
              onClick={() => setSpread('single')}
              title='Single page'
            >
              <RectangleVertical size={15} />
            </button>
            <button
              type='button'
              className={spread === 'double' ? 'active' : ''}
              onClick={() => setSpread('double')}
              title='Two-page spread'
            >
              <Columns2 size={15} />
            </button>
            <button
              type='button'
              className={spread === 'scroll' ? 'active' : ''}
              onClick={() => setSpread('scroll')}
              title='Vertical scrolling'
            >
              <GalleryVertical size={15} />
            </button>
            <button type='button' title='Fit page'>
              <Maximize2 size={15} />
            </button>
            <button type='button' title='Fit width'>
              <StretchHorizontal size={15} />
            </button>
          </div>

          <MenuRow
            label='Separate Cover Page'
            checked={cover}
            onClick={() => setCover((v) => !v)}
          />
          <MenuRow label='Right-to-Left Pages' />
          <MenuRow label='Webtoon Mode' />
          <hr />
          <MenuRow label='Auto Scroll' shortcut='Shift+A' />
          <MenuRow label='Paragraph Mode' shortcut='Shift+P' />
          <MenuRow label='Speed Reading Mode' shortcut='Shift+V' />
          <hr />
          <MenuRow
            label='Sign in to Sync'
            icon={
              <>
                <RefreshCw size={14} />
                <Info size={13} />
              </>
            }
          />
          <hr />
          <MenuRow label='Fullscreen' icon={<Maximize2 size={14} />} />
          <MenuRow label='Dark Mode' icon={<Moon size={14} />} />
          <MenuRow label='Settings' icon={<Settings size={14} />} />
          <MenuRow label='Apply Theme Colors to PDF' />
          <MenuRow
            label='Invert Image In Dark Mode'
            checked={invert}
            active={invert}
            onClick={() => setInvert((v) => !v)}
          />
          <hr />
          <MenuRow label='Share Book' icon={<Share size={14} />} />
        </aside>
      </div>

      <footer className='reader-bottombar'>
        <div className='reader-nav'>
          <ChevronLeft size={15} />
          <RotateCcw size={14} />
          <ChevronRight size={15} />
        </div>
        <div className='reader-progress'>
          <span>187 / 396</span>
          <div className='reader-track'>
            <i style={{ width: '47%' }} />
          </div>
        </div>
        <div className='reader-audio'>
          <Headphones size={15} />
          <button type='button' aria-label='Play narration'>
            <Play size={12} fill='currentColor' />
          </button>
        </div>
      </footer>
    </WindowShell>
  );
}

const settingsTabs = [
  { icon: Type, label: 'Typography' },
  { icon: LayoutGrid, label: 'Layout' },
  { icon: Palette, label: 'Themes' },
  { icon: Languages, label: 'Language' },
  { icon: Link2, label: 'Integrations', active: true },
  { icon: Volume2, label: 'Audio' },
  { icon: Accessibility, label: 'Accessibility' },
] as const;

function SettingsModal({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <WindowShell className='settings-window'>
      <LibraryChrome
        actions={
          <>
            <button aria-label='Library layout'>
              <LayoutGrid size={16} />
            </button>
            <button aria-label='Appearance'>
              <Sun size={16} />
            </button>
          </>
        }
      >
        <div className='settings-backdrop' aria-hidden='true'>
          <CoverGrid compact />
        </div>
        <div className='settings-modal'>
          <div className='mock-settings-tabs' role='tablist' aria-label='Settings sections'>
            {settingsTabs.map(({ icon: Icon, label, ...rest }) => (
              <button
                key={label}
                type='button'
                className={'active' in rest && rest.active ? 'active' : ''}
                aria-label={label}
                title={label}
              >
                <Icon size={16} />
              </button>
            ))}
            <span className='mock-settings-tabs-gap' />
            <button type='button' aria-label='Search settings'>
              <Search size={16} />
            </button>
            <button type='button' aria-label='Close settings'>
              <X size={16} />
            </button>
          </div>
          <div className='settings-copy'>
            <small>Integrations › {title}</small>
            <p>{description}</p>
          </div>
          <div className='settings-body'>{children}</div>
          {footer ? <div className='settings-footer'>{footer}</div> : null}
        </div>
      </LibraryChrome>
    </WindowShell>
  );
}

export function GoogleDriveMock() {
  const [upload, setUpload] = useState(false);
  const [full, setFull] = useState(false);

  return (
    <SettingsModal
      title='Google Drive'
      description='Import books from a Google Drive folder or share link. Optional library backup stays off until you turn it on.'
      footer={
        <button type='button' className='mock-disconnect'>
          Disconnect
        </button>
      }
    >
      <p className='settings-account'>Connected as you@readstein.local</p>
      <label className='drive-link'>
        <Link2 size={14} />
        <span>Paste a Drive folder or file link</span>
      </label>
      <div className='drive-browser'>
        <div className='drive-row is-folder'>
          <Folder size={15} />
          <div>
            <strong>My Drive</strong>
            <small>Root</small>
          </div>
        </div>
        <div className='drive-row is-active'>
          <Folder size={15} />
          <div>
            <strong>Readest</strong>
            <small>Modified Aug 27, 2026</small>
          </div>
        </div>
      </div>
      <div className='settings-list'>
        <div className='settings-item'>
          <div>
            <strong>Upload Book Files</strong>
            <small>Uploads book files to your other devices</small>
          </div>
          <MockSwitch on={upload} onToggle={() => setUpload((v) => !v)} label='Upload book files' />
        </div>
        <div className='settings-item'>
          <div>
            <strong>Full Sync</strong>
            <small>Re-check every book instead of only changed ones</small>
          </div>
          <MockSwitch on={full} onToggle={() => setFull((v) => !v)} label='Full sync' />
        </div>
        <div className='settings-item'>
          <div>
            <strong>Sync Strategy</strong>
            <small>Two-way copy without replacing your local shelf</small>
          </div>
          <span className='mock-select'>Send and receive</span>
        </div>
        <div className='settings-item'>
          <div>
            <strong>Manual Sync</strong>
            <small>Synced a few seconds ago</small>
          </div>
          <button type='button' className='mock-sync'>
            <RefreshCw size={13} />
            Sync now
          </button>
        </div>
      </div>
    </SettingsModal>
  );
}

export function HomeLibrarySettingsMock() {
  const [sharing, setSharing] = useState(true);
  const [client, setClient] = useState(false);
  const [quiet, setQuiet] = useState(true);

  return (
    <SettingsModal
      title='Home Library'
      description='Use this PC as the library server for phones on the same Wi-Fi. Books stay on your computer — there is no Readest Cloud limit.'
    >
      <div className='settings-list'>
        <div className='settings-item'>
          <div>
            <strong>Share this library on the network</strong>
            <small>
              {sharing
                ? 'Sharing at 192.168.1.107:17432'
                : 'Phones on the same Wi-Fi can import books from this PC.'}
            </small>
          </div>
          <MockSwitch
            on={sharing}
            onToggle={() => setSharing((v) => !v)}
            label='Share this library on the network'
          />
        </div>
        <div className='settings-item settings-item-fields'>
          <div className='settings-pair'>
            <label>
              Pairing code
              <input readOnly value='R8N3HOME' />
            </label>
            <label>
              Port
              <input readOnly value='17432' />
            </label>
          </div>
        </div>
      </div>
      <div className='settings-list'>
        <div className='settings-item'>
          <div>
            <strong>Connect to a home PC</strong>
            <small>
              Import missing titles from a desktop on this Wi-Fi. Your shelf stays local.
            </small>
          </div>
          <MockSwitch
            on={client}
            onToggle={() => setClient((v) => !v)}
            label='Connect to a home PC'
          />
        </div>
        <div className='settings-item settings-item-fields'>
          <div className='settings-pair'>
            <label>
              PC address
              <input readOnly value='192.168.1.10' />
            </label>
            <label>
              Port
              <input readOnly value='17432' />
            </label>
          </div>
        </div>
        <div className='settings-item settings-item-fields'>
          <label className='settings-full'>
            Pairing code
            <input readOnly value='' placeholder='Code shown on the PC' />
          </label>
        </div>
      </div>
      <div className='settings-actions'>
        <button type='button' className='mock-ghost'>
          Find PCs on this network
        </button>
        <button type='button' className='mock-sync mock-sync-solid'>
          <RefreshCw size={13} />
          Sync now
        </button>
      </div>
      <div className='settings-list'>
        <div className='settings-item'>
          <div>
            <strong>Silence Readest Cloud storage notices</strong>
            <small>A large local library is not an error when you sync over Home Library.</small>
          </div>
          <MockSwitch
            on={quiet}
            onToggle={() => setQuiet((v) => !v)}
            label='Silence Readest Cloud storage notices'
          />
        </div>
      </div>
    </SettingsModal>
  );
}

export function TTSPlayerMock() {
  const playing = useVoiceSample('heart');

  return (
    <WindowShell className='reader-window reader-window-paper'>
      <header className='reader-topbar paper-topbar'>
        <div className='reader-top-left'>
          <Type size={15} />
          <span className='font-chip'>Literata · 18px</span>
        </div>
        <div className='reader-title'>
          <strong>The Orchard</strong>
          <span>M. C. Wells</span>
        </div>
        <div className='reader-top-right'>
          <Headphones size={15} />
          <Search size={15} />
          <X size={15} />
        </div>
      </header>

      <div className='reader-stage paper-stage'>
        <div className='reader-spread paper-spread'>
          <article className='spread-page paper-page'>
            <small>12 · THE ORCHARD</small>
            <p>
              Afternoon light found the desk before it found the garden. The page was already warm
              when she began to read aloud, as if the type had been waiting for a voice.
            </p>
            <p>
              Any book could become a listening room: a PDF left on the table, an EPUB from the
              shelf, the same words returning in another cadence.
            </p>
          </article>
          <article className='spread-page paper-page'>
            <small>WELLS · 13</small>
            <p>
              Heart, Bella, Michael—each voice kept the library close without sending a sentence out
              of the house.
            </p>
            <p>
              The comfort was not spectacle. It was remaining with the page while the page spoke.
            </p>
          </article>
        </div>

        <aside className='tts-sheet' aria-label='Listening controls'>
          <button type='button' className='tts-close' aria-label='Close player'>
            <X size={14} />
          </button>
          <div className='tts-cover cover-ochre'>
            <span className='cover-flourish'>◆</span>
            <strong>The Orchard</strong>
          </div>
          <p className='tts-title'>The Orchard — M. C. Wells</p>
          <div className='tts-progress'>
            <span>0:02</span>
            <div className='tts-track'>
              <i style={{ width: playing ? '38%' : '8%' }} />
            </div>
            <span>-2:20</span>
          </div>
          <div className='tts-transport'>
            <ChevronsLeft size={18} />
            <ChevronLeft size={22} />
            <button
              type='button'
              className='tts-play'
              aria-label={playing ? 'Pause sample' : 'Play Heart sample'}
              onClick={() => toggleVoiceSample('heart')}
            >
              {playing ? (
                <Pause size={22} fill='currentColor' />
              ) : (
                <Play size={22} fill='currentColor' />
              )}
            </button>
            <ChevronRight size={22} />
            <ChevronsRight size={18} />
          </div>
          <div className='tts-grid tts-grid-3'>
            <button type='button'>
              <strong>1.05x</strong>
              <small>Speed</small>
            </button>
            <button type='button'>
              <AudioLines size={16} />
              <small>Heart</small>
            </button>
            <button type='button'>
              <AlarmClock size={16} />
              <small>Sleep Timer</small>
            </button>
          </div>
          <div className='tts-grid tts-grid-2'>
            <button type='button'>
              <strong>On-device</strong>
              <small>Engine</small>
            </button>
            <button type='button'>
              <strong>Small</strong>
              <small>Model</small>
            </button>
          </div>
          <div className='tts-offline'>
            <Download size={18} />
            <div>
              <strong>Offline Audio</strong>
              <small>Download chapters for offline playback</small>
            </div>
            <span>Premium</span>
            <ChevronRight size={16} />
          </div>
        </aside>
      </div>
    </WindowShell>
  );
}
