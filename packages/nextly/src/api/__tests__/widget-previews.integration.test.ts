/**
 * The development preview read through the real catch-all handler, the real
 * permission decision and real keys: `GET /api/_dev/widget-previews`.
 *
 * Two properties, each only observable on the request path. In development
 * the read answers each reader with the widgets the dashboard would offer
 * them, so a reader lacking a widget's permission is not sent it, its cases
 * included. Anywhere else the answer is byte for byte the router's answer to
 * a path it does not serve, so nothing on the wire says the read exists; and
 * the workspace payload, which decides whether the admin registers the page,
 * says the same thing the read does in each runtime.
 *
 * In-memory SQLite: a second person is a stored user, and on PostgreSQL and
 * MySQL a stored user stays behind between runs, so the first one would no
 * longer be the super admin these keys are minted by.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { defineWidget } from "../../domains/widgets/declaration/define-widget";
import { clearSources } from "../../domains/widgets/sources";
import { definePlugin } from "../../plugins/plugin-context";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import { _recordRegisteredLocalizationForTest } from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services";
import { sanitizeConfig } from "../../shared/types/config";

const ORDERS = "orders";
const NOTES = "notes";

/** Counts every data function run, which the read must never cause. */
let loads = 0;

const shop = definePlugin({
  name: "@test/preview-shop",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [
      defineCollection({ slug: ORDERS, fields: [text({ name: "state" })] }),
      defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
    ],
    dashboard: {
      widgets: [
        // Offered only to a reader who may read orders.
        defineWidget({
          id: "acme/open-orders",
          title: "Open orders",
          description: "Orders waiting to be sent",
          size: { default: { w: 4, h: 2 } },
          access: `read-${ORDERS}`,
          load: async () => {
            loads += 1;
            return { total: 1 };
          },
          view: "figure",
          preview: [{ name: "Secret busy day", data: { total: 9001 } }],
        }),
        // Offered to everyone who can open the dashboard.
        defineWidget({
          id: "acme/welcome",
          title: "Welcome",
          description: "A figure for everyone",
          size: { default: { w: 4, h: 2 } },
          load: async () => {
            loads += 1;
            return { total: 1 };
          },
          view: "figure",
          preview: [{ name: "Hello", data: { total: 1 } }],
        }),
      ],
    },
  },
});

/** The route module's stored config: the plugin list the payload projects. */
const ROUTE_CONFIG = sanitizeConfig({ collections: [], plugins: [shop] });

function handlers() {
  return createDynamicHandlers({ config: ROUTE_CONFIG });
}

let handle: TestNextly | undefined;
let ownerId: string | undefined;

beforeEach(async () => {
  loads = 0;
  handle = await createTestNextly({ plugins: [shop] });
  // The services were registered from this config, as a development server's
  // own boot records. Unrecorded, the first development request reads the
  // config as edited since boot and registers the services again, against a
  // database of its own, which is not the one these keys live in.
  _recordRegisteredLocalizationForTest(ROUTE_CONFIG);
  clearSources();
  ownerId = await userNamed("owner");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  clearSources();
  await handle?.destroy();
  handle = undefined;
  ownerId = undefined;
});

async function userNamed(name: string): Promise<string> {
  const nextly = handle!.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };
  const created = await nextly.users.create({
    data: {
      email: `${name}@example.com`,
      password: "Password123!",
      name,
      isActive: true,
    },
  });
  return created.item.id;
}

/**
 * A key of `userId`'s holding exactly the grants named, its owner given the
 * same role first when they are not the super admin.
 */
async function keyOf(userId: string, slugs: string[]): Promise<string> {
  const nextly = handle!.nextly as unknown as {
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
  const permissions = await nextly.permissions.find({ limit: 300 });
  const ids = slugs.map(slug => {
    const found = permissions.items.find(p => p.slug === slug);
    expect(
      found,
      `\`${slug}\` must be seeded, or the role grants nothing and a refusal ` +
        "here is for the wrong reason"
    ).toBeDefined();
    return found!.id;
  });
  const role = await nextly.roles.create({
    data: {
      name: `Role ${userId} ${slugs.join(" ")}`,
      slug: `r-${userId.slice(0, 8)}-${slugs.join("-")}`,
      permissionIds: ids,
    },
  });
  if (userId !== ownerId) {
    const assigned = await new ServiceContainer(
      handle!.adapter
    ).userRoles.assignRoleToUser(userId, role.item.id);
    expect(assigned.success).toBe(true);
  }
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
  const { key } = await apiKeys.createApiKey(userId, {
    name: `key ${slugs.join(" ")}`,
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return key;
}

/** A GET through the catch-all, as `segments`, with `key` when given. */
function get(segments: string[], key?: string): Promise<Response> {
  return handlers().GET(
    new Request(`http://localhost/api/${segments.join("/")}`, {
      method: "GET",
      headers: key === undefined ? {} : { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: segments }) }
  );
}

const PREVIEWS = ["_dev", "widget-previews"];
/** A path under the same prefix that no runtime serves. */
const UNKNOWN = ["_dev", "no-such-read"];

interface PreviewBody {
  items: { id: string; preview: { name: string }[] }[];
  meta: { total: number };
}

async function previewIds(key: string): Promise<string[]> {
  const res = await get(PREVIEWS, key);
  expect(res.status).toBe(200);
  const body = (await res.json()) as PreviewBody;
  return body.items.map(item => item.id);
}

describe("GET /api/_dev/widget-previews in development", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  it("lists each widget the reader may see, with its cases, in the list envelope", async () => {
    const res = await get(PREVIEWS, await keyOf(ownerId!, [`read-${ORDERS}`]));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as PreviewBody;
    const ours = body.items.filter(item => item.id.startsWith("acme/"));
    expect(ours).toEqual([
      expect.objectContaining({
        id: "acme/open-orders",
        preview: [expect.objectContaining({ name: "Secret busy day" })],
      }),
      expect.objectContaining({
        id: "acme/welcome",
        preview: [expect.objectContaining({ name: "Hello" })],
      }),
    ]);
    expect(body.meta.total).toBe(body.items.length);
    // Drawing a case runs nothing of the widget's.
    expect(loads).toBe(0);
  });

  it("leaves out a widget whose permission the reader lacks, its cases with it", async () => {
    const reader = await keyOf(await userNamed("reader"), [`read-${NOTES}`]);
    const res = await get(PREVIEWS, reader);
    expect(res.status).toBe(200);
    const text = await res.text();
    const ids = (JSON.parse(text) as PreviewBody).items.map(item => item.id);
    // The control: the same reader is sent the ungated widget, so the absence
    // below is the gate's, not an answer that lists nothing.
    expect(ids).toContain("acme/welcome");
    expect(ids).not.toContain("acme/open-orders");
    expect(text).not.toContain("Secret busy day");
    // And a reader holding the grant is sent it.
    expect(
      await previewIds(await keyOf(ownerId!, [`read-${ORDERS}`]))
    ).toContain("acme/open-orders");
  });

  it("refuses a caller with no credential before reading anything", async () => {
    const res = await get(PREVIEWS);
    expect(res.status).toBe(401);
  });

  it("tells the admin the page exists in the workspace payload", async () => {
    const res = await get(
      ["admin-meta", "workspace"],
      await keyOf(ownerId!, [`read-${NOTES}`])
    );
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { widgetPreviews?: boolean }).widgetPreviews
    ).toBe(true);
  });
});

describe("GET /api/_dev/widget-previews outside development", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  it("answers exactly as the router answers a path it does not serve", async () => {
    const key = await keyOf(ownerId!, [`read-${ORDERS}`]);
    const asked = await get(PREVIEWS, key);
    const unknown = await get(UNKNOWN, key);
    // 🔴 The whole answer, not a status alone: a gate that refused with its
    // own not-found would match a status check and still say the read exists.
    expect(asked.status).toBe(unknown.status);
    expect(asked.status).not.toBe(200);
    expect(asked.headers.get("content-type")).toBe(
      unknown.headers.get("content-type")
    );
    const body = await asked.text();
    expect(body).toBe(await unknown.text());
    expect(body).not.toContain("acme/welcome");
    expect(loads).toBe(0);
  });

  it("answers a caller with no credential as it answers one for an unknown path", async () => {
    const asked = await get(PREVIEWS);
    const unknown = await get(UNKNOWN);
    expect(asked.status).toBe(unknown.status);
    expect(await asked.text()).toBe(await unknown.text());
  });

  it("tells the admin the page does not exist", async () => {
    const res = await get(
      ["admin-meta", "workspace"],
      await keyOf(ownerId!, [`read-${NOTES}`])
    );
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { widgetPreviews?: boolean }).widgetPreviews
    ).toBe(false);
  });
});
