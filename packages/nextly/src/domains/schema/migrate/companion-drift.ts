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

import { COMPANION_KEY_COLUMNS } from "../../i18n/companion-columns";
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
interface CompanionFileRef {
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
  if (live === undefined) return judgeAbsentTable(entity, table, before, after);
  if (before?.localized !== true) {
    return {
      kind: "unchecked",
      why: `the translations table ${table} is already there, and no applied migration file records it`,
    };
  }
  // The table is on its way out: nothing of it is named on both sides.
  if (after?.localized !== true) return { kind: "matches" };
  // The key every translations table has had since the first release, which no snapshot lists:
  // never rightly missing, whatever the snapshots record of its translated columns.
  const keys = missingColumns({
    table,
    names: COMPANION_KEY_COLUMNS,
    live,
    leftToFiles: new Set(),
  });
  if (keys.length > 0) return { kind: "drift", items: keys };
  return judgeTranslatedColumns({ entity, table, before, after, live });
}

/**
 * A translations table that is not there: drift where both snapshots say it is translated, so it
 * should be there throughout, unless a file of the entity makes or drops it, which it may have
 * done already in a run stopped part-way.
 */
function judgeAbsentTable(
  entity: PendingEntity,
  table: string,
  before: TableSpec | undefined,
  after: TableSpec | undefined
): Verdict {
  const translated = before?.localized === true && after?.localized === true;
  const leftToFiles = entity.files.some(
    file => LEFT_TO_FILE[file.localization.kind].table
  );
  return translated && !leftToFiles
    ? { kind: "drift", items: [{ kind: "-", detail: `table ${table}` }] }
    : { kind: "matches" };
}

/**
 * The translated columns of a table both snapshots say is translated: drift is each one both
 * name that the table lacks, unless a file not yet applied adds it. Not judged where a snapshot
 * does not record them, or where a pending file renames one.
 */
function judgeTranslatedColumns(args: {
  entity: PendingEntity;
  table: string;
  before: TableSpec;
  after: TableSpec;
  live: readonly ColumnSpec[];
}): Verdict {
  const { entity, table, before, after, live } = args;
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

/** A file this run applies that has no header intent. */
interface FileOfNoRecord {
  file: CompanionFileRef;
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
      found.push({ file, kind: "unread" });
    } else if ((await snapshotOf(file.name)) === null) {
      found.push({ file, kind: "by-hand" });
    }
  }
  return found;
}

/** `sql` with its comments and string literals blanked, so that only its statements are read. */
const statementsOf = (sql: string): string =>
  sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, " ");

/**
 * Whether `sql`, as its statements, names `table` itself: not inside a comment or a string, and
 * not as part of a longer name such as `<table>_backup`.
 */
function statementsName(sql: string, table: string): boolean {
  const name = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`).test(
    statementsOf(sql)
  );
}

/**
 * Why no drift can be asserted of `table`, or undefined when it can: a file of this run that no
 * record describes names the table in the statements it applies, so it may be the very change,
 * or the operator's repair, that accounts for the difference.
 */
function whyNotAsserted(
  table: string,
  ofNoRecord: readonly FileOfNoRecord[]
): string | undefined {
  const about = ofNoRecord.find(each =>
    statementsName(each.file.upSql ?? "", table)
  );
  if (about === undefined) return undefined;
  return about.kind === "unread"
    ? `${about.file.name}.sql, a localization file this version cannot read, may change the translations table ${table}`
    : `${about.file.name}.sql, a migration written by hand, may change the translations table ${table}`;
}

/** What the check is handed: the run's files, as the ledger divides them, and their snapshots. */
interface CompanionCheckArgs {
  db: unknown;
  dialect: SupportedDialect;
  /** The files the ledger records as applied, in run order. */
  applied: readonly CompanionFileRef[];
  /** Every file not yet applied, in run order. */
  pending: readonly CompanionFileRef[];
  /** The names of the files this run applies: all of `pending`, or fewer under a step. */
  runs: ReadonlySet<string>;
  snapshotOf: SnapshotOf;
}

/** The drift a run is refused for: the companion file, its table, and each difference. */
export interface CompanionRefusal {
  migration: string;
  file: string;
  table: string;
  items: DriftItem[];
}

/**
 * Judges the translations table of every companion file this run applies against what the
 * migrations around this point record of it: which files were checked, which could not be and
 * why, and the drift of the first entity whose table differs. Reads only: a dry run names what
 * it finds, and a real run refuses it (`checkCompanionFiles`).
 */
export async function judgeCompanionFiles(
  args: CompanionCheckArgs
): Promise<{ check: CompanionCheck; refusal?: CompanionRefusal }> {
  const ofNoRecord = await filesOfNoRecord(
    args.pending.filter(file => args.runs.has(file.name)),
    args.snapshotOf
  );
  const checked = new Set<string>();
  const unchecked = unreadFilesUnchecked(ofNoRecord);
  const entities = byEntity(args.pending.filter(hasIntent)).filter(entity =>
    entity.files.some(file => args.runs.has(file.name))
  );
  if (entities.length === 0) return { check: { checked, unchecked } };

  const before = await lastSnapshot(args.applied, args.snapshotOf);
  const run: RunRecord = {
    runs: args.runs,
    before,
    after: (await lastSnapshot(args.pending, args.snapshotOf)) ?? before,
    live: await introspectLiveColumns(
      args.db,
      args.dialect,
      entities.flatMap(entity =>
        entity.files
          .slice(0, 1)
          .map(file => file.localization.spec.companionTable)
      )
    ),
    ofNoRecord,
  };
  for (const entity of entities) {
    const judged = entityVerdict(entity, run);
    if (judged === undefined) continue;
    const { first, verdict } = judged;
    if (verdict.kind === "drift") {
      return {
        check: { checked, unchecked },
        refusal: {
          migration: first.name,
          file: first.filePath,
          table: first.localization.spec.companionTable,
          items: verdict.items,
        },
      };
    }
    for (const file of entity.files) {
      if (verdict.kind === "unchecked") unchecked.set(file.name, verdict.why);
      else checked.add(file.name);
    }
  }
  return { check: { checked, unchecked } };
}

/** The localization files of this run this build cannot read, each with why it goes unchecked. */
function unreadFilesUnchecked(
  ofNoRecord: readonly FileOfNoRecord[]
): Map<string, string> {
  return new Map(
    ofNoRecord
      .filter(each => each.kind === "unread")
      .map(({ file }) => [
        file.name,
        "this version cannot read what the file records of its translations table",
      ])
  );
}

/** What the run's check reads each entity against. */
interface RunRecord {
  runs: ReadonlySet<string>;
  before: NextlySchemaSnapshot | null;
  after: NextlySchemaSnapshot | null;
  live: { tables: readonly { name: string; columns: ColumnSpec[] }[] };
  ofNoRecord: readonly FileOfNoRecord[];
}

/**
 * One entity's verdict, with the first of its files this run applies, which a refusal names;
 * undefined when this run applies none of them. Drift a file of the run no record describes may
 * account for is not asserted (`whyNotAsserted`).
 */
function entityVerdict(
  entity: PendingEntity,
  run: RunRecord
): { first: IntentFile; verdict: Verdict } | undefined {
  const [first] = entity.files.filter(file => run.runs.has(file.name));
  if (first === undefined) return undefined;
  const { spec } = first.localization;
  const judged = judge({
    entity,
    before: run.before?.tables.find(table => table.name === spec.mainTable),
    after: run.after?.tables.find(table => table.name === spec.mainTable),
    live: run.live.tables.find(table => table.name === spec.companionTable)
      ?.columns,
  });
  const notAsserted =
    judged.kind === "drift"
      ? whyNotAsserted(spec.companionTable, run.ofNoRecord)
      : undefined;
  return {
    first,
    verdict:
      notAsserted === undefined
        ? judged
        : { kind: "unchecked", why: notAsserted },
  };
}

/**
 * Checks the translations table of every companion file this run applies, before any file
 * applies: throws the drift refusal for the first entity whose table differs; otherwise says
 * which files were checked and which could not be, with why.
 */
export async function checkCompanionFiles(
  args: CompanionCheckArgs
): Promise<CompanionCheck> {
  const { check, refusal } = await judgeCompanionFiles(args);
  if (refusal !== undefined) {
    throw migrationDriftError({
      migration: refusal.migration,
      file: refusal.file,
      translationsTable: refusal.table,
      driftItems: refusal.items,
    });
  }
  return check;
}

/**
 * What `nextly migrate` says of a file with no snapshot as it applies it, or undefined when there
 * is nothing to say: a companion file whose table was checked. One that could not be checked is
 * said so with the reason, and any other file is one written by hand, with nothing to check it
 * against.
 */
function snapshotlessNotice(
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

/**
 * Says, through `warn`, what `nextly migrate` says of a file with no snapshot as it applies it
 * (`snapshotlessNotice`), when there is anything to say.
 */
export function warnOfSnapshotlessFile(
  warn: (message: string) => void,
  filename: string,
  check: CompanionCheck
): void {
  const notice = snapshotlessNotice(filename, check);
  if (notice !== undefined) warn(notice);
}
