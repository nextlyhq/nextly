/**
 * The drift check of the companion files `nextly migrate:create` writes for an entity's
 * translations table, made before `nextly migrate` applies any pending file.
 *
 * A companion file has no snapshot of its own: it carries statements that move values and must
 * run as written. What its table should look like is recorded all the same, in two places.
 *
 * - The snapshots of the main files say which tables are translated and name each one's
 *   translated columns. They are written from the config, so they follow a renamed field and a
 *   collection removed and added again.
 * - The headers of the applied companion files say what type a column was made with, where the
 *   file made it with the field's own type: a file that creates the table, or adds a column to
 *   it. A file that moves a field into translation may make the column with the main column's
 *   wider type, which its header does not record, so of such a column only the name is judged.
 *
 * The table may rightly stand anywhere between the last applied snapshot and the newest pending
 * one: a run stopped part-way leaves it there. So, as for a main file, drift is what fits
 * neither: the table, or a translated column, that both snapshots name and the database lacks,
 * or holds narrower than its file made it. A column neither names is not drift: a translated
 * field deleted from the config leaves its column behind, and the files cannot tell that column
 * from one added by hand.
 *
 * Not every translations table can be checked. One a snapshot does not record the columns of
 * (a development sync or `db:sync` made it, or the snapshot was written before column names were
 * recorded), or one a pending file renames a column of, has no known shape; its files are
 * applied, and the reason is said in place of the check.
 *
 * @module domains/schema/migrate/companion-drift
 */
import { readFile } from "node:fs/promises";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { earlierCompanionColumnType } from "../../i18n/migration/companion-column-holds";
import { companionHistoryKey } from "../../i18n/migration/companion-history";
import { ddlType } from "../../i18n/migration/ddl-types";
import type { LocalizationMigrationIntent } from "../../i18n/migration/migration-intent";
import type { LocalizedColumnSpec } from "../../i18n/migration/types";
import { LOCALIZATION_MIGRATION_MARKER } from "../../i18n/migration/write-migration-file";
import { columnHolds, declaredSize } from "../pipeline/diff/declared-size";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import { normalizeType } from "../pipeline/diff/normalize-type";
import type {
  ColumnSpec,
  NextlySchemaSnapshot,
  TableSpec,
} from "../pipeline/diff/types";

import { migrationDriftError, type DriftItem } from "./drift-error";

/** A migration file as the run lists it. */
export interface CompanionFileRef {
  /** Its name without `.sql`. */
  name: string;
  filePath: string;
  /** What a companion file's header says it is for, as the run read it. */
  localization?: LocalizationMigrationIntent;
  /** The statements it applies, read only for whether a companion file renames a column. */
  upSql?: string;
}

/** What the check found of the companion files this run applies, by name. */
export interface CompanionCheck {
  /** The files whose translations table was compared and matches. */
  checked: ReadonlySet<string>;
  /** The files that could not be checked, each with why, as a sentence's end. */
  unchecked: ReadonlyMap<string, string>;
}

type Kind = LocalizationMigrationIntent["kind"];
type IntentFile = CompanionFileRef & {
  localization: LocalizationMigrationIntent;
};

const hasIntent = (file: CompanionFileRef): file is IntentFile =>
  file.localization !== undefined;

const keyOf = ({ entity, spec }: LocalizationMigrationIntent): string =>
  companionHistoryKey(entity, spec.collection, spec.mainTable);

/**
 * Whether a companion file renames a column of its table. Its header names no column it renames,
 * so the statement is the only record of it.
 */
const renamesColumn = (file: CompanionFileRef): boolean =>
  /\bRENAME\s+COLUMN\b/i.test(file.upSql ?? "");

/** The kinds of file that add the columns their header names, which may not be there yet. */
const ADDS_ITS_COLUMNS: ReadonlySet<Kind> = new Set<Kind>([
  "create-only",
  "enable",
  "joins",
  "adds",
]);

/** The kinds of file after which the translations table is there, or gone, whatever it was. */
const MAKES_OR_DROPS_TABLE: ReadonlySet<Kind> = new Set<Kind>([
  "create-only",
  "enable",
  "disable",
]);

/**
 * What each kind of file does to the record of exact column types: a create or an add makes its
 * columns with the field's own type; a move into translation may carry the main column's, so its
 * columns are no longer known exactly; a move out and a disable drop theirs.
 */
const TYPES_AFTER: Record<
  Kind,
  (
    types: Map<string, LocalizedColumnSpec>,
    named: readonly LocalizedColumnSpec[]
  ) => void
> = {
  "create-only": record,
  adds: record,
  enable: forget,
  joins: forget,
  shared: forget,
  disable: types => types.clear(),
  archive: () => {},
  unique: () => {},
};

function record(
  types: Map<string, LocalizedColumnSpec>,
  named: readonly LocalizedColumnSpec[]
): void {
  for (const column of named) types.set(column.name, column);
}

function forget(
  types: Map<string, LocalizedColumnSpec>,
  named: readonly LocalizedColumnSpec[]
): void {
  for (const column of named) types.delete(column.name);
}

/** The exact column types the applied companion files record, by entity then column. */
function exactTypes(
  applied: readonly CompanionFileRef[]
): Map<string, Map<string, LocalizedColumnSpec>> {
  const byEntity = new Map<string, Map<string, LocalizedColumnSpec>>();
  for (const file of applied.filter(hasIntent)) {
    const key = keyOf(file.localization);
    const types = byEntity.get(key) ?? new Map<string, LocalizedColumnSpec>();
    TYPES_AFTER[file.localization.kind](types, file.localization.spec.columns);
    // After a rename the names the earlier headers recorded types under are no longer the
    // columns', and no header says which moved.
    if (renamesColumn(file)) types.clear();
    byEntity.set(key, types);
  }
  return byEntity;
}

/** The snapshot of the last of `files` that has one, or null when none has. */
async function lastSnapshot(
  files: readonly CompanionFileRef[],
  snapshotOf: SnapshotOf
): Promise<NextlySchemaSnapshot | null> {
  for (const file of [...files].reverse()) {
    const found = await snapshotOf(file.name);
    if (found !== null) return found.snapshot;
  }
  return null;
}

/** A migration's snapshot by the migration's name, or null when it has none. */
type SnapshotOf = (
  name: string
) => Promise<{ snapshot: NextlySchemaSnapshot } | null>;

/**
 * Whether `live` holds what a file made the column to hold: the type it gave it or a wider one,
 * or the type an earlier release gave it. SQLite enforces no size, so there none decides.
 */
function holds(
  live: ColumnSpec,
  recorded: LocalizedColumnSpec,
  dialect: SupportedDialect
): boolean {
  const wanted = ddlType(recorded, dialect);
  const earlier = earlierCompanionColumnType(wanted, dialect);
  return (
    columnHolds(
      live,
      { name: live.name, type: wanted, nullable: true },
      { sizes: dialect !== "sqlite" }
    ) ||
    (earlier !== undefined &&
      normalizeType(live.type) === normalizeType(earlier))
  );
}

/** A live column's definition as a drift line says it: its type, its size, and NOT NULL. */
function definitionOf(column: ColumnSpec): string {
  const size = declaredSize(column);
  const type =
    size === undefined || column.type.includes("(")
      ? column.type
      : `${column.type}(${size})`;
  return column.nullable ? type : `${type} NOT NULL`;
}

/**
 * How the real table's columns fall short of the ones both snapshots name, as drift items: each
 * such column that is not there, or holds narrower than its file made it.
 */
function differences(args: {
  table: string;
  /** The columns both the last applied and the newest pending snapshot name. */
  names: readonly string[];
  types: ReadonlyMap<string, LocalizedColumnSpec> | undefined;
  live: readonly ColumnSpec[];
  /** The columns a file not yet applied adds. */
  leftToFiles: ReadonlySet<string>;
  dialect: SupportedDialect;
}): DriftItem[] {
  const { table, names, types, live, leftToFiles, dialect } = args;
  const byName = new Map(live.map(column => [column.name, column]));
  const items: DriftItem[] = [];
  for (const name of names) {
    if (leftToFiles.has(name)) continue;
    const column = byName.get(name);
    const recorded = types?.get(name);
    if (column === undefined) {
      items.push({ kind: "-", detail: `column ${table}.${name}` });
    } else if (recorded !== undefined && !holds(column, recorded, dialect)) {
      items.push({
        kind: "?",
        detail: `column ${table}.${name} is ${definitionOf(column)}, and its migration file made it ${ddlType(recorded, dialect)}`,
      });
    }
  }
  return items;
}

/** One entity's companion files not yet applied, in the order they run. */
interface PendingEntity {
  key: string;
  files: IntentFile[];
}

function byEntity(pending: readonly IntentFile[]): PendingEntity[] {
  const entities = new Map<string, PendingEntity>();
  for (const file of pending) {
    const key = keyOf(file.localization);
    const found = entities.get(key) ?? { key, files: [] };
    found.files.push(file);
    entities.set(key, found);
  }
  return [...entities.values()];
}

/** What one entity's check comes to: it matches, it cannot be checked (why), or it has drifted. */
type Verdict =
  | { kind: "matches" }
  | { kind: "unchecked"; why: string }
  | { kind: "drift"; items: DriftItem[] };

function judge(args: {
  entity: PendingEntity;
  /** The main table as the last applied snapshot records it. */
  before: TableSpec | undefined;
  /** The main table as the newest pending snapshot records it: `before`, where none is pending. */
  after: TableSpec | undefined;
  types: ReadonlyMap<string, LocalizedColumnSpec> | undefined;
  live: readonly ColumnSpec[] | undefined;
  dialect: SupportedDialect;
}): Verdict {
  const { entity, before, after, types, live, dialect } = args;
  const [first] = entity.files;
  if (first === undefined) return { kind: "matches" };
  const table = first.localization.spec.companionTable;
  // Both snapshots say the table is translated: it should be there throughout.
  const translated = before?.localized === true && after?.localized === true;
  // A file that makes or drops the table may have done so already, in a run stopped part-way.
  const tableLeftToFiles = entity.files.some(file =>
    MAKES_OR_DROPS_TABLE.has(file.localization.kind)
  );

  if (live === undefined) {
    return translated && !tableLeftToFiles
      ? { kind: "drift", items: [{ kind: "-", detail: `table ${table}` }] }
      : { kind: "matches" };
  }
  if (before?.localized !== true) {
    return {
      kind: "unchecked",
      why: `the translations table ${table} is already there, and no applied migration file records it`,
    };
  }
  // The table is on its way out: nothing of it is named on both sides.
  if (after?.localized !== true) return { kind: "matches" };
  if (
    before.localizedColumns === undefined ||
    after.localizedColumns === undefined
  ) {
    return {
      kind: "unchecked",
      why: `the migration files do not record the columns of the translations table ${table}`,
    };
  }
  if (entity.files.some(renamesColumn)) {
    return {
      kind: "unchecked",
      why: `a file not yet applied renames a column of the translations table ${table}, and the files do not record which`,
    };
  }
  const named = new Set(after.localizedColumns);
  const items = differences({
    table,
    names: before.localizedColumns.filter(name => named.has(name)),
    types,
    live,
    leftToFiles: new Set(
      entity.files
        .filter(file => ADDS_ITS_COLUMNS.has(file.localization.kind))
        .flatMap(file =>
          file.localization.spec.columns.map(column => column.name)
        )
    ),
    dialect,
  });
  return items.length === 0 ? { kind: "matches" } : { kind: "drift", items };
}

/**
 * The pending files with no header intent, by what they are: a localization file this build
 * cannot read (it carries the marker), or a migration written by hand (no marker, no snapshot).
 * Either may change a translations table in a way no record says.
 */
async function filesOfNoRecord(
  pending: readonly CompanionFileRef[],
  snapshotOf: SnapshotOf
): Promise<{ unread: CompanionFileRef[]; byHand: CompanionFileRef[] }> {
  const unread: CompanionFileRef[] = [];
  const byHand: CompanionFileRef[] = [];
  for (const file of pending) {
    if (hasIntent(file)) continue;
    const content = await readFile(file.filePath, "utf-8");
    if (content.includes(LOCALIZATION_MIGRATION_MARKER)) unread.push(file);
    else if ((await snapshotOf(file.name)) === null) byHand.push(file);
  }
  return { unread, byHand };
}

/**
 * Why no drift can be asserted of `table` while such a file is pending, or undefined when none
 * is: the file may be the very change, or the operator's repair, that accounts for the
 * difference.
 */
function whyNotAsserted(
  table: string,
  pending: { unread: readonly unknown[]; byHand: readonly unknown[] }
): string | undefined {
  if (pending.unread.length > 0) {
    return `a localization file not yet applied, which this version cannot read, may change the translations table ${table}`;
  }
  if (pending.byHand.length > 0) {
    return `a migration written by hand, not yet applied, may change the translations table ${table}`;
  }
  return undefined;
}

/**
 * Checks the translations table of every companion file this run applies against the record the
 * applied files left. Throws the drift refusal for the first entity whose table differs, before
 * any file applies; otherwise says which files were checked and which could not be, with why.
 */
export async function checkCompanionFiles(args: {
  db: unknown;
  dialect: SupportedDialect;
  /** The files the ledger records as applied, in run order. */
  applied: readonly CompanionFileRef[];
  /** Every file not yet applied, in run order. */
  pending: readonly CompanionFileRef[];
  /** The names of the files this run applies: all of `pending`, or fewer under a step. */
  runs: ReadonlySet<string>;
  snapshotOf: SnapshotOf;
}): Promise<CompanionCheck> {
  const checked = new Set<string>();
  const unchecked = new Map<string, string>();
  const ofNoRecord = await filesOfNoRecord(args.pending, args.snapshotOf);
  for (const file of ofNoRecord.unread) {
    if (!args.runs.has(file.name)) continue;
    unchecked.set(
      file.name,
      "this version cannot read what the file records of its translations table"
    );
  }
  const entities = byEntity(args.pending.filter(hasIntent)).filter(entity =>
    entity.files.some(file => args.runs.has(file.name))
  );
  if (entities.length === 0) return { checked, unchecked };

  const before = await lastSnapshot(args.applied, args.snapshotOf);
  const after = (await lastSnapshot(args.pending, args.snapshotOf)) ?? before;
  const types = exactTypes(args.applied);
  const tables = entities.flatMap(entity =>
    entity.files.slice(0, 1).map(file => file.localization.spec.companionTable)
  );
  const live = await introspectLiveColumns(args.db, args.dialect, tables);
  for (const entity of entities) {
    const [first] = entity.files.filter(file => args.runs.has(file.name));
    if (first === undefined) continue;
    const { spec } = first.localization;
    const judged = judge({
      entity,
      before: before?.tables.find(table => table.name === spec.mainTable),
      after: after?.tables.find(table => table.name === spec.mainTable),
      types: types.get(entity.key),
      live: live.tables.find(table => table.name === spec.companionTable)
        ?.columns,
      dialect: args.dialect,
    });
    const notAsserted = whyNotAsserted(spec.companionTable, ofNoRecord);
    const verdict: Verdict =
      judged.kind === "drift" && notAsserted !== undefined
        ? { kind: "unchecked", why: notAsserted }
        : judged;
    if (verdict.kind === "drift") {
      throw migrationDriftError({
        migration: first.name,
        file: first.filePath,
        translationsTable: spec.companionTable,
        driftItems: verdict.items,
      });
    }
    for (const file of entity.files) {
      if (verdict.kind === "unchecked") unchecked.set(file.name, verdict.why);
      else checked.add(file.name);
    }
  }
  return { checked, unchecked };
}

/**
 * What `nextly migrate` says of a file with no snapshot as it applies it, or undefined when there
 * is nothing to say: a companion file whose table was checked. One that could not be checked is
 * said so with the reason, and any other file is one written by hand, with nothing to check it
 * against.
 */
export function snapshotlessNotice(
  filename: string,
  check: CompanionCheck
): string | undefined {
  const name = filename.replace(/\.sql$/, "");
  if (check.checked.has(name)) return undefined;
  const why = check.unchecked.get(name);
  return why === undefined
    ? `No snapshot for ${filename}; applying verbatim without drift checks.`
    : `${filename} is applied without a drift check: ${why}.`;
}
