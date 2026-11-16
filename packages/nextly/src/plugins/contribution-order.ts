/**
 * The order of one place's contributions of one kind, with the place's
 * built-in parts of that kind among them.
 *
 * One function, run when the app starts and again where the admin's metadata
 * is built, so the admin receives every list already in order and never
 * orders again: two orderings of one list, one in each process, would disagree
 * the first time a tie broke differently.
 *
 * A contribution is placed by number (lower first, 100 when it gives none, as
 * the menu orders), or relative to another contribution or a built-in part it
 * names: `after: A` places it after A, as close to A as the other
 * constraints allow, and straight after A when nothing competes; `before` is
 * the same on the other side. An order, then, and nearness, not a promise of
 * adjacency: another contribution ordered between the two keeps its place.
 * Built-in parts keep their order
 * among themselves, and come before contributions of the same number; ties
 * among contributions break by id. A contribution may take a built-in part's
 * place with `replaces`, and is then ordered where that part was.
 *
 * @module plugins/contribution-order
 * @experimental
 */
import { resolutionError } from "./resolution-error";

/** What ordering reads of a contribution. */
export interface OrderableContribution {
  /** `<plugin-slug>.<name>`. */
  id: string;
  /** The contributing plugin, for a refusal to name. */
  plugin: string;
  order?: number;
  before?: string;
  after?: string;
  replaces?: string;
}

/**
 * @experimental One entry of an ordered list: a built-in part, or a
 * contribution, which names the built-in part it takes the place of.
 */
export type OrderedEntry =
  | { builtIn: string }
  | { contribution: string; replaces?: string };

/** The default number, the menu's. */
const DEFAULT_ORDER = 100;

/** A node of the graph: a built-in part, or a contribution not replacing one. */
interface Node {
  key: string;
  /** Lower first: number, then built-ins before contributions, then a tie-break. */
  rank: readonly [number, number, string | number];
  entry: OrderedEntry;
  /** The contributions this node stands for, for a refusal to name. */
  names: string[];
}

/** Compare two ranks, lower first. */
function compareRank(a: Node["rank"], b: Node["rank"]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** The members of every cycle among `remaining`, by Tarjan's algorithm. */
function cycleMembers(
  remaining: ReadonlySet<string>,
  edges: ReadonlyMap<string, ReadonlySet<string>>
): Set<string> {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const members = new Set<string>();
  const visit = (key: string): void => {
    indices.set(key, index);
    low.set(key, index);
    index++;
    stack.push(key);
    onStack.add(key);
    for (const next of edges.get(key) ?? []) {
      if (!remaining.has(next)) continue;
      if (!indices.has(next)) {
        visit(next);
        low.set(key, Math.min(low.get(key)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(key, Math.min(low.get(key)!, indices.get(next)!));
      }
    }
    if (low.get(key) !== indices.get(key)) return;
    const component: string[] = [];
    let popped: string;
    do {
      popped = stack.pop()!;
      onStack.delete(popped);
      component.push(popped);
    } while (popped !== key);
    const selfLoop = edges.get(key)?.has(key) === true;
    if (component.length > 1 || selfLoop) {
      for (const member of component) members.add(member);
    }
  };
  for (const key of remaining) if (!indices.has(key)) visit(key);
  return members;
}

/** Where a refusal says the list is. */
interface Scope {
  place: string;
  kind: string;
}

/**
 * Refuse a `replaces` that names no built-in part, a part the place keeps
 * whatever is contributed, or a part two take.
 */
function replacementNodes(
  items: readonly OrderableContribution[],
  builtIns: readonly string[],
  notReplaceable: readonly string[],
  scope: Scope
): Map<string, OrderableContribution> {
  const replacers = new Map<string, OrderableContribution>();
  for (const item of items) {
    if (item.replaces === undefined) continue;
    if (!builtIns.includes(item.replaces)) {
      throw resolutionError(
        "contribution-replace-unknown",
        `Plugin "${item.plugin}" contributes "${item.id}" to replace "${item.replaces}" at the admin place "${scope.place}", which has no built-in ${scope.kind} by that name.`,
        {
          plugin: item.plugin,
          contribution: item.id,
          replaces: item.replaces,
          place: scope.place,
          kind: scope.kind,
          builtIns: [...builtIns],
        }
      );
    }
    if (notReplaceable.includes(item.replaces)) {
      throw resolutionError(
        "contribution-replace-not-allowed",
        `Plugin "${item.plugin}" contributes "${item.id}" to replace "${item.replaces}" at the admin place "${scope.place}", which a contribution may be placed beside but not replace.`,
        {
          plugin: item.plugin,
          contribution: item.id,
          replaces: item.replaces,
          place: scope.place,
          kind: scope.kind,
        }
      );
    }
    const earlier = replacers.get(item.replaces);
    if (earlier) {
      throw resolutionError(
        "contribution-replace-twice",
        `"${earlier.id}" and "${item.id}" both replace the built-in ${scope.kind} "${item.replaces}" at the admin place "${scope.place}".`,
        {
          place: scope.place,
          kind: scope.kind,
          replaces: item.replaces,
          contributions: [earlier.id, item.id],
          plugins: [earlier.plugin, item.plugin],
        }
      );
    }
    replacers.set(item.replaces, item);
  }
  return replacers;
}

/** How strongly an anchor holds two neighbours together: `after` wins. */
const AFTER_WEIGHT = 2;
const BEFORE_WEIGHT = 1;

/** The graph's nodes, and the node each id or built-in name is placed by. */
interface Nodes {
  nodes: Map<string, Node>;
  /** A replacer stands where its built-in part was, so either name reaches it. */
  nodeOf: Map<string, string>;
}

/** One node per built-in part, a replacer taking its part's, and one per other contribution. */
function graphNodes(
  items: readonly OrderableContribution[],
  builtIns: readonly string[],
  replacers: ReadonlyMap<string, OrderableContribution>
): Nodes {
  const nodes = new Map<string, Node>();
  const nodeOf = new Map<string, string>();
  builtIns.forEach((name, i) => {
    const key = `builtin:${name}`;
    const replacer = replacers.get(name);
    nodes.set(key, {
      key,
      rank: [DEFAULT_ORDER, 0, i],
      entry: replacer
        ? { contribution: replacer.id, replaces: name }
        : { builtIn: name },
      names: replacer ? [replacer.id] : [name],
    });
    nodeOf.set(name, key);
    if (replacer) nodeOf.set(replacer.id, key);
  });
  for (const item of items) {
    if (item.replaces !== undefined) continue;
    nodes.set(item.id, {
      key: item.id,
      rank: [item.order ?? DEFAULT_ORDER, 1, item.id],
      entry: { contribution: item.id },
      names: [item.id],
    });
    nodeOf.set(item.id, item.id);
  }
  return { nodes, nodeOf };
}

/**
 * The graph's edges, from what comes first to what follows it, and apart from
 * them the ones a contribution asked for, weighted: an `after`, a follower
 * asking to come after what it names, outweighs a `before` when both are free
 * at once. So what a contribution is anchored to is followed by it as soon as
 * nothing else must come between. Refuses a reference to nothing there.
 */
function graphEdges(
  items: readonly OrderableContribution[],
  builtIns: readonly string[],
  { nodes, nodeOf }: Nodes,
  scope: Scope
): {
  edges: Map<string, Set<string>>;
  anchored: Map<string, Map<string, number>>;
} {
  const edges = new Map<string, Set<string>>(
    [...nodes.keys()].map(key => [key, new Set<string>()])
  );
  const anchored = new Map<string, Map<string, number>>(
    [...nodes.keys()].map(key => [key, new Map<string, number>()])
  );
  const link = (from: string, to: string, weight: number): void => {
    edges.get(from)!.add(to);
    if (weight > 0) {
      const asked = anchored.get(from)!;
      asked.set(to, Math.max(asked.get(to) ?? 0, weight));
    }
  };
  for (let i = 1; i < builtIns.length; i++) {
    link(`builtin:${builtIns[i - 1]}`, `builtin:${builtIns[i]}`, 0);
  }
  for (const item of items) {
    const self = nodeOf.get(item.id)!;
    for (const [relation, target] of [
      ["before", item.before],
      ["after", item.after],
    ] as const) {
      if (target === undefined) continue;
      const other = nodeOf.get(target);
      if (other === undefined) {
        throw resolutionError(
          "contribution-order-unknown",
          `Plugin "${item.plugin}" orders "${item.id}" ${relation} "${target}" at the admin place "${scope.place}", but no ${scope.kind} there, contributed or built in, has that name.`,
          {
            plugin: item.plugin,
            contribution: item.id,
            [relation]: target,
            place: scope.place,
            kind: scope.kind,
          }
        );
      }
      if (relation === "before") link(self, other, BEFORE_WEIGHT);
      else link(other, self, AFTER_WEIGHT);
    }
  }
  return { edges, anchored };
}

/**
 * Kahn's algorithm. What a node frees is placed straight after it, what it
 * was anchored to first, so `after` keeps a contribution as near as the
 * order allows; otherwise the lowest-ranked free node goes next. Answers the order and the nodes placed;
 * a node left unplaced is on or behind a cycle.
 */
function placed(
  nodes: ReadonlyMap<string, Node>,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  anchored: ReadonlyMap<string, ReadonlyMap<string, number>>
): { ordered: OrderedEntry[]; done: Set<string> } {
  const incoming = new Map<string, number>(
    [...nodes.keys()].map(key => [key, 0])
  );
  for (const targets of edges.values()) {
    for (const to of targets) incoming.set(to, incoming.get(to)! + 1);
  }
  const ordered: OrderedEntry[] = [];
  const done = new Set<string>();
  const place = (node: Node): void => {
    ordered.push(node.entry);
    done.add(node.key);
    const freed: Node[] = [];
    for (const to of edges.get(node.key)!) {
      const left = incoming.get(to)! - 1;
      incoming.set(to, left);
      if (left === 0) freed.push(nodes.get(to)!);
    }
    const asked = anchored.get(node.key)!;
    freed.sort(
      (a, b) =>
        (asked.get(b.key) ?? 0) - (asked.get(a.key) ?? 0) ||
        compareRank(a.rank, b.rank)
    );
    for (const next of freed) place(next);
  };
  for (;;) {
    const free = [...nodes.values()]
      .filter(n => !done.has(n.key) && incoming.get(n.key) === 0)
      .sort((a, b) => compareRank(a.rank, b.rank));
    if (free.length === 0) break;
    place(free[0]);
  }
  return { ordered, done };
}

/**
 * @experimental One place's contributions of one kind in order, the place's
 * built-in parts of that kind among them, refusing a reference to nothing, a
 * built-in part replaced twice, not at all there or one of `notReplaceable`,
 * and a cycle, naming every contribution in it.
 */
export function orderContributions(
  items: readonly OrderableContribution[],
  builtIns: readonly string[],
  scope: Scope,
  notReplaceable: readonly string[] = []
): OrderedEntry[] {
  const graph = graphNodes(
    items,
    builtIns,
    replacementNodes(items, builtIns, notReplaceable, scope)
  );
  const { edges, anchored } = graphEdges(items, builtIns, graph, scope);
  const { ordered, done } = placed(graph.nodes, edges, anchored);
  if (done.size === graph.nodes.size) return ordered;

  const remaining = new Set(
    [...graph.nodes.keys()].filter(key => !done.has(key))
  );
  const members = [...cycleMembers(remaining, edges)]
    .flatMap(key => graph.nodes.get(key)!.names)
    .sort();
  throw resolutionError(
    "contribution-order-cycle",
    `The ${scope.kind}s ${members.map(m => `"${m}"`).join(", ")} at the admin place "${scope.place}" are each ordered before another of them, so no order satisfies them all.`,
    { place: scope.place, kind: scope.kind, contributions: members }
  );
}
