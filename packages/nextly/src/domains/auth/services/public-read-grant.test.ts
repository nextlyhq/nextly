/**
 * Each grant boot seeding makes the Public role is claimed in `nextly_meta`
 * before it is made, so it is made once: not by two boots at once, and not
 * again after an owner has taken it away. A grant claimed and then not made
 * is given back, so the next boot makes it.
 */
import { describe, expect, it } from "vitest";

import type { Logger } from "../../../services/shared";

import { permissionIdsBySlug, seedPublicReadGrants } from "./public-read-grant";

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
    async get<T>(key: string): Promise<T | null> {
      await turn();
      const raw = rows.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async insertIfAbsent(key: string, value: unknown): Promise<void> {
      await turn();
      if (!rows.has(key)) rows.set(key, JSON.stringify(value));
    },
    async compareAndSet(
      key: string,
      expected: unknown,
      next: unknown
    ): Promise<boolean> {
      await turn();
      if (rows.get(key) !== JSON.stringify(expected)) return false;
      rows.set(key, JSON.stringify(next));
      return true;
    },
  };
}

/** A site with one collection anyone may read, and what was granted. */
function site(
  meta = memoryMeta(),
  grantRead: (roleId: string, resource: string) => Promise<void> = async () =>
    undefined
) {
  const granted: string[] = [];
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
      grantRead: async (roleId: string, resource: string) => {
        await grantRead(roleId, resource);
        granted.push(resource);
      },
      meta,
      logger: quiet,
    },
  };
}

describe("seedPublicReadGrants", () => {
  it("claims a grant before making it", async () => {
    const meta = memoryMeta();
    const claimedWhenMade: boolean[] = [];
    const { seeding } = site(meta, async () => {
      const recorded = JSON.parse(meta.rows.get("public-role-granted") ?? "[]");
      claimedWhenMade.push(
        recorded.includes("p-media") && recorded.includes("p-posts")
      );
    });

    await seedPublicReadGrants(seeding);

    expect(claimedWhenMade).toEqual([true, true]);
  });

  it("makes each grant once when two boots seed at once", async () => {
    const meta = memoryMeta();
    const first = site(meta);
    const second = site(meta);

    await Promise.all([
      seedPublicReadGrants(first.seeding),
      seedPublicReadGrants(second.seeding),
    ]);

    expect([...first.granted, ...second.granted].sort()).toEqual([
      "media",
      "posts",
    ]);
  });

  it("gives back a claim it could not make, so the next boot makes it", async () => {
    const meta = memoryMeta();
    const failing = site(meta, async (_roleId, resource) => {
      if (resource === "posts") throw new Error("connection reset");
    });
    await expect(seedPublicReadGrants(failing.seeding)).rejects.toThrow(
      "connection reset"
    );

    const next = site(meta);
    await seedPublicReadGrants(next.seeding);

    expect(next.granted).toEqual(["posts"]);
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
