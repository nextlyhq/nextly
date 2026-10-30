/**
 * The Public role's grants a request keeps stop holding when the process's
 * kept copy would: a minute after they were read.
 *
 * The role version retires both on any change it can see. Where it cannot see
 * one, as for a revocation made through another instance whose version never
 * reaches this one, the minute is the only bound. A request kept the first
 * read's promise with no expiry of its own, so a request running past the
 * minute went on judging visitors by a grant already revoked. Here the version
 * never moves, the Public role's grant is revoked after the first read, and
 * the request asks again: before the minute it is still served what it kept
 * (the control), and after it, it reads the revocation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The Public role's grant rows, as the stand-in database holds them now. */
const held = vi.hoisted(() => ({
  rows: [] as Array<{ slug: string; action: string; resource: string }>,
  grantReads: 0,
}));

/**
 * A stand-in for the pooled Drizzle handle: the Public role's id for the role
 * lookup, and the rows above for the grants lookup, counting each read.
 */
const db = vi.hoisted(() => ({
  select(projection: Record<string, unknown>) {
    const grants = "slug" in projection;
    if (grants) held.grantReads += 1;
    const result = grants ? [...held.rows] : [{ id: "role-public" }];
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (
        resolve: (rows: unknown[]) => unknown,
        reject: (error: unknown) => unknown
      ) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  },
}));

vi.mock("../../di/container", () => ({
  container: {
    has: () => false,
    get: (name: string) => {
      if (name === "adapter") return { getDrizzle: () => db };
      // Boot seeding has made the Public role.
      if (name === "metaService") {
        return { get: async () => "created" };
      }
      throw new Error(`${name} is not registered`);
    },
  },
}));

// A role version that never moves: nothing this process can observe retires
// what was kept, as where a change is made through another instance.
vi.mock("./rbac-epoch", async importOriginal => ({
  ...(await importOriginal<typeof import("./rbac-epoch")>()),
  refreshEpoch: async () => "stable",
  stampIsCurrent: () => true,
}));

const START = new Date("2026-01-01T00:00:00Z").getTime();

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  held.rows = [{ slug: "read-posts", action: "read", resource: "posts" }];
  held.grantReads = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Within one request, reads Public's grants, revokes them in the stand-in
 * database, moves the clock `laterMs` on and reads them again.
 */
async function askAgainAfter(laterMs: number) {
  const { runWithAccessMemo } = await import("../../auth/access/request-memo");
  const { listPublicGrants } = await import("./permissions");
  return runWithAccessMemo(async () => {
    const first = await listPublicGrants();
    held.rows = [];
    vi.setSystemTime(START + laterMs);
    const second = await listPublicGrants();
    return { first, second };
  });
}

describe("the Public role's grants kept for a request", () => {
  it("are served as kept within the minute", async () => {
    const { first, second } = await askAgainAfter(30_000);

    expect(first.map(grant => grant.slug)).toEqual(["read-posts"]);
    expect(second.map(grant => grant.slug)).toEqual(["read-posts"]);
    expect(held.grantReads).toBe(1);
  });

  it("are read again once the minute has passed, and a revocation is seen", async () => {
    const { first, second } = await askAgainAfter(61_000);

    expect(first.map(grant => grant.slug)).toEqual(["read-posts"]);
    expect(second).toEqual([]);
    expect(held.grantReads).toBe(2);
  });
});
