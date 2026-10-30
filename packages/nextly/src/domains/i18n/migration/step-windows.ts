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
 *   column back, to the main file's DOWN, which drops the main column;
 * - down, a field joining translation: from the main file's DOWN, which puts the main column back
 *   empty, to its `joins` file's DOWN, which fills it from the companion.
 *
 * @module domains/i18n/migration/step-windows
 */
import { parseEntityHeaders } from "../../schema/migrate-create/format-file";

import {
  type LocalizationMigrationIntent,
  type LocalizationMigrationKind,
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

/** A file's part in a move: the entity it is about, and what it does to it. */
interface Touch {
  entity: string;
  kind: LocalizationMigrationKind | "main";
  intent?: LocalizationMigrationIntent;
}

/**
 * What a file does to each entity it is about: a localization file to the one its intent names,
 * a main file, which has no intent, to each entity its header names.
 */
function touchesOf(file: StepFile): Touch[] {
  const intent = file.localization;
  if (intent) {
    const entity = `${intent.entity}:${intent.spec.collection}`;
    return [{ entity, kind: intent.kind, intent }];
  }
  return [
    ...file.collections.map(s => `collection:${s}`),
    ...file.singles.map(s => `single:${s}`),
    ...file.components.map(s => `fieldGroup:${s}`),
  ].map(entity => ({ entity, kind: "main" as const }));
}

/**
 * The windows a run going each way must not end inside, each from a file of `from` to the
 * entity's next file of `to`. Coming down through a field joining translation, the main file
 * that opens the window is the one the joins file pairs with, the nearest above it: a newer main
 * file about the entity (`stopAt`) moves nothing of it.
 */
const WINDOWS: Record<
  Direction,
  readonly { from: Touch["kind"]; to: Touch["kind"]; stopAt?: Touch["kind"] }[]
> = {
  up: [
    { from: "archive", to: "shared" },
    { from: "joins", to: "main" },
  ],
  down: [
    { from: "shared", to: "main" },
    { from: "main", to: "joins", stopAt: "main" },
  ],
};

/** The windows a file opens, with the move each is for, and those it closes, by key. */
interface FileWindows {
  opens: [string, LocalizationMigrationIntent][];
  closes: string[];
}

/** Each file's windows, in the order the run takes `files`. */
function windowsAlong(
  files: readonly StepFile[],
  direction: Direction
): FileWindows[] {
  const touches = files.map(touchesOf);
  const rules = WINDOWS[direction];
  return touches.map((own, i) => ({
    opens: own.flatMap(t =>
      rules.flatMap((rule, r) => {
        if (rule.from !== t.kind) return [];
        const closer = closerOf(touches.slice(i + 1), t.entity, rule);
        // A rollback's main file has no intent; the move is its joins file's.
        const intent = t.intent ?? closer?.intent;
        return closer && intent
          ? [
              [`${r}:${t.entity}`, intent] as [
                string,
                LocalizationMigrationIntent,
              ],
            ]
          : [];
      })
    ),
    closes: own.flatMap(t =>
      rules.flatMap((rule, r) =>
        rule.to === t.kind ? [`${r}:${t.entity}`] : []
      )
    ),
  }));
}

/**
 * The later file's touch that closes a window `rule` opens on `entity`, or `undefined` when none
 * does. A window opens only when one does, so a missing file never keeps a run going.
 */
function closerOf(
  later: readonly Touch[][],
  entity: string,
  rule: (typeof WINDOWS)[Direction][number]
): Touch | undefined {
  for (const touches of later) {
    const touch = touches.find(t => t.entity === entity);
    if (touch?.kind === rule.to) return touch;
    if (touch !== undefined && touch.kind === rule.stopAt) return undefined;
  }
  return undefined;
}

/**
 * The files of `files`, in the order the run takes them, that a run with `step` takes: `step` of
 * those not `done` (none for a step of zero or less), or every one with no step, and past the
 * budget on through any window the files taken so far left open. `continued` names the moves the
 * run goes on for, for the notice the run prints; the run and its dry-run preview both read this,
 * so the preview lists what runs.
 */
export function filesWithinStep<T extends StepFile>(
  files: readonly { file: T; done: boolean }[],
  step: number | undefined,
  direction: Direction
): { run: T[]; budget: number; continued: string | undefined } {
  const windows = windowsAlong(
    files.map(f => f.file),
    direction
  );
  const open = new Map<string, LocalizationMigrationIntent>();
  const budget =
    step === undefined ? Number.POSITIVE_INFINITY : Math.max(0, step);
  const run: T[] = [];
  let continued: string | undefined;
  for (const [i, { file, done }] of files.entries()) {
    const past = !done && run.length >= budget;
    if (past && open.size === 0) break;
    if (past) continued ??= describeMoves([...open.values()]);
    if (!done) run.push(file);
    for (const key of windows[i]?.closes ?? []) open.delete(key);
    for (const [key, intent] of windows[i]?.opens ?? []) open.set(key, intent);
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
