/**
 * Field groups that place each other in a cycle.
 *
 * A field group may hold another at any depth; what keeps a definition finite is that none is
 * placed inside itself, directly or through other field groups (A in B in A). A placement through
 * a named group, a repeater or a zone counts like a direct one: the definition loops either way,
 * and every walk over field-group definitions would follow it.
 *
 * A cycle is refused where it is written. Code is written at start, so a cycle that takes in a
 * field group defined in code is refused there. A Builder field group is written by its save, so a
 * save that would leave the saved field group in a cycle is refused. A cycle among Builder field
 * groups saved before this rule existed is named at start rather than refused there: a site that
 * cannot start cannot reach the admin that would fix it, and the next save of any field group in
 * the cycle is refused until one of them stops placing the next.
 *
 * Every question here derives from {@link fieldGroupPlacements}, the one walk of where a field list
 * places field groups.
 *
 * @module domains/field-groups/field-group-cycles
 */

import { NextlyError } from "../../errors/nextly-error";

import { fieldGroupPlacements } from "./storage/field-group-placements";

/** A field group as the rule reads it: its slug and its field list as written or stored. */
export interface FieldGroupDefinition {
  readonly slug: string;
  readonly fields?: unknown;
}

/** The stable code a cycle refusal carries. */
export const FIELD_GROUP_CYCLE = "FIELD_GROUP_CYCLE";

/**
 * Each field group's slug, keyed by its lower-cased slug, with the field groups it places that are
 * among `definitions`. Slugs are compared without case, as the config's slug checks compare them;
 * a placement of a field group not among the definitions cannot close a cycle and is left out.
 */
function placementGraph(definitions: readonly FieldGroupDefinition[]): {
  edges: Map<string, string[]>;
  written: Map<string, string>;
} {
  const written = new Map<string, string>();
  for (const { slug } of definitions) written.set(slug.toLowerCase(), slug);
  const edges = new Map<string, string[]>();
  for (const { slug, fields } of definitions) {
    const placed = new Set<string>();
    for (const placement of fieldGroupPlacements(fields)) {
      for (const target of placement.slugs) {
        const key = target.toLowerCase();
        if (written.has(key)) placed.add(key);
      }
    }
    edges.set(slug.toLowerCase(), [...placed]);
  }
  return { edges, written };
}

/** Each field group's placements of others, by lower-cased slug. */
type Placements = ReadonlyMap<string, readonly string[]>;

/** The slugs from `from` down the search to `node`, `from` first. */
function wayBack(
  parent: ReadonlyMap<string, string>,
  from: string,
  node: string
): string[] {
  const back: string[] = [];
  for (let at = node; at !== from; at = parent.get(at) ?? from) back.push(at);
  return [from, ...back.reverse()];
}

/**
 * The shortest way along placements from `from` to a placement of `to`, as the slugs along it,
 * `from` first and `to` last, or null when nothing on the way places `to`. With `to` the same as
 * `from` it is the shortest cycle through it (`["a", "b", "a"]`; `["a", "a"]` for a field group
 * placed directly in itself). Found breadth first, so the cycle named is the plainest to break.
 */
function shortestWay(
  edges: Placements,
  from: string,
  to: string
): string[] | null {
  const parent = new Map<string, string>();
  const queue: string[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const next of edges.get(node) ?? []) {
      if (next === to) return [...wayBack(parent, from, node), to];
      if (next !== from && !parent.has(next)) {
        parent.set(next, node);
        queue.push(next);
      }
    }
  }
  return null;
}

/** The cycle the placement of `to` in `from` closes, or null when it closes none. */
function cycleClosedBy(
  edges: Placements,
  from: string,
  to: string
): string[] | null {
  if (to === from) return [from, from];
  const way = shortestWay(edges, to, from);
  return way === null ? null : [from, ...way];
}

/** The cycle `slug` takes part in among `definitions`, named with each slug as written, or null. */
function fieldGroupCycleThrough(
  definitions: readonly FieldGroupDefinition[],
  slug: string
): string[] | null {
  const { edges, written } = placementGraph(definitions);
  const key = slug.toLowerCase();
  const cycle = shortestWay(edges, key, key);
  return cycle === null ? null : cycle.map(k => written.get(k) ?? k);
}

function describeCycle(cycle: readonly string[]): string {
  return cycle.join(" → ");
}

function cycleRefusal(cycle: readonly string[], path: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path,
        code: FIELD_GROUP_CYCLE,
        message:
          `Field groups place each other in a cycle: ${describeCycle(cycle)}. ` +
          `A field group cannot be placed inside itself, directly or through other field groups.`,
      },
    ],
    logContext: { reason: "field-group-cycle", cycle },
  });
}

/**
 * Refuse a cycle among the field groups a configuration defines in code. Run where the config is
 * defined, before anything else knows the Builder's field groups.
 */
export function assertNoFieldGroupCycleInCode(
  definitions: readonly FieldGroupDefinition[]
): void {
  const { edges, written } = placementGraph(definitions);
  for (const key of edges.keys()) {
    const cycle = shortestWay(edges, key, key);
    if (cycle !== null) {
      throw cycleRefusal(
        cycle.map(k => written.get(k) ?? k),
        "fieldGroups"
      );
    }
  }
}

/** Slugs as their definitions write them. */
type Named = (cycle: readonly string[]) => string[];

/** Refuse a cycle that takes in a field group defined in code. */
function refuseCodeCycles(
  edges: Placements,
  codeKeys: ReadonlySet<string>,
  named: Named
): void {
  for (const key of codeKeys) {
    const cycle = shortestWay(edges, key, key);
    if (cycle !== null) throw cycleRefusal(named(cycle), "fieldGroups");
  }
}

/**
 * Refuse a cycle closed by a placement the start adds to the stored field groups (one in `edges`
 * but not in `before`): code written at start, whatever cycles the stored ones already hold.
 */
function refuseAddedCycles(
  edges: Placements,
  before: Placements,
  named: Named
): void {
  for (const [from, targets] of edges) {
    const stored = new Set(before.get(from) ?? []);
    for (const to of targets.filter(target => !stored.has(target))) {
      const cycle = cycleClosedBy(edges, from, to);
      if (cycle !== null) throw cycleRefusal(named(cycle), "fieldGroups");
    }
  }
}

/** Name, once each, the cycles left: made only of placements the Builder stored earlier. */
function warnStoredCycles(
  edges: Placements,
  named: Named,
  warn: (message: string) => void
): void {
  const reported = new Set<string>();
  for (const key of edges.keys()) {
    if (reported.has(key)) continue;
    const cycle = shortestWay(edges, key, key);
    if (cycle === null) continue;
    for (const member of cycle) reported.add(member);
    warn(
      `Field groups place each other in a cycle: ${describeCycle(named(cycle))}. ` +
        `They were saved before such a cycle was refused. The next save of any of them is ` +
        `refused until one stops placing the next.`
    );
  }
}

/**
 * Judge the field groups an application starts with: the ones its code defines together with the
 * Builder's. A cycle taking in a code field group is refused, since code is written at start. So
 * is any cycle a placement the start adds to a stored field group closes (a plugin extending a
 * Builder field group), even where the stored field groups already hold another cycle. A cycle
 * made only of placements the Builder stored was written by earlier saves, so it is named through
 * `warn`, once per cycle, and the start goes on. Where a slug is both, the code's definition is
 * the one judged, as it is the one the application uses.
 */
export function judgeFieldGroupCyclesAtStart(args: {
  code: readonly FieldGroupDefinition[];
  /** The Builder's field groups as the start uses them, with any field a plugin extends onto one. */
  registered: readonly FieldGroupDefinition[];
  /** The Builder's field groups as stored, before the start's additions; `registered` when absent. */
  stored?: readonly FieldGroupDefinition[];
  warn: (message: string) => void;
}): void {
  const codeKeys = new Set(args.code.map(({ slug }) => slug.toLowerCase()));
  const withCode = (builder: readonly FieldGroupDefinition[]) => [
    ...builder.filter(({ slug }) => !codeKeys.has(slug.toLowerCase())),
    ...args.code,
  ];
  const { edges, written } = placementGraph(withCode(args.registered));
  const named: Named = cycle => cycle.map(k => written.get(k) ?? k);

  refuseCodeCycles(edges, codeKeys, named);
  if (args.stored !== undefined) {
    refuseAddedCycles(
      edges,
      placementGraph(withCode(args.stored)).edges,
      named
    );
  }
  warnStoredCycles(edges, named, args.warn);
}

/**
 * Refuse a Builder save that would leave the saved field group in a cycle, judged against every
 * stored field group with the saved definition in place of its stored one.
 */
export function assertSaveLeavesNoFieldGroupCycle(args: {
  saved: FieldGroupDefinition;
  stored: readonly FieldGroupDefinition[];
}): void {
  const savedKey = args.saved.slug.toLowerCase();
  const definitions = [
    ...args.stored.filter(({ slug }) => slug.toLowerCase() !== savedKey),
    args.saved,
  ];
  const cycle = fieldGroupCycleThrough(definitions, args.saved.slug);
  if (cycle !== null) throw cycleRefusal(cycle, "fields");
}
