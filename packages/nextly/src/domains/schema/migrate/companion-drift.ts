/**
 * The drift check of the companion files `nextly migrate:create` writes for an entity's
 * translations table, made before `nextly migrate` applies any pending file.
 *
 * A companion file has no snapshot of its own: it carries statements that move values and must
 * run as written. What its table should look like is recorded all the same.
 *
 * The snapshots of the main files say which tables are translated and name each one's translated
 * columns. They are written from the config, so they follow a renamed field and a collection
 * removed and added again. A column's type is not judged: a file's header records the type its
 * field declares, and the file adopts a column already there, so the header does not say what
 * the column is.
 *
 * The table may rightly stand anywhere between the last applied snapshot and the newest pending
 * one: a run stopped part-way leaves it there. So, as for a main file, drift is what fits
 * neither: the table, or a translated column, that both snapshots name and the database lacks.
 * A column neither names is not drift: a translated
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

import { companionHistoryKey } from "../../i18n/migration/companion-history";
import type { LocalizationMigrationIntent } from "../../i18n/migration/migration-intent";
import { LOCALIZATION_MIGRATION_MARKER } from "../../i18n/migration/write-migration-file";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
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

/**
 * What a file of each kind may already have done to the table when a run stopped part-way, so
 * that the check leaves it to the file: the columns its header names added, the table made or
 * dropped. A record of every kind, so a new kind is classified before this compiles.
 */
const LEFT_TO_FILE: Record<Kind, { columns: boolean; table: boolean }> = {
  "create-only": { columns: true, table: true },
  enable: { columns: true, table: true },
  joins: { columns: true, table: false },
  adds: { columns: true, table: false },
  disable: { columns: false, table: true },
  shared: { columns: false, table: false },
  archive: { columns: false, table: false },
  unique: { columns: false, table: false },
};

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

/** The columns among `names` the real table lacks, as drift items. */
function missingColumns(args: {
  table: string;
  /** The columns both the last applied and the newest pending snapshot name. */
  names: readonly string[];
  live: readonly ColumnSpec[];
  /** The columns a file not yet applied adds. */
  leftToFiles: ReadonlySet<string>;
}): DriftItem[] {
  const there = new Set(args.live.map(column => column.name));
  return args.names
    .filter(name => !args.leftToFiles.has(name) && !there.has(name))
    .map(name => ({ kind: "-", detail: `column ${args.table}.${name}` }));
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
  live: readonly ColumnSpec[] | undefined;
}): Verdict {
  const { entity, before, after, live } = args;
  const [first] = entity.files;
  if (first === undefined) return { kind: "matches" };
  const table = first.localization.spec.companionTable;
  // Both snapshots say the table is translated: it should be there throughout.
  const translated = before?.localized === true && after?.localized === true;
  // A file that makes or drops the table may have done so already, in a run stopped part-way.
  const tableLeftToFiles = entity.files.some(
    file => LEFT_TO_FILE[file.localization.kind].table
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
  const items = missingColumns({
    table,
    names: before.localizedColumns.filter(name => named.has(name)),
    live,
    leftToFiles: new Set(
      entity.files
        .filter(file => LEFT_TO_FILE[file.localization.kind].columns)
        .flatMap(file =>
          file.localization.spec.columns.map(column => column.name)
        )
    ),
  });
  return items.length === 0 ? { kind: "matches" } : { kind: "drift", items };
}

/** A file this run applies that has no header intent, with its text. */
interface FileOfNoRecord {
  file: CompanionFileRef;
  content: string;
  /** A localization file this build cannot read (it carries the marker), or one written by hand. */
  kind: "unread" | "by-hand";
}

/**
 * The files this run applies that have no header intent and no snapshot: a localization file
 * this build cannot read, or a migration written by hand. Either may change a translations table
 * in a way no record says.
 */
async function filesOfNoRecord(
  running: readonly CompanionFileRef[],
  snapshotOf: SnapshotOf
): Promise<FileOfNoRecord[]> {
  const found: FileOfNoRecord[] = [];
  for (const file of running) {
    if (hasIntent(file)) continue;
    const content = await readFile(file.filePath, "utf-8");
    if (content.includes(LOCALIZATION_MIGRATION_MARKER)) {
      found.push({ file, content, kind: "unread" });
    } else if ((await snapshotOf(file.name)) === null) {
      found.push({ file, content, kind: "by-hand" });
    }
  }
  return found;
}

/**
 * Why no drift can be asserted of `table`, or undefined when it can: a file of this run that no
 * record describes names the table, so it may be the very change, or the operator's repair,
 * that accounts for the difference.
 */
function whyNotAsserted(
  table: string,
  ofNoRecord: readonly FileOfNoRecord[]
): string | undefined {
  const about = ofNoRecord.find(each => each.content.includes(table));
  if (about === undefined) return undefined;
  return about.kind === "unread"
    ? `${about.file.name}.sql, a localization file this version cannot read, may change the translations table ${table}`
    : `${about.file.name}.sql, a migration written by hand, may change the translations table ${table}`;
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
  const ofNoRecord = await filesOfNoRecord(
    args.pending.filter(file => args.runs.has(file.name)),
    args.snapshotOf
  );
  for (const { file, kind } of ofNoRecord) {
    if (kind !== "unread") continue;
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
      live: live.tables.find(table => table.name === spec.companionTable)
        ?.columns,
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
