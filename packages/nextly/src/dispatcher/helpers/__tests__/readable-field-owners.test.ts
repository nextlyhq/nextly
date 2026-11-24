/**
 * Who a save's refused move into or out of a field group names (`fieldGroupUsersForMoves`): the
 * users the reader may read, by the same scoped read as the field group's own "used by" list, and
 * whether any were left out, so the refusal never names a collection or Single the reader's own
 * lists hide.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

// The field lists, answered by each test.
const readFieldOwners = vi.hoisted(() => vi.fn());
vi.mock(
  "../../../domains/collections/services/collection-dependents",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../domains/collections/services/collection-dependents")
    >()),
    readFieldOwners,
  })
);

// Who is reading, and what their lists let them read. No reader unless a test sets one.
const readAuthenticatedUser = vi.hoisted(() => vi.fn());
vi.mock("../authenticated-user", async importOriginal => ({
  ...(await importOriginal<typeof import("../authenticated-user")>()),
  readAuthenticatedUser,
}));
const readableSlugsOfKind = vi.hoisted(() => vi.fn());
vi.mock(
  "../../../services/lib/readable-slug-allowlist",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../services/lib/readable-slug-allowlist")
    >()),
    readableSlugsOfKind,
  })
);

import { fieldGroupUsersClause } from "../../../domains/field-groups/storage/field-group-users-clause";
import { fieldGroupUsersForMoves } from "../readable-field-owners";

const adapter = {} as DrizzleAdapter;
const MOVE = [{ from: ["meta", "title"], to: ["title"] }];

const placing = (slug: string) => [
  { name: "seo", type: "component", component: slug },
];
const OWNERS = [
  { entityType: "fieldGroup", entitySlug: "card", fields: placing("seo") },
  { entityType: "collection", entitySlug: "posts", fields: placing("seo") },
  { entityType: "collection", entitySlug: "pages", fields: placing("seo") },
  { entityType: "single", entitySlug: "home", fields: placing("seo") },
];

afterEach(() => {
  readFieldOwners.mockReset();
  readAuthenticatedUser.mockReset();
  readableSlugsOfKind.mockReset();
});

describe("fieldGroupUsersForMoves", () => {
  it("names only the users the reader may read, and says others were left out", async () => {
    readFieldOwners.mockResolvedValue(OWNERS);
    readAuthenticatedUser.mockReturnValue({ id: "u1", role: "editor" });
    // The reader may read no Single, and of the collections only "posts".
    readableSlugsOfKind.mockImplementation(
      async (_caller: unknown, kind: string) => ({
        slugs: kind === "collection" ? ["posts"] : [],
        reachable: true,
      })
    );

    const usersOf = await fieldGroupUsersForMoves(adapter, MOVE);
    const users = usersOf?.("seo");

    expect(users).toEqual({
      uses: [
        { entityType: "fieldGroup", entitySlug: "card", fieldPath: "seo" },
        { entityType: "collection", entitySlug: "posts", fieldPath: "seo" },
      ],
      complete: false,
    });
    expect(
      fieldGroupUsersClause(users?.uses ?? [], users?.complete ?? true)
    ).toBe(
      "It is used by the field group card, the collection posts, and others you may not read."
    );
  });

  it("names every user, with none left out, where nothing scopes the read", async () => {
    readFieldOwners.mockResolvedValue(OWNERS);

    const usersOf = await fieldGroupUsersForMoves(adapter, MOVE);

    expect(usersOf?.("seo")).toEqual({
      uses: [
        { entityType: "fieldGroup", entitySlug: "card", fieldPath: "seo" },
        { entityType: "collection", entitySlug: "posts", fieldPath: "seo" },
        { entityType: "collection", entitySlug: "pages", fieldPath: "seo" },
        { entityType: "single", entitySlug: "home", fieldPath: "seo" },
      ],
      complete: true,
    });
  });

  it("reads no field list for a save that moves nothing", async () => {
    readFieldOwners.mockResolvedValue(OWNERS);

    expect(await fieldGroupUsersForMoves(adapter, [])).toBeUndefined();
    expect(readFieldOwners).not.toHaveBeenCalled();
  });
});
