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
      return { svc, db: new ReedyDb(svc) };
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
