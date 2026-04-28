// Public exports for the schema apply pipeline.
//
// Two entry-point shapes coexist intentionally during the F3 transition:
//
//   1. The factory `createApplyDesiredSchema(deps)` from ./apply.js — used
//      by today's in-process callers (init/reload-config.ts and the UI
//      dispatcher). They construct per-call factories with locally-resolved
//      services so they can wire MySQL `databaseName` from the connection
//      URL into the pipeline's apply() args, and so existing test seams
//      keep working without DI mocking.
//
//   2. The DI-bound `applyDesiredSchema` re-exported below — positioned for
//      future external / plugin / integration-test callers that want a
//      zero-wiring entry point. Resolves services from the DI container at
//      first call and caches. MySQL via this entry point requires the
//      caller to extract databaseName themselves and pass it through —
//      F8 will wire this fully when it absorbs the callers.

import {
  getAdapterFromDI,
  getCollectionRegistryFromDI,
} from "../../../dispatcher/helpers/di.js";
import { DrizzleStatementExecutor } from "../services/drizzle-statement-executor.js";

import {
  createApplyDesiredSchema,
  type ApplyDesiredSchemaDeps,
  type ApplyDesiredSchemaFn,
} from "./apply.js";
import { ClackTerminalPromptDispatcher } from "./prompt-dispatcher/clack-terminal.js";
import {
  noopClassifier,
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "./pushschema-pipeline-stubs.js";
import { PushSchemaPipeline } from "./pushschema-pipeline.js";
import { RegexRenameDetector } from "./rename-detector.js";
import type { DesiredSchema } from "./types.js";

export type {
  DesiredCollection,
  DesiredComponent,
  DesiredSchema,
  DesiredSingle,
} from "./types.js";

export type { SchemaApplyErrorCode } from "./errors.js";

export type { ApplyResult } from "./apply.js";

export {
  buildDesiredSchemaFromRegistry,
  buildDesiredSchemaFromRegistryAsync,
  type DesiredSchemaOverrides,
} from "./snapshot.js";

// Lazy DI binding — the deps object is built on first call so the
// DI container has finished registration before resolution.
let cached: ApplyDesiredSchemaFn | null = null;

export const applyDesiredSchema: ApplyDesiredSchemaFn = (
  desired,
  source,
  ctx
) => {
  cached ??= createApplyDesiredSchema(buildProductionDeps());
  return cached(desired, source, ctx);
};

/**
 * Test-only: reset the cached binding so a subsequent applyDesiredSchema
 * call re-resolves DI. Used by integration tests that swap the container.
 * @internal
 */
export function _resetApplyDesiredSchemaForTests(): void {
  cached = null;
}

function buildProductionDeps(): ApplyDesiredSchemaDeps {
  return {
    async applyPipeline(
      desired: DesiredSchema,
      source: "ui" | "code",
      promptChannel: "browser" | "terminal"
    ) {
      const adapter = getAdapterFromDI();
      if (!adapter) {
        throw new Error(
          "applyDesiredSchema: database adapter not registered in DI container"
        );
      }
      // dialect is an abstract readonly property on DrizzleAdapter,
      // not a method (a previous iteration mistakenly called .getDialect()
      // which would crash at runtime; tsc missed it because of `as any`).
      const dialect = adapter.dialect;
      const db = adapter.getDrizzle();

      // F4 Option E PR 4: real terminal-channel PromptDispatcher.
      // Throws TTYRequiredError on non-TTY runtimes; the pipeline's
      // classifyErrorCode maps that to CONFIRMATION_REQUIRED_NO_TTY.
      const pipeline = new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db),
        renameDetector: new RegexRenameDetector(),
        classifier: noopClassifier,
        promptDispatcher: new ClackTerminalPromptDispatcher(),
        preRenameExecutor: noopPreRenameExecutor,
        migrationJournal: noopMigrationJournal,
      });

      // MySQL note: the DI-bound entry point doesn't have access to
      // the caller's connection URL, so it can't auto-extract
      // databaseName for MySQL. Per-call factories (in reload-config.ts
      // and collection-dispatcher.ts) do extract it themselves. F8 will
      // collapse the two paths — until then, MySQL via this entry point
      // throws loudly inside PushSchemaPipeline.importDrizzleKit.
      return pipeline.apply({
        desired,
        db,
        dialect,
        source,
        promptChannel,
      });
    },

    async readSchemaVersionForSlug(slug: string): Promise<number | null> {
      const registry = getCollectionRegistryFromDI();
      if (!registry) return null;
      const record = await registry.getCollectionBySlug(slug);
      const v = record?.schemaVersion;
      return typeof v === "number" ? v : null;
    },

    async readNewSchemaVersionsForSlugs(
      slugs: string[]
    ): Promise<Record<string, number>> {
      if (slugs.length === 0) return {};
      const registry = getCollectionRegistryFromDI();
      if (!registry) return {};
      const out: Record<string, number> = {};
      for (const slug of slugs) {
        const record = await registry.getCollectionBySlug(slug);
        const v = record?.schemaVersion;
        if (typeof v === "number") out[slug] = v;
      }
      return out;
    },
  };
}
