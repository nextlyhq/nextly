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
  DesiredSchema,
} from "../domains/schema/pipeline/types";

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
}

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

  if (collections.length === 0) return { kind: "clean" };

  // Bounded-parallel preview. Earlier this was `Promise.all` of N parallel
  // calls, which against a Neon poolMax:5 with 10+ collections instantly
  // saturated the pool and queued requests behind a 20s connectionTimeout.
  // Drift check is informational and dev-only — bounded concurrency keeps
  // the boot path responsive without losing the wall-time win over serial.
  const DRIFT_CONCURRENCY = 3;
  const results: Array<
    { ok: true; opCount: number } | { ok: false; error: string }
  > = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < collections.length) {
      const myIndex = cursor++;
      const collection = collections[myIndex];
      try {
        const preview = await deps.previewDesiredSchema({
          desired: {
            collections: {
              [collection.slug]: collection as unknown as DesiredCollection,
            },
            singles: {},
            components: {},
          },
          db: adapter.getDrizzle(),
          dialect: adapter.dialect,
        });
        results[myIndex] = { ok: true, opCount: preview.operations.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug?.(
          `[nextly] Drift preview failed for '${collection.slug}': ${msg} (continuing).`
        );
        results[myIndex] = { ok: false, error: msg };
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(DRIFT_CONCURRENCY, collections.length) },
      () => worker()
    )
  );

  let pendingOps = 0;
  let failureCount = 0;
  for (const r of results) {
    if (r.ok) pendingOps += r.opCount;
    else failureCount += 1;
  }

  // PR 6 review #5: surface aggregate failure count so users notice
  // when drift introspection is broken on most collections.
  if (failureCount > 0) {
    logger.warn(
      `[nextly] ${failureCount} of ${collections.length} drift previews failed. ` +
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
