/**
 * Where a `--step` budget may end, in a run of migration files going up (`nextly migrate`) or
 * coming down (`nextly migrate:down`).
 *
 * A field moving between translated and shared is moved by files `nextly migrate:create` writes
 * around the main migration, and between some of them the field has a column on the main table
 * that the next file still fills or drops. A run that stopped there would let an app write a value
 * into that column that the next file then replaces or drops. So a budget never ends inside one of
 * these windows; the run goes on until the window closes:
 *
 * - up, a field leaving translation: from its `archive` file to its `shared` file, which copies
 *   each entry's value onto the column the main file between them added;
 * - up, a field joining translation: from its `joins` file to the main file, which drops the main
 *   column whose value the joins file copied;
 * - down, a field leaving translation: from its `shared` file's DOWN, which puts the companion
 *   column back, to the main file's DOWN, which drops the main column.
 *
 * @module domains/i18n/migration/step-windows
 */
import { parseEntityHeaders } from "../../schema/migrate-create/format-file";

import {
  type LocalizationMigrationIntent,
  parseLocalizationIntent,
} from "./migration-intent";
import { KIND_NAMES } from "./resolve-entity-table";

/** A migration file, as the step rule reads it: what it is for, and the entities it names. */
export interface StepFile {
  localization?: LocalizationMigrationIntent;
  collections: readonly string[];
  singles: readonly string[];
  components: readonly string[];
}

/**
 * A file's `StepFile`, read from its content. An intent that does not parse reads as none: the
 * file then opens and closes no window, as it did before windows were kept.
 */
export function stepFileOf(content: string, filename: string): StepFile {
  const { collections, singles, components } = parseEntityHeaders(content);
  let localization: LocalizationMigrationIntent | undefined;
  try {
    localization = parseLocalizationIntent(content, filename) ?? undefined;
  } catch {
    localization = undefined;
  }
  return { collections, singles, components, localization };
}

type Direction = "up" | "down";

/** The window a file opens, and the windows it closes, by key. */
function windowsOf(
  file: StepFile,
  direction: Direction
): { opens?: string; closes: string[] } {
  const intent = file.localization;
  const entity = (i: LocalizationMigrationIntent) =>
    `${i.entity}:${i.spec.collection}`;
  // A main file has no intent, and names the entities it changes in its header.
  const named = intent
    ? []
    : [
        ...file.collections.map(s => `collection:${s}`),
        ...file.singles.map(s => `single:${s}`),
        ...file.components.map(s => `fieldGroup:${s}`),
      ];
  if (direction === "up") {
    if (intent?.kind === "archive") {
      return { opens: `leaves:${entity(intent)}`, closes: [] };
    }
    if (intent?.kind === "joins") {
      return { opens: `joins:${entity(intent)}`, closes: [] };
    }
    if (intent?.kind === "shared") {
      return { closes: [`leaves:${entity(intent)}`] };
    }
    return { closes: named.map(e => `joins:${e}`) };
  }
  if (intent?.kind === "shared") {
    return { opens: `leaves:${entity(intent)}`, closes: [] };
  }
  return { closes: named.map(e => `leaves:${e}`) };
}

/**
 * The files of `files`, in the order the run takes them, that a run with `step` takes: `step` of
 * those not `done`, or every one with no step, and past the budget on through any window the files
 * taken so far left open. A window opens only when a file later in `files` closes it, so a missing
 * one never keeps a run going. `continued` names the moves the run goes on for, for the notice the
 * run prints; the run and its dry-run preview both read this, so the preview lists what runs.
 */
export function filesWithinStep<T extends StepFile>(
  files: readonly { file: T; done: boolean }[],
  step: number | undefined,
  direction: Direction
): { run: T[]; budget: number; continued: string | undefined } {
  const windows = files.map(f => windowsOf(f.file, direction));
  const open = new Map<string, LocalizationMigrationIntent>();
  const budget =
    step !== undefined && step > 0 ? step : Number.POSITIVE_INFINITY;
  const run: T[] = [];
  let continued: string | undefined;
  for (const [i, { file, done }] of files.entries()) {
    if (!done) {
      if (run.length >= budget) {
        if (open.size === 0) break;
        continued ??= describeMoves([...open.values()]);
      }
      run.push(file);
    }
    const { opens, closes } = windows[i] ?? { closes: [] };
    for (const key of closes) open.delete(key);
    if (
      opens !== undefined &&
      file.localization &&
      windows.slice(i + 1).some(w => w.closes.includes(opens))
    ) {
      open.set(opens, file.localization);
    }
  }
  return { run, budget, continued };
}

/** The moves, as the notice names them: `"body" in collection "docs"`. */
function describeMoves(moves: readonly LocalizationMigrationIntent[]): string {
  return moves
    .map(
      m =>
        `${m.spec.columns.map(c => `"${c.name}"`).join(", ")} in ${KIND_NAMES[m.entity]} "${m.spec.collection}"`
    )
    .join("; ");
}

/** The notice a run prints when its `--step` budget ends inside a move (`filesWithinStep`). */
export function stepContinuedNotice(continued: string): string {
  return (
    `--step ends inside a move between translated and shared (${continued}): running on until ` +
    "it is whole, so nothing can write in between."
  );
}
