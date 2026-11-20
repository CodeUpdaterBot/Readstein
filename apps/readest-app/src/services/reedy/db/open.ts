import type { AppService } from '@/types/system';
import type { DatabaseService } from '@/types/database';
import { ReedyDb } from './ReedyDb';

/**
 * Process-wide Reedy handle. reedy.db is long-lived (never closed in the
 * MVP) and every writer goes through one ReedyDb.writeQueue so two
 * BEGIN/COMMIT batches cannot nest on the shared Turso connection.
 */

export interface ReedyHandle {
  db: ReedyDb;
  svc: DatabaseService;
}

let shared: Promise<ReedyHandle> | null = null;

export function openReedy(appService: AppService): Promise<ReedyHandle> {
  if (!shared) {
    const opening = (async (): Promise<ReedyHandle> => {
      const svc = await appService.openDatabase('reedy', 'reedy.db', 'Data', {
        experimental: ['index_method'],
      });
      const db = new ReedyDb(svc);
      // The chunk-text FTS index is being retired (see ReedyDb.dropChunkFtsIndex)
      // — it costs 2.3-10x disk and a multi-minute build for no retrieval win
      // the app's own library-search benchmark could measure. Dropping it is
      // idempotent and instant once it is gone. Never reBUILD it here: doing
      // that on open held the serial DB queue for minutes and made the whole
      // app, and every query behind it, look hung.
      void db.dropChunkFtsIndex().catch(() => {});
      return { svc, db };
    })();
    shared = opening;
    void opening.catch(() => {
      if (shared === opening) shared = null;
    });
  }
  return shared;
}

/** Test-only: drop the memoized handle so the next openReedy() reconnects. */
export function resetOpenReedyForTests(): void {
  shared = null;
}
