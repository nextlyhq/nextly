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
        handler: async (_req, ctx) => {
          try {
            const created = await ctx.services.collections.createEntry(
              "posts",
              { title: "written by a read-only key" },
              {
                as: "user",
                user: ctx.user ?? undefined,
                authenticatedScope: ctx.authenticatedScope,
              }
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
    ],
  },
});

function post(headers: Record<string, string>): Promise<Response> {
  const handlers = createDynamicHandlers();
  const url = `http://localhost/api/plugins/${PLUGIN}/write`;
  const params = ["plugins", ...PLUGIN.split("/"), "write"];
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

describe("a plugin route judges an API key on its own grants", () => {
  it("refuses a write from a read-only key minted by a super-admin", async () => {
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
    const ownerId = owner.item.id;

    // The precondition the whole test rests on. Asserted rather than assumed:
    // if the first user ever stopped being a super-admin, the assertion below
    // would pass because nothing was privileged, not because the key was
    // correctly refused — a green with the mechanism absent.
    expect(
      await isSuperAdmin(ownerId),
      "the owner must be a super-admin, or this test proves nothing"
    ).toBe(true);

    const apiKeys = handle!.getService("apiKeyService") as unknown as {
      createApiKey: (
        userId: string,
        input: { name: string; tokenType: string; expiresIn: string }
      ) => Promise<{ key: string; meta: { id: string } }>;
    };
    const { key } = await apiKeys.createApiKey(ownerId, {
      name: "read-only contractor key",
      tokenType: "read-only",
      expiresIn: "never",
    });

    const res = await post({ authorization: `Bearer ${key}` });

    // The key authenticated — this is not a 401 in disguise.
    expect(
      res.status,
      "a 401 would mean the key never reached the handler, so the write was " +
        "refused by authentication rather than by the key's scope"
    ).not.toBe(401);

    const body = (await res.json()) as { wrote: boolean };
    expect(
      body.wrote,
      "a read-only key wrote through a plugin route. Its owner is a " +
        "super-admin, so the access check resolved the OWNER rather than the " +
        "key's own grants."
    ).toBe(false);
  });

  it("still lets that key read, so the refusal is about the grant not the key", async () => {
    // The control. Without it, a key rejected for any reason at all — expired,
    // malformed, unrecognised — satisfies the assertion above identically to
    // one correctly held to a read-only scope.
    const nextly = handle!.nextly as unknown as {
      users: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    };
    const owner = await nextly.users.create({
      data: {
        email: "reader@example.com",
        password: "Password123!",
        name: "Reader",
        isActive: true,
      },
    });

    const apiKeys = handle!.getService("apiKeyService") as unknown as {
      createApiKey: (
        userId: string,
        input: { name: string; tokenType: string; expiresIn: string }
      ) => Promise<{ key: string; meta: { id: string } }>;
    };
    const { key } = await apiKeys.createApiKey(owner.item.id, {
      name: "read-only contractor key",
      tokenType: "read-only",
      expiresIn: "never",
    });

    const auth = handle!.getService("apiKeyService") as unknown as {
      authenticateApiKey: (raw: string) => Promise<unknown>;
    };
    const resolved = await auth.authenticateApiKey(key);
    expect(
      resolved,
      "the key must authenticate, or the refusal above is about the key " +
        "being unusable rather than about its scope"
    ).toBeTruthy();
  });
});
