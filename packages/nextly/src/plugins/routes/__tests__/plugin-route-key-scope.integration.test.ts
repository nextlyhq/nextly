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
      // A second collection exists only so the catalogue holds a read
      // permission no hand-built role below is granted. That one slug is what
      // separates "copied the catalogue" from "copied the owner's rows"; with
      // a single collection both branches answer `read-posts` and the
      // assertion would be satisfied by the behaviour it was written to refuse.
      defineCollection({
        slug: "notes",
        access: { read: () => true },
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
 * Role-based so the key holds exactly `read-posts`, which makes both directions
 * testable against one grant. It is also the vector `auth/authenticated-scope.ts`
 * names in its own header. The super-admin's own read-only key is the other
 * case below: it used to resolve to an empty scope, because a super-admin's
 * role holds the rows that existed at setup and their power is the bypass, so
 * the first key an operator minted was refused everything.
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

/**
 * The super-admin first user's OWN read-only key, the first key an operator
 * mints to try an integration with. Its grants are the catalogue's read
 * permissions rather than the role's rows, so it reads whatever the install
 * declares, and still cannot write.
 */
async function readOnlyKeyOwnedBySuperAdmin(): Promise<string> {
  const nextly = handle!.nextly as unknown as {
    users: {
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
  const apiKeys = handle!.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: { name: string; tokenType: string; expiresIn: string }
    ) => Promise<{ key: string; meta: { id: string } }>;
    resolveApiKeyPermissions: (
      tokenType: string,
      roleId: string | null,
      userId: string,
      keyId: string
    ) => Promise<string[]>;
  };
  const { key, meta } = await apiKeys.createApiKey(owner.item.id, {
    name: "the operator's own read-only key",
    tokenType: "read-only",
    expiresIn: "never",
  });
  const scope = await apiKeys.resolveApiKeyPermissions(
    "read-only",
    null,
    owner.item.id,
    meta.id
  );
  // Named here so an emptied scope fails by its cause rather than downstream
  // as a refusal that reads like the guard working.
  expect(scope, "the key must hold read-posts and nothing writable").toContain(
    "read-posts"
  );
  expect(scope.every(slug => slug.startsWith("read-"))).toBe(true);
  ownerId = owner.item.id;
  return key;
}

/**
 * A super-admin by INHERITANCE, which is what the canonical resolver answers
 * and a direct read of `user_roles` does not.
 *
 * An operator who gives a deputy a role built on top of Super Admin has made a
 * super-admin: `isSuperAdmin` resolves the inherited set, so the session
 * bypass, the admin's own checks and the key ceiling all agree they are one.
 * The key service asked its own narrower question for a while, and their key
 * took the ordinary branch — so the same person was a super-admin everywhere
 * except in the key they minted.
 *
 * Returns the catalogue permission their own role does NOT hold, which is the
 * only thing that separates the two branches: the role-rows branch cannot
 * produce it.
 */
async function readOnlyKeyOwnedByAnInheritedSuperAdmin(): Promise<{
  slugs: string[];
  ownerId: string;
  onlyInTheCatalogue: string;
}> {
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
      find: (a: { limit: number }) => Promise<{
        items: { id: string; slug: string }[];
      }>;
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };

  // The first user holds the seeded super-admin role directly, which is also
  // what puts that role in the table for the deputy's role to inherit.
  await nextly.users.create({
    data: {
      email: "first@example.com",
      password: "Password123!",
      name: "First",
      isActive: true,
    },
  });

  const roles = await nextly.roles.find({ limit: 200 });
  const superAdmin = roles.items.find(r => r.slug === "super-admin");
  expect(
    superAdmin,
    "the seeded super-admin role must exist, or nothing below inherits it"
  ).toBeDefined();

  const permissions = await nextly.permissions.find({ limit: 300 });
  const readPosts = permissions.items.find(p => p.slug === "read-posts");
  const readNotes = permissions.items.find(p => p.slug === "read-notes");
  expect(
    readPosts && readNotes,
    "both collections must have seeded their read permission"
  ).toBeTruthy();

  // Built ON TOP of Super Admin: one child role, so the service requires at
  // least one permission of its own, and `read-posts` is the one it gets.
  // `read-notes` is therefore in the catalogue and NOT in this role's rows.
  const deputy = await nextly.roles.create({
    data: {
      name: "Deputy",
      slug: "deputy",
      permissionIds: [readPosts!.id],
      childRoleIds: [superAdmin!.id],
    },
  });

  const owner = await nextly.users.create({
    data: {
      email: "deputy@example.com",
      password: "Password123!",
      name: "Deputy",
      isActive: true,
      roles: [deputy.item.id],
    },
  });

  const apiKeys = handle!.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: { name: string; tokenType: string; expiresIn: string }
    ) => Promise<{ key: string; meta: { id: string } }>;
    resolveApiKeyPermissions: (
      tokenType: string,
      roleId: string | null,
      userId: string,
      keyId: string
    ) => Promise<string[]>;
  };
  const { meta } = await apiKeys.createApiKey(owner.item.id, {
    name: "the deputy's read-only key",
    tokenType: "read-only",
    expiresIn: "never",
  });
  const slugs = await apiKeys.resolveApiKeyPermissions(
    "read-only",
    null,
    owner.item.id,
    meta.id
  );
  return {
    slugs,
    ownerId: owner.item.id,
    onlyInTheCatalogue: readNotes!.slug,
  };
}

describe("a super-admin by inheritance", () => {
  it("is one to the resolver every other gate asks", async () => {
    // The precondition, and the whole point: the deputy holds no `user_roles`
    // row naming super-admin, so a direct read of that table answers no here
    // while every gate in the codebase answers yes.
    const { ownerId } = await readOnlyKeyOwnedByAnInheritedSuperAdmin();
    expect(await isSuperAdmin(ownerId)).toBe(true);
  });

  it("mints a key that copies the catalogue, not their own role's rows", async () => {
    const { slugs, onlyInTheCatalogue } =
      await readOnlyKeyOwnedByAnInheritedSuperAdmin();
    expect(
      slugs,
      `a permission no role of theirs holds is the only thing the ordinary ` +
        `branch cannot produce; without it the key copied ${onlyInTheCatalogue}'s ` +
        `absence, which is the direct-user_roles read back`
    ).toContain(onlyInTheCatalogue);
  });

  it("still cannot write, so the inheritance widened nothing", async () => {
    const { slugs } = await readOnlyKeyOwnedByAnInheritedSuperAdmin();
    expect(slugs.every(slug => slug.startsWith("read-"))).toBe(true);
  });
});

describe("a super-admin's own read-only key", () => {
  it("reads through a plugin route, the way the operator's first key is used", async () => {
    const key = await readOnlyKeyOwnedBySuperAdmin();
    expect(
      await isSuperAdmin(ownerId),
      "the key's owner must be a super-admin, or this test proves nothing"
    ).toBe(true);

    const res = await post("read", { authorization: `Bearer ${key}` });
    expect(
      res.status,
      "a 401 would mean the key never reached the handler"
    ).not.toBe(401);
    const body = (await res.json()) as { read: boolean; reason?: string };
    expect(
      body.read,
      "a super-admin's read-only key holds the catalogue's read permissions; " +
        `a refusal here is the empty scope back: ${body.reason ?? ""}`
    ).toBe(true);
  });

  it("still cannot write: the catalogue is bounded by the key's kind", async () => {
    const key = await readOnlyKeyOwnedBySuperAdmin();
    const res = await post("write", { authorization: `Bearer ${key}` });
    expect(res.status).not.toBe(401);
    const body = (await res.json()) as { wrote: boolean };
    expect(
      body.wrote,
      "a read-only key wrote through a plugin route because its owner is a super-admin"
    ).toBe(false);
  });
});

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
