import { AppService } from '@/types/system';
import { BufferedTTSClient } from '../BufferedTTSClient';
import { BookTTSCacheStore, getTTSCacheConfig } from '../providers/bookCacheStore';
import { CachingProvider } from '../providers/cache';
import { KokoroSpeechProvider } from '../providers/kokoro';
import { SpeechProvider } from '../providers/types';
import type { TTSCapabilities } from '../TTSClient';
import type { TTSController } from '../TTSController';
import { kokoroModelStore } from './modelStore';

/**
 * Thin BufferedTTSClient wrapper for on-device Kokoro. Same playout / highlight
 * / scrubber path as Edge TTS.
 */
export class KokoroTTSClient extends BufferedTTSClient {
  #kokoroProvider: KokoroSpeechProvider;
  #forceLoad = false;

  constructor(controller?: TTSController, appService?: AppService | null) {
    const kokoroProvider = new KokoroSpeechProvider();
    let provider: SpeechProvider = kokoroProvider;
    const cacheConfig = getTTSCacheConfig();
    if (appService && cacheConfig.enabled) {
      const store = new BookTTSCacheStore(
        appService,
        () => controller?.bookKey?.split('-')[0] || null,
        cacheConfig.budgetMB * 1024 * 1024,
      );
      provider = new CachingProvider(kokoroProvider, store);
    }
    super(provider, controller, appService);
    this.#kokoroProvider = kokoroProvider;
  }

  /** When true, init downloads the model even if it was never cached. */
  setForceLoad(force: boolean) {
    this.#forceLoad = force;
  }

  override getCapabilities(): TTSCapabilities {
    return {
      ...super.getCapabilities(),
      slowLocal: true,
    };
  }

  override async init(): Promise<boolean> {
    this.voices = await this.#kokoroProvider.getAllVoices();
    const ok = this.#forceLoad
      ? await this.#kokoroProvider.initForce()
      : await this.#kokoroProvider.init();
    this.initialized = ok;
    return ok;
  }

  /** Reload after the user changes Tiny/Small/Large. */
  async reloadModel(): Promise<boolean> {
    await kokoroModelStore.shutdown();
    this.#forceLoad = true;
    return this.init();
  }
}
