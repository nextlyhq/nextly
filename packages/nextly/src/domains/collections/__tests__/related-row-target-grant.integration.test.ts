/**
 * Populating a relationship asks for its TARGET the question a
 * permission-checked direct read of that target asks.
 *
 * A session caller reading a target that declares no read rule falls through
 * to its database grants, as the direct read does, rather than being admitted
 * because nothing said no. A scoped API key must hold `read-<target>` in its
 * own scope before the target's rule is consulted at all, as the direct read's
 * key branch requires.
 *
 * Each refusal is paired with a caller the same fixture admits, and each direct
 * read is asserted before its relationship, so an expansion that withheld every
 * target, or a direct read that refused everyone, fails a named case.
 */
import { afterEach, describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { defineCollection, relationship, text } from "../../../config";
import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type ReadRule = () => boolean;

interface Fixture {
  handler: CollectionsHandler;
  refId: string;
  pageId: string;
  readerId: string;
  strangerId: string;
}

/**
 * `refs.plain` points at one `pages` row. `reader` holds a role granting
 * `read-pages`; `stranger` holds no role at all.
 */
async function boot(pagesRead?: ReadRule): Promise<Fixture> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        ...(pagesRead ? { access: { read: pagesRead } } : {}),
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "refs",
        fields: [
          text({ name: "name" }),
          relationship({ name: "plain", relationTo: "pages" }),
        ],
      }),
    ],
  });

  const readPages = await current.nextly.permissions.create({
    data: {
      action: "read",
      resource: "pages",
      name: "Read pages",
      slug: "read-pages",
    },
  });
  const pageReader = await current.nextly.roles.create({
    data: {
      name: "Page reader",
      slug: "page-reader",
      permissionIds: [readPages.item.id],
    },
  });
  const readerId = await createUser("reader@example.com", pageReader.item.id);
  const strangerId = await createUser("stranger@example.com");

  const handler = current.getService("collectionsHandler");
  const page = await handler.createEntry(
    { collectionName: "pages", overrideAccess: true },
    { title: "Target page" }
  );
  const pageId = (page.data as { id: string }).id;
  const ref = await handler.createEntry(
    { collectionName: "refs", overrideAccess: true },
    { name: "r", plain: pageId }
  );

  return {
    handler,
    refId: (ref.data as { id: string }).id,
    pageId,
    readerId,
    strangerId,
  };
}

/**
 * Inserts a user, granting it `roleId` when given. Written against drizzle
 * because the adapter's `insert` and `where` disagree on column naming.
 */
async function createUser(email: string, roleId?: string): Promise<string> {
  const db = current!.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => {
      values: (row: unknown) => Promise<unknown>;
    };
  };
  const tables = getDialectTables();
  const userId = `user-${email}`;
  await db.insert(tables.users).values({
    id: userId,
    email,
    name: email,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (roleId) {
    await db.insert(tables.userRoles).values({
      id: `user-role-${email}`,
      userId,
      roleId,
      createdAt: new Date(),
    });
  }
  return userId;
}

type Caller = Pick<
  Parameters<CollectionsHandler["getEntry"]>[0],
  "user" | "authenticatedScope"
>;

/** Whether a permission-checked direct read of the page is served. */
async function readsDirectly(fx: Fixture, caller: Caller): Promise<boolean> {
  const direct = await fx.handler.getEntry({
    collectionName: "pages",
    entryId: fx.pageId,
    ...caller,
  });
  return direct.success;
}

/** Whether the populated relationship on `refs` carries the page. */
async function populates(fx: Fixture, caller: Caller): Promise<boolean> {
  const result = await fx.handler.getEntry({
    collectionName: "refs",
    entryId: fx.refId,
    depth: 1,
    routeAuthorized: true,
    ...caller,
  });
  // The parent read is served in every case; only the target varies.
  expect(result.success).toBe(true);
  const plain = (result.data as Record<string, unknown>).plain;
  return JSON.stringify(plain ?? null).includes("Target page");
}

/** A scoped key that may read `refs`, plus whatever `extra` grants. */
function keyScope(...extra: string[]) {
  return apiKeyScope(
    ["refs", ...extra].map(resource => ({
      slug: `read-${resource}`,
      action: "read",
      resource,
    }))
  );
}

const KEY_OWNER = { id: "key-owner", roles: [] as string[] };

describe("relationship expansion — session caller, target with no read rule", () => {
  it("withholds the target from a caller holding no grant for it", async () => {
    const fx = await boot();
    const caller = { user: { id: fx.strangerId } };

    expect(await readsDirectly(fx, caller)).toBe(false);
    expect(await populates(fx, caller)).toBe(false);
  });

  it("populates the target for a caller whose role grants read on it", async () => {
    const fx = await boot();
    const caller = { user: { id: fx.readerId } };

    expect(await readsDirectly(fx, caller)).toBe(true);
    expect(await populates(fx, caller)).toBe(true);
  });

  it("withholds the target on the list path as on the single-entry path", async () => {
    const fx = await boot();

    const listed = async (userId: string): Promise<string> => {
      const result = await fx.handler.listEntries({
        collectionName: "refs",
        depth: 1,
        routeAuthorized: true,
        user: { id: userId },
      });
      expect(result.success).toBe(true);
      return JSON.stringify(
        (result.data as { docs: Array<{ plain?: unknown }> }).docs.map(
          row => row.plain ?? null
        )
      );
    };

    expect(await listed(fx.strangerId)).not.toContain("Target page");
    expect(await listed(fx.readerId)).toContain("Target page");
  });
});

describe("relationship expansion — session caller, target with a read rule", () => {
  it("lets the rule decide without a grant, as before", async () => {
    const fx = await boot(() => true);
    const caller = { user: { id: fx.strangerId } };

    expect(await populates(fx, caller)).toBe(true);
  });
});

describe("relationship expansion — a scoped API key", () => {
  it("withholds a target with no read rule from a key without read-<target>", async () => {
    const fx = await boot();
    const caller = { user: KEY_OWNER, authenticatedScope: keyScope() };

    expect(await readsDirectly(fx, caller)).toBe(false);
    expect(await populates(fx, caller)).toBe(false);
  });

  it("withholds a target whose rule admits from a key without read-<target>", async () => {
    const fx = await boot(() => true);
    const caller = { user: KEY_OWNER, authenticatedScope: keyScope() };

    expect(await readsDirectly(fx, caller)).toBe(false);
    expect(await populates(fx, caller)).toBe(false);
  });

  it("populates a target with no read rule for a key holding read-<target>", async () => {
    const fx = await boot();
    const caller = {
      user: KEY_OWNER,
      authenticatedScope: keyScope("pages"),
    };

    expect(await readsDirectly(fx, caller)).toBe(true);
    expect(await populates(fx, caller)).toBe(true);
  });

  it("still holds a key with read-<target> to a rule that refuses", async () => {
    const fx = await boot(() => false);
    const caller = {
      user: KEY_OWNER,
      authenticatedScope: keyScope("pages"),
    };

    expect(await readsDirectly(fx, caller)).toBe(false);
    expect(await populates(fx, caller)).toBe(false);
  });
});
