/**
 * A declared widget's cards through the real catch-all handler, the real
 * permission decision and real keys: `POST /api/dashboard/query` answering a
 * card asked for by widget and card id, the workspace payload describing the
 * widget, and the layout read's default.
 *
 * `widget-cards.test.ts` decides what a card entry is answered with against a
 * mocked layout and executor. Neither is the request path: the entry could be
 * answered right there and still reach a person it was never handed, read as
 * the system, or be told apart from a refusal by its bytes on the wire. These
 * are each observed here, on in-memory SQLite: two people are stored users,
 * and on PostgreSQL and MySQL a stored user stays behind between runs, so the
 * first one would no longer be the super admin these keys are minted by.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import { defineWidget } from "../../domains/widgets/declaration/define-widget";
import { settings } from "../../domains/widgets/declaration/setting-builders";
import { clearSources } from "../../domains/widgets/sources";
import { definePlugin } from "../../plugins/plugin-context";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services";
import { WidgetLayoutService } from "../../services/widgets/widget-layout-service";
import { sanitizeConfig } from "../../shared/types/config";

const ORDERS = "orders";
const NOTES = "notes";

const orders = defineCollection({
  slug: ORDERS,
  fields: [text({ name: "state" })],
});
const notes = defineCollection({
  slug: NOTES,
  fields: [text({ name: "title" })],
});

/**
 * The super admin's user, as a plain JavaScript data function could pass it:
 * a read that honoured it would read every order, whoever asked for the card.
 */
let ownerUser: { id: string } | undefined;

/** What each read the widgets below made reported, by the card it read for. */
let reads: { widget: string; signal: AbortSignal }[] = [];
/** Settled when the slow widget's data function has started. */
let slowStarted: () => void = () => {};
/** The signal the slow widget's data function was handed. */
let slowSignal: AbortSignal | undefined;

/** A card's slow data function, held until its card gives it up. */
async function untilGivenUp(signal: AbortSignal): Promise<{ total: number }> {
  slowSignal = signal;
  slowStarted();
  await new Promise<void>(resolve => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
  return { total: 0 };
}

const shop = definePlugin({
  name: "@test/shop",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [orders, notes],
    dashboard: {
      widgets: [
        // How many open orders, up to the card's number of items, read as the
        // person asking. Empty when there are none, with a gated action.
        defineWidget({
          id: "acme/open-orders",
          title: "Open orders",
          description: "Orders waiting to be sent",
          category: "Shop",
          size: { default: { w: 12, h: 3 }, min: { w: 6, h: 3 } },
          permission: `read-${ORDERS}`,
          settings: { items: settings.items({ default: 5 }) },
          data: async ({ settings: values, services, signal }) => {
            reads.push({ widget: "acme/open-orders", signal });
            const found = await services.find(ORDERS, {
              where: { state: { equals: "open" } },
              limit: values.items,
            });
            return { total: found.items.length };
          },
          display: "metric",
          empty: {
            when: data => data.total === 0,
            message: "No open orders",
            action: {
              label: "Add an order",
              link: `collections/${ORDERS}/create`,
              permission: `create-${ORDERS}`,
            },
          },
        }),
        // Placed on the strength of `read-notes` alone, and reads orders: a
        // read only the person's own grants can refuse, whatever it passes.
        defineWidget({
          id: "acme/notes-and-orders",
          title: "Notes and orders",
          description: "Orders beside the notes desk",
          category: "Shop",
          size: { default: { w: 12, h: 3 } },
          permission: `read-${NOTES}`,
          data: async ({ services }) => ({
            // Options a plain JavaScript caller may pass anyway. None of them
            // is read: the services are already bound to the person.
            total: await services.count(ORDERS, {
              overrideAccess: true,
              user: ownerUser,
              as: "system",
            } as unknown as Parameters<typeof services.count>[1]),
          }),
          display: "metric",
        }),
        defineWidget({
          id: "acme/slow",
          title: "Slow",
          description: "Answers only when given up",
          category: "Shop",
          size: { default: { w: 12, h: 3 } },
          permission: `read-${ORDERS}`,
          data: async ({ signal }) => untilGivenUp(signal),
          display: "metric",
        }),
      ],
    },
  },
});

/** The route module's stored config: the plugin list the payload projects. */
function handlers() {
  return createDynamicHandlers({
    config: sanitizeConfig({ collections: [], plugins: [shop] }),
  });
}

let handle: TestNextly | undefined;
/** The instance's first user: its super admin, who mints every role's grants. */
let ownerId: string | undefined;
/** A second person, holding exactly the role their key is minted with. */
let otherId: string | undefined;

beforeEach(async () => {
  reads = [];
  slowSignal = undefined;
  slowStarted = () => {};
  handle = await createTestNextly({ plugins: [shop] });
  clearSources();
  ownerId = await userNamed("owner");
  ownerUser = { id: ownerId };
  otherId = await userNamed("other");
});

afterEach(async () => {
  clearSources();
  await handle?.destroy();
  handle = undefined;
  ownerId = undefined;
  ownerUser = undefined;
  otherId = undefined;
});

/** Three open orders and one sent. */
async function seedOrders(): Promise<void> {
  for (const state of ["open", "open", "open", "sent"]) {
    await handle!.nextly.create({ collection: ORDERS, data: { state } });
  }
}

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
 * A key of `userId`'s holding exactly the grants named. A key may hold no more
 * than its owner does, so a person other than the super admin is given the
 * same role first.
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

/** Stores `userId`'s own dashboard: one card of each widget id given, by card id. */
async function placeFor(
  userId: string,
  cards: { id: string; widgetId: string; config?: Record<string, unknown> }[]
): Promise<void> {
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  await new WidgetLayoutService(handle!.adapter, silent).saveLayout(
    "user",
    userId,
    cards.map(card => ({ ...card, w: 12, h: 3, removed: false })),
    0
  );
}

/**
 * A signed-in person's session, as the admin's own requests carry it: the one
 * caller that may preview a card, since only a person may place one.
 */
async function sessionOf(userId: string): Promise<{ session: string }> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.com`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return { session: `nextly_session=${token}` };
}

/** Who asks: an API key's token, or a person's session cookie. */
type Asker = string | { session: string };

async function queryRequest(
  asker: Asker,
  queries: unknown[],
  init: { stream?: boolean; signal?: AbortSignal } = {}
): Promise<Response> {
  return handlers().POST(
    new Request("http://localhost/api/dashboard/query", {
      method: "POST",
      headers: {
        ...(typeof asker === "string"
          ? { authorization: `Bearer ${asker}` }
          : { cookie: asker.session }),
        "content-type": "application/json",
        ...(init.stream ? { accept: "application/x-ndjson" } : {}),
      },
      body: JSON.stringify({ queries }),
      ...(init.signal ? { signal: init.signal } : {}),
    }),
    { params: Promise.resolve({ params: ["dashboard", "query"] }) }
  );
}

/** The batch's slots, each as the bytes the JSON answer carries it in. */
async function slotBytes(asker: Asker, queries: unknown[]): Promise<string[]> {
  const res = await queryRequest(asker, queries);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { results: unknown[] };
  return body.results.map(slot => JSON.stringify(slot));
}

/** The streamed batch's slots, in their index order, each as its line carries it. */
async function streamedBytes(
  key: string,
  queries: unknown[]
): Promise<string[]> {
  const res = await queryRequest(key, queries, { stream: true });
  expect(res.status).toBe(200);
  const lines = (await res.text()).split("\n").filter(line => line !== "");
  const slots: string[] = [];
  for (const line of lines) {
    const { index, slot } = JSON.parse(line) as {
      index: number;
      slot: unknown;
    };
    slots[index] = JSON.stringify(slot);
  }
  return slots;
}

describe("a declared widget's card through POST /api/dashboard/query", () => {
  it("answers the person's own card with its stored settings, as that person", async () => {
    await seedOrders();
    await placeFor(ownerId!, [
      { id: "c-orders", widgetId: "acme/open-orders", config: { items: 2 } },
    ]);
    const key = await keyOf(ownerId!, [`read-${ORDERS}`]);

    const [slot] = await slotBytes(key, [
      { widget: "acme/open-orders", card: "c-orders" },
    ]);
    // Three orders are open and the card asks for at most two of them.
    expect(JSON.parse(slot)).toEqual({
      ok: true,
      result: { op: "count", total: 2 },
    });
  });

  it("previews a placed widget with settings of the reader's choosing", async () => {
    await seedOrders();
    await placeFor(ownerId!, [
      { id: "c-orders", widgetId: "acme/open-orders", config: { items: 2 } },
    ]);

    const [preview, stored] = await slotBytes(await sessionOf(ownerId!), [
      { widget: "acme/open-orders", settings: { items: 3 } },
      { widget: "acme/open-orders", card: "c-orders" },
    ]);
    expect(JSON.parse(preview)).toMatchObject({ result: { total: 3 } });
    // The stored card is untouched by the preview beside it.
    expect(JSON.parse(stored)).toMatchObject({ result: { total: 2 } });
  });

  it("previews nothing for an API key, which may place no card", async () => {
    // 🔴 A preview runs a data function with settings of the asker's choosing,
    // which is allowed because it stands in for placing the card. A key may
    // not write a layout at all, so it gets the one unavailable answer, with
    // its own stored card still answered beside it.
    await seedOrders();
    await placeFor(ownerId!, [
      { id: "c-orders", widgetId: "acme/open-orders", config: { items: 2 } },
    ]);
    const key = await keyOf(ownerId!, [`read-${ORDERS}`]);

    const [preview, stored, unknown] = await slotBytes(key, [
      { widget: "acme/open-orders", settings: { items: 3 } },
      { widget: "acme/open-orders", card: "c-orders" },
      { widget: "acme/open-orders", card: "c-nowhere" },
    ]);
    expect(JSON.parse(stored)).toMatchObject({ result: { total: 2 } });
    expect(JSON.parse(preview)).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    expect(preview).toBe(unknown);
    expect(preview).not.toContain('"total"');
  });

  it("answers another person's card, an unknown card and a mismatched widget with the same bytes", async () => {
    await seedOrders();
    await placeFor(ownerId!, [
      { id: "c-orders", widgetId: "acme/open-orders" },
      { id: "c-notes", widgetId: "acme/notes-and-orders" },
    ]);
    const ownerKey = await keyOf(ownerId!, [`read-${ORDERS}`, `read-${NOTES}`]);
    const otherKey = await keyOf(otherId!, [`read-${ORDERS}`]);

    const [theirs] = await slotBytes(otherKey, [
      { widget: "acme/open-orders", card: "c-orders" },
    ]);
    const [unknown, mismatched, gone, held] = await slotBytes(ownerKey, [
      { widget: "acme/open-orders", card: "c-nowhere" },
      { widget: "acme/open-orders", card: "c-notes" },
      { widget: "acme/not-declared", card: "c-orders" },
      { widget: "acme/open-orders", card: "c-orders" },
    ]);

    // The control: the card answers its own person, so the refusals below are
    // not a route that refuses every card.
    expect(JSON.parse(held)).toMatchObject({ ok: true });
    expect(JSON.parse(theirs)).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    expect(new Set([theirs, unknown, mismatched, gone]).size).toBe(1);
    // Nothing of the card the other person was refused ran for them.
    expect(
      reads.filter(read => read.widget === "acme/open-orders")
    ).toHaveLength(1);
  });

  it("refuses a data function's read the key does not hold, whatever options it passes", async () => {
    await seedOrders();
    // The owner is the super admin and may read every order; the key is
    // narrower, and the data function reads as the key's holder.
    await placeFor(ownerId!, [
      { id: "c-notes", widgetId: "acme/notes-and-orders" },
    ]);
    const narrow = await keyOf(ownerId!, [`read-${NOTES}`]);
    const both = await keyOf(ownerId!, [`read-${NOTES}`, `read-${ORDERS}`]);

    const [refused] = await slotBytes(narrow, [
      { widget: "acme/notes-and-orders", card: "c-notes" },
    ]);
    const [answered] = await slotBytes(both, [
      { widget: "acme/notes-and-orders", card: "c-notes" },
    ]);
    expect(JSON.parse(refused)).toMatchObject({ ok: false });
    expect(refused).not.toContain('"total"');
    // The control: the same card and the same options, for a key holding the
    // read, count all four orders.
    expect(JSON.parse(answered)).toEqual({
      ok: true,
      result: { op: "count", total: 4 },
    });
  });

  it("carries a card's empty verdict in the same bytes on either encoding", async () => {
    // No orders at all: the widget's own test says its answer is empty.
    await placeFor(ownerId!, [
      { id: "c-orders", widgetId: "acme/open-orders" },
    ]);
    const key = await keyOf(ownerId!, [`read-${ORDERS}`]);
    const asked = [{ widget: "acme/open-orders", card: "c-orders" }];

    const [json] = await slotBytes(key, asked);
    const [streamed] = await streamedBytes(key, asked);
    expect(JSON.parse(json)).toEqual({
      ok: true,
      empty: true,
      result: { op: "count", total: 0 },
    });
    expect(streamed).toBe(json);
  });
});

/** Settles with `settled`, or fails saying `why` after five seconds. */
function withinSeconds(settled: Promise<void>, why: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(why)), 5_000);
    settled.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

function abortOf(signal: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("a reader who leaves gives a declared card up", () => {
  it.each([
    ["the JSON answer", false],
    ["the streamed answer", true],
  ] as const)("through %s", async (_, stream) => {
    await placeFor(ownerId!, [{ id: "c-slow", widgetId: "acme/slow" }]);
    const key = await keyOf(ownerId!, [`read-${ORDERS}`]);
    const started = new Promise<void>(resolve => {
      slowStarted = resolve;
    });
    const reader = new AbortController();
    const answered = queryRequest(
      key,
      [{ widget: "acme/slow", card: "c-slow" }],
      { stream, signal: reader.signal }
    );
    // The stream answers at once and writes its slot later; the JSON answer
    // waits for the card, so only the stream's response is in hand here.
    const response = stream ? await answered : undefined;
    await withinSeconds(started, "the slow card's data function never ran");

    reader.abort();
    // Given up by the reader: the card's own budget is 30 seconds, so a card
    // still running five seconds after the reader left was not told.
    await withinSeconds(abortOf(slowSignal!), "the card was not given up");

    if (!stream) await answered.catch(() => undefined);
    await response?.body?.cancel().catch(() => undefined);
  });
});

interface WorkspaceWidget {
  id: string;
  serverData?: true;
  empty?: { message?: string; action?: { label: string } };
  [field: string]: unknown;
}

async function workspaceWidgets(key: string): Promise<WorkspaceWidget[]> {
  const res = await handlers().GET(
    new Request("http://localhost/api/admin-meta/workspace", {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: ["admin-meta", "workspace"] }) }
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { widgets?: WorkspaceWidget[] }).widgets ?? [];
}

describe("what the workspace payload and the layout read say of a declared widget", () => {
  it("describes the widget with neither its query nor its data, and its empty action only to who may take it", async () => {
    const reader = await keyOf(ownerId!, [`read-${ORDERS}`]);
    const writer = await keyOf(ownerId!, [
      `read-${ORDERS}`,
      `create-${ORDERS}`,
    ]);

    const asRead = (await workspaceWidgets(reader)).find(
      widget => widget.id === "acme/open-orders"
    );
    const asWritten = (await workspaceWidgets(writer)).find(
      widget => widget.id === "acme/open-orders"
    );
    expect(asRead).toMatchObject({
      serverData: true,
      empty: { message: "No open orders" },
    });
    // Withheld on the server: the payload is JSON, and reading it is the bypass.
    expect(asRead?.empty?.action).toBeUndefined();
    expect(asWritten?.empty?.action).toMatchObject({ label: "Add an order" });
    // Its data is built on the server, from the declaration the server holds.
    expect(asRead).not.toHaveProperty("query");
    expect(asRead).not.toHaveProperty("data");
    expect(JSON.stringify(asRead)).not.toContain("equals");
  });

  it("keeps declared widgets out of the default a reader follows, and offers them", async () => {
    const key = await keyOf(otherId!, [`read-${ORDERS}`, `read-${NOTES}`]);
    const res = await handlers().GET(
      new Request("http://localhost/api/dashboard/layout", {
        method: "GET",
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ params: ["dashboard", "layout"] }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      defaultPlacements: { widgetId: string }[];
      available: string[];
    };
    expect(body.source).toBe("default");
    // The control: the default is not empty, so the absence below is a choice.
    expect(body.defaultPlacements.length).toBeGreaterThan(0);
    expect(
      body.defaultPlacements.filter(p => p.widgetId.startsWith("acme/"))
    ).toEqual([]);
    expect(body.available).toEqual(
      expect.arrayContaining(["acme/open-orders", "acme/notes-and-orders"])
    );
  });
});
