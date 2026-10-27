/**
 * Each grant boot seeding makes the Public role is claimed in `nextly_meta`
 * before it is made, both under the lock an edit of the role's permissions
 * takes, so it is made once: not by two boots at once, not again after an
 * owner has taken it away, and not over an owner's edit made meanwhile. One
 * the role holds already is claimed and left as it is. The claim is made in
 * the transaction that adds, so a failed add leaves nothing claimed.
 */
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../../../services/shared";

import {
  permissionIdsBySlug,
  seedPublicReadGrants,
  withdrawDisabledPluginGrants,
} from "./public-read-grant";

const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

/** `nextly_meta` in memory, with a turn of the event loop in each call. */
function memoryMeta() {
  const rows = new Map<string, string>();
  const turn = () => new Promise(resolve => setImmediate(resolve));
  return {
    rows,
    async get<T>(key: string, _executor?: unknown): Promise<T | null> {
      await turn();
      const raw = rows.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async insertIfAbsent(
      key: string,
      value: unknown,
      _executor?: unknown
    ): Promise<void> {
      await turn();
      if (!rows.has(key)) rows.set(key, JSON.stringify(value));
    },
    async compareAndSet(
      key: string,
      expected: unknown,
      next: unknown,
      _executor?: unknown
    ): Promise<boolean> {
      await turn();
      if (rows.get(key) !== JSON.stringify(expected)) return false;
      rows.set(key, JSON.stringify(next));
      return true;
    },
  };
}

/**
 * The Public role as stored: the permission ids it holds, and the lock an
 * edit of its permissions takes, with whether something holds it now.
 */
function storedRole(held: string[] = []) {
  return { held: new Set(held), queue: Promise.resolve(), locked: false };
}

const RESOURCE: Record<string, string> = {
  "p-media": "media",
  "p-posts": "posts",
};

/** The executor the fake transaction hands `pick`. */
const TX = { transaction: true };

/**
 * A site with one collection anyone may read, and what was granted. Adding
 * to the role takes its lock and either adds every pick and keeps what was
 * written in `nextly_meta`, or, failing, adds none and undoes those writes,
 * as the transaction it stands for does.
 */
function site(
  meta = memoryMeta(),
  role = storedRole(),
  grantRead: (roleId: string, resource: string) => Promise<void> = async () =>
    undefined
) {
  const granted: string[] = [];
  const addOnce = (
    roleId: string,
    wanted: ReadonlyArray<{ id: string; action: string; resource: string }>,
    pick: (
      ids: readonly string[],
      executor: unknown
    ) => Promise<readonly string[]>
  ) => {
    const run = role.queue.then(async () => {
      role.locked = true;
      const before = new Map(meta.rows);
      try {
        const added = (
          await pick(
            wanted.map(({ id }) => id),
            TX
          )
        ).filter(id => !role.held.has(id));
        for (const id of added) await grantRead(roleId, RESOURCE[id]);
        for (const id of added) role.held.add(id);
        granted.push(...added.map(id => RESOURCE[id]));
        return added;
      } catch (error) {
        meta.rows.clear();
        for (const [key, value] of before) meta.rows.set(key, value);
        throw error;
      } finally {
        role.locked = false;
      }
    });
    role.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  return {
    granted,
    seeding: {
      publicRoleId: async () => "public",
      targets: async () => [
        { kind: "collection" as const, slug: "posts", access: { read: true } },
      ],
      permissionIds: async () =>
        new Map([
          ["read-media", "p-media"],
          ["read-posts", "p-posts"],
        ]),
      publicHolds: async () => new Set<string>(),
      declared: () => ({ grants: [], withheld: [], refused: [] }),
      addOnce,
      withdraw: async () => [],
      meta,
      logger: quiet,
    },
  };
}

describe("seedPublicReadGrants", () => {
  it("claims a grant before making it", async () => {
    const meta = memoryMeta();
    const claimedWhenMade: boolean[] = [];
    const { seeding } = site(meta, storedRole(), async () => {
      const { granted = [] } = JSON.parse(
        meta.rows.get("public-role-granted") ?? "{}"
      );
      claimedWhenMade.push(
        granted.includes("p-media") && granted.includes("p-posts")
      );
    });

    await seedPublicReadGrants(seeding);

    expect(claimedWhenMade).toEqual([true, true]);
  });

  it("claims in the transaction that adds, under the lock an edit of the role takes", async () => {
    const meta = memoryMeta();
    const role = storedRole();
    const claims: Array<{ locked: boolean; executor: unknown }> = [];
    const compareAndSet = meta.compareAndSet;
    meta.compareAndSet = async (key, expected, next, executor) => {
      if (key === "public-role-granted") {
        claims.push({ locked: role.locked, executor });
      }
      return compareAndSet(key, expected, next, executor);
    };

    await seedPublicReadGrants(site(meta, role).seeding);

    expect(claims).toEqual([{ locked: true, executor: TX }]);
  });

  it("claims a permission the role holds already, without adding it again", async () => {
    const meta = memoryMeta();
    const next = site(meta, storedRole(["p-media"]));

    await seedPublicReadGrants(next.seeding);

    expect(next.granted).toEqual(["posts"]);
    expect(JSON.parse(meta.rows.get("public-role-granted") ?? "{}")).toEqual({
      role: "public",
      granted: ["p-media", "p-posts"],
    });
  });

  it("makes each grant once when two boots seed at once", async () => {
    const meta = memoryMeta();
    const role = storedRole();
    const first = site(meta, role);
    const second = site(meta, role);

    await Promise.all([
      seedPublicReadGrants(first.seeding),
      seedPublicReadGrants(second.seeding),
    ]);

    expect([...first.granted, ...second.granted].sort()).toEqual([
      "media",
      "posts",
    ]);
  });

  it("leaves nothing claimed where the add fails, so the next boot makes it", async () => {
    const meta = memoryMeta();
    const role = storedRole();
    const failing = site(meta, role, async (_roleId, resource) => {
      if (resource === "posts") throw new Error("connection reset");
    });
    await expect(seedPublicReadGrants(failing.seeding)).rejects.toThrow(
      "connection reset"
    );

    const next = site(meta, role);
    await seedPublicReadGrants(next.seeding);

    // The failed add made nothing, so both are made now.
    expect(next.granted).toEqual(["media", "posts"]);
  });
});

describe("seedPublicReadGrants asking rules", () => {
  it("bounds every rule it asks with one deadline", async () => {
    // Timeouts only: the in-memory `nextly_meta` turns with `setImmediate`.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let started = 0;
      const never = () => {
        started++;
        return new Promise<boolean>(() => {});
      };
      const { seeding } = site();
      const seeded = seedPublicReadGrants({
        ...seeding,
        targets: async () =>
          ["a", "b", "c"].map(slug => ({
            kind: "collection" as const,
            slug,
            access: { read: never, create: never },
          })),
      });
      await vi.advanceTimersByTimeAsync(0);

      // All six rules asked at once, before any time passes, and one timer
      // for all of them.
      expect(started).toBe(6);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(2000);
      await seeded;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("seedPublicReadGrants timing", () => {
  it("gives the rules their whole time after the targets are found", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { seeding, granted } = site();
      const seeded = seedPublicReadGrants({
        ...seeding,
        // A slow registry: the targets take longer to find than a rule has.
        targets: async () => {
          await new Promise(resolve => setTimeout(resolve, 2500));
          return [
            {
              kind: "collection" as const,
              slug: "posts",
              access: { read: async () => true },
            },
          ];
        },
      });
      await vi.advanceTimersByTimeAsync(2500);
      await seeded;

      expect(granted).toContain("posts");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withdrawDisabledPluginGrants", () => {
  /**
   * Public holding `create-tickets`, recorded as boot seeding's grant, and
   * what a withdrawal took back and logged.
   */
  function withdrawal(granted: string[]) {
    const meta = memoryMeta();
    meta.rows.set(
      "public-role-granted",
      JSON.stringify({ role: "public", granted })
    );
    const held = new Set(["p-tickets"]);
    const warned: string[] = [];
    const deps = {
      publicRoleId: async () => "public",
      permissionIds: async () => new Map([["create-tickets", "p-tickets"]]),
      declared: () => ({
        grants: [],
        withheld: [{ action: "create", resource: "tickets", owner: "tickets" }],
        refused: [],
      }),
      withdraw: async (
        _roleId: string,
        unwanted: ReadonlyArray<{ id: string }>,
        pick: (
          ids: readonly string[],
          executor: unknown
        ) => Promise<readonly string[]>
      ) => {
        const removed = await pick(
          unwanted.map(({ id }) => id).filter(id => held.has(id)),
          TX
        );
        for (const id of removed) held.delete(id);
        return removed;
      },
      meta,
      logger: {
        ...quiet,
        warn: (message: unknown) => warned.push(String(message)),
      } as unknown as Logger,
    };
    return { deps, held, meta, warned };
  }

  it("takes back and forgets a grant boot seeding recorded, and logs it", async () => {
    const { deps, held, meta, warned } = withdrawal(["p-tickets"]);

    await withdrawDisabledPluginGrants(deps);

    expect(held.has("p-tickets")).toBe(false);
    expect(JSON.parse(meta.rows.get("public-role-granted")!).granted).toEqual(
      []
    );
    expect(warned).toEqual([expect.stringContaining('"create-tickets"')]);
  });

  it("leaves a grant no boot recorded, as an owner gave it", async () => {
    const { deps, held, warned } = withdrawal([]);

    await withdrawDisabledPluginGrants(deps);

    expect(held.has("p-tickets")).toBe(true);
    expect(warned).toEqual([]);
  });
});

describe("permissionIdsBySlug", () => {
  it("reads every page of permissions", async () => {
    const pages = [
      [{ id: "p-1", action: "read", resource: "posts" }],
      [{ id: "p-2", action: "read", resource: "pages" }],
    ];
    const ids = await permissionIdsBySlug({
      listPermissions: async ({ page }) => ({
        data: pages[page - 1],
        meta: { totalPages: pages.length },
      }),
    });

    expect(ids).toEqual(
      new Map([
        ["read-posts", "p-1"],
        ["read-pages", "p-2"],
      ])
    );
  });
});
