/**
 * The one walk of role inheritance, in either direction.
 *
 * `role_inherits(parentRoleId, childRoleId)` records that the parent holds
 * everything the child holds. Walking it down, from a role to its children,
 * gives the roles a holder of that role holds. Walking it up, from a role to
 * its parents, gives the roles that confer it. Every question about
 * inheritance is one of those two walks, so both are this one function: each
 * caller supplies how a frontier's neighbours are read (a database read, or
 * edges already in memory) and decides for itself what a walk cut short at
 * its limit means.
 *
 * @module domains/auth/services/role-graph
 */

/**
 * The most roles a bounded walk visits before stopping. A hierarchy that
 * large is not a real one, so a walk that reaches it is treated as cut short,
 * which stops a cycle written around the checks from looping forever.
 */
export const MAX_ROLE_HIERARCHY_DEPTH = 2000;

/** The roles a walk reached, and whether it reached all of them. */
export interface RoleWalk {
  ids: string[];
  complete: boolean;
}

/** How many roles of the frontier each read asks about. */
const BATCH = 50;

/**
 * Every role reachable from `seeds` through `step`, breadth-first.
 *
 * `step` answers the neighbours of a batch of roles: their children for a
 * walk down, their parents for a walk up. The seeds themselves are not in
 * `ids` unless the walk reaches them again, and only when `seedsVisited` is
 * false; by default they count as already visited.
 *
 * With a `limit`, the walk stops once it has visited more roles than that,
 * counting the seeds when they count as visited, and says so: `complete` is
 * false. Without one it walks the whole graph, which only a caller holding a
 * finite graph in memory, or reading one it knows to be bounded, should ask.
 */
export async function walkRoleGraph(
  seeds: readonly string[],
  step: (
    batch: readonly string[]
  ) => readonly unknown[] | Promise<readonly unknown[]>,
  opts: { seedsVisited?: boolean; limit?: number } = {}
): Promise<RoleWalk> {
  const visited = new Set<string>(opts.seedsVisited === false ? [] : seeds);
  const reached: string[] = [];
  const queue: string[] = [...seeds];

  while (queue.length > 0) {
    const batch = queue.splice(0, BATCH);
    for (const neighbour of await step(batch)) {
      const id = String(neighbour);
      if (visited.has(id)) continue;
      visited.add(id);
      reached.push(id);
      queue.push(id);
    }
    if (opts.limit !== undefined && visited.size > opts.limit) {
      return { ids: reached, complete: false };
    }
  }
  return { ids: reached, complete: true };
}

/** One inheritance: `parent` holds everything `child` holds. */
export interface RoleEdge {
  parent: string;
  child: string;
}

/**
 * The roles that confer `roleId` over `edges` held in memory: the role
 * itself, and every role that inherits it at any depth. The edges are a
 * finite graph, so the walk is not bounded.
 */
export async function rolesConferring(
  edges: readonly RoleEdge[],
  roleId: string
): Promise<Set<string>> {
  const parentsOf = new Map<string, string[]>();
  for (const { parent, child } of edges) {
    const parents = parentsOf.get(child);
    if (parents) parents.push(parent);
    else parentsOf.set(child, [parent]);
  }
  const { ids } = await walkRoleGraph([roleId], batch =>
    batch.flatMap(child => parentsOf.get(child) ?? [])
  );
  return new Set([roleId, ...ids]);
}
