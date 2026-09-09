/**
 * A plugin route must judge an API key on the grants stamped on the KEY, never
 * on the roles of whoever minted it.
 *
 * The escalation this pins, end to end through the real catch-all dispatcher:
 * `ctx.user` names the key's OWNER, so a facade that forwarded it alone reached
 * `rbacAccessControlService.checkAccess({ userId })`, whose first act is
 * `isSuperAdmin(userId)` — a database lookup on that owner. A read-only key
 * minted by a super-admin was therefore authorized to write.
 *
 * The setup is the ordinary one, not a contrived fixture: the first user of a
 * Nextly install holds the seeded `super-admin` role, and a read-only key is
 * the obvious thing for them to hand a contractor or a build script.
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

const PLUGIN = "@test/key-scope";

/**
 * A write route with NO `requiredPermission` — the shape already shipped in
 * `plugin-page-builder`'s save-pattern route, so this is the real exposure
 * rather than a worst case invented for the test. The door lets any
 * authenticated caller through; what must still refuse is the write itself.
 */
const writePlugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "POST",
        path: "/write",
        // Composes `{ as: "user", user }` and NOTHING else — the shape every
        // first-party route already written uses. The scope has to reach the
        // access check without the handler naming it, or the fix only helps
        // routes nobody has written yet.
        handler: async (_req, ctx) => {
          try {
            const created = await ctx.services.collections.createEntry(
              "posts",
              { title: "written by a read-only key" },
              { as: "user", user: ctx.user ?? undefined }
            );
            return Response.json({ wrote: true, id: created.item });
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
        path: "/read",
        // Same shape, an operation the key DOES hold. Separates "held to its
        // grant" from "denied everything".
        handler: async (_req, ctx) => {
          try {
            const found = await ctx.services.collections.listEntries(
              "posts",
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
    ],
  },
});

function post(
  sub: "write" | "read",
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

beforeEach(async () => {
  handle = await createTestNextly({
    collections: [
      defineCollection({
        slug: "posts",
        // Reads stay open so a read-only key has something it MAY do; the code
        // rule refuses create, which is what a scoped key must be held to and
        // what a super-admin would otherwise bypass.
        access: { read: () => true, create: () => false },
        fields: [text({ name: "title" })],
      }),
    ],
    plugins: [writePlugin],
  });
});

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/**
 * A `viewer` role holding ONLY `read-posts`, and a role-based key scoped to it,
 * minted by the super-admin first user.
 *
 * Role-based rather than read-only because `resolveApiKeyPermissions` derives a
 * read-only key's grants from its OWNER's enumerated slugs — and a super-admin
 * has none, its power being an implicit bypass rather than a list. Such a key
 * resolves to an empty scope and is refused everything, which cannot separate
 * "held to its grant" from "denied outright". A role-based key resolves from
 * the ROLE, so it holds exactly `read-posts` and both directions are testable.
 * It is also the vector `auth/authenticated-scope.ts` names in its own header.
 */
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

  // The first user of an install holds the seeded super-admin role. Asserted
  // in the test rather than here, so the precondition is visible where it is
  // relied on.
  const owner = await nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });

  const permissions = await nextly.permissions.find({ limit: 300 });
  const readPosts = permissions.items.find(p => p.slug === "read-posts");
  expect(
    readPosts,
    "the `read-posts` permission must be seeded, or the role below grants nothing"
  ).toBeDefined();

  const viewer = await nextly.roles.create({
    data: {
      name: "Viewer",
      slug: "viewer",
      permissionIds: [readPosts!.id],
    },
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

  // The scope this whole suite is about. Asserted so a resolution change that
  // emptied it would fail here, naming the cause, rather than downstream as a
  // refusal that looks like the guard working.
  const scope = await apiKeys.resolveApiKeyPermissions(
    "role-based",
    viewer.item.id,
    owner.item.id,
    meta.id
  );
  expect(scope, "the key must hold read and NOT create").toEqual([
    "read-posts",
  ]);

  ownerId = owner.item.id;
  return key;
}

let ownerId = "";

describe("a plugin route judges an API key on its own grants", () => {
  it("refuses a write the key's own grant does not cover", async () => {
    const key = await viewerKeyOwnedBySuperAdmin();

    // The precondition the escalation depends on. Without a privileged owner
    // the write below is refused because nobody was privileged, not because
    // the key was held to its grant.
    expect(
      await isSuperAdmin(ownerId),
      "the key's owner must be a super-admin, or this test proves nothing"
    ).toBe(true);

    const res = await post("write", { authorization: `Bearer ${key}` });
    expect(
      res.status,
      "a 401 would mean the key never reached the handler"
    ).not.toBe(401);

    const body = (await res.json()) as { wrote: boolean };
    expect(
      body.wrote,
      "a viewer-scoped key wrote through a plugin route. Its owner is a " +
        "super-admin, so the access check resolved the OWNER rather than the " +
        "key's own grants."
    ).toBe(false);
  });

  it("allows the read that grant DOES cover, through the same route shape", async () => {
    // The discriminating control. An implementation that authenticates the key
    // and then refuses every scoped operation passes the write-denial above
    // identically; only an authorized operation succeeding separates the two.
    const key = await viewerKeyOwnedBySuperAdmin();

    const res = await post("read", { authorization: `Bearer ${key}` });
    const body = (await res.json()) as { read: boolean; reason?: string };

    expect(
      body.read,
      "the key holds `read-posts`, so a refusal here is blanket rather than " +
        `scoped: ${body.reason ?? ""}`
    ).toBe(true);
  });
});
