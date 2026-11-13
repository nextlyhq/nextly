/**
 * Whether turning translation on or off would lose part of a column's definition: the comment,
 * character set or collation the column holding a field's values has, which the column created to
 * receive them would not have. The receiving column is created naming none of them, so it takes
 * its table's (or its type's) default; a source column that has its own is refused before any
 * statement runs, rather than moved without it.
 *
 * One judge for every path that moves the values (a schema push, a Builder save, a field group's
 * update, `nextly migrate`), each reading the source column and the receiving table's defaults
 * from its database (`readColumnExtras`, `readReceivingDefaults`).
 *
 * @module domains/i18n/migration/move-keeps-definition
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import type { ColumnSpec } from "../../schema/pipeline/diff/types";
import {
  type ColumnExtras,
  readColumnExtras,
  readReceivingDefaults,
  type ReceivingDefaults,
} from "../../schema/pipeline/live-table-facts";

import { carriedDefinition } from "./carried-definition";
import {
  type LeavingTranslationRefusal,
  refusal,
  type TranslationSurface,
} from "./field-leaves-translation-rules";
import type { LocalizationMigrationIntent } from "./migration-intent";
import type { LocalizedColumnSpec } from "./types";

/** A part of a column's definition a move into a new column can lose. */
export type CarriedProperty =
  | "comment"
  | "character set"
  | "collation"
  | "type"
  | "default";

/** A moved field whose column has parts of its definition the receiving column would not. */
export interface ColumnMoveLoss {
  field: string;
  column: string;
  lost: CarriedProperty[];
}

/**
 * The moved fields whose source column (`extras`, by column) has a comment, or a character set or
 * collation other than the one a column created in the receiving table takes (`receiving`). A
 * column `extras` does not describe is not there to lose anything.
 */
export function lostOnMove(
  moved: readonly { field: string; column: string }[],
  extras: ReadonlyMap<string, ColumnExtras>,
  receiving: ReceivingDefaults
): ColumnMoveLoss[] {
  return moved.flatMap(({ field, column }) => {
    const source = extras.get(column);
    if (source === undefined) return [];
    const lost: CarriedProperty[] = [
      ...(source.comment !== null ? (["comment"] as const) : []),
      ...(source.charset !== null && source.charset !== receiving.charset
        ? (["character set"] as const)
        : []),
      ...(source.collation !== null && source.collation !== receiving.collation
        ? (["collation"] as const)
        : []),
    ];
    return lost.length > 0 ? [{ field, column, lost }] : [];
  });
}

/**
 * What moving `moved` from the table `from` into new columns of the table `to` would lose, read
 * from the database as it stands: the source columns' own definition (`readColumnExtras`) against
 * what a column created in `to` takes (`readReceivingDefaults`).
 */
export async function lossesOnMove(
  db: unknown,
  dialect: SupportedDialect,
  move: {
    moved: readonly { field: string; column: string }[];
    from: string;
    to: string;
  }
): Promise<ColumnMoveLoss[]> {
  if (move.moved.length === 0) return [];
  return lostOnMove(
    move.moved,
    await readColumnExtras(
      db,
      dialect,
      move.from,
      move.moved.map(m => m.column)
    ),
    await readReceivingDefaults(db, dialect, move.to)
  );
}

/** One refusal per field whose move would lose part of its column's definition. */
export function refusalsForMovesLosingDefinition(args: {
  losses: readonly ColumnMoveLoss[];
  /** The table the values sit in now. */
  table: string;
  /** Whether translation is turned on (values move to the translations table) or off. */
  translation: "on" | "off";
  surface: TranslationSurface;
}): LeavingTranslationRefusal[] {
  return args.losses.map(({ field, column, lost }) => {
    const parts = lost.join(" and ");
    return refusal(
      `fields.${field}`,
      "TRANSLATION_MOVE_LOSES_COLUMN_DEFINITION",
      `"${field}" is stored in ${args.table}.${column}, which has its own ${parts}; turning ` +
        `translation ${args.translation} moves its values into a new column, which would not have it.`,
      [
        `Change ${args.table}.${column} in the database to have no ${parts} of its own, or leave ` +
          `translation ${args.translation === "on" ? "off" : "on"} for this entity.`,
        args.surface === "builder" ? "Then save again." : "Then run it again.",
      ]
    );
  });
}

/**
 * Refuses a `nextly migrate` run, before any file applies, where a pending file turning
 * translation on or off would move a column's values into a new column without part of its
 * definition (`lostOnMove`). Each file says what it moves in its header
 * (`LocalizationMigrationIntent`): turning translation on moves the spec's columns still on the
 * main table into the companion; off, the companion's back. Read from the database as it stands
 * before the run, so a column an earlier file of the same run creates is not there to judge; no
 * column Nextly creates carries any of these.
 */
export async function refuseMigrationFilesLosingDefinition(
  files: readonly {
    name: string;
    localization?: LocalizationMigrationIntent;
  }[],
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  const refusals: LeavingTranslationRefusal[] = [];
  const refused: string[] = [];
  // Judged in the run's order: a companion an earlier file of the run creates is not in the
  // database yet when a later one turning translation off is judged.
  const createdInRun = new Set<string>();
  for (const file of files) {
    const intent = file.localization;
    if (intent?.kind !== "enable" && intent?.kind !== "disable") continue;
    const companionCreatedEarlier = createdInRun.has(
      intent.spec.companionTable
    );
    if (intent.kind === "enable") createdInRun.add(intent.spec.companionTable);
    const found = await fileRefusals(
      intent,
      db,
      dialect,
      companionCreatedEarlier
    );
    if (found.length === 0) continue;
    refused.push(file.name);
    refusals.push(...found);
  }
  if (refusals.length === 0) return;
  throw NextlyError.validation({
    errors: refusals,
    logContext: { files: refused, fields: refusals.map(r => r.path) },
  });
}

/**
 * What a file turning translation off would not restore of each companion column: its type where
 * wider than the field's own, and its default (`carriedDefinition`). The file re-adds each main
 * column from the field alone, since its header records the companion's columns by kind, while
 * the live companion column may carry either, from a move that turned translation on or from a
 * change by hand. A companion an earlier file of the same run creates (`createdEarlier`) is not
 * there yet; it receives the main columns that file moves, so those are what it would carry.
 */
async function uncarriedOnDisable(
  db: unknown,
  dialect: SupportedDialect,
  spec: LocalizationMigrationIntent["spec"],
  createdEarlier: boolean
): Promise<ColumnMoveLoss[]> {
  const tables = (
    await introspectLiveSnapshot(db, dialect, [
      spec.companionTable,
      spec.mainTable,
    ])
  ).tables;
  const live =
    tables.find(t => t.name === spec.companionTable) ??
    (createdEarlier ? tables.find(t => t.name === spec.mainTable) : undefined);
  if (live === undefined) return [];
  return spec.columns.flatMap(column => {
    const carried = carriedDefinition(
      live.columns.find(c => c.name === column.name),
      column,
      dialect
    );
    const lost: CarriedProperty[] = [
      ...(carried?.type !== undefined ? (["type"] as const) : []),
      ...(carried?.default !== undefined ? (["default"] as const) : []),
    ];
    return lost.length > 0
      ? [{ field: column.name, column: column.name, lost }]
      : [];
  });
}

/** `a` and `b` as one loss per column, each column's lost parts together. */
export function mergeLosses(
  a: readonly ColumnMoveLoss[],
  b: readonly ColumnMoveLoss[]
): ColumnMoveLoss[] {
  const byColumn = new Map<string, ColumnMoveLoss>();
  for (const loss of [...a, ...b]) {
    const known = byColumn.get(loss.column);
    byColumn.set(
      loss.column,
      known ? { ...known, lost: [...known.lost, ...loss.lost] } : loss
    );
  }
  return [...byColumn.values()];
}

/**
 * The companion columns whose carried default a column turning translation off on SQLite cannot
 * take back: SQLite adds a column only with a constant default, and refuses `CURRENT_TIME`,
 * `CURRENT_DATE`, `CURRENT_TIMESTAMP` or an expression in parentheses. No column Nextly creates has
 * one; a companion column given one by hand, or from a main column that had one, does.
 */
export function nonConstantSqliteDefaults(
  live: readonly ColumnSpec[],
  moved: readonly { field: string; column: LocalizedColumnSpec }[]
): ColumnMoveLoss[] {
  return moved.flatMap(({ field, column }) => {
    const value = carriedDefinition(
      live.find(c => c.name === column.name),
      column,
      "sqlite"
    )?.default?.trim();
    const nonConstant =
      value !== undefined &&
      (value.startsWith("(") || /^current_(time|date|timestamp)$/i.test(value));
    return nonConstant
      ? [{ field, column: column.name, lost: ["default"] }]
      : [];
  });
}

/**
 * The refusals one file turning translation on or off earns: what its move would lose of each
 * column it moves (`lossesOnMove`), and for one turning it off, what it would not restore
 * (`uncarriedOnDisable`).
 */
async function fileRefusals(
  intent: LocalizationMigrationIntent,
  db: unknown,
  dialect: SupportedDialect,
  companionCreatedEarlier: boolean
): Promise<LeavingTranslationRefusal[]> {
  const { spec } = intent;
  const turningOn = intent.kind === "enable";
  const onMain = spec.columnsOnMain && new Set(spec.columnsOnMain);
  const moved = spec.columns
    .filter(c => !turningOn || onMain === undefined || onMain.has(c.name))
    .map(c => ({ field: c.name, column: c.name }));
  const [from, to] = turningOn
    ? [spec.mainTable, spec.companionTable]
    : [spec.companionTable, spec.mainTable];
  const losses = mergeLosses(
    await lossesOnMove(db, dialect, { moved, from, to }),
    turningOn
      ? []
      : await uncarriedOnDisable(db, dialect, spec, companionCreatedEarlier)
  );
  return refusalsForMovesLosingDefinition({
    losses,
    table: from,
    translation: turningOn ? "on" : "off",
    surface: "code",
  });
}
