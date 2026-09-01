import type { DatabaseService } from '@/types/database';
import { migrate, type SchemaType } from './migrate';
import { getMigrations } from './migrations';

/**
 * Share one physical connection per database file and run migrations once.
 *
 * Opening the same path twice (React Strict Mode remount, ReedyBackend +
 * ReedyAssistant, statistics tracker in split view, …) previously started
 * two Turso connections that both ran `migrate()`. The second INSERT into
 * `__migrations` failed with `UNIQUE constraint failed: __migrations.name (19)`
 * as an unhandledRejection — the overlay the user hit on first AI book open.
 *
 * OPFS also allows only one writable handle per file; a second connect()
 * throws. Caching matches the statistics.db singleton already used there.
 *
 * `close()` is refcounted: the underlying connection is checkpointed and
 * released only when the last caller closes.
 */

interface CacheEntry {
  db: DatabaseService;
  refs: number;
}

const live = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DatabaseService>>();

function wrap(key: string, db: DatabaseService): DatabaseService {
  return {
    execute: (sql, params) => db.execute(sql, params),
    select: (sql, params) => db.select(sql, params),
    batch: (statements) => db.batch(statements),
    async close() {
      const entry = live.get(key);
      if (!entry) {
        await db.close();
        return;
      }
      entry.refs -= 1;
      if (entry.refs > 0) return;
      live.delete(key);
      await db.close();
    },
  };
}

export async function openSharedDatabase(
  key: string,
  open: () => Promise<DatabaseService>,
  schema: SchemaType,
): Promise<DatabaseService> {
  const existing = live.get(key);
  if (existing) {
    existing.refs += 1;
    return wrap(key, existing.db);
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const db = await open();
      try {
        await migrate(db, getMigrations(schema));
      } catch (err) {
        await db.close().catch(() => {});
        throw err;
      }
      live.set(key, { db, refs: 0 });
      return db;
    })();
    inflight.set(key, pending);
    void pending.finally(() => {
      if (inflight.get(key) === pending) inflight.delete(key);
    });
  }

  const db = await pending;
  const entry = live.get(key);
  if (!entry) {
    throw new Error(`openSharedDatabase: connection for ${key} was not cached after open`);
  }
  entry.refs += 1;
  return wrap(key, db);
}

/** Test-only: drop in-memory bookkeeping. Does not close live connections. */
export function resetOpenSharedForTests(): void {
  live.clear();
  inflight.clear();
}
