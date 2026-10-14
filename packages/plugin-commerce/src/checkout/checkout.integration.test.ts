/**
 * Checkout over commerce's own tables, on every configured dialect: a cart
 * becomes exactly one order and one payment, with its stock held and a
 * number of its own, however often or however concurrently completion is
 * called.
 *
 * @module checkout/checkout.integration.test
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createCartService, type CartResult } from "../cart/cart-service";
import type {
  CatalogueItem,
  CatalogueSource,
} from "../contracts/catalogue-source";
import type { PaymentProvider } from "../contracts/payment-provider";
import { money } from "../money/money";
import { commerce } from "../plugin";
import {
  carts,
  orderLines,
  orderNumbers,
  orders,
  payments,
  stockHolds,
  stockItems,
  work,
} from "../schema/tables";
import { createInMemoryCatalogueSource } from "../testing/in-memory-catalogue-source";
import { createTestPaymentProvider } from "../testing/test-payment-provider";
import { recordJobRun } from "../work/job-health";
import { runDueWork } from "../work/work-runner";

import type { CheckoutAddresses } from "./addresses";
import {
  createCheckoutService,
  WORK_JOB,
  type CheckoutServiceOptions,
} from "./checkout-service";
import { checkoutWorkHandlers } from "./checkout-work";

const MINUTE = 60_000;

const ITEMS: CatalogueItem[] = [
  {
    reference: "drill",
    name: "Drill press",
    sku: "DP-1",
    price: { kind: "listed", unitPrice: money(12_900, "USD") },
    stock: { kind: "counted", available: 4 },
  },
  {
    reference: "lathe",
    name: "Used lathe",
    price: { kind: "listed", unitPrice: money(850_000, "USD") },
    stock: { kind: "one-off", available: 1 },
  },
  {
    reference: "bolt",
    name: "Bolt",
    price: { kind: "listed", unitPrice: money(25, "USD") },
    stock: { kind: "untracked" },
  },
];

const ADDRESSES: CheckoutAddresses = {
  shipping: {
    name: "Ada Lovelace",
    line1: "1 Main Street",
    city: "Lahore",
    country: "PK",
  },
};

async function codeOf(
  work: () => Promise<unknown>
): Promise<string | undefined> {
  try {
    await work();
  } catch (error) {
    return NextlyError.is(error) ? String(error.code) : String(error);
  }
  return undefined;
}

function tokenOf(result: CartResult): string {
  if (result.cookie.action !== "set") throw new Error("no cookie set");
  return result.cookie.token;
}

describe.each(getConfiguredTestDialects())(
  "checkout (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function setup(
      options: {
        readonly source?: CatalogueSource;
        readonly provider?: PaymentProvider;
        readonly jobsRan?: boolean;
        readonly clock?: { now: Date };
      } = {}
    ) {
      const memory = createInMemoryCatalogueSource({
        currency: "USD",
        items: ITEMS,
      });
      const source = options.source ?? memory.source;
      const test = createTestPaymentProvider();
      const provider = options.provider ?? test.provider;
      const plugin = commerce({
        currency: "USD",
        catalogue: source,
        payments: provider,
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
      const ctx = captured;
      const clock = options.clock ?? { now: new Date() };
      const alerts = {
        abandoned: [] as string[],
        jobsRefused: 0,
      };
      const checkout = (overrides: Partial<CheckoutServiceOptions> = {}) =>
        createCheckoutService({
          db: ctx.db,
          dialect: ctx.dialect,
          source,
          payments: provider,
          currency: "USD",
          unpaidOrderMs: 30 * MINUTE,
          jobsStaleAfterMs: 15 * MINUTE,
          alerts: {
            abandoned: item => void alerts.abandoned.push(item.operationId),
            jobsNotRunning: () => void (alerts.jobsRefused += 1),
          },
          now: () => clock.now,
          ...overrides,
        });
      const cart = createCartService({
        db: ctx.db,
        source,
        currency: "USD",
        lifetimeDays: 30,
        now: () => clock.now,
      });
      if (options.jobsRan !== false) {
        await recordJobRun(ctx.db, ctx.dialect, WORK_JOB, clock.now);
      }
      // A pass of the work job, as the jobs trigger would run it.
      const workPass = () =>
        runDueWork({
          db: ctx.db,
          handlers: checkoutWorkHandlers({
            db: ctx.db,
            provider,
            source,
            now: () => clock.now,
          }),
          alerts: { abandoned: () => undefined },
          now: () => clock.now,
        });
      return {
        ctx,
        memory,
        test,
        provider,
        checkout,
        cart,
        clock,
        alerts,
        workPass,
      };
    }

    /** A shopper with the given lines in their cart, and their cart's token. */
    async function shopper(
      cart: Awaited<ReturnType<typeof setup>>["cart"],
      lines: readonly [string, number][]
    ): Promise<string> {
      let token: string | null = null;
      for (const [reference, quantity] of lines) {
        token = tokenOf(await cart.add({ token, reference, quantity }));
      }
      if (token === null) throw new Error("no lines");
      return token;
    }

    it("quotes the cart from the source's own prices, as one summary", async () => {
      const { checkout, cart } = await setup();
      const token = await shopper(cart, [
        ["drill", 2],
        ["bolt", 10],
      ]);
      const summary = await checkout().quote({ token });
      expect(
        summary.lines.map(l => [l.reference, l.quantity, l.lineTotal.amount])
      ).toEqual([
        ["drill", 2, 25_800],
        ["bolt", 10, 250],
      ]);
      expect(summary.total).toEqual(money(26_050, "USD"));
      expect(summary.quoteKey).toMatch(/^[0-9a-f]{64}$/);
      expect(summary.lines[0]).toMatchObject({
        name: "Drill press",
        sku: "DP-1",
        available: 4,
      });
    });

    it("places one order awaiting payment, with its snapshot, its stock held and its payment started", async () => {
      const { ctx, checkout, cart, test } = await setup();
      const token = await shopper(cart, [
        ["drill", 2],
        ["bolt", 1],
      ]);
      const service = checkout();
      const { quoteKey } = await service.quote({ token });
      const done = await service.complete({
        token,
        quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      });

      expect(done.order).toMatchObject({
        number: 1,
        status: "awaiting_payment",
        email: "ada@example.com",
        total: { amount: 25_825, currency: "USD" },
        lines: [
          { reference: "drill", name: "Drill press", quantity: 2 },
          { reference: "bolt", name: "Bolt", quantity: 1 },
        ],
      });
      expect(done.payment.status).toBe("pending");
      expect(done.payment.clientData).not.toBeNull();

      // One payment at the provider, carrying commerce's own reference and
      // exactly the order's total.
      expect(test.control.payments()).toHaveLength(1);
      expect(test.control.payments()[0]).toMatchObject({
        reference: done.payment.reference,
        amount: { amount: 25_825, currency: "USD" },
      });
      // Minted in lower-case hex, which every collation compares exactly: the
      // reason the schema rules let the payments table index it as it is.
      expect(done.payment.reference).toMatch(/^pay_[0-9a-f]{32}$/);

      const [stock] = await ctx.db.select(stockItems).all();
      expect(stock).toMatchObject({ reference: "drill", held: 2 });
      expect(await ctx.db.select(stockHolds).all()).toMatchObject([
        { reference: "drill", quantity: 2, state: "active" },
      ]);
      expect(await ctx.db.select(orderLines).all()).toHaveLength(2);

      // The cart has become the order: it shows empty, and the next change
      // starts a new cart.
      expect((await cart.get({ token })).cart.lines).toEqual([]);
      const next = await cart.add({ token, reference: "bolt", quantity: 1 });
      expect(tokenOf(next)).not.toBe(token);
    });

    it("holds the stock of references that differ only in case apart", async () => {
      const lamps = createInMemoryCatalogueSource({
        currency: "USD",
        items: [
          {
            reference: "Lamp",
            name: "Floor lamp",
            price: { kind: "listed", unitPrice: money(5_000, "USD") },
            stock: { kind: "counted", available: 1 },
          },
          {
            reference: "lamp",
            name: "Desk lamp",
            price: { kind: "listed", unitPrice: money(3_000, "USD") },
            stock: { kind: "counted", available: 1 },
          },
        ],
      });
      const { ctx, checkout, cart } = await setup({ source: lamps.source });
      const token = await shopper(cart, [
        ["Lamp", 1],
        ["lamp", 1],
      ]);
      const service = checkout();
      const { quoteKey } = await service.quote({ token });
      const done = await service.complete({
        token,
        quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      });
      expect(done.order.lines.map(l => l.reference)).toEqual(["Lamp", "lamp"]);
      const stock = await ctx.db.select(stockItems).all();
      expect(stock.map(s => [s.reference, s.held]).sort()).toEqual([
        ["Lamp", 1],
        ["lamp", 1],
      ]);
      const holds = await ctx.db.select(stockHolds).all();
      expect(holds.map(h => h.reference).sort()).toEqual(["Lamp", "lamp"]);
    });

    it("answers the same order and starts one payment however often completion is called", async () => {
      const { ctx, checkout, cart, test } = await setup();
      const token = await shopper(cart, [["drill", 1]]);
      const service = checkout();
      const { quoteKey } = await service.quote({ token });
      const input = {
        token,
        quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      };

      const together = await Promise.all(
        Array.from({ length: 5 }, () => service.complete(input))
      );
      const again = await service.complete(input);
      const numbers = new Set([...together, again].map(c => c.order.number));
      expect(numbers.size).toBe(1);
      expect(await ctx.db.select(orders).all()).toHaveLength(1);
      expect(await ctx.db.select(payments).all()).toHaveLength(1);
      expect(test.control.payments()).toHaveLength(1);
      expect(await ctx.db.select(stockHolds).all()).toHaveLength(1);
      // The completion that started the payment hands on the provider's
      // browser data, as does any completion after the start; one racing it
      // may answer while the start is still in flight, with no data yet.
      expect(together.some(answer => answer.payment.clientData !== null)).toBe(
        true
      );
      expect(again.payment.clientData).not.toBeNull();
    });

    it("numbers orders from 1, no two alike and none skipped, when many checkouts commit at once", async () => {
      const { ctx, checkout, cart } = await setup();
      const tokens = [];
      for (let i = 0; i < 6; i++)
        tokens.push(await shopper(cart, [["bolt", i + 1]]));
      const service = checkout();
      const placed = await Promise.all(
        tokens.map(async token => {
          const { quoteKey } = await service.quote({ token });
          return service.complete({
            token,
            quoteKey,
            email: "buyer@example.com",
            addresses: ADDRESSES,
          });
        })
      );
      // Which checkout gets which number is not promised, only that the
      // numbers count up from 1 with none shared and, when every checkout
      // commits, none skipped.
      const numbers = placed.map(p => p.order.number).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
      expect(await ctx.db.select(orderNumbers).all()).toHaveLength(6);
    });

    it("lets exactly one of two buyers take the last unit, and tells the other it is gone", async () => {
      const { ctx, checkout, cart } = await setup();
      const first = await shopper(cart, [["lathe", 1]]);
      const second = await shopper(cart, [["lathe", 1]]);
      const service = checkout();
      const quotes = await Promise.all(
        [first, second].map(token => service.quote({ token }))
      );
      const outcomes = await Promise.allSettled(
        [first, second].map((token, i) =>
          service.complete({
            token,
            quoteKey: quotes[i]?.quoteKey ?? "",
            email: "buyer@example.com",
            addresses: ADDRESSES,
          })
        )
      );
      expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
      const refused = outcomes.find(o => o.status === "rejected");
      expect(
        refused?.status === "rejected" && NextlyError.is(refused.reason)
          ? refused.reason.code
          : undefined
      ).toBe("COMMERCE_OUT_OF_STOCK");
      expect(await ctx.db.select(orders).all()).toHaveLength(1);
      const [stock] = await ctx.db.select(stockItems).all();
      expect(stock).toMatchObject({ reference: "lathe", held: 1 });
      // And the loser's cart now says so before checkout does.
      const loser = outcomes[0]?.status === "rejected" ? first : second;
      const [line] = (await cart.get({ token: loser })).cart.lines;
      expect(line?.availability).toEqual({ kind: "sold-out" });
    });

    it("lets exactly one of two buyers take the last units of an item another order already holds", async () => {
      const { ctx, checkout, cart } = await setup();
      const service = checkout();
      const place = async (token: string) => {
        const { quoteKey } = await service.quote({ token });
        return service.complete({
          token,
          quoteKey,
          email: "buyer@example.com",
          addresses: ADDRESSES,
        });
      };
      // An earlier order holds 2 of the 4, so the item's stock record exists
      // and the two buyers below race on moving it, not on creating it.
      await place(await shopper(cart, [["drill", 2]]));
      const first = await shopper(cart, [["drill", 2]]);
      const second = await shopper(cart, [["drill", 2]]);
      const outcomes = await Promise.allSettled([place(first), place(second)]);
      expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
      expect(await ctx.db.select(orders).all()).toHaveLength(2);
      const [stock] = await ctx.db.select(stockItems).all();
      expect(stock).toMatchObject({ reference: "drill", held: 4 });
    });

    it("saves nothing when the order's transaction fails after its stock is held", async () => {
      const { ctx, checkout, cart } = await setup();
      const token = await shopper(cart, [["drill", 2]]);
      const failing = checkout({
        onStockHeld: () => {
          throw new Error("the database failed after the hold");
        },
      });
      const { quoteKey } = await failing.quote({ token });
      await expect(
        failing.complete({
          token,
          quoteKey,
          email: "ada@example.com",
          addresses: ADDRESSES,
        })
      ).rejects.toThrow("the database failed after the hold");
      for (const table of [
        orders,
        orderNumbers,
        orderLines,
        stockHolds,
        stockItems,
        payments,
        work,
      ]) {
        expect(await ctx.db.select(table).all()).toEqual([]);
      }
      // The cart is as it was, and still checks out.
      expect((await cart.get({ token })).cart.lines).toHaveLength(1);
      const done = await checkout().complete({
        token,
        quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      });
      expect(done.order.number).toBeGreaterThan(0);
    });

    it("starts the payment later when the provider is down at completion, once", async () => {
      const test = createTestPaymentProvider();
      let down = true;
      const flaky: PaymentProvider = {
        ...test.provider,
        start: async input => {
          if (down) throw new Error("connect ECONNREFUSED");
          return test.provider.start(input);
        },
      };
      const { ctx, checkout, cart, clock, workPass } = await setup({
        provider: flaky,
      });
      const token = await shopper(cart, [["bolt", 2]]);
      const service = checkout();
      const { quoteKey } = await service.quote({ token });
      const input = {
        token,
        quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      };

      const first = await service.complete(input);
      expect(first.payment).toMatchObject({
        status: "pending",
        clientData: null,
      });
      expect(test.control.payments()).toHaveLength(0);
      // The step is recorded and waits to be tried again.
      expect(await ctx.db.select(work).all()).toMatchObject([
        { state: "pending", attempts: 1, lastError: "Error" },
      ]);

      down = false;
      clock.now = new Date(clock.now.getTime() + MINUTE);
      await workPass();
      expect(test.control.payments()).toHaveLength(1);
      const resumed = await service.complete(input);
      expect(resumed.order.number).toBe(first.order.number);
      expect(resumed.payment.clientData).not.toBeNull();
      expect(test.control.payments()).toHaveLength(1);
    });

    it("repeats a lost start under the same key inside its lifetime, and looks it up past it", async () => {
      for (const pastLifetime of [false, true]) {
        // One clock for commerce and the provider, so the key's lifetime
        // passes for both: past it, the provider treats a repeated key as a
        // new payment, and only a lookup by reference avoids a second one.
        const clock = { now: new Date() };
        const test = createTestPaymentProvider({
          now: () => clock.now.getTime(),
        });
        let loseNext = true;
        const losing: PaymentProvider = {
          ...test.provider,
          start: async input => {
            const answer = await test.provider.start(input);
            if (loseNext) {
              loseNext = false;
              throw new Error("the answer was lost on the way");
            }
            return answer;
          },
        };
        const { ctx, checkout, cart, workPass } = await setup({
          provider: losing,
          clock,
        });
        const token = await shopper(cart, [["bolt", 1]]);
        const service = checkout();
        const { quoteKey } = await service.quote({ token });
        await service.complete({
          token,
          quoteKey,
          email: "ada@example.com",
          addresses: ADDRESSES,
        });
        // The provider made the payment; commerce never heard.
        expect(test.control.payments()).toHaveLength(1);

        clock.now = new Date(
          clock.now.getTime() +
            (pastLifetime
              ? losing.capabilities.operationKeyLifetimeMs + MINUTE
              : MINUTE)
        );
        await workPass();
        expect(test.control.payments()).toHaveLength(1);
        const [payment] = await ctx.db.select(payments).all();
        expect(payment?.providerReference).toBe(
          test.control.payments()[0]?.providerReference
        );
        await current?.destroy();
        current = undefined;
      }
    });

    it("refuses checkout while the jobs have never run, and creates nothing", async () => {
      const { ctx, checkout, cart, alerts } = await setup({ jobsRan: false });
      const token = await shopper(cart, [["bolt", 1]]);
      const service = checkout();
      const { quoteKey } = await service.quote({ token });
      expect(
        await codeOf(() =>
          service.complete({
            token,
            quoteKey,
            email: "ada@example.com",
            addresses: ADDRESSES,
          })
        )
      ).toBe("COMMERCE_JOBS_NOT_RUNNING");
      expect(alerts.jobsRefused).toBe(1);
      expect(await ctx.db.select(orders).all()).toEqual([]);
    });

    it("refuses an order for a cart or a price the buyer was not shown", async () => {
      const { ctx, checkout, cart } = await setup();
      const token = await shopper(cart, [["drill", 1]]);
      const service = checkout();
      const { quoteKey } = await service.quote({ token });
      await cart.add({ token, reference: "bolt", quantity: 1 });
      expect(
        await codeOf(() =>
          service.complete({
            token,
            quoteKey,
            email: "ada@example.com",
            addresses: ADDRESSES,
          })
        )
      ).toBe("COMMERCE_QUOTE_CHANGED");
      expect(await ctx.db.select(orders).all()).toEqual([]);
    });

    it("refuses what a buyer could tamper with: a malformed key, an address or an email outside the contract", async () => {
      const { checkout, cart } = await setup();
      const token = await shopper(cart, [["bolt", 1]]);
      const service = checkout();
      const { quoteKey } = await service.quote({ token });
      for (const input of [
        {
          quoteKey: "not-a-key",
          email: "ada@example.com",
          addresses: ADDRESSES,
        },
        { quoteKey, email: "not an email", addresses: ADDRESSES },
        {
          quoteKey,
          email: "ada@example.com",
          addresses: {
            shipping: { ...ADDRESSES.shipping, country: "Pakistan" },
          },
        },
      ]) {
        expect(await codeOf(() => service.complete({ token, ...input }))).toBe(
          "VALIDATION_ERROR"
        );
      }
    });

    it("keeps a confirmed hold from a second buyer when the source leaves holds out of its figure", async () => {
      // The in-memory source records a hold without lowering its own figure,
      // so after confirming it still reports the one-off unit available.
      const { ctx, checkout, cart, clock, workPass, memory } = await setup();
      const service = checkout();
      const place = async (token: string) => {
        const { quoteKey } = await service.quote({ token });
        return service.complete({
          token,
          quoteKey,
          email: "buyer@example.com",
          addresses: ADDRESSES,
        });
      };
      await place(await shopper(cart, [["lathe", 1]]));
      clock.now = new Date(clock.now.getTime() + MINUTE);
      await workPass();
      const [hold] = await ctx.db.select(stockHolds).all();
      expect(hold?.confirmedAt).not.toBeNull();
      expect(memory.control.stock("lathe")).toEqual({
        kind: "one-off",
        available: 1,
      });

      const second = await shopper(cart, [["lathe", 1]]);
      expect(await codeOf(() => place(second))).toBe("COMMERCE_OUT_OF_STOCK");
      expect(await ctx.db.select(orders).all()).toHaveLength(1);
    });

    it("never shows less than none when a source counts holds in its own figure", async () => {
      // A source that lowers its figure for every hold it records.
      const counts = new Map([["drill", 4]]);
      const recorded = new Set<string>();
      const counting: CatalogueSource = {
        id: "counting",
        find: async ({ references }) =>
          references.flatMap(reference =>
            reference === "drill"
              ? [
                  {
                    ...ITEMS[0],
                    stock: {
                      kind: "counted",
                      available: counts.get("drill") ?? 0,
                    },
                  } as CatalogueItem,
                ]
              : []
          ),
        price: async ({ lines }) =>
          lines.map(line => ({
            ...line,
            found: true as const,
            price: { kind: "listed" as const, unitPrice: money(12_900, "USD") },
            stock: {
              kind: "counted" as const,
              available: counts.get("drill") ?? 0,
            },
          })),
        stock: {
          report: async input => {
            if (recorded.has(input.operationId)) return;
            recorded.add(input.operationId);
            if (input.kind === "hold") {
              counts.set(
                input.reference,
                Math.max(0, (counts.get(input.reference) ?? 0) - input.quantity)
              );
            }
          },
          confirm: async input => ({
            recorded: recorded.has(input.operationId),
          }),
        },
      };
      const { checkout, cart, clock, workPass } = await setup({
        source: counting,
      });
      const service = checkout();
      const token = await shopper(cart, [["drill", 4]]);
      const { quoteKey } = await service.quote({ token });
      await service.complete({
        token,
        quoteKey,
        email: "buyer@example.com",
        addresses: ADDRESSES,
      });
      clock.now = new Date(clock.now.getTime() + MINUTE);
      await workPass();
      // The source now says 0 and commerce still holds 4: none, not -4.
      const other = await shopper(cart, [["drill", 1]]);
      const [line] = (await cart.get({ token: other })).cart.lines;
      expect(line?.availability).toEqual({ kind: "sold-out" });
      const summary = await service.quote({ token: other });
      expect(summary.lines[0]?.available).toBe(0);
    });

    it("reports each hold to a source that hears them once, with a lost answer along the way, and keeps a confirmed hold coming off", async () => {
      const memory = createInMemoryCatalogueSource({
        currency: "USD",
        items: ITEMS,
      });
      const listener = memory.source.stock;
      if (!listener) throw new Error("the in-memory source hears reports");
      let loseNext = true;
      const source: CatalogueSource = {
        ...memory.source,
        stock: {
          report: async input => {
            await listener.report(input);
            if (loseNext) {
              loseNext = false;
              throw new Error("the report's answer was lost");
            }
          },
          confirm: input => listener.confirm(input),
        },
      };
      const { ctx, checkout, cart, clock, workPass } = await setup({ source });
      const token = await shopper(cart, [["drill", 3]]);
      const service = checkout();
      const { quoteKey } = await service.quote({ token });
      await service.complete({
        token,
        quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      });

      clock.now = new Date(clock.now.getTime() + MINUTE);
      await workPass();
      expect(memory.control.reports()).toMatchObject([
        { kind: "hold", reference: "drill", quantity: 3, orderReference: "1" },
      ]);
      const [hold] = await ctx.db.select(stockHolds).all();
      expect(hold?.confirmedAt).not.toBeNull();

      // Confirmed or not, the hold still comes off the source's figure: 4 on
      // hand, 3 held, 1 left for the next buyer.
      const other = await shopper(cart, [["drill", 1]]);
      const [line] = (await cart.get({ token: other })).cart.lines;
      expect(line?.availability).toEqual({ kind: "in-stock", available: 1 });
    });

    /** A source over the suite's items whose `price` can be made to stall or fail. */
    function stallingSource(onPrice: () => void): CatalogueSource {
      const memory = createInMemoryCatalogueSource({
        currency: "USD",
        items: ITEMS,
      }).source;
      const price = memory.price.bind(memory);
      return {
        ...memory,
        find: memory.find.bind(memory),
        price: async input => {
          onPrice();
          return price(input);
        },
      };
    }

    it("places an order only while its cart is live at that moment, and dates its deadline from then", async () => {
      const clock = { now: new Date("2026-10-14T05:00:00.000Z") };
      let stall = 0;
      const source = stallingSource(() => {
        clock.now = new Date(clock.now.getTime() + stall);
      });
      const { ctx, checkout, cart } = await setup({ source, clock });
      const input = async (token: string) => ({
        token,
        quoteKey: (await checkout().quote({ token })).quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      });

      // The source answers a minute late: the order is placed, and its
      // deadline runs from when it was, not from before the source was asked.
      const late = await shopper(cart, [["bolt", 1]]);
      const lateInput = await input(late);
      stall = MINUTE;
      const placed = await checkout().complete(lateInput);
      expect(placed.order.expiresAt).toBe(
        new Date(clock.now.getTime() + 30 * MINUTE).toISOString()
      );

      // The source answers after the cart's own deadline: no order.
      stall = 0;
      const expiring = await shopper(cart, [["bolt", 1]]);
      const expiringInput = await input(expiring);
      stall = 31 * 24 * 60 * MINUTE;
      expect(await codeOf(() => checkout().complete(expiringInput))).toBe(
        "COMMERCE_CART_EMPTY"
      );
      expect(await ctx.db.select(orders).all()).toHaveLength(1);
    });

    it("calls a source that fails to price unavailable, at quote and at completion, and creates nothing", async () => {
      let down = false;
      const source = stallingSource(() => {
        if (down) throw new TypeError("fetch failed");
      });
      const { ctx, checkout, cart } = await setup({ source });
      const token = await shopper(cart, [["bolt", 1]]);
      const { quoteKey } = await checkout().quote({ token });
      down = true;
      expect(await codeOf(() => checkout().quote({ token }))).toBe(
        "COMMERCE_CATALOGUE_UNAVAILABLE"
      );
      expect(
        await codeOf(() =>
          checkout().complete({
            token,
            quoteKey,
            email: "ada@example.com",
            addresses: ADDRESSES,
          })
        )
      ).toBe("COMMERCE_CATALOGUE_UNAVAILABLE");
      expect(await ctx.db.select(orders).all()).toEqual([]);
    });

    it("refuses a free order before anything is written", async () => {
      const free = createInMemoryCatalogueSource({
        currency: "USD",
        items: [
          {
            reference: "sample",
            name: "Free sample",
            price: { kind: "listed", unitPrice: money(0, "USD") },
            stock: { kind: "counted", available: 3 },
          },
        ],
      });
      const { ctx, checkout, cart } = await setup({ source: free.source });
      const token = await shopper(cart, [["sample", 1]]);
      const { quoteKey } = await checkout().quote({ token });
      expect(
        await codeOf(() =>
          checkout().complete({
            token,
            quoteKey,
            email: "ada@example.com",
            addresses: ADDRESSES,
          })
        )
      ).toBe("COMMERCE_NOTHING_TO_PAY");
      expect(await ctx.db.select(orders).all()).toEqual([]);
      expect(await ctx.db.select(stockHolds).all()).toEqual([]);
      expect(await ctx.db.select(work).all()).toEqual([]);
      expect(await ctx.db.select(carts).all()).toMatchObject([
        { checkedOutAt: null },
      ]);
    });

    it("answers an order already placed when the jobs have since stopped, and refuses only a new one", async () => {
      const { ctx, checkout, cart, clock, alerts } = await setup();
      const token = await shopper(cart, [["bolt", 1]]);
      const service = checkout();
      const input = {
        token,
        quoteKey: (await service.quote({ token })).quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      };
      const first = await service.complete(input);

      // The jobs stop: no run for longer than the store allows.
      clock.now = new Date(clock.now.getTime() + 16 * MINUTE);
      const again = await service.complete(input);
      expect(again.order.number).toBe(first.order.number);
      expect(alerts.jobsRefused).toBe(0);

      const other = await shopper(cart, [["bolt", 1]]);
      expect(
        await codeOf(async () =>
          service.complete({
            ...input,
            token: other,
            quoteKey: (await service.quote({ token: other })).quoteKey,
          })
        )
      ).toBe("COMMERCE_JOBS_NOT_RUNNING");
      expect(alerts.jobsRefused).toBe(1);
      expect(await ctx.db.select(orders).all()).toHaveLength(1);
    });

    it("starts the payment on the first attempt however short the provider's key lifetime", async () => {
      const test = createTestPaymentProvider();
      // Under a second: the first attempt's moment is stored to the second,
      // so it can read as older than the lifetime before any call is made.
      const brief: PaymentProvider = {
        ...test.provider,
        capabilities: {
          ...test.provider.capabilities,
          operationKeyLifetimeMs: 500,
        },
      };
      const clock = { now: new Date("2026-10-14T05:00:00.900Z") };
      const { ctx, checkout, cart } = await setup({ provider: brief, clock });
      const token = await shopper(cart, [["bolt", 1]]);
      const done = await checkout().complete({
        token,
        quoteKey: (await checkout().quote({ token })).quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      });
      expect(test.control.payments()).toHaveLength(1);
      expect(done.payment.status).toBe("pending");
      expect(await ctx.db.select(payments).all()).toMatchObject([
        { status: "pending", providerReference: expect.any(String) },
      ]);
    });

    it("holds the provider's read of a started payment to that payment before passing its data on", async () => {
      const test = createTestPaymentProvider();
      let mode: "as-is" | "another" | "malformed" | "down" = "as-is";
      const provider: PaymentProvider = {
        ...test.provider,
        read: async input => {
          if (mode === "down") throw new Error("connect ECONNREFUSED");
          const real = await test.provider.read(input);
          if (mode === "another") return { ...real, reference: "pay_other" };
          // Well typed, outside the contract: more captured than the payment.
          if (mode === "malformed")
            return {
              ...real,
              amountCaptured: money(
                real.amount.amount + 1,
                real.amount.currency
              ),
            };
          return real;
        },
      };
      const { checkout, cart } = await setup({ provider });
      const token = await shopper(cart, [["bolt", 1]]);
      const service = checkout();
      const input = {
        token,
        quoteKey: (await service.quote({ token })).quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      };
      const first = await service.complete(input);

      // A repeated completion reads the payment back from the provider.
      expect((await service.complete(input)).payment.clientData).toEqual(
        first.payment.clientData
      );
      for (const broken of ["another", "malformed"] as const) {
        mode = broken;
        expect(await codeOf(() => service.complete(input)), broken).toBe(
          "COMMERCE_PROVIDER_CONTRACT"
        );
      }
      // A provider that cannot be reached leaves the order answered without
      // its form data.
      mode = "down";
      const offline = await service.complete(input);
      expect(offline.order.number).toBe(first.order.number);
      expect(offline.payment.clientData).toBeNull();
    });

    it("keeps a long catalogue name and SKU whole in the order, on every dialect", async () => {
      const long = createInMemoryCatalogueSource({
        currency: "USD",
        items: [
          {
            reference: "rig",
            name: "Rig ".repeat(100),
            sku: "SKU-".repeat(100),
            price: { kind: "listed", unitPrice: money(1_000, "USD") },
            stock: { kind: "untracked" },
          },
        ],
      });
      const { ctx, checkout, cart } = await setup({ source: long.source });
      const token = await shopper(cart, [["rig", 1]]);
      const done = await checkout().complete({
        token,
        quoteKey: (await checkout().quote({ token })).quoteKey,
        email: "ada@example.com",
        addresses: ADDRESSES,
      });
      expect(done.order.lines[0]?.name).toBe("Rig ".repeat(100));
      const [line] = await ctx.db.select(orderLines).all();
      expect(line?.sku).toBe("SKU-".repeat(100));
    });

    it("refuses an argument it cannot parse as a validation error, before any work", async () => {
      const { ctx, checkout } = await setup();
      const service = checkout();
      // A method's parameter is compared both ways, so either method fits here.
      interface Untyped {
        call(input: unknown): Promise<unknown>;
      }
      const methods: Record<string, Untyped> = {
        quote: { call: service.quote },
        complete: { call: service.complete },
      };
      for (const [name, method] of Object.entries(methods)) {
        expect(await codeOf(() => method.call(null)), `${name}(null)`).toBe(
          "VALIDATION_ERROR"
        );
        expect(
          await codeOf(() =>
            method.call({ token: null, cartId: "someone-elses-cart" })
          ),
          `${name} with a key it does not know`
        ).toBe("VALIDATION_ERROR");
      }
      expect(await ctx.db.select(orders).all()).toEqual([]);
    });
  }
);
