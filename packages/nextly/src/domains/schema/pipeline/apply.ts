// The pure pipeline factory for applyDesiredSchema.
//
// F3 PR-2 reshaped this from F2's per-resource shim (iterateResources +
// applySingleResource per resource) to a single-call pattern: callers
// inject an applyPipeline callback that takes the FULL desired snapshot
// and returns one PipelineResult. The internal loop is gone — the F3
// PushSchemaPipeline does its own per-table iteration via drizzle-kit's
// pushSchema, which fundamentally requires the full snapshot to apply
// MANAGED_TABLE_PREFIXES_REGEX correctness.
//
// This wrapper still owns:
//   - 'auto' promptChannel resolution (terminal until F10 wires SSE)
//   - per-slug optimistic-lock check (UI source only; HMR is the source
//     of truth)
//   - timing + ApplyResult discriminated-union shape

import { classifyError, type SchemaApplyErrorCode } from "./errors.js";
import type { DesiredSchema } from "./types.js";

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

// Result shape of one full-snapshot pipeline call. Mirrors F3's
// PushSchemaPipeline.PipelineResult so production callers can pass
// pipeline.apply directly through to deps.applyPipeline.
export interface PipelineCallResult {
  success: boolean;
  statementsExecuted: number;
  renamesApplied: number;
  error?: { code: string; message: string; details?: unknown };
  partiallyApplied?: boolean;
}

// What the pipeline asks of its environment. In production, callers
// wire applyPipeline to a closure that constructs and runs F3's
// PushSchemaPipeline. In tests, callers pass stubs.
export interface ApplyDesiredSchemaDeps {
  // Single-call pipeline invocation. Replaces F2's per-resource
  // applySingleResource pattern. The pipeline does its own per-table
  // iteration internally (via drizzle-kit's pushSchema).
  applyPipeline(
    desired: DesiredSchema,
    source: "ui" | "code",
    promptChannel: "browser" | "terminal"
  ): Promise<PipelineCallResult>;

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

    // Optimistic-lock check — UI-source only. HMR (code) is the source
    // of truth for code-first edits and skips the check.
    //
    // Race window: this loop reads each slug's version sequentially,
    // so a write to slug A could land between the A check and the B
    // check. F3's pipeline does the actual apply inside db.transaction()
    // on PG/SQLite — but the version check happens BEFORE the
    // transaction opens, so a concurrent change between the check and
    // the apply is still possible. Acceptable for v1 (admin saves are
    // per-resource today). F8/F15 may tighten this with a DB advisory
    // lock if real races emerge.
    if (source === "ui" && ctx.schemaVersions) {
      for (const slug of Object.keys(desired.collections)) {
        const expected = ctx.schemaVersions[slug];
        if (expected === undefined) continue;
        const actual = await deps.readSchemaVersionForSlug(slug);
        if (actual !== null && actual !== expected) {
          return {
            success: false,
            error: {
              code: "SCHEMA_VERSION_CONFLICT",
              message: `Schema version conflict on '${slug}': expected ${expected}, found ${actual}. Reload and try again.`,
            },
            durationMs: Date.now() - start,
          };
        }
      }
    }

    // Single pipeline call. F3's PushSchemaPipeline iterates internally
    // via drizzle-kit's pushSchema (which receives the full snapshot
    // and produces statements for all changed managed tables).
    let pipelineResult: PipelineCallResult;
    try {
      pipelineResult = await deps.applyPipeline(
        desired,
        source,
        resolvedChannel
      );
    } catch (err) {
      const classified = classifyError(err);
      return {
        success: false,
        error: classified,
        durationMs: Date.now() - start,
      };
    }

    if (!pipelineResult.success) {
      // Pipeline returned a typed failure (PUSHSCHEMA_FAILED,
      // DDL_EXECUTION_FAILED, etc.). Map it through to ApplyResult.
      return {
        success: false,
        error: {
          code: (pipelineResult.error?.code ??
            "INTERNAL_ERROR") as SchemaApplyErrorCode,
          message:
            pipelineResult.error?.message ??
            "Pipeline returned failure with no error details",
          details: pipelineResult.error?.details,
        },
        partiallyApplied: pipelineResult.partiallyApplied,
        durationMs: Date.now() - start,
      };
    }

    // Success — read the post-apply schema versions for any slugs we
    // touched (callers may use these for response shaping or telemetry).
    const allSlugs = Object.keys(desired.collections);
    const newSchemaVersions =
      await deps.readNewSchemaVersionsForSlugs(allSlugs);

    return {
      success: true,
      newSchemaVersions,
      statementsExecuted: pipelineResult.statementsExecuted,
      renamesApplied: pipelineResult.renamesApplied,
      durationMs: Date.now() - start,
    };
  };
}
