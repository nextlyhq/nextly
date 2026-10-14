/**
 * The checkout routes through Nextly's real request handler, on every
 * configured dialect: what a storefront calls to quote a cart and to turn it
 * into an order.
 *
 * @module checkout/checkout-routes.integration.test
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
import { commerce } from "../plugin";
import { carts, orders } from "../schema/tables";
import { createInMemoryCatalogueSource } from "../testing/in-memory-catalogue-source";
import { createTestPaymentProvider } from "../testing/test-payment-provider";
import { recordJobRun } from "../work/job-health";

import { WORK_JOB } from "./checkout-service";

const ORIGIN = "http://localhost";
const BASE = `${ORIGIN}/api/plugins/@nextlyhq/plugin-commerce`;
const CSRF = "c".repeat(64);

const ITEMS: CatalogueItem[] = [
  {
    reference: "drill",
    name: "Drill press",
    price: { kind: "listed", unitPrice: money(12_900, "USD") },
    stock: { kind: "counted", available: 4 },
  },
];

const ADDRESSES = {
  shipping: {
    name: "Ada Lovelace",
    line1: "1 Main Street",
    city: "Lahore",
    country: "PK",
  },
};

type Method = "GET" | "POST" | "PATCH" | "DELETE";

describe.each(getConfiguredTestDialects())(
  "the checkout routes (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(options: { jobsRan?: boolean } = {}) {
      const plugin = commerce({
        currency: "USD",
        catalogue: createInMemoryCatalogueSource({
          currency: "USD",
          items: ITEMS,
        }).source,
        payments: createTestPaymentProvider().provider,
        cartWriteLimit: { max: 10_000, windowMs: 60_000 },
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
      if (options.jobsRan !== false) {
        await recordJobRun(captured.db, captured.dialect, WORK_JOB, new Date());
      }
      return captured;
    }

    async function call(
      method: Method,
      path: string,
      options: { cart?: string; csrf?: boolean; body?: unknown } = {}
    ) {
      const url = new URL(`${BASE}${path}`);
      const headers = new Headers({ origin: ORIGIN });
      const cookies = [
        ...(options.cart ? [`commerce-cart=${options.cart}`] : []),
        ...(options.csrf === false ? [] : [`nextly_csrf=${CSRF}`]),
      ];
      if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
      if (options.csrf !== false) headers.set("x-csrf-token", CSRF);
      if (options.body !== undefined)
        headers.set("content-type", "application/json");
      const response = await createDynamicHandlers()[method](
        new Request(url, {
          method,
          headers,
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
        }),
        {
          params: Promise.resolve({
            params: url.pathname.split("/").filter(Boolean).slice(1),
          }),
        }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
        setCookie: response.headers.get("set-cookie"),
      };
    }

    async function shopper(quantity = 1): Promise<string> {
      const added = await call("POST", "/cart/lines", {
        body: { reference: "drill", quantity },
      });
      const token = /^commerce-cart=([A-Za-z0-9_-]{43});/.exec(
        added.setCookie ?? ""
      )?.[1];
      if (!token) throw new Error("no cart token");
      return token;
    }

    it("quotes and completes a checkout in fixed shapes, from the server's own figures", async () => {
      const ctx = await boot();
      const token = await shopper(2);
      const quote = await call("POST", "/checkout/quote", { cart: token });
      expect(quote.status).toBe(200);
      expect(Object.keys(quote.body).sort()).toEqual([
        "currency",
        "lines",
        "quoteKey",
        "subtotal",
        "total",
      ]);

      const completed = await call("POST", "/checkout/complete", {
        cart: token,
        body: {
          quoteKey: quote.body.quoteKey,
          email: "ada@example.com",
          addresses: ADDRESSES,
          // A browser's own figures and another cart's id, all ignored.
          total: { amount: 1, currency: "USD" },
          unitPrice: 1,
          cartId: "someone-elses-cart",
        },
      });
      expect(completed.status).toBe(200);
      expect(Object.keys(completed.body).sort()).toEqual(["item", "message"]);
      const item = completed.body.item as {
        order: Record<string, unknown>;
        payment: Record<string, unknown>;
      };
      expect(Object.keys(item).sort()).toEqual(["order", "payment"]);
      expect(Object.keys(item.order).sort()).toEqual([
        "currency",
        "email",
        "expiresAt",
        "lines",
        "number",
        "status",
        "subtotal",
        "total",
      ]);
      expect(Object.keys(item.payment).sort()).toEqual([
        "clientData",
        "reference",
        "status",
      ]);
      expect(item.order.total).toEqual({ amount: 25_800, currency: "USD" });
      expect(await ctx.db.select(orders).all()).toHaveLength(1);
    });

    it("refuses a checkout without the CSRF token, and creates nothing", async () => {
      const ctx = await boot();
      const token = await shopper();
      const refusedQuote = await call("POST", "/checkout/quote", {
        cart: token,
        csrf: false,
      });
      expect(refusedQuote.status).toBe(403);
      const quote = await call("POST", "/checkout/quote", { cart: token });
      const refused = await call("POST", "/checkout/complete", {
        cart: token,
        csrf: false,
        body: {
          quoteKey: quote.body.quoteKey,
          email: "ada@example.com",
          addresses: ADDRESSES,
        },
      });
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ error: { code: "CSRF_FAILED" } });
      expect(await ctx.db.select(orders).all()).toEqual([]);
    });

    it("answers 503 while the jobs have never run, and creates nothing", async () => {
      const ctx = await boot({ jobsRan: false });
      const token = await shopper();
      const quote = await call("POST", "/checkout/quote", { cart: token });
      const refused = await call("POST", "/checkout/complete", {
        cart: token,
        body: {
          quoteKey: quote.body.quoteKey,
          email: "ada@example.com",
          addresses: ADDRESSES,
        },
      });
      expect(refused.status).toBe(503);
      expect(refused.body).toMatchObject({
        error: { code: "COMMERCE_JOBS_NOT_RUNNING" },
      });
      expect(await ctx.db.select(orders).all()).toEqual([]);
      // The cart is untouched, and still checks out once the jobs run.
      expect(await ctx.db.select(carts).all()).toMatchObject([
        { checkedOutAt: null },
      ]);
    });

    it("refuses to quote or complete with no cart, in core's error shape", async () => {
      await boot();
      const quote = await call("POST", "/checkout/quote");
      expect(quote.status).toBe(409);
      expect(quote.body).toMatchObject({
        error: { code: "COMMERCE_CART_EMPTY" },
      });
    });
  }
);
