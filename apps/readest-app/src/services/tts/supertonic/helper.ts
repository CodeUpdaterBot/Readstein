/**
 * Official Supertonic 3 browser inference, ported from
 * https://github.com/supertone-inc/supertonic/blob/main/web/helper.js
 */
import * as ort from 'onnxruntime-web';
import { SUPERTONIC_LANGS } from '../kokoro/protocol';

type TtsCfgs = {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
};

export class Style {
  constructor(
    readonly ttl: ort.Tensor,
    readonly dp: ort.Tensor,
  ) {}
}

class UnicodeProcessor {
  constructor(private readonly indexer: number[]) {}

  call(textList: string[], langList: string[]) {
    const processed = textList.map((text, i) => this.preprocessText(text, langList[i] ?? 'en'));
    const lengths = processed.map((text) => text.length);
    const maxLen = Math.max(...lengths, 1);
    const textIds = processed.map((text) => {
      const row = new Array<number>(maxLen).fill(0);
      for (let j = 0; j < text.length; j++) {
        const codePoint = text.codePointAt(j) ?? 0;
        row[j] = codePoint < this.indexer.length ? (this.indexer[codePoint] ?? -1) : -1;
      }
      return row;
    });
    return { textIds, textMask: this.lengthToMask(lengths, maxLen) };
  }

  preprocessText(text: string, lang: string): string {
    text = text.normalize('NFKD');
    text = text.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,
      '',
    );
    const replacements: Record<string, string> = {
      '–': '-',
      '‑': '-',
      '—': '-',
      _: ' ',
      '\u201C': '"',
      '\u201D': '"',
      '\u2018': "'",
      '\u2019': "'",
      '´': "'",
      '`': "'",
      '[': ' ',
      ']': ' ',
      '|': ' ',
      '/': ' ',
      '#': ' ',
      '→': ' ',
      '←': ' ',
    };
    for (const [from, to] of Object.entries(replacements)) {
      text = text.split(from).join(to);
    }
    text = text.replace(/[♥☆♡©\\]/g, '');
    text = text.split('@').join(' at ');
    text = text.replace(/\s+/g, ' ').trim();
    if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) text += '.';
    const code = (SUPERTONIC_LANGS as readonly string[]).includes(lang) ? lang : 'na';
    return `<${code}>${text}</${code}>`;
  }

  lengthToMask(lengths: number[], maxLen: number): number[][][] {
    return lengths.map((len) => {
      const row = new Array<number>(maxLen).fill(0);
      for (let j = 0; j < Math.min(len, maxLen); j++) row[j] = 1;
      return [row];
    });
  }
}

export class TextToSpeech {
  readonly sampleRate: number;

  constructor(
    private readonly cfgs: TtsCfgs,
    private readonly textProcessor: UnicodeProcessor,
    private readonly dpOrt: ort.InferenceSession,
    private readonly textEncOrt: ort.InferenceSession,
    private readonly vectorEstOrt: ort.InferenceSession,
    private readonly vocoderOrt: ort.InferenceSession,
  ) {
    this.sampleRate = cfgs.ae.sample_rate;
  }

  async synthesize(
    text: string,
    lang: string,
    style: Style,
    totalStep = 8,
    speed = 1.05,
  ): Promise<{ wav: Float32Array; durationSec: number }> {
    const maxLen = lang === 'ko' || lang === 'ja' ? 120 : 300;
    const chunks = chunkText(text, maxLen);
    const parts: Float32Array[] = [];
    let durationSec = 0;
    for (const chunk of chunks) {
      const { wav, duration } = await this.#infer(chunk, lang, style, totalStep, speed);
      parts.push(wav);
      durationSec += duration;
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const wav = new Float32Array(total);
    let offset = 0;
    for (const part of parts) {
      wav.set(part, offset);
      offset += part.length;
    }
    return { wav, durationSec };
  }

  async #infer(
    text: string,
    lang: string,
    style: Style,
    totalStep: number,
    speed: number,
  ): Promise<{ wav: Float32Array; duration: number }> {
    const { textIds, textMask } = this.textProcessor.call([text], [lang]);
    const width = textIds[0]?.length ?? 1;
    const textIdsTensor = new ort.Tensor(
      'int64',
      BigInt64Array.from((textIds[0] ?? []).map((x) => BigInt(x))),
      [1, width],
    );
    const textMaskTensor = new ort.Tensor('float32', Float32Array.from(textMask[0]?.[0] ?? []), [
      1,
      1,
      width,
    ]);

    const dpOutputs = await this.dpOrt.run({
      text_ids: textIdsTensor,
      style_dp: style.dp,
      text_mask: textMaskTensor,
    });
    const durationRaw = Array.from(dpOutputs['duration']!.data as Float32Array);
    const duration = durationRaw.map((value) => value / speed);

    const textEncOutputs = await this.textEncOrt.run({
      text_ids: textIdsTensor,
      style_ttl: style.ttl,
      text_mask: textMaskTensor,
    });
    const textEmb = textEncOutputs['text_emb']!;

    let { xt, latentMask } = this.#sampleNoisyLatent(duration);
    const latentMaskTensor = new ort.Tensor(
      'float32',
      Float32Array.from(latentMask[0]?.[0] ?? []),
      [1, 1, latentMask[0]?.[0]?.length ?? 1],
    );
    const totalStepTensor = new ort.Tensor('float32', Float32Array.from([totalStep]), [1]);

    for (let step = 0; step < totalStep; step++) {
      const currentStepTensor = new ort.Tensor('float32', Float32Array.from([step]), [1]);
      const xtTensor = new ort.Tensor('float32', Float32Array.from(xt.flat(2)), [
        1,
        xt[0]!.length,
        xt[0]![0]!.length,
      ]);
      const vectorEstOutputs = await this.vectorEstOrt.run({
        noisy_latent: xtTensor,
        text_emb: textEmb,
        style_ttl: style.ttl,
        latent_mask: latentMaskTensor,
        text_mask: textMaskTensor,
        current_step: currentStepTensor,
        total_step: totalStepTensor,
      });
      const denoised = Array.from(vectorEstOutputs['denoised_latent']!.data as Float32Array);
      const latentDim = xt[0]!.length;
      const latentLen = xt[0]![0]!.length;
      xt = [[]];
      let idx = 0;
      for (let d = 0; d < latentDim; d++) {
        const row: number[] = [];
        for (let t = 0; t < latentLen; t++) row.push(denoised[idx++] ?? 0);
        xt[0]!.push(row);
      }
    }

    const finalXtTensor = new ort.Tensor('float32', Float32Array.from(xt.flat(2)), [
      1,
      xt[0]!.length,
      xt[0]![0]!.length,
    ]);
    const vocoderOutputs = await this.vocoderOrt.run({ latent: finalXtTensor });
    const wav = new Float32Array(vocoderOutputs['wav_tts']!.data as Float32Array);
    return { wav, duration: duration[0] ?? wav.length / this.sampleRate };
  }

  #sampleNoisyLatent(duration: number[]) {
    const maxDur = Math.max(...duration, 0.05);
    const wavLenMax = Math.floor(maxDur * this.sampleRate);
    const chunkSize = this.cfgs.ae.base_chunk_size * this.cfgs.ttl.chunk_compress_factor;
    const latentLen = Math.max(1, Math.floor((wavLenMax + chunkSize - 1) / chunkSize));
    const latentDimVal = this.cfgs.ttl.latent_dim * this.cfgs.ttl.chunk_compress_factor;
    const xt: number[][][] = [[]];
    for (let d = 0; d < latentDimVal; d++) {
      const row: number[] = [];
      for (let t = 0; t < latentLen; t++) {
        const u1 = Math.max(0.0001, Math.random());
        const u2 = Math.random();
        row.push(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2));
      }
      xt[0]!.push(row);
    }
    const wavLen = Math.floor((duration[0] ?? maxDur) * this.sampleRate);
    const keep = Math.max(1, Math.floor((wavLen + chunkSize - 1) / chunkSize));
    const maskRow = new Array<number>(latentLen).fill(0);
    for (let t = 0; t < Math.min(keep, latentLen); t++) maskRow[t] = 1;
    for (let d = 0; d < latentDimVal; d++) {
      for (let t = 0; t < latentLen; t++) xt[0]![d]![t]! *= maskRow[t]!;
    }
    return { xt, latentMask: [[maskRow]] };
  }
}

export async function loadVoiceStyle(json: {
  style_ttl: { dims: number[]; data: number[] | number[][][] };
  style_dp: { dims: number[]; data: number[] | number[][][] };
}): Promise<Style> {
  const ttlDims = json.style_ttl.dims;
  const dpDims = json.style_dp.dims;
  const ttl = new ort.Tensor(
    'float32',
    Float32Array.from((json.style_ttl.data as number[]).flat(Infinity) as number[]),
    ttlDims,
  );
  const dp = new ort.Tensor(
    'float32',
    Float32Array.from((json.style_dp.data as number[]).flat(Infinity) as number[]),
    dpDims,
  );
  return new Style(ttl, dp);
}

export async function createTextToSpeech(
  urls: {
    durationPredictor: string;
    textEncoder: string;
    vectorEstimator: string;
    vocoder: string;
    ttsJson: string;
    unicodeIndexer: string;
  },
  sessionOptions: ort.InferenceSession.SessionOptions,
): Promise<TextToSpeech> {
  const [cfgs, indexer, dpOrt, textEncOrt, vectorEstOrt, vocoderOrt] = await Promise.all([
    fetch(urls.ttsJson).then((res) => res.json() as Promise<TtsCfgs>),
    fetch(urls.unicodeIndexer).then((res) => res.json() as Promise<number[]>),
    ort.InferenceSession.create(urls.durationPredictor, sessionOptions),
    ort.InferenceSession.create(urls.textEncoder, sessionOptions),
    ort.InferenceSession.create(urls.vectorEstimator, sessionOptions),
    ort.InferenceSession.create(urls.vocoder, sessionOptions),
  ]);
  return new TextToSpeech(
    cfgs,
    new UnicodeProcessor(indexer),
    dpOrt,
    textEncOrt,
    vectorEstOrt,
    vocoderOrt,
  );
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function chunkText(text: string, maxLen: number): string[] {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n+/)
    .filter((part) => part.trim());
  const chunks: string[] = [];
  for (const paragraph of paragraphs.length ? paragraphs : [text]) {
    const sentences = paragraph
      .trim()
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean);
    let current = '';
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= maxLen) {
        current += (current ? ' ' : '') + sentence;
      } else {
        if (current) chunks.push(current.trim());
        current = sentence;
      }
    }
    if (current) chunks.push(current.trim());
  }
  return chunks.length ? chunks : [text.trim()];
}
