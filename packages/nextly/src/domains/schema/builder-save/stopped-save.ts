/**
 * A Builder save that stopped part way, judged from the live database: which of the changes it
 * asked for the entity's table holds, field by field.
 *
 * MySQL commits each schema statement as it runs, so a save whose file fails at a later statement
 * keeps the earlier ones. What it kept is read from the table as it stands, never from how many
 * statements ran: each change the save asked for is laid over the entity as it was, alone, and the
 * columns, indexes, checks and keys that change alone makes are compared with the live table. A
 * change whose parts all stand as it makes them applied; one whose parts all stand as before did
 * not; anything else, or two changes reaching the same part, cannot be judged, and the save is left
 * to the caller's fallback rather than recorded wrongly. The shape the judgement arrives at is then
 * proven whole against the live table before anything is written for it.
 *
 * @module domains/schema/builder-save/stopped-save
 */
import { NextlyError } from "../../../errors/nextly-error";
import type { StoppedSavePublicData } from "../../../errors/public-data";
import { snapshotsEquivalent } from "../migrate/drift-reconcile";
import type { TableSpec } from "../pipeline/diff/types";

/** What a save asked of one field. */
export type FieldChangeKind = "add" | "drop" | "rename" | "retype" | "settings";

/** One change a save asked of one field: its name after the save, and a rename's name before. */
export interface AskedChange {
  field: string;
  change: FieldChangeKind;
  /** A rename's name before the save. */
  from?: string;
}

/** One change a stopped save asked for, as its report names it: applied or not. */
export interface StoppedChange extends AskedChange {
  applied: boolean;
}

/** A field as both the definition and the registry row list it: by its name, where it has one. */
interface NamedField {
  name?: string;
  type?: unknown;
}

/**
 * Each change `next` asks of `previous`, field by field: a field `renamed` names is a rename,
 * whatever else changed with it; one only `next` has is an addition, one only `previous` has a drop;
 * one both have that differs is a type change where its type differs and a settings change
 * otherwise. A field with no name (a layout field) holds no column, and is no change of its own.
 * Ordered by field.
 */
export function askedChanges<F extends NamedField>(
  previous: readonly F[],
  next: readonly F[],
  renamed: ReadonlyArray<{ from: string; to: string }> = []
): AskedChange[] {
  const before = byName(previous);
  const after = byName(next);
  // Only a rename whose two names the lists hold is one: the definition is what is judged.
  const renames = renamed.filter(r => before.has(r.from) && after.has(r.to));
  const renamedTo = new Set(renames.map(r => r.to));
  const renamedFrom = new Set(renames.map(r => r.from));
  const changes: AskedChange[] = renames.map(r => ({
    field: r.to,
    change: "rename",
    from: r.from,
  }));
  for (const [name, field] of after) {
    if (renamedTo.has(name)) continue;
    const was = before.get(name);
    if (was === undefined) {
      changes.push({ field: name, change: "add" });
    } else if (JSON.stringify(was) !== JSON.stringify(field)) {
      changes.push({
        field: name,
        change: was.type === field.type ? "settings" : "retype",
      });
    }
  }
  for (const name of before.keys()) {
    if (!after.has(name) && !renamedFrom.has(name)) {
      changes.push({ field: name, change: "drop" });
    }
  }
  return changes.sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * The field list with exactly the changes `applied` answers yes for laid over `previous`: in
 * `next`'s order, a change not applied keeps the field as `previous` had it (an addition not
 * applied is left out), and a drop not applied keeps its field, after the others. The one
 * derivation of a stopped save's fields, for its definition and its registry row alike.
 */
export function fieldsWith<F extends NamedField>(
  previous: readonly F[],
  next: readonly F[],
  changes: readonly AskedChange[],
  applied: (change: AskedChange) => boolean
): F[] {
  const before = byName(previous);
  const asked = new Map(changes.map(c => [c.field, c]));
  const saved = next.flatMap(field =>
    fieldAsSaved(
      field,
      field.name === undefined ? undefined : asked.get(field.name),
      before,
      applied
    )
  );
  const dropsKept = changes
    .filter(change => change.change === "drop" && !applied(change))
    .flatMap(change => before.get(change.field) ?? []);
  return [...saved, ...dropsKept];
}

/**
 * One field of the save's list as a stopped save keeps it: as saved where its change applied (or
 * it had none), as it was where the change did not, and not at all for an addition that did not.
 */
function fieldAsSaved<F extends NamedField>(
  field: F,
  change: AskedChange | undefined,
  before: ReadonlyMap<string, F>,
  applied: (change: AskedChange) => boolean
): F[] {
  if (change === undefined || applied(change)) return [field];
  if (change.change === "add") return [];
  const was = before.get(
    change.change === "rename" ? (change.from ?? change.field) : change.field
  );
  return was === undefined ? [] : [was];
}

/**
 * The fields a stopped save's registry row records: `next`'s changes the report names as applied,
 * laid over `previous` (`fieldsWith`).
 */
export function appliedFieldsOf<F extends NamedField>(
  previous: readonly F[],
  next: readonly F[],
  report: readonly StoppedChange[]
): F[] {
  return fieldsWith(previous, next, report, change =>
    report.some(c => c.field === change.field && c.applied)
  );
}

/** The kinds of part a table is made of, each named within the table. */
const PARTS = ["columns", "indexes", "checks", "foreignKeys"] as const;
type Part = (typeof PARTS)[number];
type PartNames = ReadonlyMap<Part, ReadonlySet<string>>;

/**
 * Which of the changes a stopped save asked for the live table holds, judged change by change:
 * `withEach` is the entity's table as its desired shape with that change alone laid over
 * `before`. Undefined where any change cannot be judged: a part that stands as neither, or a part
 * two changes both reach.
 */
export function judgeStoppedSave(args: {
  asked: readonly AskedChange[];
  live: TableSpec | undefined;
  before: TableSpec;
  withEach: ReadonlyMap<string, TableSpec>;
}): StoppedChange[] | undefined {
  const claimed = new Set<string>();
  const report: StoppedChange[] = [];
  for (const change of args.asked) {
    const alone = args.withEach.get(change.field);
    if (alone === undefined) return undefined;
    const parts = differingParts(args.before, alone);
    const keys = [...parts].flatMap(([part, names]) =>
      [...names].map(name => `${part}\u0000${name}`)
    );
    // Two changes reaching one part (a field dropped and another added under its name) leave the
    // part standing for either: not judged.
    if (keys.some(key => claimed.has(key))) return undefined;
    for (const key of keys) claimed.add(key);
    // A change making no part of the table (a label, a layout) has nothing to stop at.
    if (keys.length === 0) {
      report.push({ ...change, applied: true });
      continue;
    }
    const live = only(args.live, alone.name, parts);
    if (equivalent(live, only(alone, alone.name, parts))) {
      report.push({ ...change, applied: true });
    } else if (equivalent(live, only(args.before, alone.name, parts))) {
      report.push({ ...change, applied: false });
    } else {
      return undefined;
    }
  }
  return report;
}

/** Whether the live table stands exactly as `desired` declares it. */
export function standsAs(
  live: TableSpec | undefined,
  desired: TableSpec | undefined
): boolean {
  if (live === undefined || desired === undefined) return live === desired;
  return equivalent(live, desired);
}

/**
 * The failure a stopped save that was settled is reported with: each change it asked for, applied
 * or not, by field (`publicData.changes`), and that saving again finishes the rest. Its code is a
 * part-way failure's, as the database still holds part of what was asked; statements and tables
 * stay in the log, behind the failure that stopped it.
 */
export function stoppedSaveError(
  slug: string,
  changes: readonly StoppedChange[],
  failure: unknown
): NextlyError {
  const named = (c: StoppedChange) =>
    c.change === "rename"
      ? `${c.from ?? c.field} renamed to ${c.field}`
      : `${c.field} (${CHANGE_WORDS[c.change]})`;
  const applied = changes.filter(c => c.applied).map(named);
  const not = changes.filter(c => !c.applied).map(named);
  const publicData: StoppedSavePublicData = {
    changes: changes.map(c => ({ ...c })),
  };
  return new NextlyError({
    code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    publicMessage: `The save of "${slug}" stopped part way, and keeps what applied. Applied: ${applied.length === 0 ? "nothing" : applied.join(", ")}. Not applied: ${not.length === 0 ? "nothing" : not.join(", ")}. Save again to finish the rest.`,
    publicData,
    logMessage: failure instanceof Error ? failure.message : String(failure),
    logContext: { reason: "stopped-save-settled", slug },
    ...(failure instanceof Error ? { cause: failure } : {}),
  });
}

/**
 * `failure`, the stopped save's own, told with the failure of what tried to settle it after its
 * own words: its record that it is in progress is kept, for the next settle. The settle's failure is named only where it is a `NextlyError`, whose public message is
 * written to be shown; a driver's text stays in the log.
 */
export function withSettleFailure(
  failure: unknown,
  settleFailure: unknown
): NextlyError {
  const base = NextlyError.is(failure) ? failure : undefined;
  const why = NextlyError.is(settleFailure)
    ? `: ${settleFailure.publicMessage}`
    : ".";
  return new NextlyError({
    code: base?.code ?? "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    ...(base === undefined ? {} : { statusCode: base.statusCode }),
    publicMessage: `${base?.publicMessage ?? "The save failed part way."} Recording what of it applied failed too, so the save stays recorded as in progress, to be settled again${why}`,
    ...(base?.publicData === undefined ? {} : { publicData: base.publicData }),
    logMessage:
      settleFailure instanceof Error
        ? settleFailure.message
        : String(settleFailure),
    logContext: { ...base?.logContext, reason: "stopped-save-left" },
    ...(failure instanceof Error ? { cause: failure } : {}),
  });
}

/** How a report names each kind of change. */
const CHANGE_WORDS: Record<Exclude<FieldChangeKind, "rename">, string> = {
  add: "added",
  drop: "removed",
  retype: "type changed",
  settings: "settings changed",
};

/** The named fields of `fields`, by name. */
function byName<F extends NamedField>(fields: readonly F[]): Map<string, F> {
  return new Map(
    fields.flatMap(field =>
      field.name === undefined ? [] : [[field.name, field] as const]
    )
  );
}

/** A table's parts of one kind, each with its name; none where the table does not track them. */
function partsOf(table: TableSpec, part: Part): readonly { name: string }[] {
  return table[part] ?? [];
}

/** The parts, by kind and name, that differ between two desired shapes of one table. */
function differingParts(a: TableSpec, b: TableSpec): PartNames {
  const parts = new Map<Part, Set<string>>();
  for (const part of PARTS) {
    const left = new Map(partsOf(a, part).map(p => [p.name, p]));
    const right = new Map(partsOf(b, part).map(p => [p.name, p]));
    const names = new Set<string>();
    for (const name of new Set([...left.keys(), ...right.keys()])) {
      if (JSON.stringify(left.get(name)) !== JSON.stringify(right.get(name))) {
        names.add(name);
      }
    }
    if (names.size > 0) parts.set(part, names);
  }
  return parts;
}

/**
 * `table` holding only the parts `names` lists, named `name` (absent: a table with none), each kind
 * the table does not track left untracked, so a comparison skips it as the snapshot diff does.
 */
function only(
  table: TableSpec | undefined,
  name: string,
  names: PartNames
): TableSpec {
  const kept = <P extends { name: string }>(
    part: Part,
    list: readonly P[] | undefined
  ): P[] | undefined =>
    list === undefined
      ? undefined
      : list.filter(p => names.get(part)?.has(p.name) === true);
  const indexes = kept("indexes", table?.indexes);
  const checks = kept("checks", table?.checks);
  const foreignKeys = kept("foreignKeys", table?.foreignKeys);
  return {
    name,
    columns: kept("columns", table?.columns ?? []) ?? [],
    ...(indexes === undefined ? {} : { indexes }),
    ...(checks === undefined ? {} : { checks }),
    ...(foreignKeys === undefined ? {} : { foreignKeys }),
  };
}

/** Whether two shapes of one table are the same to the snapshot diff. */
function equivalent(a: TableSpec, b: TableSpec): boolean {
  return snapshotsEquivalent({ tables: [a] }, { tables: [b] });
}
