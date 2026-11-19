/**
 * A project's migrations are one line: each is written from the one before
 * it, and its snapshot says which (`parent`, `snapshot-io.ts`).
 *
 * A migration accounts for its parent and everything its parent accounts
 * for. Two migrations that do not account for each other were written
 * without each other: by two writers at once (one stopped past its hold on
 * the migration files while the other wrote), or on two branches merged
 * afterwards. Each was diffed against a snapshot that knows nothing of the
 * other, so the newest snapshot lacks one side's changes until a migration
 * records the merge: one written with both in the folder, whose snapshot
 * names the other branch's end beside its parent (`merges`). That is the
 * next `nextly migrate:create`. Until then the history is refused where the
 * migrations are used, with the files named.
 *
 * A snapshot that names no parent of its own (written before parents were
 * recorded, or copied by hand for a hand-written migration) is trusted in
 * its file order: it accounts for every migration named before it, so
 * nothing of an existing project is refused. So is one whose parent is no
 * longer in the folder, since an older migration may be removed on purpose.
 *
 * @module domains/schema/migrate/history-line
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NextlyError } from "../../../errors/nextly-error";
import { recordedSnapshotNames } from "../migrate-create/snapshot-io";

/** Migrations written without each other, with no migration recording them together. */
export interface UnrecordedMerge {
  /**
   * What the branches were written from, by base name: null for the
   * project's start, and undefined where they do not share it.
   */
  parent: string | null | undefined;
  /** The first migration of each branch, by base name, in file order. */
  migrations: string[];
  /** Every migration of every branch, in file order. */
  members: string[];
  /** The branch of the newest migration: what the others were written without. */
  newest: string[];
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
  /** The other branch ends its snapshot records a merge of. */
  merges: readonly string[];
}

/**
 * Where `content`, the text of `base`'s snapshot, places it: no parent
 * where it records none (written before parents were), where it was written
 * for another migration (copied by hand), or where it cannot be read as a
 * snapshot, which the checks of snapshots themselves name.
 */
function placedBy(content: string, base: string): Placed {
  const none: Placed = { base, parent: undefined, merges: [] };
  try {
    const { parent, migration, merges } = JSON.parse(content) as {
      parent?: unknown;
      migration?: unknown;
      merges?: unknown;
    };
    if (migration !== base) return none;
    if (parent !== null && typeof parent !== "string") return none;
    return {
      base,
      parent,
      merges: Array.isArray(merges)
        ? merges.filter((each): each is string => typeof each === "string")
        : [],
    };
  } catch {
    return none;
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
    placed.push(
      placedBy(await readFile(resolve(metaDir, file), "utf-8"), base)
    );
  }
  return placed;
}

/** The line as read: each migration, and what each accounts for. */
interface Line {
  placed: readonly Placed[];
  /** Every migration `base` accounts for, itself left out. */
  known(base: string): ReadonlySet<string>;
}

/**
 * What each migration accounts for: its parent and the branch ends it
 * merges, and all they account for in turn. One that names no parent of its
 * own accounts for every migration named before it.
 */
function lineOf(placed: readonly Placed[]): Line {
  const byBase = new Map(placed.map(each => [each.base, each]));
  /** Every migration named before `base`: what one trusted in file order accounts for. */
  const before = (base: string) =>
    placed.filter(other => other.base < base).map(other => other.base);
  const steps = (each: Placed): readonly string[] => {
    if (each.parent === undefined) return before(each.base);
    if (each.parent === null) return each.merges;
    // A parent that is no longer in the folder (removed on purpose) says
    // nothing more: the migration is trusted in file order from there.
    return byBase.has(each.parent)
      ? [each.parent, ...each.merges]
      : [...before(each.base), ...each.merges];
  };
  const memo = new Map<string, ReadonlySet<string>>();
  const known = (base: string): ReadonlySet<string> => {
    const done = memo.get(base);
    if (done !== undefined) return done;
    const all = new Set<string>();
    const queue = [base];
    for (let at = queue.pop(); at !== undefined; at = queue.pop()) {
      const each = byBase.get(at);
      if (each === undefined) continue;
      for (const next of steps(each)) {
        if (all.has(next) || next === base) continue;
        all.add(next);
        queue.push(next);
      }
    }
    memo.set(base, all);
    return all;
  };
  return { placed, known };
}

/**
 * The ends of the line's branches: each migration that records a parent and
 * that no other migration accounts for. One where the history is one line.
 */
function headsOf(line: Line): string[] {
  return line.placed
    .filter(
      each =>
        each.parent !== undefined &&
        !line.placed.some(
          other => other !== each && line.known(other.base).has(each.base)
        )
    )
    .map(each => each.base);
}

/**
 * The branch ending at `head`: `head` and each migration it accounts for
 * that no other branch end does, in file order.
 */
function branchOf(line: Line, head: string, heads: readonly string[]) {
  const shared = new Set(
    heads.filter(other => other !== head).flatMap(o => [...line.known(o)])
  );
  return [...line.known(head), head]
    .filter(
      base =>
        !shared.has(base) &&
        line.placed.find(each => each.base === base)?.parent !== undefined
    )
    .sort();
}

/**
 * The merge the folder's history does not record, or none: the branches
 * written without each other, where more than one migration is accounted
 * for by no other.
 */
export async function unrecordedMerges(
  migrationsDir: string
): Promise<UnrecordedMerge[]> {
  const line = lineOf(await placedIn(migrationsDir));
  const heads = headsOf(line);
  if (heads.length < 2) return [];
  const branches = heads.map(head => branchOf(line, head, heads));
  const parentOf = (base: string) =>
    line.placed.find(each => each.base === base)?.parent;
  const starts = branches.map(branch => branch[0]);
  const parents = new Set(starts.map(parentOf));
  return [
    {
      parent: parents.size === 1 ? [...parents][0] : undefined,
      migrations: [...starts].sort(),
      members: branches.flat().sort(),
      newest: branches[heads.indexOf([...heads].sort().at(-1) ?? "")] ?? [],
    },
  ];
}

/**
 * The branch ends a migration written now from `parent` records a merge of:
 * each end of the folder's line that is not `parent`. None in a history
 * that is one line, where the only end is the parent itself.
 */
export async function mergedBy(
  migrationsDir: string,
  parent: string | null
): Promise<string[]> {
  const line = lineOf(await placedIn(migrationsDir));
  return headsOf(line).filter(head => head !== parent);
}

/** `names` as a sentence lists them: "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

const COUNTS = ["", "", "Two", "Three", "Four", "Five"];

const file = (base: string) => `${base}.sql`;

/** What happened, for an unrecorded merge. */
function whatOf(merge: UnrecordedMerge): string {
  const names = merge.migrations.map(file);
  if (merge.parent === undefined) {
    return `${listed(names)} were written without each other.`;
  }
  const from =
    merge.parent === null
      ? "each as this project's first"
      : `from ${file(merge.parent)}`;
  const count = COUNTS[names.length] ?? String(names.length);
  return `${count} migrations were written ${from}: ${listed(names)}.`;
}

/** An unrecorded merge as its refusal says it, or undefined where it is not refused. */
function mergeLines(
  merge: UnrecordedMerge,
  applied: ReadonlySet<string> | undefined
): { what: string; why: string; next: string } | undefined {
  const done = merge.members.filter(base => applied?.has(base) === true);
  const pending = merge.members.filter(base => !done.includes(base));
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
 * history holds a merge nothing records: the configuration is what the
 * newest migration's snapshot records, so there is no merge to write, and
 * the migrations written without it either repeat its change or make one
 * the configuration no longer has. Undefined where the history is one line.
 */
export async function nothingToRecordNotice(
  migrationsDir: string
): Promise<string | undefined> {
  const [merge] = await unrecordedMerges(migrationsDir);
  if (merge === undefined) return undefined;
  const others = merge.members.filter(base => !merge.newest.includes(base));
  const one = others.length === 1;
  return (
    `${whatOf(merge)} The configuration is what ${file(merge.newest.at(-1) ?? "")} records, ` +
    `so there is no merge to write. ${listed(others.map(file))} ${one ? "was" : "were"} written ` +
    `without it: if ${one ? "its change is" : "their changes are"} the same, or no longer wanted, ` +
    `delete ${one ? "it and its snapshot" : "them and their snapshots"}; if ${one ? "it is" : "they are"} ` +
    "wanted, make the change in the configuration and run `nextly migrate:create` again."
  );
}
