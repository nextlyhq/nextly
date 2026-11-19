/**
 * The drift check of the companion files `nextly migrate:create` writes for an entity's
 * translations table, made before `nextly migrate` applies any pending file.
 *
 * A companion file has no snapshot: the snapshot records the main tables, and these files carry
 * statements that move values and must run as written. Each one records in its header what it is
 * for, its columns included, so the table the applied companion files left is known
 * (`readCompanionHistory`). The real table is compared with that: whether it is there, and each
 * translated column by name and by whether it holds what the files made it to hold. A difference
 * is drift, reported with the companion file as a main file's drift is, and nothing is applied.
 *
 * Not every translations table can be checked. One no applied file made (a development sync or
 * `db:sync` made it), or one with a localization file this build cannot read in its history, has
 * no known shape; its files are applied, and the reason is said in place of the check.
 *
 * A column a pending file of the same entity names is left to that file: a run stopped part-way
 * can leave it added or dropped already, and the file's own checks decide what to do with it.
 *
 * @module domains/schema/migrate/companion-drift
 */
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { earlierCompanionColumnType } from "../../i18n/migration/companion-column-holds";
import {
  companionHistoryKey,
  readCompanionHistory,
  type CompanionHistory,
} from "../../i18n/migration/companion-history";
import { ddlType } from "../../i18n/migration/ddl-types";
import {
  parseLocalizationIntent,
  type LocalizationMigrationIntent,
} from "../../i18n/migration/migration-intent";
import type { LocalizedColumnSpec } from "../../i18n/migration/types";
import { LOCALIZATION_MIGRATION_MARKER } from "../../i18n/migration/write-migration-file";
import { columnHolds } from "../pipeline/diff/declared-size";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import { normalizeType } from "../pipeline/diff/normalize-type";
import type { ColumnSpec } from "../pipeline/diff/types";

import { migrationDriftError, type DriftItem } from "./drift-error";

/** A migration file as the run lists it: its name without `.sql`, and where it is. */
export interface CompanionFileRef {
  name: string;
  filePath: string;
}

/** What the check found of the pending companion files, by name. */
export interface CompanionCheck {
  /** The files whose translations table was compared and matches. */
  checked: ReadonlySet<string>;
  /** The files that could not be checked, each with why, as a sentence's end. */
  unchecked: ReadonlyMap<string, string>;
}

const NOTHING: CompanionCheck = { checked: new Set(), unchecked: new Map() };

/** The kinds of file that make a translations table. */
const MAKES_TABLE = new Set<LocalizationMigrationIntent["kind"]>([
  "create-only",
  "enable",
]);

/** One pending companion file, read. */
type PendingFile = CompanionFileRef &
  (
    | { reading: "intent"; intent: LocalizationMigrationIntent }
    /** A localization file whose header this build cannot read. */
    | { reading: "unread" }
  );

/** `file` as a pending companion file, or undefined when it is not one. */
async function readPending(
  file: CompanionFileRef
): Promise<PendingFile | undefined> {
  const content = await readFile(file.filePath, "utf-8");
  let intent: LocalizationMigrationIntent | null;
  try {
    intent = parseLocalizationIntent(content, `${file.name}.sql`);
  } catch {
    return { ...file, reading: "unread" };
  }
  if (intent !== null) return { ...file, reading: "intent", intent };
  return content.includes(LOCALIZATION_MIGRATION_MARKER)
    ? { ...file, reading: "unread" }
    : undefined;
}

/**
 * What the applied companion files left, by the one reader of their headers. It reads a folder,
 * so the applied localization files are set in one of their own, which is removed after.
 */
async function historyOfApplied(
  applied: readonly CompanionFileRef[]
): Promise<CompanionHistory> {
  const folder = await mkdtemp(join(tmpdir(), "nextly-applied-companions-"));
  try {
    for (const file of applied) {
      const content = await readFile(file.filePath, "utf-8");
      if (!content.includes(LOCALIZATION_MIGRATION_MARKER)) continue;
      await copyFile(file.filePath, join(folder, `${file.name}.sql`));
    }
    return await readCompanionHistory(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** The translations table's columns as the database has them, or undefined when it is not there. */
async function liveColumns(
  db: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<readonly ColumnSpec[] | undefined> {
  const live = await introspectLiveColumns(db, dialect, [table]);
  return live.tables.find(each => each.name === table)?.columns;
}

/**
 * Whether `live` holds what the files made the column to hold: the type they gave it or a wider
 * one, or the type an earlier release gave it. SQLite enforces no size, so there none decides.
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

/** One entity's pending companion files, in the order they run. */
interface PendingEntity {
  key: string;
  files: (PendingFile & { reading: "intent" })[];
}

/**
 * How the real table differs from the one the applied files left, as drift items. The table's
 * own columns (`_parent`, `_locale` and the others it keeps for itself) begin with an underscore
 * and are no field's.
 */
function differences(args: {
  table: string;
  expected: ReadonlyMap<string, LocalizedColumnSpec>;
  live: readonly ColumnSpec[];
  /** The columns a pending file of the entity names. */
  pendingColumns: ReadonlySet<string>;
  dialect: SupportedDialect;
}): DriftItem[] {
  const { table, expected, live, pendingColumns, dialect } = args;
  const byName = new Map(live.map(column => [column.name, column]));
  const items: DriftItem[] = [];
  for (const [name, recorded] of expected) {
    if (pendingColumns.has(name)) continue;
    const column = byName.get(name);
    if (column === undefined) {
      items.push({
        kind: "-",
        detail: `column ${table}.${name} (${ddlType(recorded, dialect)})`,
      });
    } else if (!holds(column, recorded, dialect)) {
      items.push({
        kind: "?",
        detail: `column ${table}.${name} is ${column.type}, and the migration files made it ${ddlType(recorded, dialect)}`,
      });
    }
  }
  for (const column of live) {
    if (
      !column.name.startsWith("_") &&
      !expected.has(column.name) &&
      !pendingColumns.has(column.name)
    ) {
      items.push({
        kind: "+",
        detail: `column ${table}.${column.name} (${column.type})`,
      });
    }
  }
  return items;
}

/** What one entity's check comes to: it matches, it cannot be checked (why), or it has drifted. */
type Verdict =
  | { kind: "matches" }
  | { kind: "unchecked"; why: string }
  | { kind: "drift"; items: DriftItem[] };

async function judge(
  entity: PendingEntity,
  history: CompanionHistory,
  db: unknown,
  dialect: SupportedDialect
): Promise<Verdict> {
  const [first] = entity.files;
  if (first === undefined) return { kind: "matches" };
  const { spec } = first.intent;
  const table = spec.companionTable;
  const live = await liveColumns(db, dialect, table);
  const kinds = new Set(entity.files.map(file => file.intent.kind));
  const expected = history.columns.get(entity.key);

  // No applied file is about this table.
  if (expected === undefined) {
    if (live === undefined) return { kind: "matches" };
    return {
      kind: "unchecked",
      why: `the translations table ${table} is already there, and no applied migration file made it`,
    };
  }
  if (
    !history.describes(first.intent.entity, spec.collection, spec.mainTable)
  ) {
    return {
      kind: "unchecked",
      why: `the translations table ${table} was not made by a migration file this version can read`,
    };
  }

  const shouldBeThere = history.present.has(entity.key);
  if (live === undefined) {
    // A table a pending file drops may be gone already, from a run stopped part-way.
    return shouldBeThere && !kinds.has("disable")
      ? { kind: "drift", items: [{ kind: "-", detail: `table ${table}` }] }
      : { kind: "matches" };
  }
  if (!shouldBeThere) {
    // One a pending file makes may be there already, from a run stopped part-way.
    return MAKES_TABLE.has(first.intent.kind)
      ? { kind: "matches" }
      : { kind: "drift", items: [{ kind: "+", detail: `table ${table}` }] };
  }
  const items = differences({
    table,
    expected,
    live,
    pendingColumns: new Set(
      entity.files.flatMap(file =>
        file.intent.spec.columns.map(column => column.name)
      )
    ),
    dialect,
  });
  return items.length === 0 ? { kind: "matches" } : { kind: "drift", items };
}

/** The pending companion files with a readable header, grouped by entity in the order they run. */
function byEntity(pending: readonly PendingFile[]): PendingEntity[] {
  const entities = new Map<string, PendingEntity>();
  for (const file of pending) {
    if (file.reading !== "intent") continue;
    const { entity, spec } = file.intent;
    const key = companionHistoryKey(entity, spec.collection, spec.mainTable);
    const found = entities.get(key) ?? { key, files: [] };
    found.files.push(file);
    entities.set(key, found);
  }
  return [...entities.values()];
}

/**
 * Checks every pending companion file's translations table against the one the applied companion
 * files left. Throws the drift refusal for the first entity whose table differs, before any file
 * applies; otherwise says which files were checked and which could not be, with why.
 */
export async function checkCompanionFiles(args: {
  db: unknown;
  dialect: SupportedDialect;
  /** The files the ledger records as applied. */
  applied: readonly CompanionFileRef[];
  /** The files this run applies, in order. */
  pending: readonly CompanionFileRef[];
}): Promise<CompanionCheck> {
  const pending = (await Promise.all(args.pending.map(readPending))).filter(
    file => file !== undefined
  );
  if (pending.length === 0) return NOTHING;

  const history = await historyOfApplied(args.applied);
  const checked = new Set<string>();
  const unchecked = new Map<string, string>();
  for (const file of pending) {
    if (file.reading === "unread") {
      unchecked.set(
        file.name,
        "this version cannot read what the file records of its translations table"
      );
    }
  }
  for (const entity of byEntity(pending)) {
    const verdict = await judge(entity, history, args.db, args.dialect);
    const [first] = entity.files;
    if (verdict.kind === "drift" && first !== undefined) {
      throw migrationDriftError({
        migration: first.name,
        file: first.filePath,
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
