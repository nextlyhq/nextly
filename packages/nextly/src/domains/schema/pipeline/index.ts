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
//      first call and caches. MySQL needs no caller cooperation here: the
//      database name comes from the live connection.

import {
  getAdapterFromDI,
  getCollectionRegistryFromDI,
  getMigrationJournalFromDI,
} from "../../../dispatcher/helpers/di";
import { getProductionNotifier } from "../../../runtime/notifications/index";
import { DrizzleStatementExecutor } from "../services/drizzle-statement-executor";

import {
  createApplyDesiredSchema,
  type ApplyDesiredSchemaDeps,
  type ApplyDesiredSchemaFn,
} from "./apply";
import { RealClassifier } from "./classifier/classifier";
import { currentMysqlDatabaseName } from "./database-url";
import { RealPreCleanupExecutor } from "./pre-cleanup/executor";
import { ClackTerminalPromptDispatcher } from "./prompt-dispatcher/clack-terminal";
import { PushSchemaPipeline } from "./pushschema-pipeline";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "./pushschema-pipeline-stubs";
import { RegexRenameDetector } from "./rename-detector";
import type { DesiredSchema } from "./types";

export type {
  DesiredCollection,
  DesiredFieldGroup,
  DesiredSchema,
  DesiredSingle,
} from "./types";

export type { SchemaApplyErrorCode } from "./errors";

export type { ApplyResult } from "./apply";

export {
  buildDesiredSchemaFromRegistry,
  buildDesiredSchemaFromRegistryAsync,
  type DesiredSchemaOverrides,
} from "./snapshot";

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
      // F5 PR 6: real classifier + real pre-cleanup executor wired here too.
      // This is the DI-bound entry point used by callers that don't manage
      // their own pipeline instance.
      // F8 PR 5: prefer the DI-registered journal; fall back to noop
      // when DI hasn't run yet (e.g. some test contexts construct the
      // pipeline before registerServices()).
      const migrationJournal =
        getMigrationJournalFromDI() ?? noopMigrationJournal;
      const pipeline = new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db),
        renameDetector: new RegexRenameDetector(),
        classifier: new RealClassifier(),
        promptDispatcher: new ClackTerminalPromptDispatcher(),
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        migrationJournal,
        // F10 PR 3: terminal box + NDJSON log line on every apply.
        notifier: getProductionNotifier(),
      });

      // drizzle-kit's MySQL pushSchema needs the database name as its own
      // argument. This entry point is handed a connection rather than a URL,
      // so it asks the connection which database it selected — authoritative,
      // and available even when the caller never set DATABASE_URL. Without it
      // every MySQL apply through here fails inside
      // PushSchemaPipeline.importDrizzleKit, which is what made boot-time
      // auto-sync silently skip creating a code-first collection's table.
      const databaseName =
        dialect === "mysql" ? await currentMysqlDatabaseName(db) : undefined;

      return pipeline.apply({
        desired,
        db,
        dialect,
        source,
        promptChannel,
        databaseName,
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
