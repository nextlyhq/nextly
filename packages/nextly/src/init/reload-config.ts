// What: re-reads nextly.config.ts and applies code-first schema deltas in
// the same process. Called from getNextly() when the HMR listener has
// flipped the reload flag.
//
// Why a helper: keeps init.ts clean. The actual config-loading + DDL apply
// flows through the F2 applyDesiredSchema pipeline.
//
// Safety stance (F4 Option E PR 4):
//   - Pure additive deltas (add table/column, default change) auto-apply.
//   - Drop+add pairs that the rename detector picks up as candidates flow
//     through to the pipeline so the clack PromptDispatcher can confirm
//     them in the terminal.
//   - Standalone drops (a removed field with no rename target), table
//     drops, and lossy type / NOT NULL changes are still skipped with a
//     warning. Until F5 ships a real Classifier, code-first has no
//     terminal UI for those, and silent auto-apply would lose data.
//   - Tables where drops > adds also get skipped: the dispatcher can only
//     match `min(drops, adds)` pairs, so the surplus drops would silently
//     become data loss even after the user confirms renames.
//   - Non-TTY runtimes (CI, IDE task runners) still hit the rename
//     prompt, but ClackTerminalPromptDispatcher throws TTYRequiredError
//     which the pipeline maps to CONFIRMATION_REQUIRED_NO_TTY. We log
//     that and keep the dev server alive.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { createApplyDesiredSchema } from "../domains/schema/pipeline/apply";
import { RealClassifier } from "../domains/schema/pipeline/classifier/classifier";
import { extractDatabaseNameFromUrl } from "../domains/schema/pipeline/database-url";
import { buildDesiredTableFromFields } from "../domains/schema/pipeline/diff/build-from-fields";
import { diffSnapshots } from "../domains/schema/pipeline/diff/diff";
import { introspectLiveSnapshot } from "../domains/schema/pipeline/diff/introspect-live";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../domains/schema/pipeline/diff/types";
import { RealPreCleanupExecutor } from "../domains/schema/pipeline/pre-cleanup/executor";
import { ClackTerminalPromptDispatcher } from "../domains/schema/pipeline/prompt-dispatcher/clack-terminal";
import type {
  MigrationJournal,
  PromptDispatcher,
} from "../domains/schema/pipeline/pushschema-pipeline-interfaces";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../domains/schema/pipeline/pushschema-pipeline-stubs";
import { PushSchemaPipeline } from "../domains/schema/pipeline/pushschema-pipeline";
import { RegexRenameDetector } from "../domains/schema/pipeline/rename-detector";
import type {
  DesiredCollection,
  DesiredSchema,
} from "../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../domains/schema/services/drizzle-statement-executor";
import { getProductionNotifier } from "../runtime/notifications/index";

// Service-resolver shape. Defaulted to the real getService at runtime;
// tests inject a lighter-weight resolver to avoid pulling DI internals.
// Return value is `unknown` because ESLint's no-redundant-type-constituents
// rule rejects `unknown | Promise<unknown>`; `unknown` already includes
// Promises and the call site awaits the result so both shapes work.
type ServiceResolver = (name: string) => unknown;

type LoggerLike = {
  warn: (msg: string) => void;
  info: (msg: string) => void;
  error: (msg: string) => void;
};

// Minimal duck-typed shape for the database adapter — only the readonly
// `dialect` property and `getDrizzle()` method we invoke. Matches the
// public surface of DrizzleAdapter; full type imported from
// adapter-drizzle would couple this module to the adapter package.
interface AdapterLike {
  readonly dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle(): unknown;
}

type CollectionDef = {
  slug?: string;
  tableName?: string;
  fields?: unknown[];
};

// Minimal field shape passed to buildDesiredTableFromFields. Mirrors the
// MinimalFieldDef in build-from-fields.ts (kept duck-typed here to avoid
// importing private types).
interface MinimalField {
  name: string;
  type: string;
  required?: boolean;
}

// Default resolver: lazy-imports DI to avoid a circular import with init.ts.
async function defaultResolver(name: string): Promise<unknown> {
  const { getService } = await import("../di/register");
  // The DI key types are a fixed map; we cast through the resolver edge.
  return getService(name as Parameters<typeof getService>[0]);
}

// Reload entry point. resolver is optional and exists primarily for tests.
// dispatcher is also test-only: injects a fake PromptDispatcher (e.g., one
// that records prompts and auto-confirms) so tests don't need a real TTY.
export async function reloadNextlyConfig(opts?: {
  resolver?: ServiceResolver;
  dispatcher?: PromptDispatcher;
}): Promise<void> {
  const resolverArg = opts?.resolver;
  const resolve = (name: string): unknown =>
    resolverArg ? resolverArg(name) : defaultResolver(name);

  // Re-read disk. The config-loader has its own in-memory cache; we
  // explicitly clear it so we definitely pick up the just-saved file
  // even on hosts with coarse mtime resolution.
  // The whole load is wrapped in try/catch because users routinely save
  // nextly.config.ts mid-edit with syntax errors during dev. Without this
  // guard, the loader rejection bubbles through getNextly() and turns
  // every subsequent request into a 500.
  let newConfig: { collections?: CollectionDef[] } | undefined;
  try {
    const { loadConfig, clearConfigCache } = await import(
      "../cli/utils/config-loader"
    );
    clearConfigCache();
    const result = await loadConfig();
    newConfig = (result as { config?: { collections?: CollectionDef[] } })
      .config;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Nextly HMR] Could not reload nextly.config.ts: ${msg}. ` +
        `Keeping the previously-loaded config. Fix the syntax error and ` +
        `save again to retry.`
    );
    return;
  }
  if (!newConfig) return;

  // databaseAdapter doubles as our DI-readiness probe. We don't need any
  // other service from DI in this path — the new gate gets prior-state
  // straight from the live DB via introspectLiveSnapshot, not from the
  // collection registry as the F1 preview gate did.
  let logger: LoggerLike | undefined;
  let adapter: AdapterLike | undefined;
  // F8 PR 5: pull the journal from DI so HMR-driven applies get
  // recorded alongside admin-UI applies. Optional — if DI hasn't
  // registered it (e.g. very early HMR), we fall back to the noop
  // and the apply still proceeds.
  let migrationJournal: MigrationJournal | undefined;
  try {
    logger = (await resolve("logger")) as LoggerLike;
    adapter = (await resolve("databaseAdapter")) as AdapterLike;
    migrationJournal = (await resolve("migrationJournal")) as
      | MigrationJournal
      | undefined;
  } catch {
    // DI not initialised yet (init-time race). Nothing to do.
    return;
  }
  if (!adapter) return;

  // dialect is an abstract readonly property on DrizzleAdapter, not a
  // method (a previous iteration mistakenly called .getDialect() which
  // would crash at runtime).
  const dialect = adapter.dialect;
  const db = adapter.getDrizzle();

  // Normalize collections to (slug, tableName, fields) tuples. Drop
  // entries without a slug — they can't be addressed.
  const targets: Array<{
    slug: string;
    tableName: string;
    fields: MinimalField[];
  }> = [];
  for (const c of newConfig.collections ?? []) {
    if (!c.slug) continue;
    targets.push({
      slug: c.slug,
      tableName: c.tableName ?? `dc_${c.slug}`,
      fields: (c.fields ?? []) as MinimalField[],
    });
  }
  if (targets.length === 0) return;

  // ONE batched introspect for every managed table the config knows about.
  // Replaces N per-collection round-trips. If the call fails, abort the
  // reload entirely — it's a connection-level failure, not a per-table
  // problem we can usefully partial-apply around.
  let liveSnapshot: NextlySchemaSnapshot;
  try {
    liveSnapshot = await introspectLiveSnapshot(
      db,
      dialect,
      targets.map(t => t.tableName)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error(
      `[Nextly HMR] Could not introspect live schema: ${msg}. ` +
        `No code-first schema changes were applied this cycle.`
    );
    return;
  }
  const liveByTable = new Map<string, TableSpec>();
  for (const t of liveSnapshot.tables) liveByTable.set(t.name, t);

  // Per-collection diff + safety classification. Replaces the F1 preview
  // gate. Pure-additive collections + collections whose drop+add pairs
  // can be fully covered by rename candidates flow through to the
  // pipeline. Everything else gets logged + skipped.
  const desiredCollections: Record<string, DesiredCollection> = {};
  for (const target of targets) {
    try {
      const live = liveByTable.has(target.tableName)
        ? { tables: [liveByTable.get(target.tableName)!] }
        : { tables: [] };
      const desiredTable = buildDesiredTableFromFields(
        target.tableName,
        target.fields,
        dialect
      );
      const operations = diffSnapshots(live, { tables: [desiredTable] });

      if (operations.length === 0) continue;

      const classification = classifyForCodeFirst(operations, dialect);
      if (!classification.safe) {
        logger?.warn(
          `[Nextly HMR] Code-first change for '${target.slug}' needs review ` +
            `(${classification.reason}). Auto-apply skipped to prevent ` +
            `data loss without explicit resolutions. Use the admin Schema ` +
            `Builder to confirm with resolutions, or revert the config edit.`
        );
        continue;
      }

      desiredCollections[target.slug] = {
        slug: target.slug,
        tableName: target.tableName,
        fields: target.fields as DesiredCollection["fields"],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.warn(
        `[Nextly HMR] Skipping '${target.slug}' due to error during diff: ${msg}`
      );
    }
  }

  // Nothing to apply.
  if (Object.keys(desiredCollections).length === 0) return;

  // One batch pipeline call with the full snapshot. The pipeline runs its
  // own introspect + diff inside (the gate's diff above is for safety
  // classification only), so it's self-contained.
  const databaseName =
    dialect === "mysql"
      ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
      : undefined;

  const desired: DesiredSchema = {
    collections: desiredCollections,
    singles: {},
    components: {},
  };

  // Per-call factory (not the DI-bound applyDesiredSchema in
  // pipeline/index.ts) so we can thread MySQL databaseName + the
  // resolved adapter into the F3 PushSchemaPipeline at this site.
  // F8 will collapse both seams into the unified pipeline.
  const promptDispatcher =
    opts?.dispatcher ?? new ClackTerminalPromptDispatcher();
  const apply = createApplyDesiredSchema({
    applyPipeline: (desiredArg, sourceArg, channelArg) => {
      const pipeline = new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db),
        renameDetector: new RegexRenameDetector(),
        // F5 PR 5: real classifier emits add_not_null_with_nulls,
        // add_required_field_no_default, and type_change events from the
        // typed Operation[] stream. ClackTerminalPromptDispatcher renders
        // them in the terminal; RealPreCleanupExecutor runs UPDATE/DELETE.
        classifier: new RealClassifier(),
        promptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        // F8 PR 5: real journal from DI; falls back to noop if DI
        // hasn't registered it yet (very-early HMR cycles).
        migrationJournal: migrationJournal ?? noopMigrationJournal,
        // F10 PR 3: HMR applies print a terminal box + write the
        // NDJSON line. Same singleton across HMR cycles.
        notifier: getProductionNotifier(),
      });
      return pipeline.apply({
        desired: desiredArg,
        db,
        dialect,
        source: sourceArg,
        promptChannel: channelArg,
        databaseName,
      });
    },
    // Unused for source='code' — HMR skips the version check.
    readSchemaVersionForSlug: () => Promise.resolve(null),
    // Unused for HMR — we don't surface bumped versions in the log.
    readNewSchemaVersionsForSlugs: () => Promise.resolve({}),
  });

  const applyResult = await apply(desired, "code", {
    promptChannel: "terminal",
  });

  if (!applyResult.success) {
    // CONFIRMATION_REQUIRED_NO_TTY is the expected outcome when a rename
    // is detected on a non-TTY runtime (CI, IDE task runner). Surface it
    // as a warn (actionable for the user) rather than an error (which
    // implies a bug). All other codes still go through error.
    const code = applyResult.error.code;
    const msg = `[Nextly HMR] Batch apply failed (${code}): ${applyResult.error.message}`;
    if (code === "CONFIRMATION_REQUIRED_NO_TTY") {
      logger?.warn(msg);
    } else {
      logger?.error(msg);
    }
  }
}

// Decides whether a collection's ops are safe to auto-apply in code-first.
// The gate borrows the pipeline's own RegexRenameDetector dialect rules
// implicitly through the diff so it sees the same drop+add candidates
// the pipeline + clack dispatcher will.
//
//   - Pure additive (add_*, change_column_default) -> safe.
//   - drop_column in a table where the same-table drop count <= add count
//     -> safe (the dispatcher can pair every drop to at least one
//     potential rename target; the user confirms or declines per drop).
//   - drop_column in a table where drops > adds -> unsafe. The dispatcher
//     can only ever confirm `min(drops, adds)` renames, so the surplus
//     drops fall through as drop_and_add (silent data loss). Standalone
//     drops with zero same-table adds are the same case (drops > 0,
//     adds = 0).
//   - drop_table, change_column_type, NOT NULL adds -> unsafe (lossy
//     and no Classifier-driven prompt yet; F5 will refine).
function classifyForCodeFirst(
  operations: Operation[],
  _dialect: SupportedDialect
): { safe: true } | { safe: false; reason: string } {
  if (operations.length === 0) return { safe: true };

  // Per-table drop / add counts. The asymmetry test below is the
  // load-bearing rename safety check: if every drop has at least one
  // potential rename target in the same table (drops <= adds) the
  // dispatcher can ask the user; otherwise some drops would silently
  // become data loss even after the user confirms.
  const dropsPerTable = new Map<string, number>();
  const addsPerTable = new Map<string, number>();
  for (const op of operations) {
    if (op.type === "drop_column") {
      dropsPerTable.set(
        op.tableName,
        (dropsPerTable.get(op.tableName) ?? 0) + 1
      );
    } else if (op.type === "add_column") {
      addsPerTable.set(op.tableName, (addsPerTable.get(op.tableName) ?? 0) + 1);
    }
  }

  const reasons: string[] = [];
  for (const [t, drops] of dropsPerTable) {
    const adds = addsPerTable.get(t) ?? 0;
    if (drops > adds) {
      const surplus = drops - adds;
      reasons.push(
        adds === 0
          ? `drops ${drops} column(s) from '${t}' with no replacement(s); ${surplus} cannot be renamed without data loss`
          : `drops ${drops} columns from '${t}' but only ${adds} replacement(s); at least ${surplus} cannot be renamed without data loss`
      );
    }
  }
  for (const op of operations) {
    if (op.type === "drop_table") {
      reasons.push(`drops table '${op.tableName}'`);
    } else if (op.type === "change_column_type") {
      reasons.push(
        `changes column '${op.columnName}' type from '${op.fromType}' to '${op.toType}'`
      );
    } else if (op.type === "change_column_nullable" && !op.toNullable) {
      reasons.push(
        `adds NOT NULL to column '${op.columnName}' (would fail on existing rows without a default)`
      );
    }
  }

  if (reasons.length > 0) {
    return { safe: false, reason: reasons.join("; ") };
  }
  return { safe: true };
}
