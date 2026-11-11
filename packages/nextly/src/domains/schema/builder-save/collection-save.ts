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
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import { checksumOf } from "../migrate/applied-checksums";
import {
  reconcileFile,
  recordAlreadyApplied,
  runRecordedAttempt,
  snapshotsEquivalent,
} from "../migrate/drift-reconcile";
import { runMigrationStatements } from "../migrate/migration-transaction";
import { refuseRequiredColumnsOverNulls } from "../migrate/required-column-guard";
import { resolveMigration } from "../migrate/resolve";
import { marksNoTransaction, splitSqlStatements } from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import { tablesChangedIn } from "../migrate/statement-targets";
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
import { countRowsBreakingNotNull } from "../pipeline/classifier/count-helpers";
import { diffSnapshots } from "../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";
import { assertDeleteWithinThreshold } from "../pipeline/pre-cleanup/executor";
import { validateDefaultValue } from "../pipeline/pre-cleanup/validate-default";
import type { RenameCandidate } from "../pipeline/pushschema-pipeline-interfaces";
import { generateStatements } from "../pipeline/sql-templates/index";
import type { ColumnResolution } from "../pipeline/sql-templates/resolution-statements";
import {
  classifyFieldKind,
  getColumnDescriptor,
  toSnakeCase,
} from "../services/field-column-descriptor";
import {
  uniquenessCanBeAnIndex,
  uniquenessNotEnforceableError,
} from "../services/index-name";
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
  /**
   * The person's answer, field by field, to rows that do not fit a field this
   * save makes required: fill them with a value, or delete them. Written into
   * the change's file between the column's creation and its NOT NULL, and
   * named in the review (`previewCollectionSave`). Making the field optional
   * instead is the definition's own business, and needs nothing here.
   */
  resolutions?: ReadonlyArray<
    | { column: string; kind: "fill"; value: unknown }
    | { column: string; kind: "delete_nonconforming" }
  >;
  /**
   * The other collections deleted with this one: gone from the definition
   * the save writes, so the links between them do not hold this one's delete
   * back. Each still gets a migration of its own.
   */
  removedTogether?: readonly string[];
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
     * caller did first.
     */
    historyChecked?: boolean;
    /**
     * What applies the change in development instead of the file's
     * statements: a translated collection's push, which carries its values
     * across a translation change as the file's companions cannot yet. Once
     * it has run, each written file is recorded applied where the database
     * stands as its snapshot says, and the save is refused, its files kept,
     * where it does not.
     */
    appliedBy?: () => Promise<void>;
  } = {}
): Promise<CollectionSaveResult> {
  const written = await writeSave(deps, save, options);
  // Once a push has run, the database changed outside the files: they stay.
  let pushed = false;
  try {
    if (deps.applies && options.appliedBy !== undefined) {
      await options.appliedBy();
      pushed = true;
      await recordWhatWasPushed(deps, written.files, written.table);
    } else if (deps.applies) {
      await runWritten(deps, written.files, written.table);
    }
    return { files: [...written.names], applied: deps.applies };
  } catch (error) {
    if (!pushed) {
      await undoThenThrow(error, [
        { files: written.names, undo: () => written.undo(error) },
      ]);
    }
    throw error;
  }
}

/**
 * Withdraw what failed saves wrote, each of `undos` tried in turn, then
 * rethrow `error`, the failure that called for it. Where a withdrawal fails
 * too, the error thrown instead keeps that failure's message and cause and
 * names every file the failed withdrawals may have left: hidden, they would be
 * applied by the next `nextly migrate` for a save the person was told failed.
 */
export async function undoThenThrow(
  error: unknown,
  undos: ReadonlyArray<{
    files: readonly string[];
    undo: () => Promise<void>;
  }>
): Promise<never> {
  const left: string[] = [];
  for (const { files, undo } of undos) {
    try {
      await undo();
    } catch {
      left.push(...files);
    }
  }
  if (left.length === 0) throw error;
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: `${NextlyError.is(error) ? error.publicMessage : "The save failed."} What it wrote could not all be withdrawn, and may remain: ${left.join(", ")}, with the definition file as the save left it. Remove them and restore the definition before the next \`nextly migrate\`.`,
    logContext: { reason: "save-files-left", files: left },
    ...(error instanceof Error ? { cause: error } : {}),
  });
}

/**
 * A save written and not run: its definition and files are in place, and the
 * caller runs them, or withdraws them, once its own work has settled.
 */
export interface PreparedCollectionSave {
  /** The migration files written, in run order. */
  files: string[];
  /**
   * In development, run the files as `nextly migrate` runs them. A failure
   * keeps them, with the definition, for `nextly migrate` to finish from.
   */
  run(): Promise<void>;
  /** Remove the files and their snapshots, and put the definition back. */
  withdraw(): Promise<void>;
}

/**
 * Write the save's definition and migration, run nothing, and hand back how
 * to run or withdraw them: for a caller that changes the database itself
 * between the two, as a delete tears down what a collection holds. Every file
 * exists before that work starts, so a failure writing one leaves the
 * database as it was.
 */
export async function prepareCollectionSave(
  deps: CollectionSaveDeps,
  save: CollectionSave,
  options: { historyChecked?: boolean } = {}
): Promise<PreparedCollectionSave> {
  const written = await writeSave(deps, save, options);
  return {
    files: [...written.names],
    run: async () => {
      if (deps.applies) await runWritten(deps, written.files, written.table);
    },
    withdraw: () => written.undo(undefined),
  };
}

/**
 * The save's checks, its definition and its files, written: what every save
 * does before anything runs. A failure writing a file removes what was
 * written and puts the definition back. `undo` does the same afterwards for
 * the files that did not apply (`undoUnapplied`).
 */
async function writeSave(
  deps: CollectionSaveDeps,
  save: CollectionSave,
  options: { historyChecked?: boolean }
): Promise<{
  files: SaveFiles;
  names: readonly string[];
  table: string;
  undo(error: unknown): Promise<void>;
}> {
  if (options.historyChecked !== true) await checkSaveHistory(deps);
  const plan = await planSave(deps, save);
  refuseUnconfirmedConversions(plan, save);
  refuseUnenforceableUniques(deps, save, plan.table);
  await settledRows(deps, save, plan.table);

  const definitionPath = resolve(deps.projectRoot, deps.config.db.uiSchemaFile);
  const before = await readIfPresent(definitionPath);
  await writeAtomically(definitionPath, serializeUiSchema(plan.next));

  const names: string[] = [];
  const undo = (error: unknown) =>
    undoUnapplied(deps, names, before, definitionPath, error);
  try {
    const files = await writeFiles(deps, save, plan, written =>
      names.push(...written)
    );
    return { files, names, table: plan.table, undo };
  } catch (error) {
    return undoThenThrow(error, [{ files: names, undo: () => undo(error) }]);
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
      notices: [
        ...conversions.map(conversionNotice),
        ...(await settledRows(deps, save, plan.table)).map(resolutionNotice),
      ],
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
  const current = withPreviousRecorded(
    await loadUiSchema({
      projectRoot: deps.projectRoot,
      uiSchemaFile: deps.config.db.uiSchemaFile,
    }),
    save
  );
  // Named as the generator names it (`uiToMinimal`), so the scope is the
  // table the migration writes.
  const table = uiToMinimal(collectionOf(save), "dc_").tableName;
  return {
    current,
    next: (save.removedTogether ?? []).reduce(
      (manifest, slug) => withCollection(manifest, slug, null),
      withCollection(current, save.slug, save.entity)
    ),
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
    ...inputsArgs(deps, [save.previous], save.slug),
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

/** A resolution with the rows it settles here. */
interface SettledRows {
  column: string;
  rows: number;
  resolution: NonNullable<CollectionSave["resolutions"]>[number];
}

/**
 * Each resolution checked and counted against the rows as they stand: a fill
 * value the field's type takes, on a field that is not unique (one value
 * cannot fill a unique column's rows), and a delete within the threshold the
 * Builder's push path keeps. A field the table does not have yet counts every
 * row. Refused before anything is written.
 */
async function settledRows(
  deps: CollectionSaveDeps,
  save: CollectionSave,
  table: string
): Promise<SettledRows[]> {
  const dialect = deps.adapter.getCapabilities().dialect;
  const db = deps.adapter.getDrizzle();
  const exists = await deps.adapter.tableExists(table);
  const live = exists
    ? (await introspectLiveSnapshot(db, dialect, [table])).tables[0]
    : undefined;
  const settled: SettledRows[] = [];
  for (const resolution of save.resolutions ?? []) {
    const field = save.entity?.fields.find(f => f.name === resolution.column);
    if (field === undefined) {
      throw NextlyError.validation({
        errors: [
          {
            path: resolution.column,
            code: "RESOLUTION_FIELD_UNKNOWN",
            message: `${resolution.column} is not a field of the saved collection.`,
          },
        ],
      });
    }
    if (resolution.kind === "fill") {
      if (field.unique === true) {
        throw NextlyError.validation({
          errors: [
            {
              path: resolution.column,
              code: "FILL_ON_UNIQUE_FIELD",
              message: `${resolution.column} is unique, so one value cannot fill its rows. Make it optional, or delete the rows that do not fit.`,
            },
          ],
        });
      }
      const valid = validateDefaultValue(
        { name: resolution.column, type: field.type },
        resolution.value,
        dialect
      );
      if (!valid.success) {
        throw NextlyError.validation({
          errors: [
            {
              path: resolution.column,
              code: "INVALID_DEFAULT_FOR_TYPE",
              message: valid.error ?? "The fill value does not fit the field.",
            },
          ],
        });
      }
    }
    const column = toSnakeCase(resolution.column);
    const liveColumn = live?.columns.find(c => c.name === column);
    // An answer settles rows that do not fit a field this save makes
    // required: one required now whose column is new, or nullable as it
    // stands. Any other would delete or fill rows, and the generator would
    // make the column NOT NULL, for a change the save does not make.
    if (field.required !== true || liveColumn?.nullable === false) {
      throw NextlyError.validation({
        errors: [
          {
            path: resolution.column,
            code: "RESOLUTION_NOT_ASKED",
            message: `This save does not make ${resolution.column} required, so it has no rows to fill or delete.`,
          },
        ],
      });
    }
    const rows = exists
      ? (
          await countRowsBreakingNotNull(db, dialect, {
            table,
            column: liveColumn === undefined ? null : column,
          })
        ).total
      : 0;
    if (resolution.kind === "delete_nonconforming") {
      assertDeleteWithinThreshold(rows);
    }
    settled.push({ column: resolution.column, rows, resolution });
  }
  return settled;
}

/** Whether field `name` of the saved collection keeps its value as JSON. */
function storesJson(save: CollectionSave, name: string): boolean {
  const field = save.entity?.fields.find(f => f.name === name);
  return (
    field !== undefined &&
    classifyFieldKind(field as FieldDefinition, "collection") === "json"
  );
}

/** The line the review shows for a resolution. */
function resolutionNotice({ column, rows, resolution }: SettledRows): string {
  const counted = `${rows} ${rows === 1 ? "row" : "rows"}`;
  return resolution.kind === "fill"
    ? `This save fills ${counted} with '${String(resolution.value)}' in ${column}.`
    : `This save also deletes ${counted} here, and the rows that don't fit on every database the migration reaches.`;
}

/**
 * Refuses a field marked unique whose column, by the Builder's column rule,
 * the database cannot key (an unbounded MySQL TEXT): the generator leaves such
 * an index out, so the save would claim a uniqueness nothing enforces. The
 * Builder's own DDL refuses it with the same error.
 */
function refuseUnenforceableUniques(
  deps: CollectionSaveDeps,
  save: CollectionSave,
  table: string
): void {
  const dialect = deps.adapter.getCapabilities().dialect;
  for (const field of save.entity?.fields ?? []) {
    // A group with no name only lays fields out and has no column to key.
    const name = field.name;
    if (field.unique !== true || name === undefined) continue;
    if (toSnakeCase(name) === "slug") continue;
    const column = getColumnDescriptor(
      field as FieldDefinition,
      dialect,
      "collection"
    );
    if (column === null) continue;
    if (!uniquenessCanBeAnIndex(column.dialectType, dialect)) {
      throw uniquenessNotEnforceableError(
        table,
        { name, type: field.type },
        dialect
      );
    }
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
  // An adopted collection's address and sibling fields predate those rules.
  const held =
    plan.adoption !== null && save.previous !== null
      ? { held: [save.previous] }
      : {};
  const now = save.now ?? new Date();
  let adopt: string | undefined;
  if (plan.adoption !== null && save.previous !== null) {
    const adopted = await generateFor(deps, {
      ...held,
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
        ...held,
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
    ...held,
    manifest: plan.next,
    save,
    name: `${migrationSlug(save.slug)}_${save.change}`,
    table: plan.table,
    now: new Date(now.getTime() + offset),
    appended: addedStatements(deps, save, plan.table),
    ...(save.resolutions === undefined
      ? {}
      : {
          resolutions: save.resolutions.map(r => ({
            ...r,
            tableName: plan.table,
            columnName: toSnakeCase(r.column),
            // A structured value (a JSON, chips or plugin JSON field's) is
            // written as the JSON text its column stores.
            ...(r.kind === "fill" && storesJson(save, r.column)
              ? { json: true }
              : {}),
          })),
        }),
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

/**
 * `manifest` holding the collection as it stood before the save, where the
 * file does not: one an earlier version made, which the file never recorded.
 * Taken as it stands, without the checks a change is put through, so the
 * change is then judged against what already existed rather than as new.
 */
function withPreviousRecorded(
  manifest: UiSchemaManifest,
  save: CollectionSave
): UiSchemaManifest {
  if (
    save.previous === null ||
    manifest.collections.some(c => c.slug === save.slug)
  ) {
    return manifest;
  }
  return { ...manifest, collections: [...manifest.collections, save.previous] };
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
    resolutions?: readonly ColumnResolution[];
    /** Collections the database holds that no snapshot records (`appMigrationInputs`). */
    held?: readonly UiSchemaEntity[];
  }
): Promise<string[]> {
  const dialect = deps.adapter.getCapabilities().dialect;
  const inputs = await appMigrationInputs({
    ...inputsArgs(deps, args.held, args.save.slug),
    manifest: args.manifest,
  });
  const before = new Set(await sqlFiles(deps.migrationsDir));
  const snapshotsBefore = new Set(await snapshotFiles(deps.migrationsDir));
  // A generation that fails part-way may have written some of its files (the
  // SQL before its snapshot, the main file before a companion): each is
  // removed before the failure travels, so nothing of a refused save is left
  // for `nextly migrate` to apply.
  const removeWritten = async () => {
    for (const file of await sqlFiles(deps.migrationsDir)) {
      if (!before.has(file)) {
        await rm(join(deps.migrationsDir, file), { force: true });
      }
    }
    for (const file of await snapshotFiles(deps.migrationsDir)) {
      if (!snapshotsBefore.has(file)) {
        await rm(join(deps.migrationsDir, "meta", file), { force: true });
      }
    }
  };
  const generated = generateMigration({
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
    ...(args.resolutions === undefined
      ? {}
      : { resolutions: args.resolutions }),
    decideRenames: candidates =>
      Promise.resolve(renamesOf(candidates, args.save.renamedFields ?? [])),
    now: args.now,
  });
  let result: Awaited<typeof generated>;
  try {
    result = await generated;
  } catch (error) {
    await removeWritten();
    throw error;
  }
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
function inputsArgs(
  deps: CollectionSaveDeps,
  held: readonly UiSchemaEntity[] = [],
  judged?: string
): AppMigrationInputsArgs {
  return {
    ...(held.length === 0 ? {} : { held }),
    ...(judged === undefined ? {} : { judged }),
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

/** The snapshot files beside the migrations, in `meta/` (a missing folder has none). */
async function snapshotFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(join(dir, "meta")))
      .filter(f => f.endsWith(".snapshot.json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
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
    // A column made required over rows that would break it, refused before
    // any statement, as `nextly migrate` refuses it.
    await refuseRequiredColumnsOverNulls(
      db,
      dialect,
      splitSqlStatements(file.sql, dialect, {
        transaction: file.transaction,
      }),
      filename
    );
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
 * Run one file, and where it fails, say whether any of it stayed: every table
 * the file's statements change (the collection's own, its translations table,
 * a junction) as it stood before the file, compared with how it stands after
 * the failure. MySQL commits each schema statement as it runs, so a file that
 * failed at a later statement keeps the earlier ones whatever the error says;
 * such a failure is thrown as part-way, so its files are kept for `nextly
 * migrate:resolve`. One that changed nothing is thrown as it was. A file whose
 * tables cannot all be named, run where its statements commit one by one, is
 * taken as part-way: what it may have kept cannot be compared.
 */
async function runJudgingWhatStayed(
  deps: CollectionSaveDeps,
  table: string,
  filename: string,
  run: () => Promise<void>
): Promise<void> {
  const dialect = deps.adapter.getCapabilities().dialect;
  const file = await unitOf(deps, filename);
  const named = tablesChangedBy(file, dialect);
  const tables = named ?? [table];
  const unknown =
    named === undefined && (dialect === "mysql" || !file.transaction);
  const before = await liveTables(deps, [table, ...tables]);
  try {
    await run();
  } catch (error) {
    if (
      !unknown &&
      snapshotsEquivalent(before, await liveTables(deps, [table, ...tables]))
    ) {
      throw error;
    }
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
      publicMessage: `${filename} failed part-way, and the statements before the failure stayed applied: ${NextlyError.is(error) ? error.publicMessage : String(error)} Settle it with \`nextly migrate:resolve\` before saving again.`,
      logContext: { reason: "partially-applied", file: filename },
      ...(error instanceof Error ? { cause: error } : {}),
    });
  }
}

/** First words of a statement that changes no table. */
const TABLELESS_STATEMENTS = new Set([
  "SET",
  "PRAGMA",
  "SELECT",
  "BEGIN",
  "START",
  "COMMIT",
]);

/**
 * The tables a file's statements change (`tablesChangedIn`), or undefined
 * when one that may change a table names none this reading can tell.
 */
function tablesChangedBy(
  file: { sql: string; transaction: boolean },
  dialect: SupportedDialect
): string[] | undefined {
  const tables = new Set<string>();
  for (const statement of splitSqlStatements(file.sql, dialect, {
    transaction: file.transaction,
  })) {
    const first = /^\s*([A-Za-z]+)/.exec(statement)?.[1]?.toUpperCase();
    if (first !== undefined && TABLELESS_STATEMENTS.has(first)) continue;
    const changed = tablesChangedIn(statement, dialect);
    if (changed === undefined) return undefined;
    for (const name of changed) tables.add(name);
  }
  return [...tables];
}

/** The tables of `names` the database has now, as it has them. */
async function liveTables(
  deps: CollectionSaveDeps,
  names: readonly string[]
): Promise<NextlySchemaSnapshot> {
  const dialect = deps.adapter.getCapabilities().dialect;
  const unique = [...new Set(names)];
  const present: string[] = [];
  for (const name of unique) {
    if (await deps.adapter.tableExists(name)) present.push(name);
  }
  const snapshot = await introspectLiveSnapshot(
    deps.adapter.getDrizzle(),
    dialect,
    present
  );
  return {
    ...snapshot,
    tables: snapshot.tables.filter(t => unique.includes(t.name)),
  };
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

/**
 * Record each written file applied after a push applied its change: one with
 * a snapshot where the collection's table stands as that snapshot says, and a
 * companion, which describes what the push itself did to the translation
 * tables. Where the table does not, the save is refused naming the file, and
 * nothing is recorded for it or after it.
 */
async function recordWhatWasPushed(
  deps: CollectionSaveDeps,
  files: SaveFiles,
  table: string
): Promise<void> {
  const repo = new SchemaEventsRepository(
    deps.adapter.getDrizzle(),
    deps.adapter.getCapabilities().dialect
  );
  const ordered = [
    ...(files.adopt === undefined ? [] : [files.adopt]),
    ...files.change,
  ];
  const units = [];
  for (const filename of ordered) {
    units.push({
      filename,
      file: await unitOf(deps, filename),
      target: await snapshotOf(deps, filename),
    });
  }
  // The table after the push is what the change's newest file with a
  // snapshot records: the adoption describes it before the push, and a
  // translations-table file, which may come after, has no snapshot. Compared
  // before anything is recorded, so a mismatch records no file.
  const verified = [...units]
    .reverse()
    .find(u => u.filename !== files.adopt && u.target !== null);
  if (verified?.target != null) {
    const live = await liveTable(deps, table);
    const expected = onlyTable(verified.target, table);
    if (!snapshotsEquivalent(live, expected)) {
      throw new NextlyError({
        code: "NEXTLY_MIGRATION_DRIFT",
        publicMessage: `The database does not stand as ${verified.filename} says after the save's change was applied, so the save's files were not recorded applied. Compare the table with the file, then record it with \`nextly migrate:resolve --applied ${verified.filename}\` once they match.`,
        logContext: {
          file: verified.filename,
          differences: diffSnapshots(expected, live).length,
        },
      });
    }
  }
  for (const { filename, file } of units) {
    await recordAlreadyApplied({ filename, sha256: file.sha256 }, repo);
  }
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
 * After a failed save: where nothing the save wrote applied, remove every
 * file it wrote, with its snapshot, and put the definition back as it was. A
 * file that failed part-way stays, with the definition it was written from,
 * for `nextly migrate:resolve` to settle. Where an earlier file of the save
 * applied and a later one failed with nothing of it applied, the database is
 * part of the way to the new definition: every file and the new definition
 * stay, the failed file's attempt is settled, and `nextly migrate` runs the
 * rest once the cause is fixed.
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
  const applied: string[] = [];
  if (deps.applies) {
    for (const filename of written) {
      if (await repo.isFileApplied(filename)) applied.push(filename);
    }
  }
  if (applied.length > 0) {
    for (const filename of written) {
      if (!applied.includes(filename)) {
        await settleAttempts(deps, repo, filename);
      }
    }
    deps.logger.error(
      `${applied.join(", ")} applied before the save failed, so the save's files and its definition stay: \`nextly migrate\` runs the rest once the cause is fixed.`
    );
    return;
  }
  for (const filename of written) {
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
