// Boot-time drift check.
//
// F8 PR 6: runs once during getNextly() init, AFTER registerServices
// (so registerServices' first-run setup, dynamic-tables loading, and
// auto-sync block have already completed). Two outcomes:
//
//   1. Drift (live DB diverges from config.collections):
//      Action: emit ONE warning line summarising operation count.
//      Do NOT auto-apply — drift handling is the job of HMR
//      (reload-config.ts during dev) or `nextly db:sync` (manual CLI).
//      Auto-applying drift at boot would be a non-TTY hazard
//      (see PR 3 review C1).
//
//   2. Clean (live DB matches config or config is empty):
//      Action: log nothing. Boot continues.
//
// First-run setup is handled separately by `ensureFirstRunSetup` in
// `init/first-run.ts`, called from `registerServices()` BEFORE this
// drift check runs (see PR 6 review #2 for the sequencing rationale).
//
// Failure-safe: any introspect/diff failure is logged but does NOT
// block boot. The pipeline's HMR + db:sync paths surface real errors
// when the user actually edits the schema.
//
// Performance: collection previews run with bounded concurrency
// (DRIFT_CONCURRENCY workers, default 3). Earlier this used unbounded
// Promise.all, which on cloud Postgres (e.g. Neon poolMax:5) saturated
// the pool at boot — 10+ collections immediately queued behind a 20s
// connectionTimeout. Three workers stays under typical cloud caps
// while still finishing in ~ceil(N/3)× per-call latency for N
// collections (vs N× serial).

import type {
  DesiredCollection,
  DesiredFieldGroup,
  DesiredSchema,
  DesiredSingle,
} from "../domains/schema/pipeline/types";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../domains/schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../domains/singles/services/resolve-single-table-name";

interface AdapterLike {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
}

interface LoggerLike {
  debug?: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

interface DriftCheckCollection {
  slug: string;
  tableName: string;
  fields: unknown[];
  status?: boolean;
  indexes?: DesiredCollection["indexes"];
}

/** The parts of a config collection the drift check reads. */
interface ConfigCollectionLike {
  slug: string;
  dbName?: string;
  fields?: unknown[];
  status?: boolean;
  indexes?: DesiredCollection["indexes"];
}

/**
 * The drift check's input, reduced from the config's collections.
 *
 * Every attribute that changes a table travels, or the check compares the
 * live table against a smaller one: without `status` a collection that turned
 * Draft/Published on after its table existed never reports the missing status
 * column, and without `indexes` a declared compound index the database already
 * holds is counted as drift on every boot.
 */
export function driftCheckCollections(
  collections: readonly ConfigCollectionLike[]
): DriftCheckCollection[] {
  return collections.map(c => ({
    slug: c.slug,
    tableName: resolveCollectionTableName(c.slug, c.dbName),
    fields: c.fields ?? [],
    status: c.status === true,
    ...(c.indexes !== undefined ? { indexes: c.indexes } : {}),
  }));
}

/** The parts of a config Single or field group the drift check reads. */
interface ConfigEntityLike {
  slug: string;
  dbName?: string;
  fields?: unknown[];
  status?: boolean;
}

/** A Single or field group as the drift check compares it. */
interface DriftCheckEntity {
  slug: string;
  tableName: string;
  fields: unknown[];
  status?: boolean;
}

/**
 * The drift check's input, reduced from the config's Singles: the table a
 * Single is stored in, its fields and its Draft/Published switch, as the
 * collections' reduction carries them.
 */
export function driftCheckSingles(
  singles: readonly ConfigEntityLike[]
): DriftCheckEntity[] {
  return singles.map(s => ({
    slug: s.slug,
    tableName: resolveSingleTableName({ slug: s.slug, dbName: s.dbName }),
    fields: s.fields ?? [],
    status: s.status === true,
  }));
}

/** The drift check's input, reduced from the config's field groups. */
export function driftCheckFieldGroups(
  groups: readonly ConfigEntityLike[]
): DriftCheckEntity[] {
  return groups.map(g => ({
    slug: g.slug,
    tableName: resolveComponentTableName(g.slug),
    fields: g.fields ?? [],
  }));
}

/** One entity a drift preview is asked about, by its kind. */
type DriftCheckAsk =
  | { kind: "collection"; entity: DriftCheckCollection }
  | { kind: "single"; entity: DriftCheckEntity }
  | { kind: "fieldGroup"; entity: DriftCheckEntity };

export interface RunDriftCheckDeps {
  previewDesiredSchema: (args: {
    desired: DesiredSchema;
    db: unknown;
    dialect: "postgresql" | "mysql" | "sqlite";
  }) => Promise<{
    operations: unknown[];
    events: unknown[];
    candidates: unknown[];
    classification: string;
    liveSnapshot: unknown;
  }>;
}

export interface RunDriftCheckArgs {
  adapter: AdapterLike;
  collections: DriftCheckCollection[];
  /** Singles to compare as the collections are, each in a preview of its own. */
  singles?: DriftCheckEntity[];
  /** Field groups to compare as the collections are, each in a preview of its own. */
  fieldGroups?: DriftCheckEntity[];
  logger: LoggerLike;
  deps?: Partial<RunDriftCheckDeps>;
}

export type RunDriftCheckResult =
  | { kind: "drift"; pending: number }
  | { kind: "clean" };

export async function runDriftCheck(
  args: RunDriftCheckArgs
): Promise<RunDriftCheckResult> {
  const { adapter, collections, logger } = args;
  const deps = await resolveDeps(args.deps);

  // Every preview also compares the tables plugins and the app declare, so with
  // no entity to ask about (a development start that skips every unchanged
  // one), one preview of none still compares them.
  const entities: DriftCheckAsk[] = [
    ...collections.map(entity => ({ kind: "collection" as const, entity })),
    ...(args.singles ?? []).map(entity => ({
      kind: "single" as const,
      entity,
    })),
    ...(args.fieldGroups ?? []).map(entity => ({
      kind: "fieldGroup" as const,
      entity,
    })),
  ];
  const asks: ReadonlyArray<DriftCheckAsk | null> =
    entities.length > 0 ? entities : [null];

  // Bounded-parallel preview. Earlier this was `Promise.all` of N parallel
  // calls, which against a Neon poolMax:5 with 10+ collections instantly
  // saturated the pool and queued requests behind a 20s connectionTimeout.
  // Drift check is informational and dev-only — bounded concurrency keeps
  // the boot path responsive without losing the wall-time win over serial.
  const DRIFT_CONCURRENCY = 3;
  const results: Array<
    { ok: true; operations: unknown[] } | { ok: false; error: string }
  > = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < asks.length) {
      const myIndex = cursor++;
      const ask = asks[myIndex];
      // The one entity asked about, in its kind's place; the others empty.
      const only = <T>(kind: DriftCheckAsk["kind"]): Record<string, T> =>
        ask?.kind === kind
          ? { [ask.entity.slug]: ask.entity as unknown as T }
          : {};
      try {
        const preview = await deps.previewDesiredSchema({
          desired: {
            collections: only<DesiredCollection>("collection"),
            singles: only<DesiredSingle>("single"),
            components: only<DesiredFieldGroup>("fieldGroup"),
          },
          db: adapter.getDrizzle(),
          dialect: adapter.dialect,
        });
        results[myIndex] = { ok: true, operations: preview.operations };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug?.(
          `[nextly] Drift preview failed for '${ask?.entity.slug ?? "the plugin and app tables"}': ${msg} (continuing).`
        );
        results[myIndex] = { ok: false, error: msg };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DRIFT_CONCURRENCY, asks.length) }, () =>
      worker()
    )
  );

  // Counted once each across the previews. Every preview also compares the
  // tables plugins and the app declare, whichever collection it was asked
  // about, so an operation on one of those reaches every preview, and summing
  // would report it once per collection. A diff of the same tables yields the
  // same operation, so its serialised form identifies it.
  const pending = new Set<string>();
  let failureCount = 0;
  for (const r of results) {
    if (!r.ok) {
      failureCount += 1;
      continue;
    }
    for (const operation of r.operations)
      pending.add(JSON.stringify(operation));
  }
  const pendingOps = pending.size;

  // PR 6 review #5: surface aggregate failure count so users notice
  // when drift introspection is broken on most collections.
  if (failureCount > 0) {
    logger.warn(
      `[nextly] ${failureCount} of ${asks.length} drift previews failed. ` +
        `Run \`nextly db:sync\` to investigate.`
    );
  }

  if (pendingOps === 0) return { kind: "clean" };

  logger.warn(
    `[nextly] Detected schema drift: ${pendingOps} pending change(s). ` +
      `Save your nextly.config.ts to apply via HMR, or run \`nextly db:sync\`.`
  );
  return { kind: "drift", pending: pendingOps };
}

async function resolveDeps(
  injected: Partial<RunDriftCheckDeps> | undefined
): Promise<RunDriftCheckDeps> {
  if (injected?.previewDesiredSchema) {
    return injected as RunDriftCheckDeps;
  }
  const { previewDesiredSchema } = await import(
    "../domains/schema/pipeline/preview"
  );
  return {
    previewDesiredSchema:
      injected?.previewDesiredSchema ?? previewDesiredSchema,
  };
}
