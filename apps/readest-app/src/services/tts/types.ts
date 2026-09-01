export type TTSGranularity = 'sentence' | 'word';

export type TTSHighlightGranularity = 'word' | 'sentence';

export type TTSMediaMetadataMode = 'sentence' | 'paragraph' | 'chapter';

// Mini player card style: 'full' is the pre-#5162 (0.11.18) card with book
// cover, book title, chapter + timestamps; 'minimal' is the chrome-free card.
export type TTSPlayerStyle = 'full' | 'minimal';

// Preferred synthesis engine. 'auto' picks Kokoro when the model is ready and
// the book language is supported, else Edge, else Web Speech. Android never
// auto-selects the phone's system TTS engine (Qualcomm/Samsung), which is
// opt-in via 'system'. On Android, Kokoro runs through sherpa-onnx.
export type TTSEnginePreference = 'auto' | 'kokoro' | 'edge' | 'system';

// On-device package id. Legacy tiny/small/large still persist and are mapped
// in onDeviceCatalog. Desktop Kokoro uses kokoro-* (or legacy size aliases).
// Android uses Kitten / Piper / Supertonic sherpa packages.
export type TTSModelSize =
  | 'tiny'
  | 'small'
  | 'large'
  | 'piper-amy-low'
  | 'kitten-nano'
  | 'piper-lessac-medium'
  | 'kitten-mini'
  | 'supertonic-3'
  | 'kokoro-tiny'
  | 'kokoro-small'
  | 'kokoro-large';

// Where a fresh Play starts when there is no text selection.
export type TTSStartPosition = 'visible-page' | 'resume';

export type TTSHighlightOptions = {
  style: 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'outline';
  color: string;
};

export type TTSVoice = {
  id: string;
  name: string;
  lang: string;
  disabled?: boolean;
};

export type TTSVoicesGroup = {
  id: string;
  name: string;
  voices: TTSVoice[];
  disabled?: boolean;
};

export type TTSMark = {
  offset: number;
  name: string;
  text: string;
  language: string;
};
