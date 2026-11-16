/**
 * The storefront's REST routes through Nextly's real request handler, on every
 * configured dialect.
 *
 * `createDynamicHandlers` is what a site mounts, so a request here passes the
 * same dispatcher, rate limiter and error boundary a shopper's does. What
 * these pin is the contract a storefront calls: the cookie the cart lives
 * behind, the CSRF check on every write, the fixed shapes of every answer,
 * and that nothing in a request but the cookie reaches a cart.
 *
 * The routes' write allowance is counted per process, so this suite raises
 * it; the refusal past the default has a file of its own.
 *
 * @module storefront/routes.integration.test
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import type { CatalogueItem } from "../contracts/catalogue-source";
import { money } from "../money/money";
import { commerce, type CommerceOptions } from "../plugin";
import { carts } from "../schema/tables";
import { createInMemoryCatalogueSource } from "../testing/in-memory-catalogue-source";

import { commerceServer, commerceServices } from "./server";

const ORIGIN = "http://localhost";
const BASE = `${ORIGIN}/api/plugins/@nextlyhq/plugin-commerce`;
const CSRF = "a".repeat(64);

const ITEMS: CatalogueItem[] = [
  {
    reference: "drill",
    name: "Drill press",
    sku: "DP-1",
    price: { kind: "listed", unitPrice: money(12_900, "USD") },
    stock: { kind: "counted", available: 4 },
  },
  {
    reference: "bolt",
    name: "Bolt",
    price: { kind: "listed", unitPrice: money(25, "USD") },
    stock: { kind: "untracked" },
  },
  {
    reference: "kit/blue",
    name: "Blue kit",
    price: { kind: "listed", unitPrice: money(1_000, "USD") },
    stock: { kind: "untracked" },
  },
  {
    reference: "rig",
    name: "Custom rig",
    price: { kind: "on-request" },
    stock: { kind: "untracked" },
  },
];

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface Call {
  /** The cart cookie's value to send, if any. */
  readonly cart?: string;
  /** Send a matching CSRF cookie and header (the default for writes). */
  readonly csrf?: boolean;
  /** The `Origin` header; the site's own by default. */
  readonly origin?: string;
  readonly body?: unknown;
}

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly setCookie: string | null;
  readonly cacheControl: string | null;
}

/**
 * A request's headers: the cart cookie when there is one, and for a write the
 * site's own origin and a matching CSRF cookie and header unless the call
 * says otherwise.
 */
function headersFor(method: Method, options: Call): Headers {
  const headers = new Headers();
  const write = method !== "GET";
  const sendCsrf = write && options.csrf !== false;
  const cookies = [
    ...(options.cart === undefined ? [] : [`commerce-cart=${options.cart}`]),
    ...(sendCsrf ? [`nextly_csrf=${CSRF}`] : []),
  ];
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
  if (sendCsrf) headers.set("x-csrf-token", CSRF);
  if (write) headers.set("origin", options.origin ?? ORIGIN);
  if (options.body !== undefined)
    headers.set("content-type", "application/json");
  return headers;
}

/** The cart token a `Set-Cookie` value carries. */
function tokenIn(setCookie: string | null): string {
  const match = /^commerce-cart=([A-Za-z0-9_-]{43});/.exec(setCookie ?? "");
  if (!match?.[1]) throw new Error(`no cart token in ${String(setCookie)}`);
  return match[1];
}

describe.each(getConfiguredTestDialects())(
  "the storefront routes (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(
      options: Partial<CommerceOptions> = {}
    ): Promise<PluginContext> {
      const plugin = commerce({
        currency: "USD",
        // The writes of every case on every dialect share one process's
        // count; the default allowance is the rate-limit suite's to test.
        cartWriteLimit: { max: 10_000, windowMs: 60_000 },
        catalogue: createInMemoryCatalogueSource({
          currency: "USD",
          items: ITEMS,
        }).source,
        ...options,
      });
      const init = plugin.init;
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          {
            ...plugin,
            init: async ctx => {
              captured = ctx;
              await init?.(ctx);
            },
          },
        ],
      });
      if (!captured) throw new Error("commerce's init did not run");
      return captured;
    }

    async function call(
      method: Method,
      path: string,
      options: Call = {}
    ): Promise<Answer> {
      const url = new URL(`${BASE}${path}`);
      const request = new Request(url, {
        method,
        headers: headersFor(method, options),
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
      const segments = url.pathname.split("/").filter(Boolean).slice(1);
      const response = await createDynamicHandlers()[method](request, {
        params: Promise.resolve({ params: segments }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
        setCookie: response.headers.get("set-cookie"),
        cacheControl: response.headers.get("cache-control"),
      };
    }

    /** Add a line as a new shopper, and hand back their cart token. */
    async function newShopper(
      reference: string,
      quantity = 1
    ): Promise<string> {
      const added = await call("POST", "/cart/lines", {
        body: { reference, quantity },
      });
      expect(added.status).toBe(200);
      return tokenIn(added.setCookie);
    }

    it("answers a shopper with no cart, makes none and sets no cookie", async () => {
      const ctx = await boot();
      const read = await call("GET", "/cart");
      expect(read.status).toBe(200);
      expect(read.body).toEqual({
        currency: "USD",
        lines: [],
        itemCount: 0,
        subtotal: { amount: 0, currency: "USD" },
        expiresAt: null,
      });
      expect(read.setCookie).toBeNull();
      expect(read.cacheControl).toContain("no-store");
      expect(await ctx.db.select(carts).all()).toEqual([]);
    });

    it("adds a line behind a lasting, HTTP-only, same-site cookie", async () => {
      await boot();
      const added = await call("POST", "/cart/lines", {
        body: { reference: "drill", quantity: 2 },
      });
      expect(added.status).toBe(200);
      expect(added.cacheControl).toContain("no-store");
      expect(added.setCookie).toMatch(
        /^commerce-cart=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=259(1|2)\d{3}; HttpOnly; SameSite=Lax$/
      );
      expect(added.body.message).toBe("Added to the cart.");
      expect(added.body.item).toMatchObject({
        lines: [
          { reference: "drill", quantity: 2, lineTotal: { amount: 25_800 } },
        ],
      });

      const token = tokenIn(added.setCookie);
      const read = await call("GET", "/cart", { cart: token });
      expect(read.body).toMatchObject({
        itemCount: 2,
        subtotal: { amount: 25_800, currency: "USD" },
      });
      expect(read.setCookie).toBeNull();
    });

    it("refuses a write without the CSRF token, or from another site, and changes nothing", async () => {
      const ctx = await boot();
      for (const options of [
        { csrf: false },
        { origin: "https://elsewhere.example" },
      ] satisfies Call[]) {
        const refused = await call("POST", "/cart/lines", {
          ...options,
          body: { reference: "drill", quantity: 1 },
        });
        expect(refused.status).toBe(403);
        expect(refused.body).toMatchObject({ error: { code: "CSRF_FAILED" } });
        expect(refused.setCookie).toBeNull();
      }
      const token = await newShopper("drill");
      const refused = await call("DELETE", "/cart", {
        cart: token,
        csrf: false,
      });
      expect(refused.status).toBe(403);
      expect(await ctx.db.select(carts).all()).toHaveLength(1);
      expect((await call("GET", "/cart", { cart: token })).body.itemCount).toBe(
        1
      );
    });

    it("prices from the catalogue, never from a price the browser sent", async () => {
      await boot();
      const added = await call("POST", "/cart/lines", {
        body: {
          reference: "drill",
          quantity: 1,
          price: 1,
          unitPrice: { amount: 1, currency: "USD" },
          seenUnitPriceAmount: 1,
          subtotal: { amount: 1, currency: "USD" },
        },
      });
      expect(added.status).toBe(200);
      expect(added.body.item).toMatchObject({
        lines: [
          {
            unitPrice: { amount: 12_900, currency: "USD" },
            seenUnitPrice: { amount: 12_900, currency: "USD" },
          },
        ],
        subtotal: { amount: 12_900, currency: "USD" },
      });
    });

    it("reaches no other shopper's cart through any parameter", async () => {
      const ctx = await boot();
      const owner = await newShopper("drill");
      const [ownerCart] = await ctx.db.select(carts).all();
      const ownerId = ownerCart?.id ?? "";
      const other = await newShopper("bolt");

      // The owner's cart id, offered every way a request can carry it, with
      // the other shopper's cookie.
      const crafted = `?cartId=${ownerId}&cart=${ownerId}&token=${owner}`;
      await call("POST", `/cart/lines${crafted}`, {
        cart: other,
        body: { reference: "bolt", quantity: 1, cartId: ownerId, token: owner },
      });
      await call("DELETE", `/cart${crafted}`, {
        cart: other,
        body: { cartId: ownerId },
      });
      const readAs = await call("GET", `/cart${crafted}`, { cart: other });
      expect(readAs.body).toMatchObject({ lines: [] });

      const ownerView = await call("GET", "/cart", { cart: owner });
      expect(ownerView.body).toMatchObject({
        lines: [{ reference: "drill", quantity: 1 }],
      });
    });

    it("answers in fixed shapes", async () => {
      await boot();
      const added = await call("POST", "/cart/lines", {
        body: { reference: "drill", quantity: 1 },
      });
      expect(Object.keys(added.body).sort()).toEqual(["item", "message"]);
      const cart = added.body.item as Record<string, unknown>;
      expect(Object.keys(cart).sort()).toEqual([
        "currency",
        "expiresAt",
        "itemCount",
        "lines",
        "subtotal",
      ]);
      const [line] = cart.lines as Record<string, unknown>[];
      expect(Object.keys(line ?? {}).sort()).toEqual([
        "availability",
        "lineTotal",
        "name",
        "priceChanged",
        "quantity",
        "reference",
        "seenUnitPrice",
        "sku",
        "unitPrice",
      ]);

      const found = await call("GET", "/catalogue/items?reference=drill");
      const [item] = found.body.items as Record<string, unknown>[];
      expect(Object.keys(item ?? {}).sort()).toEqual([
        "name",
        "price",
        "reference",
        "sku",
        "stock",
      ]);
    });

    it("changes, removes and empties lines, a reference with a slash included", async () => {
      await boot();
      const token = await newShopper("kit/blue", 2);
      await call("POST", "/cart/lines", {
        cart: token,
        body: { reference: "bolt", quantity: 1 },
      });

      const set = await call("PATCH", "/cart/lines", {
        cart: token,
        body: { reference: "bolt", quantity: 7 },
      });
      expect(set.status).toBe(200);
      expect(set.body.message).toBe("Cart updated.");

      const removed = await call(
        "DELETE",
        `/cart/lines?reference=${encodeURIComponent("kit/blue")}`,
        { cart: token }
      );
      expect(removed.status).toBe(200);
      expect(removed.body.item).toMatchObject({
        lines: [{ reference: "bolt", quantity: 7 }],
      });

      const emptied = await call("DELETE", "/cart", { cart: token });
      expect(emptied.body).toMatchObject({
        message: "Cart emptied.",
        item: { lines: [], itemCount: 0 },
      });
    });

    it("says why a line is refused, in core's error shape", async () => {
      await boot();
      const unknown = await call("POST", "/cart/lines", {
        body: { reference: "no-such-item", quantity: 1 },
      });
      expect(unknown.status).toBe(404);
      expect(unknown.body).toMatchObject({
        error: { code: "COMMERCE_ITEM_NOT_FOUND" },
      });

      const onRequest = await call("POST", "/cart/lines", {
        body: { reference: "rig", quantity: 1 },
      });
      expect(onRequest.status).toBe(409);
      expect(onRequest.body).toMatchObject({
        error: { code: "COMMERCE_PRICE_ON_REQUEST" },
      });

      for (const body of [
        { reference: "drill", quantity: "2" },
        { reference: "drill" },
        { reference: "drill", quantity: 0 },
        "not an object",
      ]) {
        const invalid = await call("POST", "/cart/lines", { body });
        expect(invalid.status).toBe(400);
        expect(invalid.body).toMatchObject({
          error: { code: "VALIDATION_ERROR" },
        });
      }
    });

    it("refuses a body far larger than any cart request before reading it whole, and makes no cart", async () => {
      const ctx = await boot();
      const refused = await call("POST", "/cart/lines", {
        body: {
          reference: "drill",
          quantity: 1,
          padding: "x".repeat(32 * 1024),
        },
      });
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          data: { errors: [{ code: "too_large" }] },
        },
      });
      expect(refused.setCookie).toBeNull();
      expect(await ctx.db.select(carts).all()).toEqual([]);
    });

    it("looks items up and lists the catalogue a page at a time", async () => {
      await boot();
      const found = await call(
        "GET",
        "/catalogue/items?reference=bolt&reference=no-such-item&reference=drill"
      );
      expect(found.status).toBe(200);
      expect(found.cacheControl).toContain("no-store");
      expect(
        (found.body.items as { reference: string }[]).map(i => i.reference)
      ).toEqual(["bolt", "drill"]);
      expect(found.body.meta).toMatchObject({
        total: 2,
        page: 1,
        hasNext: false,
      });

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const query: string =
          cursor === null
            ? "?limit=2"
            : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
        const listed = await call("GET", `/catalogue${query}`);
        expect(listed.status).toBe(200);
        const body = listed.body as {
          items: { reference: string }[];
          nextCursor: string | null;
        };
        seen.push(...body.items.map(i => i.reference));
        cursor = body.nextCursor;
        if (cursor === null) break;
      }
      expect(seen.sort()).toEqual(ITEMS.map(i => i.reference).sort());

      const tooMany = await call("GET", "/catalogue?limit=101");
      expect(tooMany.status).toBe(400);
    });

    it("offers the same cart through the typed server functions", async () => {
      const ctx = await boot();
      const fromRoute = await newShopper("drill");

      const server = await commerceServer();
      const added = await server.cart.add({
        token: fromRoute,
        reference: "bolt",
        quantity: 3,
      });
      expect(added.cookie).toMatchObject({ action: "set", token: fromRoute });
      const viaRoute = await call("GET", "/cart", { cart: fromRoute });
      expect(viaRoute.body).toEqual(added.cart);

      const viaContext = commerceServices(ctx);
      expect(
        (await viaContext.catalogue.find({ references: ["drill"] })).map(
          i => i.name
        )
      ).toEqual(["Drill press"]);
    });

    it("sells from its own products collection when the site names no catalogue", async () => {
      const plugin = commerce({ currency: "USD" });
      expect(plugin.contributes?.collections?.map(c => c.slug)).toEqual([
        "products",
      ]);
      expect(
        commerce({
          currency: "USD",
          catalogue: createInMemoryCatalogueSource({
            currency: "USD",
            items: ITEMS,
          }).source,
        }).contributes?.collections
      ).toEqual([]);

      const ctx = await boot({ catalogue: undefined });
      const { item } = await ctx.services.collections.createEntry(
        "products",
        { name: "Lathe", price: 99_500, stockKind: "one-off", stockCount: 1 },
        { as: "system" }
      );
      const added = await call("POST", "/cart/lines", {
        body: { reference: item.id, quantity: 1 },
      });
      expect(added.status).toBe(200);
      expect(added.body.item).toMatchObject({
        lines: [
          {
            reference: item.id,
            name: "Lathe",
            unitPrice: { amount: 99_500, currency: "USD" },
            availability: { kind: "in-stock", available: 1 },
          },
        ],
      });
      const twice = await call("POST", "/cart/lines", {
        cart: tokenIn(added.setCookie),
        body: { reference: item.id, quantity: 1 },
      });
      expect(twice.body).toMatchObject({
        error: { code: "COMMERCE_QUANTITY_NOT_ALLOWED" },
      });
    });
  }
);
