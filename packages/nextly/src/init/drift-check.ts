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
// Performance (PR 6 review #4): all collection previews run in
// parallel via Promise.all so a project with 50 collections doesn't
// cost 50× the per-collection latency.

import type {
  DesiredCollection,
  DesiredSchema,
} from "../domains/schema/pipeline/types.js";

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

  // Parallel preview (PR 6 review #4): per-collection previews are
  // independent reads — running them in series adds wall time without
  // benefit. Promise.all caps boot delay at ~max-per-collection latency
  // instead of ~sum.
  const previewPromises = collections.map(async collection => {
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
      return { ok: true as const, opCount: preview.operations.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug?.(
        `[nextly] Drift preview failed for '${collection.slug}': ${msg} (continuing).`
      );
      return { ok: false as const, error: msg };
    }
  });
  const results = await Promise.all(previewPromises);

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
    "../domains/schema/pipeline/preview.js"
  );
  return {
    previewDesiredSchema:
      injected?.previewDesiredSchema ?? previewDesiredSchema,
  };
}
