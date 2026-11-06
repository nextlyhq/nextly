/**
 * What a Schema Builder save of a collection writes, and in development runs.
 *
 * One writer for every save of a collection, whichever surface made it (the
 * admin, a plugin's `ctx.services.collections`, the `CollectionsHandler`):
 *
 * 1. the history checks `nextly migrate` runs first: an applied file edited or
 *    missing, or an attempt left unfinished, refuses the save before anything
 *    is written;
 * 2. the collection's whole definition, into the definition file
 *    (`db.uiSchemaFile`), replaced in one rename;
 * 3. the migration and snapshot `migrate:create` would write for the
 *    collection alone, into `db.migrationsDir`. A collection whose table the
 *    database has and no snapshot records is adopted first: a file describing
 *    the table as it stands, so a fresh database replays it;
 * 4. in development, each new file run through the runner `nextly migrate`
 *    records with, so it is recorded applied with its checksum and `nextly
 *    migrate` has nothing left to do. Outside development nothing runs, and
 *    the deploy's `nextly migrate` applies the files.
 *
 * A save whose statements fail where nothing of them applied leaves no file
 * and puts the definition back; one that failed part-way (MySQL, which
 * commits each statement) keeps its files for `nextly migrate:resolve`, and
 * says so. The registry row is the caller's, written once this returns.
 *
 * @module domains/schema/builder-save/collection-save
 */
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { serializeUiSchema } from "../../../cli/utils/ui-schema-writer";
import { NextlyError } from "../../../errors/nextly-error";
import type {
  UiSchemaEntity,
  UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import { checksumOf } from "../migrate/applied-checksums";
import { reconcileFile, runRecordedAttempt } from "../migrate/drift-reconcile";
import { runMigrationStatements } from "../migrate/migration-transaction";
import { resolveMigration } from "../migrate/resolve";
import { marksNoTransaction, splitSqlStatements } from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import {
  appMigrationInputs,
  type AppMigrationInputsArgs,
} from "../migrate-create/app-migration-inputs";
import { generateMigration } from "../migrate-create/generate";
import { loadLatestSnapshot } from "../migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import type { RenameCandidate } from "../pipeline/pushschema-pipeline-interfaces";
import { toSnakeCase } from "../services/field-column-descriptor";
import { loadUiSchema } from "../ui-schema/loader";
import { mutateManifest } from "../ui-schema/mutate";
import { resolveCollectionTableName } from "../utils/resolve-table-name";

/** What the writer works with: the app's database, config and folders. */
export interface CollectionSaveDeps {
  adapter: DrizzleAdapter;
  /** The config the app runs with, plugin contributions folded in. */
  config: AppMigrationInputsArgs["config"];
  deferredExtends?: AppMigrationInputsArgs["deferredExtends"];
  /** The project root, which `db.uiSchemaFile` is resolved against. */
  projectRoot: string;
  /** Absolute path to `db.migrationsDir`. */
  migrationsDir: string;
  /** Whether a save runs its migration here: in development. */
  applies: boolean;
  logger: {
    info(m: string): void;
    warn(m: string): void;
    error(m: string): void;
  };
}

/** One save of one collection. */
export interface CollectionSave {
  slug: string;
  /** The collection as it stood before the save; null for a create. */
  previous: UiSchemaEntity | null;
  /** The collection after the save; null when the save deletes it. */
  entity: UiSchemaEntity | null;
  /** The change in a word or two, for the file name: `create`, `update`, `delete`. */
  change: string;
  /** The fields the person renamed, by name: written as renames, keeping their values. */
  renamedFields?: ReadonlyArray<{ from: string; to: string }>;
  /** Override the clock for tests. */
  now?: Date;
}

/** What a save wrote. */
export interface CollectionSaveResult {
  /** The migration files the save wrote, in run order. */
  files: string[];
  /** Whether they were run and recorded applied here. */
  applied: boolean;
}

/**
 * Write the save's definition and migration and, in development, run it. See
 * the module comment for the order and what a failure leaves.
 */
export async function writeCollectionSave(
  deps: CollectionSaveDeps,
  save: CollectionSave
): Promise<CollectionSaveResult> {
  await refuseUnsettledHistory(deps);

  const definitionPath = resolve(deps.projectRoot, deps.config.db.uiSchemaFile);
  const before = await readIfPresent(definitionPath);
  const current = await loadUiSchema({
    projectRoot: deps.projectRoot,
    uiSchemaFile: deps.config.db.uiSchemaFile,
  });
  const next = withCollection(current, save.slug, save.entity);
  await writeAtomically(definitionPath, serializeUiSchema(next));

  const written: string[] = [];
  try {
    const now = save.now ?? new Date();
    const table = resolveCollectionTableName(save.slug);
    const adopting =
      save.previous !== null && (await needsAdopting(deps, table));
    if (adopting && save.previous !== null) {
      written.push(
        ...(await generateFor(deps, {
          manifest: withCollection(current, save.slug, save.previous),
          save,
          name: `${migrationSlug(save.slug)}_adopt`,
          table,
          now,
        }))
      );
    }
    written.push(
      ...(await generateFor(deps, {
        manifest: next,
        save,
        name: `${migrationSlug(save.slug)}_${save.change}`,
        table,
        now: adopting ? new Date(now.getTime() + 1) : now,
      }))
    );
    if (deps.applies) await runWritten(deps, written, table);
    return { files: written, applied: deps.applies };
  } catch (error) {
    await undoUnapplied(deps, written, before, definitionPath, error);
    throw error;
  }
}

/**
 * The history checks `nextly migrate` makes before its first write, asked as
 * they are asked there: through the command's own module, loaded on first use
 * as boot loads it. A refusal reaches the person saving as a conflict with the
 * text the command prints, naming what to settle.
 */
async function refuseUnsettledHistory(deps: CollectionSaveDeps): Promise<void> {
  const [
    {
      assertAppliedFilesPresent,
      assertAppliedFilesUnchanged,
      refuseUnresolvedAppAttempts,
    },
    { CliError },
  ] = await Promise.all([
    import("../../../cli/commands/migrate"),
    import("../../../cli/errors/cli-error"),
  ]);
  const args = {
    adapter: deps.adapter,
    db: deps.adapter.getDrizzle(),
    dialect: deps.adapter.getCapabilities().dialect,
    migrationsDir: deps.migrationsDir,
    logger: commandLogger(deps.logger),
    command: "the Schema Builder save",
  };
  try {
    await refuseUnresolvedAppAttempts(args);
    await assertAppliedFilesUnchanged(args);
    await assertAppliedFilesPresent(args);
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    const text =
      error instanceof CliError
        ? `${error.what} ${error.next}`
        : error.publicMessage;
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_HISTORY_REFUSED",
      publicMessage: text,
      logContext: { refusedBy: error.code },
      cause: error,
    });
  }
}

/**
 * A logger in the command's shape for the history checks, which say only what
 * they find (`info`, `warn`, `error`); the rest of the command's output has no
 * reader here.
 */
function commandLogger(logger: CollectionSaveDeps["logger"]) {
  const none = () => {};
  return {
    debug: none,
    info: (m: string) => logger.info(m),
    warn: (m: string) => logger.warn(m),
    error: (m: string) => logger.error(m),
    success: (m: string) => logger.info(m),
    newline: none,
    divider: none,
    header: none,
    item: none,
    keyValue: none,
    table: none,
    spinner: () => ({ stop: none }),
    setOptions: none,
    getOptions: () => ({}),
  };
}

/** The definition with `slug` replaced by `entity`, or removed where it is null. */
function withCollection(
  manifest: UiSchemaManifest,
  slug: string,
  entity: UiSchemaEntity | null
): UiSchemaManifest {
  return entity === null
    ? mutateManifest(manifest, { type: "delete", kind: "collections", slug })
    : mutateManifest(manifest, { type: "upsert", kind: "collections", entity });
}

/** A file's text, or undefined where there is none. */
async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Replace `path` with `text` in one rename, so a reader never sees half a
 * file, and a write that fails leaves the old one whole.
 */
async function writeAtomically(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: "utf-8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** A slug as a migration name spells it. */
const migrationSlug = (slug: string) => slug.replace(/-/g, "_");

/**
 * Whether the collection's table is in the database and in no snapshot: a
 * table an earlier Builder made, which the folder cannot replay until a file
 * describes it.
 */
async function needsAdopting(
  deps: CollectionSaveDeps,
  table: string
): Promise<boolean> {
  const latest = await loadLatestSnapshot(join(deps.migrationsDir, "meta"));
  if (latest?.data.snapshot.tables.some(t => t.name === table) === true) {
    return false;
  }
  return deps.adapter.tableExists(table);
}

/**
 * Generate the collection's migration from `manifest` into the folder, and
 * name every file the run wrote (its main file and any companion beside it),
 * in run order.
 */
async function generateFor(
  deps: CollectionSaveDeps,
  args: {
    manifest: UiSchemaManifest;
    save: CollectionSave;
    name: string;
    table: string;
    now: Date;
  }
): Promise<string[]> {
  const dialect = deps.adapter.getCapabilities().dialect;
  const inputs = await appMigrationInputs({
    config: deps.config,
    ...(deps.deferredExtends === undefined
      ? {}
      : { deferredExtends: deps.deferredExtends }),
    manifest: args.manifest,
    projectRoot: deps.projectRoot,
    migrationsDir: deps.migrationsDir,
    dialect,
    logger: deps.logger,
  });
  const before = new Set(await sqlFiles(deps.migrationsDir));
  const result = await generateMigration({
    name: args.name,
    dialect,
    migrationsDir: deps.migrationsDir,
    collections: inputs.collections,
    singles: inputs.singles,
    components: inputs.components,
    metadataUpserts: inputs.metadataUpserts,
    previousMetadataUpserts: inputs.previousMetadataUpserts,
    appStream: inputs.appStream,
    defaultLocale: deps.config.localization?.defaultLocale,
    onWarning: message => deps.logger.warn(message),
    scope: {
      kind: "collection",
      slug: args.save.slug,
      tables: new Set([args.table]),
    },
    decideRenames: candidates =>
      Promise.resolve(renamesOf(candidates, args.save.renamedFields ?? [])),
    now: args.now,
  });
  if (result === null) return [];
  return (await sqlFiles(deps.migrationsDir)).filter(f => !before.has(f));
}

/** Each candidate accepted exactly where the person renamed that field. */
function renamesOf(
  candidates: readonly RenameCandidate[],
  renamed: ReadonlyArray<{ from: string; to: string }>
): { candidate: RenameCandidate; accepted: boolean }[] {
  const pairs = new Set(
    renamed.map(r => `${toSnakeCase(r.from)}\u0000${toSnakeCase(r.to)}`)
  );
  return candidates.map(candidate => ({
    candidate,
    accepted: pairs.has(`${candidate.fromColumn}\u0000${candidate.toColumn}`),
  }));
}

/** The folder's migration files, in run order. */
async function sqlFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Run each written file as `nextly migrate` runs it, recorded in the ledger:
 * one with a snapshot through the reconcile, judged on the collection's table
 * alone; a companion with none, as written.
 */
async function runWritten(
  deps: CollectionSaveDeps,
  files: readonly string[],
  table: string
): Promise<void> {
  const db = deps.adapter.getDrizzle();
  const dialect = deps.adapter.getCapabilities().dialect;
  const repo = new SchemaEventsRepository(db, dialect);
  const executeSql = (
    sql: string,
    unit: { source: string; transaction: boolean },
    after: (db: unknown, statementsExecuted: number) => Promise<void>
  ) =>
    runMigrationStatements(
      deps.adapter,
      splitSqlStatements(sql, dialect, unit),
      unit,
      after
    );
  let before = await scopedSnapshotBefore(deps, files[0], table);
  for (const filename of files) {
    const path = join(deps.migrationsDir, filename);
    const content = await readFile(path, "utf-8");
    const file = {
      filename,
      sql: parseSqlSections(content).upSql,
      path,
      sha256: checksumOf(content),
      transaction: !marksNoTransaction(content),
    };
    const target = await snapshotOf(deps, filename);
    if (target === null) {
      await runRecordedAttempt({ file, dialect, repo, executeSql });
      continue;
    }
    const scopedTarget = onlyTable(target, table);
    const live = await introspectLiveSnapshot(
      db,
      dialect,
      (await deps.adapter.tableExists(table)) ? [table] : []
    );
    await reconcileFile({
      file,
      before,
      target: scopedTarget,
      live: onlyTable(live, table),
      dialect,
      repo,
      executeSql,
    });
    before = scopedTarget;
  }
}

/** The snapshot beside `filename`, or null where it has none. */
async function snapshotOf(
  deps: CollectionSaveDeps,
  filename: string
): Promise<NextlySchemaSnapshot | null> {
  const text = await readIfPresent(
    join(
      deps.migrationsDir,
      "meta",
      filename.replace(/\.sql$/, ".snapshot.json")
    )
  );
  if (text === undefined) return null;
  return (JSON.parse(text) as { snapshot: NextlySchemaSnapshot }).snapshot;
}

/**
 * The collection's table as the snapshot before the save's first file
 * records it: the newest snapshot of a file older than that one.
 */
async function scopedSnapshotBefore(
  deps: CollectionSaveDeps,
  first: string | undefined,
  table: string
): Promise<NextlySchemaSnapshot> {
  const older = (await sqlFiles(deps.migrationsDir)).filter(
    f => first === undefined || f < first
  );
  for (const filename of older.reverse()) {
    const snapshot = await snapshotOf(deps, filename);
    if (snapshot !== null) return onlyTable(snapshot, table);
  }
  return { tables: [] };
}

/** `snapshot` holding only `table`, where it has it. */
function onlyTable(
  snapshot: NextlySchemaSnapshot,
  table: string
): NextlySchemaSnapshot {
  return { ...snapshot, tables: snapshot.tables.filter(t => t.name === table) };
}

/**
 * After a failed save: where nothing of the failed file applied, remove every
 * file the save wrote that the ledger does not record applied, with its
 * snapshot, and put the definition back as it was. A file that failed
 * part-way stays, with the definition it was written from, for `nextly
 * migrate:resolve` to settle.
 */
async function undoUnapplied(
  deps: CollectionSaveDeps,
  written: readonly string[],
  definition: string | undefined,
  definitionPath: string,
  error: unknown
): Promise<void> {
  if (partlyApplied(error)) {
    deps.logger.error(
      "The save's migration failed part-way, so its files stay for `nextly migrate:resolve`."
    );
    return;
  }
  const repo = new SchemaEventsRepository(
    deps.adapter.getDrizzle(),
    deps.adapter.getCapabilities().dialect
  );
  for (const filename of written) {
    if (deps.applies && (await repo.isFileApplied(filename))) continue;
    await settleAttempts(deps, repo, filename);
    await rm(join(deps.migrationsDir, filename), { force: true });
    await rm(
      join(
        deps.migrationsDir,
        "meta",
        filename.replace(/\.sql$/, ".snapshot.json")
      ),
      { force: true }
    );
  }
  if (definition === undefined) await rm(definitionPath, { force: true });
  else await writeAtomically(definitionPath, definition);
}

/**
 * Record that a removed file's failed attempt left nothing behind, as
 * `nextly migrate:resolve --failed-cleanup` records it. A file run outside a
 * transaction (MySQL's DDL) keeps a failed attempt in the ledger even when its
 * first statement failed; left standing, it would refuse every later save as
 * an attempt this build cannot judge. A file run in a transaction left none.
 */
async function settleAttempts(
  deps: CollectionSaveDeps,
  repo: SchemaEventsRepository,
  filename: string
): Promise<void> {
  if ((await repo.findFileApplies(filename)).length === 0) return;
  const removed = () =>
    Promise.reject(
      new NextlyError({
        code: "INTERNAL_ERROR",
        publicMessage: "A removed migration file has nothing to read.",
      })
    );
  await resolveMigration({
    mode: "failed-cleanup",
    filename,
    dialect: deps.adapter.getCapabilities().dialect,
    repo,
    // Read only by the other modes; the file is being removed.
    fileExists: () => Promise.resolve(false),
    loadTargetSnapshot: removed,
    marksNoTransaction: removed,
    fileChecksum: removed,
    introspectLive: removed,
  });
}

/** Whether the error says some of a file's statements stayed applied. */
function partlyApplied(error: unknown): boolean {
  if (!NextlyError.is(error)) return false;
  if (error.code === "NEXTLY_MIGRATION_PARTIALLY_APPLIED") return true;
  const cause = (error as { cause?: unknown }).cause;
  return (
    NextlyError.is(cause) && cause.code === "NEXTLY_MIGRATION_PARTIALLY_APPLIED"
  );
}
