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
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NextlyError } from "../../../errors/nextly-error";
import { recordedSnapshotNames } from "../migrate-create/snapshot-io";

import { compareMigrationBaseNames } from "./migration-order";

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
  /**
   * The branch that holds the folder's newest snapshot, the one `nextly
   * migrate:create` writes from: what the others were written without.
   */
  newest: string[];
  /**
   * What more than one branch changes, as `table` or `table.column`: the
   * branches cannot be applied one after another where there is any, since
   * each was written against the same thing as it stood before the other.
   * Undefined where the branches share no parent to compare them from.
   */
  overlap: string[] | undefined;
  /** Whether a blank migration, written by hand, is among them. */
  blank: boolean;
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
  /**
   * The tables its snapshot records, by table and then by what a migration
   * can change of it (`elementsOf`), each as text.
   */
  tables: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Set for a blank migration: a file with no snapshot, placed by its own header. */
  blank?: true;
}

/** The lines a blank migration's file states where it stands with, in its header. */
const BLANK_PARENT = /^-- Parent: (.+)$/m;
const BLANK_MERGES = /^-- Merges: (.+)$/m;

/**
 * The header lines a blank migration states its place with
 * (`formatBlankFile`): the migration it was written after, and the other
 * branch ends in the folder then. A blank migration has no snapshot to say
 * so, and is written by hand, so two written without each other are as much
 * a fork as two generated ones.
 */
export function blankLineHeader(line: {
  parent: string | null;
  merges: readonly string[];
}): string {
  return (
    `-- Parent: ${line.parent ?? "none"}\n` +
    (line.merges.length > 0
      ? `-- Merges: ${[...line.merges].sort().join(", ")}\n`
      : "")
  );
}

/** Where a blank migration's `content` places `base`, or undefined where it says nothing. */
function placedByHeader(content: string, base: string): Placed | undefined {
  const parent = BLANK_PARENT.exec(content)?.[1].trim();
  if (parent === undefined) return undefined;
  return {
    base,
    parent: parent === "none" ? null : parent,
    merges: (BLANK_MERGES.exec(content)?.[1] ?? "")
      .split(",")
      .map(each => each.trim())
      .filter(each => each !== ""),
    tables: new Map(),
    blank: true,
  };
}

/** The columns an element of a table names: an index's, a key's. */
function columnsNamedBy(element: Record<string, unknown>): string[] {
  const columns = Array.isArray(element.columns) ? element.columns : [];
  return columns.flatMap((column: unknown) => {
    if (typeof column === "string") return [column];
    const named = (column as { name?: unknown; column?: unknown } | null) ?? {};
    const name = named.name ?? named.column;
    return typeof name === "string" ? [name] : [];
  });
}

/**
 * One table of a snapshot, by what a migration can change of it: each
 * column under its own name, and each other element the snapshot lists
 * (an index, a key, a check) under each column it names, or under its own
 * name where it names none. So an index on a column and a change to that
 * column are changes to the same thing.
 */
function elementsOf(table: Record<string, unknown>): Map<string, string> {
  const elements = new Map<string, string[]>();
  const add = (key: string, text: string) =>
    elements.set(key, [...(elements.get(key) ?? []), text]);
  for (const [kind, listed] of Object.entries(table)) {
    if (!Array.isArray(listed)) continue;
    listed.forEach((each: unknown, index) => {
      if (typeof each !== "object" || each === null) return;
      const element = each as Record<string, unknown>;
      const text = `${kind}:${JSON.stringify(element)}`;
      const name =
        typeof element.name === "string" ? element.name : String(index);
      if (kind === "columns") return add(name, text);
      const columns = columnsNamedBy(element);
      if (columns.length === 0) return add(`${kind} ${name}`, text);
      for (const column of columns) add(column, text);
    });
  }
  return new Map(
    [...elements].map(([key, texts]) => [key, [...texts].sort().join("\n")])
  );
}

/** The tables `snapshot`, a snapshot file's `snapshot`, records (`Placed.tables`). */
function tablesIn(snapshot: unknown): Placed["tables"] {
  const tables = (snapshot as { tables?: unknown } | undefined)?.tables;
  if (!Array.isArray(tables)) return new Map();
  return new Map(
    tables.flatMap((table: Record<string, unknown>) =>
      typeof table.name === "string"
        ? [[table.name, elementsOf(table)] as const]
        : []
    )
  );
}

/**
 * What differs between two snapshots' tables, as `table` for one only one
 * side has and `table.column` for a column added, removed or changed.
 */
function changedBetween(
  from: Placed["tables"],
  to: Placed["tables"]
): Set<string> {
  const changed = new Set<string>();
  for (const name of new Set([...from.keys(), ...to.keys()])) {
    const [before, after] = [from.get(name), to.get(name)];
    if (before === undefined || after === undefined) {
      changed.add(name);
      continue;
    }
    for (const column of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(column) !== after.get(column)) {
        changed.add(`${name}.${column}`);
      }
    }
  }
  return changed;
}

/**
 * Where `content`, the text of `base`'s snapshot, places it: no parent
 * where it records none (written before parents were), where it was written
 * for another migration (copied by hand), or where it cannot be read as a
 * snapshot, which the checks of snapshots themselves name.
 */
function placedBy(content: string, base: string): Placed {
  const unread: Placed = {
    base,
    parent: undefined,
    merges: [],
    tables: new Map(),
  };
  try {
    const { parent, migration, merges, snapshot } = JSON.parse(content) as {
      parent?: unknown;
      migration?: unknown;
      merges?: unknown;
      snapshot?: unknown;
    };
    const none = { ...unread, tables: tablesIn(snapshot) };
    if (migration !== base) return none;
    if (parent !== null && typeof parent !== "string") return none;
    return {
      ...none,
      parent,
      merges: Array.isArray(merges)
        ? merges.filter((each): each is string => typeof each === "string")
        : [],
    };
  } catch {
    return unread;
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
  // And each blank migration that states its own place: a `.sql` file with
  // no snapshot beside it.
  const withSnapshot = new Set(placed.map(each => each.base));
  for (const file of await sqlFilesIn(migrationsDir)) {
    const base = file.slice(0, -".sql".length);
    if (withSnapshot.has(base)) continue;
    const blank = placedByHeader(
      await readFile(resolve(migrationsDir, file), "utf-8"),
      base
    );
    if (blank !== undefined) placed.push(blank);
  }
  return placed.sort((a, b) => compareMigrationBaseNames(a.base, b.base));
}

/** The `.sql` files of a folder, or none where there is no such folder. */
async function sqlFilesIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter(file => file.endsWith(".sql"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
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
  /** Every migration that runs before `base`: what one trusted in file order accounts for. */
  const before = (base: string) =>
    placed
      .filter(other => compareMigrationBaseNames(other.base, base) < 0)
      .map(other => other.base);
  const steps = (each: Placed): readonly string[] => {
    if (each.parent === undefined) return before(each.base);
    if (each.parent === null) return each.merges;
    // A parent that is no longer in the folder (removed on purpose) stands
    // for everything that ran before it: the migration accounts for those,
    // and not for one written from the same parent beside it.
    return byBase.has(each.parent)
      ? [each.parent, ...each.merges]
      : [...before(each.parent), ...each.merges];
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
  const parent = parents.size === 1 ? [...parents][0] : undefined;
  const members = branches.flat().sort();
  // The folder's newest snapshot by name is the one a migration is written
  // from, whichever branch end sorts last.
  const inMerge = line.placed.filter(each => members.includes(each.base));
  const blank = inMerge.some(each => each.blank === true);
  const latest =
    inMerge.findLast(each => each.blank !== true) ?? inMerge.at(-1);
  return [
    {
      parent,
      migrations: [...starts].sort(),
      members,
      newest:
        branches.find(branch => branch.includes(latest?.base ?? "")) ?? [],
      // Read from snapshots, so only where every branch has one and the
      // parent they share is in the folder to compare them from.
      overlap:
        parent === undefined ||
        blank ||
        (parent !== null && !line.placed.some(each => each.base === parent))
          ? undefined
          : overlapOf(line, parent, heads),
      blank,
    },
  ];
}

/**
 * What more than one of the branches ending at `heads` changes, each read
 * as the difference between the snapshot of `parent`, which they share, and
 * the snapshot of its end.
 */
function overlapOf(
  line: Line,
  parent: string | null,
  heads: readonly string[]
): string[] {
  const tablesOf = (base: string | null): Placed["tables"] =>
    line.placed.find(each => each.base === base)?.tables ?? new Map();
  const changes = heads.map(head =>
    changedBetween(tablesOf(parent), tablesOf(head))
  );
  const seen = new Map<string, number>();
  for (const changed of changes) {
    for (const element of changed) {
      seen.set(element, (seen.get(element) ?? 0) + 1);
    }
  }
  return [...seen]
    .filter(([, count]) => count > 1)
    .map(([element]) => element)
    .sort();
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

/**
 * Where a blank migration written now stands: after the folder's newest
 * migration, and recording a merge of every other branch end
 * (`blankLineHeader`).
 */
export async function blankLineIn(
  migrationsDir: string
): Promise<{ parent: string | null; merges: string[] }> {
  const line = lineOf(await placedIn(migrationsDir));
  const parent = line.placed.at(-1)?.base ?? null;
  return {
    parent,
    merges: headsOf(line).filter(head => head !== parent),
  };
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
  const one = pending.length === 1;
  const why =
    done.length > 0
      ? `${listed(done.map(file))} ${done.length === 1 ? "is" : "are"} applied on this database, and ` +
        `${listed(pending.map(file))} ${one ? "was" : "were"} written without ` +
        `${done.length === 1 ? "its" : "their"} changes, so ${one ? "it was" : "they were"} not applied.`
      : "Each was written without the others' changes, so none of them was applied: " +
        "nothing yet records them together.";
  return { what: whatOf(merge), why, next: nextFor(merge, done, pending) };
}

/**
 * What to do about an unrecorded merge. Branches that change different
 * things apply one after another, and a migration recording the merge is all
 * that is missing. Branches that change the same thing do not: each was
 * written against it as it stood before the other, so one of them is
 * deleted and its change written again after the other.
 */
function nextFor(
  merge: UnrecordedMerge,
  done: readonly string[],
  pending: readonly string[]
): string {
  const record = merge.blank
    ? "Run `nextly migrate:create --blank --name record_merge` to record that they apply in this order"
    : "Run `nextly migrate:create --name record_merge` to record the merge";
  const again =
    "then run `nextly migrate:create` again so its change is written after the other";
  const which =
    done.length > 0
      ? `${listed(pending.map(file))}, with ${pending.length === 1 ? "its snapshot" : "their snapshots"}`
      : "all but one of them, with their snapshots";
  if (merge.overlap === undefined) {
    return `${record}; if they change the same thing, delete ${which}, instead, ${again}.`;
  }
  if (merge.overlap.length === 0) return `${record}.`;
  const same = listed(merge.overlap.slice(0, 3));
  const more = merge.overlap.length > 3 ? " and more" : "";
  return (
    `They both change ${same}${more}, so they cannot be applied one after the other: ` +
    `delete ${which}, ${again}.`
  );
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
 * `nextly migrate:create` asks `refuseUnrecordableMerge` instead: it is what
 * records a merge.
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
 * Refuses, for `nextly migrate:create`, a merge it cannot record: branches
 * that change the same thing, where a migration written after both would
 * stand on two that cannot be applied one after the other. Branches that
 * change different things are not refused: the run records them.
 */
export async function refuseUnrecordableMerge(
  migrationsDir: string
): Promise<void> {
  const merges = await unrecordedMerges(migrationsDir);
  const refusal = forkedHistoryError(
    merges.filter(merge => (merge.overlap ?? []).length > 0)
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
    "wanted, make the change in the configuration and run `nextly migrate:create` again." +
    (merge.blank
      ? " To record that the blank migrations among them apply in this order, run `nextly migrate:create --blank --name record_merge`."
      : "")
  );
}
