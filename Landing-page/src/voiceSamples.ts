import { useEffect, useState } from 'react';

export const voiceSamples = [
  {
    id: 'heart',
    name: 'Heart',
    detail: 'Kokoro • on-device',
    file: 1,
  },
  {
    id: 'bella',
    name: 'Bella',
    detail: 'Kokoro • on-device',
    file: 2,
  },
  {
    id: 'michael',
    name: 'Michael',
    detail: 'Kokoro • on-device',
    file: 3,
  },
] as const;

type SampleId = (typeof voiceSamples)[number]['id'];

const listeners = new Set<() => void>();
let activeId: SampleId | null = null;
let player: HTMLAudioElement | null = null;

function urlsFor(file: number) {
  return [
    `/audio/kokoro_example_${file}.mp3`,
    `/kokoro_example_${file}.mp3`,
    `/audio/kokoro_example_${file}.wav`,
    `/kokoro_example_${file}.wav`,
    `/audio/kokoro_example_${file}.ogg`,
    `/kokoro_example_${file}.ogg`,
  ];
}

function notify() {
  listeners.forEach((listener) => listener());
}

function stopPlayback() {
  if (player) {
    player.pause();
    player.removeAttribute('src');
    player.load();
  }
  activeId = null;
  notify();
}

function tryPlay(id: SampleId, sources: string[], index = 0) {
  if (!player) {
    player = new Audio();
    player.addEventListener('ended', stopPlayback);
  }
  if (index >= sources.length) {
    stopPlayback();
    return;
  }
  const next = sources[index]!;
  player.src = next;
  void player.play().then(
    () => {
      activeId = id;
      notify();
    },
    () => tryPlay(id, sources, index + 1),
  );
}

export function toggleVoiceSample(id: SampleId) {
  if (activeId === id) {
    stopPlayback();
    return;
  }
  const sample = voiceSamples.find((item) => item.id === id);
  if (!sample) return;
  stopPlayback();
  tryPlay(id, urlsFor(sample.file));
}

export function useVoiceSample(id: SampleId) {
  const [playing, setPlaying] = useState(activeId === id);

  useEffect(() => {
    const sync = () => setPlaying(activeId === id);
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, [id]);

  return playing;
}
