/**
 * The collection gate was not the only gate that judged a key by its owner.
 *
 * `plugin-route-key-scope.integration.test.ts` pins the coarse RBAC gate on the
 * ordinary `createEntry` path. Three more gates stand behind it, and each one
 * resolved the OWNER's grants from `user.id` because the key's own scope never
 * reached them:
 *
 * - the TRANSACTION entry points, which the plugin surface exposes and whose
 *   write params carried no scope at all;
 * - FIELD-level access, which resolves its own permissions and roles from the
 *   user id and had no parameter a scope could arrive through;
 * - and the scope object itself, which was published by reference straight out
 *   of a shared five-minute cache.
 *
 * A fourth case covers the SPELLING a permission reaches a rule in, which is
 * not a gate of its own but decides what two of the gates above conclude.
 *
 * Each test below writes through the real catch-all dispatcher with a real
 * `nx_live_` key, so a green here is the whole request path agreeing rather
 * than a unit agreeing with its own mock.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createDynamicHandlers } from "../../../routeHandler";
import { isSuperAdmin } from "../../../services/lib/permissions";
import { definePlugin } from "../../plugin-context";
import { createTestNextly, type TestNextly } from "../../test-nextly";

const PLUGIN = "@test/key-scope-gates";

/**
 * A field only a super-admin may read.
 *
 * Written in the spelling `AccessControlContext.permissions` documents and
 * `listEffectivePermissions` produces — `roles` here, because a role predicate
 * makes the escalation unambiguous: the key holds `viewer`, its owner holds
 * `super-admin`, and the value can only appear if the owner was asked.
 */
const SECRET_FIELD = "ownerOnlyNote";

const gatedPosts = defineCollection({
  slug: "posts",
  access: { read: () => true, create: () => false },
  fields: [
    text({ name: "title" }),
    text({
      name: SECRET_FIELD,
      access: {
        read: ({ roles }: { roles: string[] }) => roles.includes("super-admin"),
      },
    } as never),
  ],
});

/**
 * A collection gated by a permission predicate, in the spelling the docs show.
 *
 * `AccessFunction` states `resource:action` as what a rule receives, and
 * `listEffectivePermissions` produces exactly that for a session caller. An API
 * key carries the STORED spelling (`read-notes`), which is what the coarse
 * grant check tests — so forwarding the stored form into the rule denies a key
 * that holds the grant, while the identical session caller is allowed.
 */
const spelledNotes = defineCollection({
  slug: "notes",
  access: {
    read: ({ permissions }: { permissions: string[] }) =>
      permissions.includes("notes:read"),
  },
  fields: [text({ name: "title" })],
});

const gatePlugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "POST",
        path: "/tx-write",
        /**
         * The transaction entry points, reached the way the facade's own
         * docblock demonstrates them. Nothing here is exotic: `withTransaction`
         * and `createEntryInTransaction` are public on the plugin-facing
         * service, so a plugin needing two writes to commit together arrives
         * exactly here.
         */
        handler: async (_req, ctx) => {
          try {
            const collections = ctx.services.collections as unknown as {
              withTransaction: <T>(
                fn: (tx: unknown) => Promise<T>
              ) => Promise<T>;
              createEntryInTransaction: (
                tx: unknown,
                slug: string,
                data: Record<string, unknown>,
                context: Record<string, unknown>
              ) => Promise<{ id: string }>;
            };
            const created = await collections.withTransaction(async tx =>
              collections.createEntryInTransaction(
                tx,
                "posts",
                { title: "written in a transaction by a read-only key" },
                { user: ctx.user ?? undefined }
              )
            );
            return Response.json({ wrote: true, id: created.id });
          } catch (error) {
            return Response.json(
              { wrote: false, reason: String(error) },
              { status: 403 }
            );
          }
        },
      },
      {
        method: "POST",
        path: "/read-one",
        // Reads a row back so the gated field's presence can be inspected.
        // Composes `{ as: "user", user }` and nothing else, as every shipped
        // route does.
        handler: async (_req, ctx) => {
          const found = await ctx.services.collections.listEntries(
            "posts",
            {},
            { as: "user", user: ctx.user ?? undefined }
          );
          return Response.json({ rows: found.data });
        },
      },
      {
        method: "POST",
        path: "/read-spelled",
        handler: async (_req, ctx) => {
          try {
            const found = await ctx.services.collections.listEntries(
              "notes",
              {},
              { as: "user", user: ctx.user ?? undefined }
            );
            return Response.json({ read: true, count: found.data.length });
          } catch (error) {
            return Response.json(
              { read: false, reason: String(error) },
              { status: 403 }
            );
          }
        },
      },
      {
        method: "POST",
        path: "/mutate-scope",
        /**
         * A handler that narrows its own scope in place — the thing
         * `ctx.authenticatedScope` invites, since a route wanting to restrict a
         * sensitive call further has an object in hand and no other obvious
         * way to say so.
         */
        handler: async (_req, ctx) => {
          const scope = ctx.authenticatedScope;
          const before = scope ? [...scope.permissions] : [];
          scope?.permissions.splice(0, scope.permissions.length);
          return Response.json({ before, after: scope?.permissions ?? [] });
        },
      },
    ],
  },
});

function post(
  sub: "tx-write" | "read-one" | "read-spelled" | "mutate-scope",
  headers: Record<string, string>
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const url = `http://localhost/api/plugins/${PLUGIN}/${sub}`;
  const params = ["plugins", ...PLUGIN.split("/"), sub];
  return handlers.POST(new Request(url, { method: "POST", headers }), {
    params: Promise.resolve({ params }),
  });
}

let handle: TestNextly | undefined;
let ownerId = "";

beforeEach(async () => {
  handle = await createTestNextly({
    collections: [gatedPosts, spelledNotes],
    plugins: [gatePlugin],
  });
});

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/** The same viewer key the collection-gate suite uses, for the same reasons. */
async function viewerKeyOwnedBySuperAdmin(): Promise<string> {
  const nextly = handle!.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
    permissions: {
      find: (a: { limit: number }) => Promise<{
        items: { id: string; slug: string }[];
      }>;
    };
    roles: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };

  const owner = await nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });

  const permissions = await nextly.permissions.find({ limit: 300 });
  const granted = ["read-posts", "read-notes"].map(slug => {
    const found = permissions.items.find(p => p.slug === slug);
    expect(
      found,
      `the \`${slug}\` permission must be seeded, or the role grants nothing`
    ).toBeDefined();
    return found!.id;
  });

  const viewer = await nextly.roles.create({
    data: { name: "Viewer", slug: "viewer", permissionIds: granted },
  });

  const apiKeys = handle!.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId?: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string; meta: { id: string } }>;
    resolveApiKeyPermissions: (
      tokenType: string,
      roleId: string | null,
      userId: string,
      keyId: string
    ) => Promise<string[]>;
  };

  const { key, meta } = await apiKeys.createApiKey(owner.item.id, {
    name: "viewer key for a contractor",
    tokenType: "role-based",
    roleId: viewer.item.id,
    expiresIn: "never",
  });

  const scope = await apiKeys.resolveApiKeyPermissions(
    "role-based",
    viewer.item.id,
    owner.item.id,
    meta.id
  );
  expect(
    [...scope].sort(),
    "the key must hold both reads and NO write"
  ).toEqual(["read-notes", "read-posts"]);

  ownerId = owner.item.id;
  return key;
}

/** Seed a row as the trusted server, so the read tests have something to read. */
async function seedPost(): Promise<void> {
  const nextly = handle!.nextly as unknown as {
    create: (a: {
      collection: string;
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  await nextly.create({
    collection: "posts",
    data: { title: "Hello", [SECRET_FIELD]: "owner eyes only" },
  });
}

describe("every gate behind the plugin route judges the key, not its owner", () => {
  it("refuses a transaction write the key's own grant does not cover", async () => {
    const key = await viewerKeyOwnedBySuperAdmin();
    expect(
      await isSuperAdmin(ownerId),
      "the key's owner must be a super-admin, or this test proves nothing"
    ).toBe(true);

    const res = await post("tx-write", { authorization: `Bearer ${key}` });
    expect(
      res.status,
      "a 401 would mean the key never reached the handler"
    ).not.toBe(401);

    const body = (await res.json()) as { wrote: boolean; reason?: string };
    expect(
      body.wrote,
      "a viewer-scoped key wrote through the TRANSACTION entry point. The " +
        "ordinary create path holds it to its grant; this one resolved the " +
        `owner because the write params carry no scope. ${body.reason ?? ""}`
    ).toBe(false);
  });

  it("hides a field the key's own roles do not open", async () => {
    const key = await viewerKeyOwnedBySuperAdmin();
    await seedPost();

    const res = await post("read-one", { authorization: `Bearer ${key}` });
    const body = (await res.json()) as {
      rows: Record<string, unknown>[];
    };

    expect(
      body.rows.length,
      "the read must return the row, or the field assertion below is vacuous"
    ).toBeGreaterThan(0);
    expect(
      body.rows[0]?.title,
      "an ungated field must still be readable, or the whole row was refused " +
        "and the gated field is absent for the wrong reason"
    ).toBe("Hello");
    expect(
      body.rows[0],
      "a field gated on `roles.includes('super-admin')` reached a key whose " +
        "own role is `viewer`. Field access resolved the grants from the " +
        "key OWNER's id rather than from the scope the request arrived with."
    ).not.toHaveProperty(SECRET_FIELD);
  });

  it("reads a rule written in the spelling the docs show", async () => {
    // The key HOLDS `read-notes`, so the coarse grant check passes and the
    // collection's own rule is what decides. That rule asks for `notes:read` —
    // the spelling `AccessFunction` documents — so a refusal here means the
    // stored spelling reached the rule, not that the key lacked the grant.
    const key = await viewerKeyOwnedBySuperAdmin();

    const res = await post("read-spelled", { authorization: `Bearer ${key}` });
    const body = (await res.json()) as { read: boolean; reason?: string };

    expect(
      body.read,
      "a documented permission predicate refused a key that holds the grant. " +
        "The key carries `read-notes` and the rule asks for `notes:read`; the " +
        `two name one permission row. ${body.reason ?? ""}`
    ).toBe(true);
  });

  it("does not let a handler's narrowing outlive its own request", async () => {
    const key = await viewerKeyOwnedBySuperAdmin();

    const first = await post("mutate-scope", {
      authorization: `Bearer ${key}`,
    });
    const firstBody = (await first.json()) as {
      before: string[];
      after: string[];
    };
    expect(
      [...firstBody.before].sort(),
      "the handler must see the key's grants, or it had nothing to mutate " +
        "and the second request below proves nothing"
    ).toEqual(["read-notes", "read-posts"]);

    // The same key, a second request. Its grants must be what the key holds,
    // not what the previous handler left behind in the shared cache.
    const second = await post("mutate-scope", {
      authorization: `Bearer ${key}`,
    });
    const secondBody = (await second.json()) as { before: string[] };

    expect(
      [...secondBody.before].sort(),
      "the first handler's in-place narrowing changed the key's effective " +
        "grants for a later request. `resolveApiKeyPermissions` returns its " +
        "cached array by reference and the route context published it as-is."
    ).toEqual(["read-notes", "read-posts"]);
  });
});
