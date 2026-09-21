/**
 * Who owns each table, and which migration stream carries it.
 *
 * Two questions that read as one and are not. A plugin-contributed collection
 * is DECLARED by the plugin and MIGRATED by the app, so a single "owner"
 * column would have to be wrong about one of them — and the wrong one decides
 * whether a drop is safe.
 *
 * ## The rule that makes this safe
 *
 * A table with NO row is never dropped by any path. Absence means "nobody has
 * claimed this", which is the conservative answer rather than an invitation:
 * an unrecognised table is far more likely to be someone's data than a stray.
 *
 * ## Why ownership cannot be re-derived from config
 *
 * Config says what SHOULD exist. This says what DOES. The difference is the
 * whole point: a table whose plugin has been removed from config is exactly
 * the case where dropping it would destroy data, and config can no longer say
 * it was ever a plugin's. A record that outlives the declaration is what makes
 * an uninstall a decision rather than an accident.
 *
 * @module domains/schema/ownership/owner-registry
 * @since 1.0.0
 */
import { NextlyError } from "../../../errors/nextly-error";

export type OwnerKind =
  | "core"
  | "collection"
  | "single"
  | "component"
  | "plugin"
  | "app";

export type OwnerState = "active" | "orphaned" | "uninstalled";

export interface OwnerRecord {
  tableName: string;
  ownerKind: OwnerKind;
  /** `nextly` | entity slug | plugin name | `app`. */
  ownerId: string;
  /** `core` | `app` | `plugin:<name>` — which stream carries the table. */
  migratedBy: string;
  ownerVersion: string | null;
  schemaVersion: number | null;
  state: OwnerState;
}

/**
 * The storage this service reads and writes.
 *
 * An interface rather than the Drizzle table directly, so the POLICY — what a
 * transfer means, which states are reachable — can be tested without a
 * database, and so the one implementation that touches SQL is the only thing
 * that has to be right about three dialects.
 */
export interface OwnerRegistryStore {
  read(tableNames?: readonly string[]): Promise<OwnerRecord[]>;
  upsert(rows: readonly OwnerRecord[]): Promise<void>;
  deleteByOwner(ownerId: string): Promise<void>;
}

export interface OwnerRegistry {
  get(tableName: string): Promise<OwnerRecord | null>;
  listByOwner(ownerId: string): Promise<OwnerRecord[]>;
  record(
    rows: readonly OwnerRecord[],
    opts?: { transfer?: boolean }
  ): Promise<void>;
  setState(ownerId: string, state: OwnerState): Promise<void>;
  remove(ownerId: string): Promise<void>;
  appliedSchemaVersion(ownerId: string): Promise<number | null>;
}

export function createOwnerRegistry(store: OwnerRegistryStore): OwnerRegistry {
  return {
    async get(tableName) {
      const [row] = await store.read([tableName]);
      return row ?? null;
    },

    async listByOwner(ownerId) {
      const rows = await store.read();
      return rows.filter(row => row.ownerId === ownerId);
    },

    /**
     * Upsert, refusing to change an existing row's owner.
     *
     * A silent owner change is how one plugin takes over another's table: the
     * second plugin declares the same name, the row is rewritten, and the
     * first plugin's uninstall then drops data it no longer appears to own.
     * `transfer: true` makes that an explicit act.
     */
    async record(rows, opts) {
      const existing = new Map(
        (await store.read(rows.map(row => row.tableName))).map(row => [
          row.tableName,
          row,
        ])
      );

      if (opts?.transfer !== true) {
        for (const row of rows) {
          const before = existing.get(row.tableName);
          if (before && before.ownerId !== row.ownerId) {
            throw NextlyError.conflict({
              logContext: {
                reason: "table-owner-would-change",
                table: row.tableName,
                from: before.ownerId,
                to: row.ownerId,
              },
            });
          }
        }
      }

      await store.upsert(rows);
    },

    async setState(ownerId, state) {
      const rows = await store.read();
      const mine = rows.filter(row => row.ownerId === ownerId);
      // Only this owner's rows. A state change that swept siblings would
      // mark another plugin's tables uninstalled on the strength of a name.
      if (mine.length === 0) return;
      await store.upsert(mine.map(row => ({ ...row, state })));
    },

    async remove(ownerId) {
      await store.deleteByOwner(ownerId);
    },

    /**
     * The highest schema version recorded for an owner.
     *
     * The highest rather than the first: an owner with several tables applied
     * across releases has a row per table, and the newest is what decides
     * whether its migrations are behind.
     */
    async appliedSchemaVersion(ownerId) {
      const rows = await store.read();
      const versions = rows
        .filter(row => row.ownerId === ownerId)
        .map(row => row.schemaVersion)
        .filter((value): value is number => typeof value === "number");
      return versions.length === 0 ? null : Math.max(...versions);
    },
  };
}
