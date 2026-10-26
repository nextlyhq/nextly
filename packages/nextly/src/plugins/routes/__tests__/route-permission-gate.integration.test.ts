/**
 * A computed `requiredPermission`, through the real catch-all dispatcher.
 *
 * The unit tests next door prove the slug is composed from the plugin's own
 * names. This proves the DISPATCHER uses it: that a caller without the grant is
 * refused at the door rather than inside the handler, that a caller holding it
 * gets through, and that a resolver which throws is answered as the server
 * fault it is (500) instead of falling through to the ungated path.
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
import { setNextlyLogger } from "../../../observability/logger";
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
        path: "/empty",
        // The quiet failure: a resolver that answers with nothing. It must
        // refuse exactly as a throw does — an empty slug is falsy, and falsy
        // is how the dispatcher spells "this route needs no permission".
        requiredPermission: () => "",
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
  sub: "write" | "read" | "empty" | "broken",
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
  setNextlyLogger(undefined);
});

/** The errors logged from here on, as the logger was handed them. */
function loggedErrors(): Record<string, unknown>[] {
  const errors: Record<string, unknown>[] = [];
  const ignore = () => {};
  setNextlyLogger({
    error: payload => errors.push(payload as Record<string, unknown>),
    warn: ignore,
    info: ignore,
    debug: ignore,
  });
  return errors;
}

/** The plugin route faults among `errors`. */
const routeFaults = (errors: Record<string, unknown>[]) =>
  errors.filter(entry => entry.kind === "plugin-route-error");

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

    const errors = loggedErrors();
    const res = await post("write", { authorization: `Bearer ${key}` });
    expect(res.status, "the key holds no `create-notes`").toBe(403);
    // The control for the logged faults below: refusing the caller is the
    // gate working, and is not logged as a fault.
    expect(routeFaults(errors)).toEqual([]);

    const body = (await res.json()) as { reached?: boolean };
    expect(
      body.reached,
      "the handler ran. The gate is meant to refuse BEFORE the handler, so an " +
        "unauthorized request does no work"
    ).not.toBe(true);
  });

  it("answers a server fault when the permission cannot be computed, rather than opening", async () => {
    const key = await readOnlyKey();

    const errors = loggedErrors();
    const res = await post("broken", { authorization: `Bearer ${key}` });
    const body = (await res.json()) as {
      reached?: boolean;
      error?: { code?: string };
    };

    expect(
      body.reached,
      "a resolver that threw let the request through. `requiredPermission` is " +
        "optional, so a swallowed failure reads as a route that needs no " +
        "permission — the gate opening the door it was written to close."
    ).not.toBe(true);
    // The plugin's fault, not the caller's: no grant could have been enough,
    // so the answer is not a 403 saying theirs fell short.
    expect(res.status, "a gate that cannot be computed is a server fault").toBe(
      500
    );
    expect(body.error?.code).toBe("INTERNAL_ERROR");
    // Logged for the operator, naming the plugin, the route and the cause:
    // the caller's 500 says nothing, so the log is where it can be fixed.
    expect(routeFaults(errors)).toEqual([
      expect.objectContaining({
        plugin: PLUGIN,
        logContext: expect.objectContaining({
          reason: "plugin-route-permission-unresolved",
        }),
        cause: expect.objectContaining({
          message: "cannot resolve this permission",
        }),
      }),
    ]);
  });

  it("answers a server fault for an EMPTY computed permission, rather than opening the route", async () => {
    const key = await readOnlyKey();

    const errors = loggedErrors();
    const res = await post("empty", { authorization: `Bearer ${key}` });
    const body = (await res.json()) as {
      reached?: boolean;
      error?: { code?: string };
    };

    expect(
      body.reached,
      'a resolver returning `""` let the request through. An empty slug is ' +
        "falsy, and falsy is how this dispatcher spells `no permission " +
        "required` — so the gate reported the route as ungated instead of " +
        "refusing, which is the failure opening the door."
    ).not.toBe(true);
    expect(res.status).toBe(500);
    expect(body.error?.code).toBe("INTERNAL_ERROR");
    // Logged as what it is, an empty permission, not as any failure to
    // resolve one: the reason the resolver's own error gave is kept.
    expect(routeFaults(errors)).toEqual([
      expect.objectContaining({
        plugin: PLUGIN,
        logMessage:
          "a route's requiredPermission resolved to an empty permission slug",
        logContext: expect.objectContaining({
          reason: "plugin-route-permission-unresolved",
          causeReason: "plugin-route-permission-empty",
        }),
      }),
    ]);
  });

  it("still answers the server fault when the logger itself fails", async () => {
    const key = await readOnlyKey();
    const ignore = () => {};
    setNextlyLogger({
      error: () => {
        throw new Error("the log is unreachable");
      },
      warn: ignore,
      info: ignore,
      debug: ignore,
    });

    const res = await post("broken", { authorization: `Bearer ${key}` });
    const body = (await res.json()) as { error?: { code?: string } };

    expect(res.status).toBe(500);
    expect(body.error?.code).toBe("INTERNAL_ERROR");
  });

  it("still refuses an unauthenticated caller", async () => {
    // Secure-by-default has not moved: the computed permission is in ADDITION
    // to authentication, not instead of it.
    const res = await post("read", {});
    expect(res.status).toBe(401);
  });
});
