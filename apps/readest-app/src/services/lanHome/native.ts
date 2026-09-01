import { invoke } from '@tauri-apps/api/core';
import type { LanHomePeer } from './protocol';

export type LanHomeHostStatus = {
  running: boolean;
  port: number;
  name: string;
  addrs: string[];
};

export const startLanHomeHost = async (opts: {
  booksDir: string;
  token: string;
  port: number;
  name: string;
}): Promise<LanHomeHostStatus> =>
  invoke<LanHomeHostStatus>('lan_library_start', opts);

export const stopLanHomeHost = async (): Promise<void> => {
  await invoke('lan_library_stop');
};

export const getLanHomeHostStatus = async (): Promise<LanHomeHostStatus> =>
  invoke<LanHomeHostStatus>('lan_library_status');

export const scanLanHomePeers = async (): Promise<LanHomePeer[]> =>
  invoke<LanHomePeer[]>('lan_library_scan');
