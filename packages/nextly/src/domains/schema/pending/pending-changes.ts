/**
 * The changes not yet in a migration: what the configuration, the plugins, the Schema Builder's
 * committed definitions and the app's extension tables declare that the newest snapshot in the
 * migration folder does not record. They are read from `migrate:create`'s own plan of a run
 * (`planRun`), so every surface that reports them reports what `migrate:create` would write:
 * `migrate:check`, `nextly migrate` and a production start (`unwritten-changes.ts`), and the
 * development server and `nextly doctor` when they report them.
 *
 * Pure: the plan is made by `pendingChanges` (`plan-pending.ts`), which reads the folder.
 *
 * @module domains/schema/pending/pending-changes
 */
import {
  movedColumnNote,
  type PerLanguageMove,
} from "../../i18n/per-language-move-guidance";
import {
  describePermissionChange,
  type PermissionChange,
} from "../migrate-create/declared-permissions";
import {
  describeSettingsChange,
  type EntitySettingsChange,
  SETTINGS_RECORDED,
} from "../migrate-create/entity-settings";
import type { PlannedRun } from "../migrate-create/generate";
import { perLanguageMovesIn } from "../migrate-create/per-language-moves";
import { describeOp } from "../pipeline/diff/describe-operation";
import type { Operation } from "../pipeline/diff/types";

/** A file planned beside the main migration, by what it does and the entity table it is for. */
export interface BesideFile {
  kind:
    | "translations table"
    | "fields leaving translation"
    | "fields joining translation"
    | "per-language unique indexes"
    | "translations column types";
  table: string;
}

/** Everything a run of `migrate:create` would write a migration for. */
export interface PendingChanges {
  /** Each table change, in the diff's order, less what a translations file does itself. */
  tables: readonly Operation[];
  /** Every table change, in the diff's order, those a translations file does itself among them. */
  diffed: readonly Operation[];
  /** Each file planned beside the main migration (`BesideFile`). */
  beside: readonly BesideFile[];
  settings: readonly EntitySettingsChange[];
  permissions: readonly PermissionChange[];
  /** Whether a field's values move between two places whose columns both stand. */
  movesValues: boolean;
  /** Whether the folder holds no snapshot at all. */
  noSnapshot: boolean;
  /**
   * The text-like fields whose column the declared schema no longer keeps on the main table and
   * that move to their per-language table, not values removed (`perLanguageMovesIn`, over the
   * diff before a translations file takes the drop).
   */
  perLanguageMoves: readonly PerLanguageMove[];
}

/** The changes a planned run would write a migration for. */
export function pendingChangesOf(planned: PlannedRun): PendingChanges {
  const { args } = planned;
  const beside = (
    kind: BesideFile["kind"],
    plans: readonly { spec: { mainTable: string } }[]
  ): BesideFile[] => plans.map(({ spec }) => ({ kind, table: spec.mainTable }));
  return {
    tables: planned.operations,
    diffed: planned.diffed,
    beside: [
      ...beside("translations table", planned.companionPlans),
      ...beside(
        "fields leaving translation",
        planned.fieldLeavesPlans.map(({ plan }) => plan.shared)
      ),
      ...beside(
        "fields joining translation",
        planned.fieldJoinsPlans.map(({ plan }) => plan)
      ),
      ...beside("per-language unique indexes", planned.uniquePlans),
      ...beside(
        "translations column types",
        planned.retypesPlans.map(({ plan }) => plan)
      ),
    ],
    settings: planned.changedSettings,
    permissions: planned.changedPermissions,
    movesValues: planned.movesValues,
    noSnapshot: planned.previous === null,
    perLanguageMoves: perLanguageMovesIn(planned.diffed, args, args.dialect),
  };
}

/** Whether a run would write nothing: no table, beside file, setting, permission or move. */
export function nothingToWrite(changes: PendingChanges): boolean {
  return (
    changes.tables.length === 0 &&
    changes.beside.length === 0 &&
    changes.settings.length === 0 &&
    changes.permissions.length === 0 &&
    !changes.movesValues
  );
}

/**
 * The notice both commands give where the newest snapshot was written before snapshots recorded
 * settings and permissions: what is declared now is recorded for the first time, which is no
 * change of what was declared before, so it is never a pending change, and `migrate:create`
 * records it.
 */
export const SETTINGS_NOT_RECORDED_NOTICE =
  "Settings not yet recorded in a migration: the newest snapshot was written before snapshots " +
  "recorded each entity's settings and the permissions. `nextly migrate:create` records them in " +
  "its next migration; until then they are not compared.";

/** A file beside the main migration as a line. */
function besideLine(file: BesideFile): string {
  return `~ ${file.kind} ${file.table}`;
}

/**
 * The notice every surface gives of the files a run would write beside the main migration where the
 * newest snapshot records no settings (`recordsTranslationsTables`): what the translations tables
 * hold is not recorded, so it is no change of what was recorded before.
 */
export function translationsNotRecordedNotice(
  files: readonly BesideFile[]
): string {
  return [
    "Translations tables not recorded yet in a migration: the newest snapshot was written without " +
      "each entity's settings, so it does not say what these tables hold. `nextly migrate:create` " +
      "writes and records the following; until then they are not compared.",
    ...files.map(file => `  ${besideLine(file)}`),
  ].join("\n");
}

/** Whether a run records settings or permissions an earlier snapshot never recorded. */
export function recordsForTheFirstTime(changes: PendingChanges): boolean {
  return (
    changes.settings.some(isFirstRecording) ||
    changes.permissions.some(change => change.kind === "recorded")
  );
}

function isFirstRecording(change: EntitySettingsChange): boolean {
  return change.changes.length === 1 && change.changes[0] === SETTINGS_RECORDED;
}

/**
 * A table change as a line: `+` added, `-` removed, `~` changed. A column drop that is a field
 * moving to its per-language table says where it moves, so it does not read as data loss.
 */
function tableLine(
  op: Operation,
  moves: readonly PerLanguageMove[] = []
): string {
  const sign = op.type.startsWith("add_")
    ? "+"
    : op.type.startsWith("drop_")
      ? "-"
      : "~";
  const note =
    op.type === "drop_column"
      ? movedColumnNote(moves, op.tableName, op.columnName)
      : "";
  return `${sign} ${describeOp(op)}${note}`;
}

/** Every change as a line: tables first, then the files beside them, settings and permissions. */
export function pendingChangeLines(
  changes: Pick<
    PendingChanges,
    "tables" | "beside" | "settings" | "permissions"
  > & {
    perLanguageMoves?: readonly PerLanguageMove[];
  }
): string[] {
  return [
    ...changes.tables.map(op => tableLine(op, changes.perLanguageMoves)),
    ...changes.beside.map(besideLine),
    ...changes.settings.map(
      change => `~ settings ${describeSettingsChange(change)}`
    ),
    ...changes.permissions.map(
      change => `~ permissions ${describePermissionChange(change)}`
    ),
  ];
}
