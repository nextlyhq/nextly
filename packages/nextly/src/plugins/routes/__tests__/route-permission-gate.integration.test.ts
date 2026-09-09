/**
 * A computed `requiredPermission`, through the real catch-all dispatcher.
 *
 * The unit tests next door prove the slug is composed from the plugin's own
 * names. This proves the DISPATCHER uses it: that a caller without the grant is
 * refused at the door rather than inside the handler, that a caller holding it
 * gets through, and that a resolver which throws refuses instead of falling
 * through to the ungated path.
 *
 * That last one is the case worth the setup. `requiredPermission` is optional,
 * so "no permission" and "the permission could not be worked out" are one value
 * apart, and the failure that silently opens a route looks exactly like a route
 * that never had a gate.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createDynamicHandlers } from "../../../routeHandler";
import { definePlugin } from "../../plugin-context";
import { createTestNextly, type TestNextly } from "../../test-nextly";

const PLUGIN = "@test/route-permission";
const NOTES = "notes";

const notes = defineCollection({
  slug: NOTES,
  fields: [text({ name: "title" })],
});

const gatedPlugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [notes],
    routes: [
      {
        method: "POST",
        path: "/write",
        // Computed from the plugin's OWN collection, so the demanded grant
        // follows a host rename rather than naming a slug nobody was seeded.
        requiredPermission: ({ collection }) => collection(NOTES, "create"),
        handler: () => Response.json({ reached: true }),
      },
      {
        method: "POST",
        path: "/read",
        requiredPermission: ({ collection }) => collection(NOTES, "read"),
        handler: () => Response.json({ reached: true }),
      },
      {
        method: "POST",
        path: "/broken",
        // A resolver that cannot answer. The route must become uncallable, not
        // ungated.
        requiredPermission: () => {
          throw new Error("cannot resolve this permission");
        },
        handler: () => Response.json({ reached: true }),
      },
    ],
  },
});

function post(
  sub: "write" | "read" | "broken",
  headers: Record<string, string>
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const params = ["plugins", ...PLUGIN.split("/"), sub];
  return handlers.POST(
    new Request(`http://localhost/api/plugins/${PLUGIN}/${sub}`, {
      method: "POST",
      headers,
    }),
    { params: Promise.resolve({ params }) }
  );
}

let handle: TestNextly | undefined;

beforeEach(async () => {
  handle = await createTestNextly({
    collections: [],
    plugins: [gatedPlugin],
  });
});

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/** A key holding exactly `read-notes`, minted by the super-admin first user. */
async function readOnlyKey(): Promise<string> {
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
  const readNotes = permissions.items.find(p => p.slug === `read-${NOTES}`);
  expect(
    readNotes,
    `\`read-${NOTES}\` must be seeded, or the role below grants nothing and ` +
      "every refusal here is for the wrong reason"
  ).toBeDefined();

  const viewer = await nextly.roles.create({
    data: { name: "Viewer", slug: "viewer", permissionIds: [readNotes!.id] },
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
    ) => Promise<{ key: string }>;
  };

  const { key } = await apiKeys.createApiKey(owner.item.id, {
    name: "viewer key",
    tokenType: "role-based",
    roleId: viewer.item.id,
    expiresIn: "never",
  });
  return key;
}

describe("a route gated by a computed permission", () => {
  it("lets through a caller holding the grant it computed", async () => {
    // The control. Without it, the refusal below is equally consistent with a
    // gate that refuses everyone — which is what a resolver returning a slug
    // nobody holds would do, and is the exact failure this mechanism exists to
    // avoid.
    const key = await readOnlyKey();

    const res = await post("read", { authorization: `Bearer ${key}` });
    const body = (await res.json()) as { reached?: boolean };
    expect(
      body.reached,
      "the key holds `read-notes` and the route computed exactly that slug, " +
        "so this must reach the handler"
    ).toBe(true);
  });

  it("refuses a caller without the grant, at the door", async () => {
    const key = await readOnlyKey();

    const res = await post("write", { authorization: `Bearer ${key}` });
    expect(res.status, "the key holds no `create-notes`").toBe(403);

    const body = (await res.json()) as { reached?: boolean };
    expect(
      body.reached,
      "the handler ran. The gate is meant to refuse BEFORE the handler, so an " +
        "unauthorized request does no work"
    ).not.toBe(true);
  });

  it("refuses when the permission cannot be computed, rather than opening", async () => {
    const key = await readOnlyKey();

    const res = await post("broken", { authorization: `Bearer ${key}` });
    const body = (await res.json()) as { reached?: boolean };

    expect(
      body.reached,
      "a resolver that threw let the request through. `requiredPermission` is " +
        "optional, so a swallowed failure reads as a route that needs no " +
        "permission — the gate opening the door it was written to close."
    ).not.toBe(true);
    expect(res.status, "a gate that cannot be computed refuses").toBe(403);
  });

  it("still refuses an unauthenticated caller", async () => {
    // Secure-by-default has not moved: the computed permission is in ADDITION
    // to authentication, not instead of it.
    const res = await post("read", {});
    expect(res.status).toBe(401);
  });
});
