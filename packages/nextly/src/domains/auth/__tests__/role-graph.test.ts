/**
 * The one walk of role inheritance, and that both its directions, and both
 * the rules built on them, agree on one graph.
 *
 * The grant rule asks whether a role confers super-admin by walking DOWN from
 * it (`rolesConferSuperAdmin`, through `walkDescendantRoleIds`), reading the
 * database. The last-super-admin guard asks the same by walking UP from the
 * super-admin role over edges it holds in memory (`rolesConferring`). Two
 * walks of one graph in opposite directions must give the same answer for
 * every role, or one rule would protect an administrator the other would let
 * be made or removed.
 */
import { describe, expect, it, vi } from "vitest";

// Conditions as plain values, so the fake database below need not parse SQL.
vi.mock("drizzle-orm", () => ({
  inArray: (_column: unknown, values: string[]) => ({ in: values }),
  and: (...parts: unknown[]) => ({ and: parts }),
  eq: (_column: unknown, value: unknown) => ({ eq: value }),
}));

const ROLE_INHERITS = vi.hoisted(() => ({
  parentRoleId: "parentRoleId",
  childRoleId: "childRoleId",
}));
const ROLES = vi.hoisted(() => ({ id: "id", slug: "slug" }));
vi.mock("../../../database", () => ({
  getDialectTables: () => ({ roleInherits: ROLE_INHERITS, roles: ROLES }),
}));
vi.mock("../../users/services/last-super-admin", () => ({
  lockSuperAdminRole: () => Promise.resolve("sa"),
}));
vi.mock("../../../services/lib/permissions", () => ({
  isSuperAdminOrThrow: () => Promise.resolve(false),
}));

import {
  MAX_ROLE_HIERARCHY_DEPTH,
  rolesConferring,
  walkRoleGraph,
  type RoleEdge,
} from "../services/role-graph";
import { rolesConferSuperAdmin } from "../services/super-admin-grant";

/** `super-admin` is `sa`. */
const SA = "sa";

/**
 * A graph with depth, a diamond, a cycle that confers nothing, a role
 * inheriting into that cycle, and a role whose only way to super-admin is
 * the second of the roles it inherits, so a walk that read only part of a
 * batch would miss it.
 */
const EDGES: RoleEdge[] = [
  { parent: "owner", child: SA },
  { parent: "wide", child: "plain" },
  { parent: "wide", child: "owner" },
  { parent: "deputy", child: "owner" },
  { parent: "staff", child: "editor" },
  { parent: "both", child: "owner" },
  { parent: "both", child: "staff" },
  { parent: "loop-a", child: "loop-b" },
  { parent: "loop-b", child: "loop-a" },
  { parent: "outside", child: "loop-a" },
];
const ROLE_IDS = [
  SA,
  ...new Set(EDGES.flatMap(e => [e.parent, e.child])),
].filter((id, i, all) => all.indexOf(id) === i);

const down = (batch: readonly string[]) =>
  EDGES.filter(e => batch.includes(e.parent)).map(e => e.child);
const up = (batch: readonly string[]) =>
  EDGES.filter(e => batch.includes(e.child)).map(e => e.parent);

/** A database answering the grant rule's two reads over `EDGES`. */
function databaseOver() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: Record<string, unknown>) => {
          if (table === ROLE_INHERITS) {
            const batch = (condition as { in: string[] }).in;
            return Promise.resolve(
              down(batch).map(childRoleId => ({ childRoleId }))
            );
          }
          const [ids] = (condition as { and: Array<{ in: string[] }> }).and;
          const rows = ids.in.includes(SA) ? [{ id: SA }] : [];
          return { limit: () => Promise.resolve(rows) };
        },
      }),
    }),
  } as unknown as Parameters<typeof rolesConferSuperAdmin>[0];
}

describe("walkRoleGraph", () => {
  it("reaches every role through any depth and through a diamond", async () => {
    const walk = await walkRoleGraph(["both"], down);
    expect(walk.complete).toBe(true);
    expect(walk.ids.sort()).toEqual(["editor", "owner", SA, "staff"].sort());
  });

  it("ends on a cycle, and lists the seed it comes back to only when asked", async () => {
    expect((await walkRoleGraph(["loop-a"], down)).ids).toEqual(["loop-b"]);
    expect(
      (
        await walkRoleGraph(["loop-a"], down, { seedsVisited: false })
      ).ids.sort()
    ).toEqual(["loop-a", "loop-b"]);
  });

  it("says it is cut short once it visits more roles than its limit", async () => {
    const chain = (batch: readonly string[]) =>
      batch.map(id => `r${Number(id.slice(1)) + 1}`);
    const bounded = await walkRoleGraph(["r0"], chain, {
      limit: MAX_ROLE_HIERARCHY_DEPTH,
    });
    expect(bounded.complete).toBe(false);
    expect(bounded.ids.length).toBeGreaterThanOrEqual(MAX_ROLE_HIERARCHY_DEPTH);
  });

  it("finds the same pairs walking down as walking up", async () => {
    for (const from of ROLE_IDS) {
      const below = new Set((await walkRoleGraph([from], down)).ids);
      for (const to of ROLE_IDS) {
        if (to === from) continue;
        const above = new Set((await walkRoleGraph([to], up)).ids);
        expect(above.has(from), `${from} → ${to}`).toBe(below.has(to));
      }
    }
  });
});

describe("the grant rule and the last-super-admin guard", () => {
  it("agree, role by role, on which roles confer super-admin", async () => {
    const conferring = await rolesConferring(EDGES, SA);
    for (const role of ROLE_IDS) {
      expect(
        await rolesConferSuperAdmin(databaseOver(), "postgresql", [role]),
        role
      ).toBe(conferring.has(role));
    }
    // The control: both sides of the graph are in it.
    expect(conferring.has("deputy")).toBe(true);
    expect(conferring.has("wide")).toBe(true);
    expect(conferring.has("staff")).toBe(false);
  });
});
