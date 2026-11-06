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
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { serializeUiSchema } from "../../../cli/utils/ui-schema-writer";
import { NextlyError } from "../../../errors/nextly-error";
import type {
  UiSchemaEntity,
  UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import { checksumOf } from "../migrate/applied-checksums";
import {
  reconcileFile,
  recordAlreadyApplied,
  runRecordedAttempt,
  snapshotsEquivalent,
} from "../migrate/drift-reconcile";
import { runMigrationStatements } from "../migrate/migration-transaction";
import { resolveMigration } from "../migrate/resolve";
import { marksNoTransaction, splitSqlStatements } from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import {
  appMigrationInputs,
  type AppMigrationInputsArgs,
} from "../migrate-create/app-migration-inputs";
import {
  buildDesiredSnapshotFromConfig,
  generateMigration,
  type AddedStatements,
} from "../migrate-create/generate";
import { loadLatestSnapshot } from "../migrate-create/snapshot-io";
import { diffSnapshots } from "../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";
import type { RenameCandidate } from "../pipeline/pushschema-pipeline-interfaces";
import { generateStatements } from "../pipeline/sql-templates/index";
import { toSnakeCase } from "../services/field-column-descriptor";
import { loadUiSchema } from "../ui-schema/loader";
import { uiToMinimal } from "../ui-schema/merge";
import { mutateManifest } from "../ui-schema/mutate";

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

/**
 * What the app's service registration knows of a save's writer: everything
 * but the database, the logger and whether saves run here, which the service
 * saving supplies.
 */
export type BuilderSaveSetup = Omit<
  CollectionSaveDeps,
  "adapter" | "logger" | "applies"
>;

/** One save of one collection. */
export interface CollectionSave {
  slug: string;
  /** The collection as it stood before the save; null for a create. */
  previous: UiSchemaEntity | null;
  /** The collection after the save; null when the save deletes it. */
  entity: UiSchemaEntity | null;
  /** The change in a word or two, for the file name: `create`, `update`, `delete`. */
  change: string;
  /**
   * The columns whose conversion the person confirmed in the save's review
   * (`previewCollectionSave`): a save converts no column it was not shown to.
   */
  acknowledgedConversions?: readonly string[];
  /**
   * The statements that take the collection's many-to-many junction tables
   * from before the save to after it, and back
   * (`DynamicCollectionService.junctionStatements`): written into the change's
   * file, since the generator writes no junction table.
   */
  junctions?: { up: readonly string[]; down: readonly string[] };
  /**
   * The collection's relationship foreign keys before the save and after it
   * (`DynamicCollectionService.relationshipForeignKeys`), which the column
   * mapping does not describe: a table the save creates is declared with
   * them, and an existing one has each removed or changed key dropped and
   * each new or changed one added, as the Builder's own DDL does. SQLite
   * cannot alter a key, so there, as in the Builder, only a new table gets
   * them.
   */
  keys?: {
    before: readonly ForeignKeySpec[];
    after: readonly ForeignKeySpec[];
  };
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
  save: CollectionSave,
  options: {
    /**
     * The history checks ran already (`checkSaveHistory`), before work the
     * caller did first: a delete checks before its teardown.
     */
    historyChecked?: boolean;
    /**
     * Keep the files a failure leaves: the caller changed the database before
     * the save (a delete's teardown), so they are what `nextly migrate`
     * finishes from.
     */
    keepFilesOnFailure?: boolean;
  } = {}
): Promise<CollectionSaveResult> {
  if (options.historyChecked !== true) await checkSaveHistory(deps);
  const plan = await planSave(deps, save);
  refuseUnconfirmedConversions(plan, save);

  const definitionPath = resolve(deps.projectRoot, deps.config.db.uiSchemaFile);
  const before = await readIfPresent(definitionPath);
  await writeAtomically(definitionPath, serializeUiSchema(plan.next));

  const written: string[] = [];
  try {
    const files = await writeFiles(deps, save, plan, names =>
      written.push(...names)
    );
    if (deps.applies) await runWritten(deps, files, plan.table);
    return { files: [...written], applied: deps.applies };
  } catch (error) {
    if (options.keepFilesOnFailure !== true) {
      await undoUnapplied(deps, written, before, definitionPath, error);
    }
    throw error;
  }
}

/**
 * What the save would write, generated as the save generates it into a
 * scratch folder holding the latest snapshots, with nothing written where the
 * app reads: the files, and each column the save also brings to the one
 * field-to-column mapping, as a line the person reads before confirming.
 */
export async function previewCollectionSave(
  deps: CollectionSaveDeps,
  save: CollectionSave
): Promise<CollectionSavePreview> {
  const plan = await planSave(deps, save);
  const scratch = await mkdtemp(join(tmpdir(), "nextly-save-preview-"));
  try {
    const meta = join(deps.migrationsDir, "meta");
    if (existsSync(meta)) {
      await cp(meta, join(scratch, "meta"), { recursive: true });
    }
    const files = await writeFiles(
      { ...deps, migrationsDir: scratch },
      save,
      plan,
      () => {}
    );
    const names = [
      ...(files.adopt === undefined ? [] : [files.adopt]),
      ...files.change,
    ];
    const conversions = plan.adoption?.conversions ?? [];
    return {
      adopts: plan.adoption !== null,
      conversions,
      notices: conversions.map(conversionNotice),
      files: await Promise.all(
        names.map(async name => ({
          name,
          sql: await readFile(join(scratch, name), "utf-8"),
        }))
      ),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** A column a save brings from how an earlier version made it to the one mapping. */
export interface ColumnConversion {
  table: string;
  column: string;
  from: string;
  to: string;
}

/** What a save would do, for the person to review before confirming it. */
export interface CollectionSavePreview {
  /** Whether the save first adopts a table no snapshot records. */
  adopts: boolean;
  /** Each column the save also converts, beyond the person's change. */
  conversions: ColumnConversion[];
  /** One line per conversion, as the review shows it. */
  notices: string[];
  /** The files the save would write, in run order. */
  files: { name: string; sql: string }[];
}

/** How the definition stands, what it becomes, and any adoption the save makes first. */
interface SavePlan {
  current: UiSchemaManifest;
  next: UiSchemaManifest;
  table: string;
  adoption: Adoption | null;
}

/** A table to adopt as the database has it, and what bringing it to the mapping converts. */
interface Adoption {
  table: TableSpec;
  conversions: ColumnConversion[];
}

async function planSave(
  deps: CollectionSaveDeps,
  save: CollectionSave
): Promise<SavePlan> {
  const current = await loadUiSchema({
    projectRoot: deps.projectRoot,
    uiSchemaFile: deps.config.db.uiSchemaFile,
  });
  // Named as the generator names it (`uiToMinimal`), so the scope is the
  // table the migration writes.
  const table = uiToMinimal(collectionOf(save), "dc_").tableName;
  return {
    current,
    next: withCollection(current, save.slug, save.entity),
    table,
    adoption: await adoptionFor(deps, save, current, table),
  };
}

/**
 * The adoption a save of an existing collection makes first, where its table
 * is in the database and in no snapshot: the table as the database has it,
 * and every difference between that and how the one field-to-column mapping
 * declares the collection as it stood, which the change then converts.
 */
async function adoptionFor(
  deps: CollectionSaveDeps,
  save: CollectionSave,
  current: UiSchemaManifest,
  table: string
): Promise<Adoption | null> {
  if (save.previous === null || !(await needsAdopting(deps, table))) {
    return null;
  }
  const dialect = deps.adapter.getCapabilities().dialect;
  const live = (
    await introspectLiveSnapshot(deps.adapter.getDrizzle(), dialect, [table])
  ).tables.find(t => t.name === table);
  if (live === undefined) return null;
  const inputs = await appMigrationInputs({
    ...inputsArgs(deps),
    manifest: withCollection(current, save.slug, save.previous),
  });
  const declared = inputs.collections.find(c => c.slug === save.slug);
  const mapped =
    declared === undefined
      ? undefined
      : buildDesiredSnapshotFromConfig([declared], [], [], dialect).tables.find(
          t => t.name === table
        );
  return {
    table: live,
    conversions:
      mapped === undefined
        ? []
        : diffSnapshots({ tables: [live] }, { tables: [mapped] }).map(op =>
            conversionOf(table, op)
          ),
  };
}

/** One difference between an adopted table and the mapping, as a conversion. */
function conversionOf(table: string, op: Operation): ColumnConversion {
  switch (op.type) {
    case "change_column_type":
      return { table, column: op.columnName, from: op.fromType, to: op.toType };
    case "change_column_nullable":
      return {
        table,
        column: op.columnName,
        from: op.fromNullable ? "nullable" : "not null",
        to: op.toNullable ? "nullable" : "not null",
      };
    case "change_column_default":
      return {
        table,
        column: op.columnName,
        from: op.fromDefault ?? "no default",
        to: op.toDefault ?? "no default",
      };
    default:
      return {
        table,
        column: "columnName" in op ? String(op.columnName) : table,
        from: "as an earlier version made it",
        to: `as Nextly declares it (${op.type.replace(/_/g, " ")})`,
      };
  }
}

/** The line the review shows for a conversion. */
function conversionNotice(conversion: ColumnConversion): string {
  return `This save also converts ${conversion.column} from ${conversion.from} to ${conversion.to}, from an earlier Nextly version.`;
}

/**
 * Refuses a save that would convert a column the caller did not acknowledge:
 * the Builder changes only what it said it would, so each conversion is named
 * in the review (`previewCollectionSave`) and confirmed before it is written.
 */
function refuseUnconfirmedConversions(
  plan: SavePlan,
  save: CollectionSave
): void {
  if (save.entity === null) return;
  const acknowledged = new Set(save.acknowledgedConversions ?? []);
  const unconfirmed = (plan.adoption?.conversions ?? []).filter(
    c => !acknowledged.has(c.column)
  );
  if (unconfirmed.length === 0) return;
  throw new NextlyError({
    code: "NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED",
    publicMessage: `${unconfirmed.map(conversionNotice).join(" ")} Review the save and confirm the conversion to write it.`,
    logContext: { columns: unconfirmed.map(c => c.column) },
  });
}

/** The files a save writes, adopt first. */
interface SaveFiles {
  adopt: string | undefined;
  change: string[];
}

/**
 * Generate the save's files into `deps.migrationsDir`: the adoption, where
 * there is one, then the change, a millisecond later so it runs after.
 */
async function writeFiles(
  deps: CollectionSaveDeps,
  save: CollectionSave,
  plan: SavePlan,
  onWritten: (names: string[]) => void
): Promise<SaveFiles> {
  const now = save.now ?? new Date();
  let adopt: string | undefined;
  if (plan.adoption !== null && save.previous !== null) {
    const adopted = await generateFor(deps, {
      manifest: withCollection(plan.current, save.slug, save.previous),
      save,
      name: `${migrationSlug(save.slug)}_adopt`,
      table: plan.table,
      now,
      tablesAsTheyStand: [plan.adoption.table],
    });
    onWritten(adopted);
    if (adopted.length > 1) {
      // A translated collection's companion table is written as files of its
      // own, with no snapshot to adopt it against.
      throw new NextlyError({
        code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
        publicMessage: `${save.slug} is translated, and its table was made by an earlier Nextly version with no migration recording it. Record it first: run \`nextly migrate:create\`, then \`nextly migrate:resolve --applied <file>\` for each file it writes, and save again.`,
      });
    }
    adopt = adopted[0];
  }
  // Each conversion to the one mapping in a file of its own, run before the
  // change: a stored value one cannot take stops it at its first statement,
  // before the person's change has touched the table.
  let offset = adopt === undefined ? 0 : 1;
  const convert: string[] = [];
  // A delete converts nothing: the table goes.
  if (
    (plan.adoption?.conversions.length ?? 0) > 0 &&
    save.previous !== null &&
    save.entity !== null
  ) {
    convert.push(
      ...(await generateFor(deps, {
        manifest: withCollection(plan.current, save.slug, save.previous),
        save,
        name: `${migrationSlug(save.slug)}_convert`,
        table: plan.table,
        now: new Date(now.getTime() + offset),
      }))
    );
    onWritten(convert);
    offset += 1;
  }
  const change = await generateFor(deps, {
    manifest: plan.next,
    save,
    name: `${migrationSlug(save.slug)}_${save.change}`,
    table: plan.table,
    now: new Date(now.getTime() + offset),
    appended: addedStatements(deps, save, plan.table),
    ...(save.keys === undefined
      ? {}
      : { newTableKeys: new Map([[plan.table, save.keys.after]]) }),
  });
  onWritten(change);
  return { adopt, change: [...convert, ...change] };
}

/**
 * The history checks `nextly migrate` makes before its first write, asked as
 * they are asked there: through the command's own module, loaded on first use
 * as boot loads it. A refusal reaches the person saving as a conflict with the
 * text the command prints, naming what to settle.
 */
export async function checkSaveHistory(
  deps: CollectionSaveDeps
): Promise<void> {
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

/** The collection a save is about: as it becomes, or as it was when deleted. */
function collectionOf(save: CollectionSave): UiSchemaEntity {
  const entity = save.entity ?? save.previous;
  if (entity === null) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "A collection save names no collection.",
      logContext: { slug: save.slug },
    });
  }
  return entity;
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
    tablesAsTheyStand?: TableSpec[];
    appended?: { up: AddedStatements; down: AddedStatements };
    newTableKeys?: ReadonlyMap<string, readonly ForeignKeySpec[]>;
  }
): Promise<string[]> {
  const dialect = deps.adapter.getCapabilities().dialect;
  const inputs = await appMigrationInputs({
    ...inputsArgs(deps),
    manifest: args.manifest,
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
    ...(args.tablesAsTheyStand === undefined
      ? {}
      : { tablesAsTheyStand: args.tablesAsTheyStand }),
    ...(args.appended === undefined
      ? {}
      : { appendedStatements: args.appended }),
    ...(args.newTableKeys === undefined
      ? {}
      : { foreignKeysOfNewTables: args.newTableKeys }),
    decideRenames: candidates =>
      Promise.resolve(renamesOf(candidates, args.save.renamedFields ?? [])),
    now: args.now,
  });
  if (result === null) return [];
  return (await sqlFiles(deps.migrationsDir)).filter(f => !before.has(f));
}

/**
 * What the save's change file carries beyond what the generator writes: its
 * junction statements (`placedJunctions`) and, for a table that exists, its
 * relationship keys' changes (`keyChanges`), each side's drops first and
 * adds last.
 */
function addedStatements(
  deps: CollectionSaveDeps,
  save: CollectionSave,
  table: string
): { up: AddedStatements; down: AddedStatements } {
  const junctions =
    save.junctions === undefined
      ? emptyAdded()
      : placedJunctions(save, save.junctions);
  const keys =
    save.keys === undefined || save.entity === null || save.previous === null
      ? emptyAdded()
      : keyChanges(deps.adapter.getCapabilities().dialect, table, save.keys);
  return {
    up: {
      first: [...keys.up.first, ...junctions.up.first],
      last: [...junctions.up.last, ...keys.up.last],
    },
    down: {
      first: [...keys.down.first, ...junctions.down.first],
      last: [...junctions.down.last, ...keys.down.last],
    },
  };
}

const emptyAdded = (): { up: AddedStatements; down: AddedStatements } => ({
  up: { first: [], last: [] },
  down: { first: [], last: [] },
});

/**
 * The statements changing an existing table's relationship keys from
 * `before` to `after`, rendered by the generator's own templates: a key that
 * went or changed is dropped before the generated statements (before its
 * column can go), and one that came or changed is added after them (once its
 * column exists). The down undoes each the other way round. None on SQLite,
 * which cannot alter a key in place; the Builder's DDL adds none there either.
 */
function keyChanges(
  dialect: SupportedDialect,
  table: string,
  keys: NonNullable<CollectionSave["keys"]>
): { up: AddedStatements; down: AddedStatements } {
  if (dialect === "sqlite") return emptyAdded();
  const same = (a: ForeignKeySpec, b: ForeignKeySpec) =>
    JSON.stringify(a) === JSON.stringify(b);
  const kept = keys.before.filter(k => keys.after.some(a => same(k, a)));
  const between = (
    from: readonly ForeignKeySpec[],
    to: readonly ForeignKeySpec[]
  ) =>
    generateStatements(
      diffSnapshots(
        { tables: [{ name: table, columns: [], foreignKeys: [...from] }] },
        { tables: [{ name: table, columns: [], foreignKeys: [...to] }] }
      ),
      dialect,
      []
    );
  return {
    up: { first: between(keys.before, kept), last: between(kept, keys.after) },
    down: {
      first: between(keys.after, kept),
      last: between(kept, keys.before),
    },
  };
}

/**
 * Where a save's junction statements go in its file. A delete drops each
 * junction before the table it links, and its down recreates them after it;
 * every other save changes them once the table stands, and its down undoes
 * them before the table changes back.
 */
function placedJunctions(
  save: CollectionSave,
  junctions: NonNullable<CollectionSave["junctions"]>
): { up: AddedStatements; down: AddedStatements } {
  const none: readonly string[] = [];
  return save.entity === null
    ? {
        up: { first: junctions.up, last: none },
        down: { first: none, last: junctions.down },
      }
    : {
        up: { first: none, last: junctions.up },
        down: { first: junctions.down, last: none },
      };
}

/** What `appMigrationInputs` is asked with for this app, its definition aside. */
function inputsArgs(deps: CollectionSaveDeps): AppMigrationInputsArgs {
  return {
    config: deps.config,
    ...(deps.deferredExtends === undefined
      ? {}
      : { deferredExtends: deps.deferredExtends }),
    projectRoot: deps.projectRoot,
    migrationsDir: deps.migrationsDir,
    dialect: deps.adapter.getCapabilities().dialect,
    logger: deps.logger,
  };
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
 * alone; a companion with none, as written. An adoption is recorded applied
 * with the change's first file, through the handle that file's row is written
 * on, so a change that fails leaves the adoption unrecorded too; with no
 * change, it is reconciled alone, against the table it describes.
 */
async function runWritten(
  deps: CollectionSaveDeps,
  files: SaveFiles,
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
  const ordered =
    files.change.length === 0 && files.adopt !== undefined
      ? [files.adopt]
      : files.change;
  let pendingAdoption =
    files.change.length === 0 || files.adopt === undefined
      ? undefined
      : await unitOf(deps, files.adopt);
  let before = await scopedSnapshotBefore(deps, ordered[0], table);
  for (const filename of ordered) {
    await runJudgingWhatStayed(deps, table, filename, () => runOne(filename));
  }

  async function runOne(filename: string): Promise<void> {
    const file = await unitOf(deps, filename);
    const target = await snapshotOf(deps, filename);
    if (target === null) {
      await runRecordedAttempt({ file, dialect, repo, executeSql });
      return;
    }
    const scopedTarget = onlyTable(target, table);
    const adoption = pendingAdoption;
    await reconcileFile({
      file,
      before,
      target: scopedTarget,
      live: await liveTable(deps, table),
      dialect,
      repo,
      executeSql,
      ...(adoption === undefined
        ? {}
        : {
            recordApplied: (handle: unknown) =>
              recordAlreadyApplied(adoption, repo.boundTo(handle)),
          }),
    });
    pendingAdoption = undefined;
    before = scopedTarget;
  }
}

/**
 * Run one file, and where it fails, say whether any of it stayed: the
 * collection's table as it stood before the file, compared with how it stands
 * after the failure. MySQL commits each schema statement as it runs, so a file
 * that failed at a later statement keeps the earlier ones whatever the error
 * says; such a failure is thrown as part-way, so its files are kept for
 * `nextly migrate:resolve`. One that changed nothing is thrown as it was.
 */
async function runJudgingWhatStayed(
  deps: CollectionSaveDeps,
  table: string,
  filename: string,
  run: () => Promise<void>
): Promise<void> {
  const before = await liveTable(deps, table);
  try {
    await run();
  } catch (error) {
    if (snapshotsEquivalent(before, await liveTable(deps, table))) throw error;
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
      publicMessage: `${filename} failed part-way, and the statements before the failure stayed applied: ${NextlyError.is(error) ? error.publicMessage : String(error)} Settle it with \`nextly migrate:resolve\` before saving again.`,
      logContext: { reason: "partially-applied", file: filename },
      ...(error instanceof Error ? { cause: error } : {}),
    });
  }
}

/** The collection's table as the database has it now, alone. */
async function liveTable(
  deps: CollectionSaveDeps,
  table: string
): Promise<NextlySchemaSnapshot> {
  const dialect = deps.adapter.getCapabilities().dialect;
  return onlyTable(
    await introspectLiveSnapshot(
      deps.adapter.getDrizzle(),
      dialect,
      (await deps.adapter.tableExists(table)) ? [table] : []
    ),
    table
  );
}

/** A written file as the runner takes it. */
async function unitOf(deps: CollectionSaveDeps, filename: string) {
  const path = join(deps.migrationsDir, filename);
  const content = await readFile(path, "utf-8");
  return {
    filename,
    sql: parseSqlSections(content).upSql,
    path,
    sha256: checksumOf(content),
    transaction: !marksNoTransaction(content),
  };
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
