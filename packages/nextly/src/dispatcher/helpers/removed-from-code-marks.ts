/**
 * The "removed from code" mark on the collections and Singles the admin reads.
 *
 A listing or schema read of a collection or Single removed from code answers
 * two extra fields, added to the canonical body and changing nothing else in
 * it:
 *
 * - `removedFromCode: true`, decided by the write guard's own rule
 *   (`registryRowRemovedFromCode`), so the admin marks exactly the entities
 *   whose writes are refused.
 * - `removedFromCodeState`: where its retirement stands
 *   (`readRemovedFromCodeStates`), from which the admin names the next step.
 *
 * Every other entity's body is left exactly as it was, so a client that never
 * heard of the mark reads what it always read; absent means not removed.
 * Builder and plugin entities are never removed from code.
 *
 * @module dispatcher/helpers/removed-from-code-marks
 */

import { resolve } from "node:path";

import {
  readRemovedFromCodeStates,
  removedEntityKey,
  type RemovedEntityRef,
  type RemovedFromCodeState,
  type RetirementAdapter,
} from "../../domains/dynamic-collections/services/removed-from-code-state";
import {
  registryRowRemovedFromCode,
  type RemovableEntityKind,
} from "../../domains/dynamic-collections/services/removed-from-code-writes";
import { getHandlerConfig } from "../../route-handler/auth-handler";
import { DEFAULT_DB_CONFIG } from "../../shared/types/config";

import { getAdapterFromDI } from "./di";

/** The two fields a removed collection or Single carries. */
export interface RemovedFromCodeMark {
  removedFromCode?: true;
  removedFromCodeState?: RemovedFromCodeState;
}

/**
 * The app's migrations directory, resolved from the working directory as
 * `nextly migrate` resolves it.
 */
function appMigrationsDir(): string {
  return resolve(
    process.cwd(),
    getHandlerConfig()?.db?.migrationsDir ?? DEFAULT_DB_CONFIG.migrationsDir
  );
}

/** The registry row's slug and table, whichever spelling it carries. */
function identityOf(
  kind: RemovableEntityKind,
  row: Record<string, unknown>
): { slug: string | null; tableName: string | null; source: string | null } {
  const slug =
    typeof row.slug === "string"
      ? row.slug
      : kind === "collection" && typeof row.name === "string"
        ? row.name
        : null;
  return {
    slug,
    tableName: typeof row.tableName === "string" ? row.tableName : null,
    source: typeof row.source === "string" ? row.source : null,
  };
}

/**
 * `rows` with the mark added to each removed one, in order.
 *
 * A removed entity's state needs the database and the migrations folder; when
 * no row is removed, neither is read. `deps` is for tests; a request reads the
 * registered adapter and the configured folder.
 */
export async function withRemovedFromCodeMarks<
  T extends Record<string, unknown>,
>(
  kind: RemovableEntityKind,
  rows: readonly T[],
  deps: { adapter?: RetirementAdapter; migrationsDir?: string } = {}
): Promise<Array<T & RemovedFromCodeMark>> {
  const removed: RemovedEntityRef[] = [];
  const flags = rows.map(row => {
    const identity = identityOf(kind, row);
    const isRemoved = registryRowRemovedFromCode(kind, identity);
    if (isRemoved && identity.slug !== null && identity.tableName !== null) {
      removed.push({
        kind,
        slug: identity.slug,
        tableName: identity.tableName,
      });
    }
    return { isRemoved, slug: identity.slug };
  });

  const adapter = deps.adapter ?? getAdapterFromDI();
  const states =
    removed.length > 0 && adapter !== undefined
      ? await readRemovedFromCodeStates({
          adapter,
          migrationsDir: deps.migrationsDir ?? appMigrationsDir(),
          entities: removed,
        })
      : new Map<string, RemovedFromCodeState>();

  return rows.map((row, index) => {
    const { isRemoved, slug } = flags[index];
    if (!isRemoved) return row;
    return {
      ...row,
      removedFromCode: true,
      // A removed row with no table name or no adapter to ask is still marked;
      // only its step is left unnamed.
      removedFromCodeState: (slug === null
        ? undefined
        : states.get(removedEntityKey(kind, slug))) ?? { state: "other" },
    };
  });
}
