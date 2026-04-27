// The pure pipeline factory for applyDesiredSchema.
//
// F2 ships this as a thin shim: each resource in the snapshot is
// delegated to the existing SchemaChangeService.apply via the injected
// applySingleResource callback. F3-F8 will replace the inner body
// without changing this module's exported signature.
//
// Multi-resource calls iterate sequentially without transaction
// wrapping. F3's PushSchemaPipeline will add db.transaction() for
// PG/SQLite atomicity. partiallyApplied is set when at least one
// resource succeeded before a later one failed.

import { classifyError, type SchemaApplyErrorCode } from "./errors.js";
import type {
  DesiredCollection,
  DesiredComponent,
  DesiredSchema,
  DesiredSingle,
} from "./types.js";

export type ApplyResult =
  | {
      success: true;
      newSchemaVersions: Record<string, number>;
      statementsExecuted: number;
      renamesApplied: number;
      durationMs: number;
    }
  | {
      success: false;
      error: {
        message: string;
        code: SchemaApplyErrorCode;
        details?: unknown;
      };
      partiallyApplied?: boolean;
      durationMs: number;
    };

export type AnyDesiredResource =
  | (DesiredCollection & { kind: "collection" })
  | (DesiredSingle & { kind: "single" })
  | (DesiredComponent & { kind: "component" });

// What the pipeline asks of its environment. In production, index.ts
// wires these to DI-resolved services. In tests, callers pass stubs.
export interface ApplyDesiredSchemaDeps {
  // Apply a single resource through the existing SchemaChangeService.
  // F2 shim calls this once per resource in the loop. The pipeline
  // aggregates statementsExecuted and renamesApplied across resources.
  applySingleResource(
    resource: AnyDesiredResource,
    source: "ui" | "code",
    promptChannel: "browser" | "terminal"
  ): Promise<{
    success: true;
    statementsExecuted: number;
    renamesApplied: number;
  }>;

  // Read the current schemaVersion for one slug from dynamic_collections.
  // Returns null when the slug has no row (fresh DB).
  readSchemaVersionForSlug(slug: string): Promise<number | null>;

  // After a successful apply, read the post-apply schemaVersion for
  // each touched slug. Returned as a map for the success result.
  readNewSchemaVersionsForSlugs(
    slugs: string[]
  ): Promise<Record<string, number>>;
}

export type ApplyDesiredSchemaFn = (
  desired: DesiredSchema,
  source: "ui" | "code",
  ctx: {
    schemaVersions?: Record<string, number>;
    promptChannel: "browser" | "terminal" | "auto";
  }
) => Promise<ApplyResult>;

export function createApplyDesiredSchema(
  deps: ApplyDesiredSchemaDeps
): ApplyDesiredSchemaFn {
  return async function applyDesiredSchema(desired, source, ctx) {
    const start = Date.now();

    // Resolve 'auto' channel. F10 will replace this with SSE detection.
    // For now, terminal is the only working channel.
    const resolvedChannel: "browser" | "terminal" =
      ctx.promptChannel === "auto" ? "terminal" : ctx.promptChannel;

    const resources = iterateResources(desired);

    // Optimistic-lock check — UI-source only. HMR (code) is the source
    // of truth for code-first edits and skips the check.
    if (source === "ui" && ctx.schemaVersions) {
      for (const r of resources) {
        const expected = ctx.schemaVersions[r.slug];
        if (expected === undefined) continue;
        const actual = await deps.readSchemaVersionForSlug(r.slug);
        if (actual !== null && actual !== expected) {
          return {
            success: false,
            error: {
              code: "SCHEMA_VERSION_CONFLICT",
              message: `Schema version conflict on '${r.slug}': expected ${expected}, found ${actual}. Reload and try again.`,
            },
            durationMs: Date.now() - start,
          };
        }
      }
    }

    // Sequential apply loop. F3 will wrap this in db.transaction()
    // for PG/SQLite atomicity. For F2, autocommit per resource.
    let totalStatements = 0;
    let totalRenames = 0;
    let appliedCount = 0;
    for (const r of resources) {
      try {
        const out = await deps.applySingleResource(r, source, resolvedChannel);
        totalStatements += out.statementsExecuted;
        totalRenames += out.renamesApplied;
        appliedCount += 1;
      } catch (err) {
        const classified = classifyError(err);
        return {
          success: false,
          error: classified,
          partiallyApplied: appliedCount > 0,
          durationMs: Date.now() - start,
        };
      }
    }

    const newSchemaVersions = await deps.readNewSchemaVersionsForSlugs(
      resources.map(r => r.slug)
    );

    return {
      success: true,
      newSchemaVersions,
      statementsExecuted: totalStatements,
      renamesApplied: totalRenames,
      durationMs: Date.now() - start,
    };
  };
}

// Flattens the three-bucket DesiredSchema into a single ordered list
// for sequential processing. Order: collections, then singles, then
// components — matches the FK dependency direction (collections may
// reference components but not vice versa).
function iterateResources(desired: DesiredSchema): AnyDesiredResource[] {
  const out: AnyDesiredResource[] = [];
  for (const c of Object.values(desired.collections)) {
    out.push({ ...c, kind: "collection" });
  }
  for (const s of Object.values(desired.singles)) {
    out.push({ ...s, kind: "single" });
  }
  for (const cm of Object.values(desired.components)) {
    out.push({ ...cm, kind: "component" });
  }
  return out;
}
