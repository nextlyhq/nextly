/**
 * A project's migrations are one line: each is written from the one before
 * it, and its snapshot says which (`parent`, `snapshot-io.ts`).
 *
 * A migration whose parent is not the one before it in the folder was
 * written without those in between: by two writers at once (one stopped past
 * its hold on the migration files while the other wrote), or on two branches
 * merged afterwards. It was diffed against a snapshot that knows nothing of
 * the others, so the newest snapshot lacks their changes until a migration
 * written with all of them in the folder records the merge: the next `nextly
 * migrate:create`. Until then the history is refused where the migrations
 * are used, with the files named. Where the migrations make the same change
 * there is nothing to record, and one of them is deleted.
 *
 * A snapshot written before parents were recorded, or copied by hand for a
 * hand-written migration, names none and is trusted in its file order:
 * nothing of an existing project is refused. A parent that is no longer in
 * the folder is not refused either, since an older migration may be removed
 * on purpose.
 *
 * @module domains/schema/migrate/history-line
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NextlyError } from "../../../errors/nextly-error";
import { recordedSnapshotNames } from "../migrate-create/snapshot-io";

/** Migrations written without each other, with no migration after them recording the merge. */
export interface UnrecordedMerge {
  /** The parent they were written from, by base name; null for the project's start. */
  parent: string | null;
  /**
   * The base names of the migrations after `parent` that were written
   * without each other, in file order: those written from it, and those
   * that followed one of them.
   */
  migrations: string[];
  /** Whether each of them was written from `parent` itself. */
  siblings: boolean;
}

/** The `logContext.reason` of a refusal over a forked history. */
export const HISTORY_FORKED_REASON = "migration history forked";

/** A migration of the folder, as its snapshot places it in the line. */
interface Placed {
  base: string;
  /**
   * The parent its snapshot records: a name, null for a project's first
   * migration, or undefined where it records none of its own.
   */
  parent: string | null | undefined;
}

/**
 * The parent `content`, the text of `base`'s snapshot, records: undefined
 * where it records none (written before parents were), where it was written
 * for another migration (copied by hand), or where it cannot be read as a
 * snapshot, which the checks of snapshots themselves name.
 */
function parentIn(content: string, base: string): string | null | undefined {
  try {
    const { parent, migration } = JSON.parse(content) as {
      parent?: unknown;
      migration?: unknown;
    };
    if (migration !== base) return undefined;
    return parent === null || typeof parent === "string" ? parent : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The folder's migrations in file order, each as its snapshot places it.
 * Read from the snapshots that record a written migration
 * (`recordedSnapshotNames`), so one whose migration file is not there is
 * part of no line.
 */
async function placedIn(migrationsDir: string): Promise<Placed[]> {
  const metaDir = resolve(migrationsDir, "meta");
  const placed: Placed[] = [];
  for (const file of await recordedSnapshotNames(metaDir)) {
    const base = file.slice(0, -".snapshot.json".length);
    const content = await readFile(resolve(metaDir, file), "utf-8");
    placed.push({ base, parent: parentIn(content, base) });
  }
  return placed;
}

/**
 * Whether `base` was written after `ancestor`, by the parents the snapshots
 * record: `ancestor` is its parent, or its parent's, and so on.
 */
function descendsFrom(
  base: string,
  ancestor: string,
  parents: ReadonlyMap<string, string | null | undefined>
): boolean {
  const seen = new Set<string>();
  let at = parents.get(base);
  while (typeof at === "string" && !seen.has(at)) {
    if (at === ancestor) return true;
    seen.add(at);
    at = parents.get(at);
  }
  return false;
}

/**
 * The migrations `placed[index]` was written without: those in the folder
 * between its parent and itself. None where it was written from the one
 * before it, where it records no parent, or where its parent is not before
 * it in the folder (removed since, or named after it). One written from it
 * in turn is not among them, whatever its name sorts as: it came after.
 */
function unseenBy(
  placed: readonly Placed[],
  index: number,
  parents: ReadonlyMap<string, string | null | undefined>
): string[] {
  const { base, parent } = placed[index];
  if (parent === undefined) return [];
  return placed
    .slice(0, index)
    .map(before => before.base)
    .filter(
      before =>
        (parent === null || before > parent) &&
        before < base &&
        !descendsFrom(before, base, parents)
    );
}

/**
 * Every merge the folder's history does not record: each parent after which
 * migrations were written without each other, with no migration after them
 * that was written from the one before it, which is what records a merge.
 */
export async function unrecordedMerges(
  migrationsDir: string
): Promise<UnrecordedMerge[]> {
  const placed = await placedIn(migrationsDir);
  const parentOf = new Map(placed.map(each => [each.base, each.parent]));
  const unseen = placed.map((_, index) => unseenBy(placed, index, parentOf));
  // The newest migration written from the one before it: with every
  // migration before it in the folder when it was written, it records them.
  const recordedUpTo = placed.findLastIndex(
    (each, index) =>
      each.parent !== undefined &&
      unseen[index].length === 0 &&
      each.parent === (placed[index - 1]?.base ?? null)
  );
  /** By parent; the project's start is keyed by the empty name. */
  const merges = new Map<string, Set<string>>();
  placed.forEach((each, index) => {
    if (index <= recordedUpTo || unseen[index].length === 0) return;
    const key = each.parent ?? "";
    const together = merges.get(key) ?? new Set<string>();
    for (const base of [...unseen[index], each.base]) together.add(base);
    merges.set(key, together);
  });
  return [...merges].map(([key, together]) => {
    const parent = key === "" ? null : key;
    const migrations = [...together].sort();
    return {
      parent,
      migrations,
      siblings: migrations.every(base => parentOf.get(base) === parent),
    };
  });
}

/** `names` as a sentence lists them: "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

const COUNTS = ["", "", "Two", "Three", "Four", "Five"];

const file = (base: string) => `${base}.sql`;

/** What happened, for one unrecorded merge. */
function whatOf(merge: UnrecordedMerge): string {
  const names = merge.migrations.map(file);
  const from =
    merge.parent === null
      ? "each as this project's first"
      : `from ${file(merge.parent)}`;
  if (merge.siblings) {
    const count = COUNTS[names.length] ?? String(names.length);
    return `${count} migrations were written ${from}: ${listed(names)}.`;
  }
  return (
    `${listed(names)} were not all written one after another: one of them was ` +
    `written ${from}, without the others.`
  );
}

/** One unrecorded merge as its refusal says it, or undefined where it is not refused. */
function mergeLines(
  merge: UnrecordedMerge,
  applied: ReadonlySet<string> | undefined
): { what: string; why: string; next: string } | undefined {
  const done = merge.migrations.filter(base => applied?.has(base) === true);
  const pending = merge.migrations.filter(base => !done.includes(base));
  // Each already applied here: the history is what it is, and nothing is
  // left to refuse.
  if (pending.length === 0) return undefined;
  const record =
    "Run `nextly migrate:create --name record_merge` to record the merge";
  if (done.length > 0) {
    const one = pending.length === 1;
    return {
      what: whatOf(merge),
      why:
        `${listed(done.map(file))} ${done.length === 1 ? "is" : "are"} applied on this database, and ` +
        `${listed(pending.map(file))} ${one ? "was" : "were"} written without ` +
        `${done.length === 1 ? "its" : "their"} changes, so ${one ? "it was" : "they were"} not applied.`,
      next:
        `${record}; if ${listed(pending.map(file))} ${one ? "makes" : "make"} the same change, ` +
        `delete ${one ? "it and its snapshot" : "them and their snapshots"} instead.`,
    };
  }
  return {
    what: whatOf(merge),
    why:
      "Each was written without the others' changes, so none of them was applied: " +
      "nothing yet records them together.",
    next: `${record}; if they make the same change, delete all but one of them, with their snapshots, instead.`,
  };
}

/**
 * The refusal of a history with a merge nothing records, or undefined where
 * there is none to refuse. `applied` is the migrations a database records
 * applied, by base name, where the command reads one: a merge with one side
 * applied there names the other as the one not applied, and one applied
 * whole is passed. The message is three sentences a terminal prints as what
 * happened, why, and what to do; the merges are in the log context.
 */
export function forkedHistoryError(
  merges: readonly UnrecordedMerge[],
  applied?: ReadonlySet<string>
): NextlyError | undefined {
  const refused = merges.flatMap(merge => {
    const lines = mergeLines(merge, applied);
    return lines === undefined ? [] : [{ merge, lines }];
  });
  if (refused.length === 0) return undefined;
  return new NextlyError({
    code: "CONFLICT",
    publicMessage: refused
      .map(({ lines }) => `${lines.what} ${lines.why} ${lines.next}`)
      .join("\n"),
    logContext: {
      // Spelt out, as `HISTORY_FORKED_REASON` holds it: the check that every
      // refusal a command prints has a code of its own reads it here.
      reason: "migration history forked",
      merges: refused.map(({ merge }) => merge),
      lines: refused.map(({ lines }) => lines),
    },
  });
}

/**
 * Refuses where the folder's history holds a merge nothing records
 * (`forkedHistoryError`): asked before a command applies the migrations or
 * checks them, and before a Schema Builder save writes another after them.
 * `nextly migrate:create` is not refused: it is what records the merge.
 */
export async function refuseForkedHistory(
  migrationsDir: string,
  applied?: ReadonlySet<string>
): Promise<void> {
  const refusal = forkedHistoryError(
    await unrecordedMerges(migrationsDir),
    applied
  );
  if (refusal !== undefined) throw refusal;
}

/**
 * What `nextly migrate:create` says where it found nothing to write and the
 * history holds a merge nothing records: the migrations make the same
 * change, so there is no merge to record and one of them goes. Undefined
 * where the history is one line.
 */
export async function nothingToRecordNotice(
  migrationsDir: string
): Promise<string | undefined> {
  const merges = await unrecordedMerges(migrationsDir);
  if (merges.length === 0) return undefined;
  return merges
    .map(
      merge =>
        `${whatOf(merge)} The configuration has nothing they lack, so they make the same ` +
        "change and there is no merge to record: delete all but one of them, with their snapshots."
    )
    .join("\n");
}
