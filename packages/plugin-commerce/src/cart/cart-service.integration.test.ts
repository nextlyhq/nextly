/**
 * The cart over commerce's own tables, on every configured dialect.
 *
 * The unit suites prove the view, the line rules and the token. What only a
 * database can answer is whether the writes mean what the cart relies on
 * there: one line per item under racing adds, a compare-and-set that lets
 * exactly one of two racing changes through and retries the other, a deadline
 * stored and read back to the second, and a sweep that removes exactly the
 * carts past it.
 *
 * @module cart/cart-service.integration.test
 */
import {
  NextlyError,
  type JobContext,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import type {
  CatalogueItem,
  CatalogueSource,
} from "../contracts/catalogue-source";
import { money } from "../money/money";
import { commerce } from "../plugin";
import { cartLines, carts } from "../schema/tables";

import { createCartService, type CartResult } from "./cart-service";
import {
  CART_EXPIRY_JOB,
  cartExpiryJob,
  sweepExpiredCarts,
} from "./expiry-job";
import { SWEEP_GRACE_MS } from "./lifetime";
import { MAX_CART_LINES } from "./line-rules";
import { hashCartToken, newCartToken, parseCartToken } from "./token";

const DAY = 86_400_000;

function listed(
  reference: string,
  amount: number,
  stock: CatalogueItem["stock"]
): CatalogueItem {
  return {
    reference,
    name: `Item ${reference}`,
    price: { kind: "listed", unitPrice: money(amount, "USD") },
    stock,
  };
}

/** An outside catalogue whose items a test can change between calls. */
function outsideSource(initial: CatalogueItem[]) {
  const items = new Map(initial.map(item => [item.reference, item]));
  let finds = 0;
  const source: CatalogueSource = {
    id: "outside",
    find: async ({ references }) => {
      finds += 1;
      return references.flatMap(reference => {
        const item = items.get(reference);
        return item ? [item] : [];
      });
    },
    price: async () => [],
  };
  return {
    source,
    set(item: CatalogueItem) {
      items.set(item.reference, item);
    },
    finds: () => finds,
  };
}

const CATALOGUE = [
  listed("drill", 12_900, { kind: "counted", available: 4 }),
  listed("lathe", 850_000, { kind: "one-off", available: 1 }),
  listed("bench", 45_000, { kind: "to-order", maxPerLine: 99 }),
  listed("bolt", 25, { kind: "untracked" }),
  {
    reference: "rig",
    name: "Custom rig",
    price: { kind: "on-request" },
    stock: { kind: "untracked" },
  } satisfies CatalogueItem,
];

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

/** The token a result asks the browser to keep. */
function tokenOf(result: CartResult): string {
  if (result.cookie.action !== "set") {
    throw new Error(
      `expected the cookie to be set, not ${result.cookie.action}`
    );
  }
  return result.cookie.token;
}

describe.each(getConfiguredTestDialects())(
  "the cart (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boot commerce over `source`, and hand back commerce's own context. */
    async function boot(source: CatalogueSource): Promise<PluginContext> {
      const plugin = commerce({ currency: "USD", catalogue: source });
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

    async function setup(options: { lifetimeDays?: number } = {}) {
      const outside = outsideSource(CATALOGUE);
      const ctx = await boot(outside.source);
      const clock = { now: new Date("2026-10-14T05:00:00.000Z") };
      const service = (lifetimeDays = options.lifetimeDays ?? 30) =>
        createCartService({
          db: ctx.db,
          source: outside.source,
          currency: "USD",
          lifetimeDays,
          now: () => clock.now,
        });
      return { ctx, outside, clock, cart: service(), service };
    }

    it("makes no cart on a read, and one with a fresh token on the first change", async () => {
      const { ctx, cart } = await setup();

      const read = await cart.get({ token: null });
      expect(read.cart.lines).toEqual([]);
      expect(read.cookie).toEqual({ action: "keep" });
      expect(await ctx.db.select(carts).all()).toEqual([]);

      const added = await cart.add({
        token: null,
        reference: "drill",
        quantity: 2,
      });
      const token = tokenOf(added);
      expect(parseCartToken(token)).toBe(token);
      expect(added.cart.lines).toMatchObject([
        { reference: "drill", quantity: 2, lineTotal: money(25_800, "USD") },
      ]);
      expect(added.cart.expiresAt).toBe("2026-11-13T05:00:00.000Z");

      const again = await cart.get({ token });
      expect(again.cart.lines.map(l => [l.reference, l.quantity])).toEqual([
        ["drill", 2],
      ]);
      expect(again.cookie).toEqual({ action: "keep" });
    });

    it("stores only the token's hash, and the token nowhere", async () => {
      const { ctx, cart } = await setup();
      const token = tokenOf(
        await cart.add({ token: null, reference: "bolt", quantity: 1 })
      );
      const rows = await ctx.db.select(carts).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toBe(hashCartToken(token));
      for (const row of [...rows, ...(await ctx.db.select(cartLines).all())]) {
        expect(JSON.stringify(row)).not.toContain(token);
      }
    });

    it("adds to a line, sets it, removes it and empties the cart", async () => {
      const { cart } = await setup();
      const token = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 1 })
      );
      await cart.add({ token, reference: "drill", quantity: 2 });
      await cart.add({ token, reference: "bolt", quantity: 10 });
      let view = (await cart.get({ token })).cart;
      expect(view.lines.map(l => [l.reference, l.quantity])).toEqual([
        ["drill", 3],
        ["bolt", 10],
      ]);
      expect(view.subtotal).toEqual(money(3 * 12_900 + 10 * 25, "USD"));

      await cart.setQuantity({ token, reference: "drill", quantity: 1 });
      await cart.remove({ token, reference: "bolt" });
      view = (await cart.get({ token })).cart;
      expect(view.lines.map(l => [l.reference, l.quantity])).toEqual([
        ["drill", 1],
      ]);

      await cart.setQuantity({ token, reference: "drill", quantity: 0 });
      expect((await cart.get({ token })).cart.lines).toEqual([]);

      await cart.add({ token, reference: "drill", quantity: 1 });
      const cleared = await cart.clear({ token });
      expect(cleared.cart.lines).toEqual([]);
      // Emptied, not ended: the same token still finds the cart.
      expect(cleared.cookie).toMatchObject({ action: "set", token });
    });

    it("refuses an unknown item, one priced on request, and a line past what its item allows", async () => {
      const { cart } = await setup();
      expect(
        await codeOf(() =>
          cart.add({ token: null, reference: "nope", quantity: 1 })
        )
      ).toBe("COMMERCE_ITEM_NOT_FOUND");
      expect(
        await codeOf(() =>
          cart.add({ token: null, reference: "rig", quantity: 1 })
        )
      ).toBe("COMMERCE_PRICE_ON_REQUEST");
      expect(
        await codeOf(() =>
          cart.add({ token: null, reference: "lathe", quantity: 2 })
        )
      ).toBe("COMMERCE_QUANTITY_NOT_ALLOWED");

      // A one-off item is held to one unit across adds as well as within one.
      const token = tokenOf(
        await cart.add({ token: null, reference: "lathe", quantity: 1 })
      );
      expect(
        await codeOf(() => cart.add({ token, reference: "lathe", quantity: 1 }))
      ).toBe("COMMERCE_QUANTITY_NOT_ALLOWED");

      // An item sold to order up to its source's limit, and not one past it.
      await cart.setQuantity({ token, reference: "bench", quantity: 99 });
      expect(
        await codeOf(() => cart.add({ token, reference: "bench", quantity: 1 }))
      ).toBe("COMMERCE_QUANTITY_NOT_ALLOWED");
      expect(
        (await cart.get({ token })).cart.lines.map(l => [
          l.reference,
          l.quantity,
        ])
      ).toEqual([
        ["lathe", 1],
        ["bench", 99],
      ]);

      expect(
        await codeOf(() => cart.add({ token, reference: "", quantity: 1 }))
      ).toBe("VALIDATION_ERROR");
      expect(
        await codeOf(() =>
          cart.add({ token, reference: "drill", quantity: 1.5 })
        )
      ).toBe("VALIDATION_ERROR");
    });

    it("holds a cart to its most lines", async () => {
      const { outside, cart } = await setup();
      for (let i = 0; i <= MAX_CART_LINES; i++) {
        outside.set(listed(`part-${i}`, 100, { kind: "untracked" }));
      }
      let token: string | null = null;
      for (let i = 0; i < MAX_CART_LINES; i++) {
        const result = await cart.add({
          token,
          reference: `part-${i}`,
          quantity: 1,
        });
        token = tokenOf(result);
      }
      expect(
        await codeOf(() =>
          cart.add({ token, reference: `part-${MAX_CART_LINES}`, quantity: 1 })
        )
      ).toBe("COMMERCE_CART_FULL");
      // A line already there still changes.
      await cart.add({ token, reference: "part-0", quantity: 1 });
    });

    it("starts a fresh cart for a forged or unknown token, and reaches no other cart", async () => {
      const { cart } = await setup();
      const owner = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 1 })
      );

      const forged = newCartToken();
      const read = await cart.get({ token: forged });
      expect(read.cart.lines).toEqual([]);
      expect(read.cookie).toEqual({ action: "clear" });
      expect((await cart.get({ token: "not a token at all" })).cookie).toEqual({
        action: "clear",
      });

      const fresh = tokenOf(
        await cart.add({ token: forged, reference: "bolt", quantity: 1 })
      );
      // Never the token the browser sent: one planted in a browser must not
      // become the key to the cart that grows from it.
      expect(fresh).not.toBe(forged);
      expect(
        (await cart.get({ token: owner })).cart.lines.map(l => l.reference)
      ).toEqual(["drill"]);
      expect(
        (await cart.get({ token: fresh })).cart.lines.map(l => l.reference)
      ).toEqual(["bolt"]);
    });

    it("never serves a cart past its deadline, swept or not, and the sweep waits out its grace", async () => {
      const { ctx, clock, cart } = await setup();
      const old = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 1 })
      );
      const deadline = new Date(clock.now.getTime() + 30 * DAY);

      clock.now = new Date(deadline.getTime() - 1_000);
      expect((await cart.get({ token: old })).cart.lines).toHaveLength(1);

      clock.now = deadline;
      const expired = await cart.get({ token: old });
      expect(expired.cart.lines).toEqual([]);
      expect(expired.cookie).toEqual({ action: "clear" });

      // A change to an expired cart makes a new one rather than reviving it.
      const fresh = tokenOf(
        await cart.add({ token: old, reference: "bolt", quantity: 1 })
      );
      expect(fresh).not.toBe(old);
      expect(await ctx.db.select(carts).all()).toHaveLength(2);

      // Within the grace the expired cart is left, though no read serves it.
      expect(
        await sweepExpiredCarts(
          ctx.db,
          new Date(deadline.getTime() + SWEEP_GRACE_MS - 1_000)
        )
      ).toBe(0);
      expect(
        await sweepExpiredCarts(
          ctx.db,
          new Date(deadline.getTime() + SWEEP_GRACE_MS)
        )
      ).toBe(1);
      const left = await ctx.db.select(carts).all();
      expect(left.map(row => row.tokenHash)).toEqual([hashCartToken(fresh)]);
      const lines = await ctx.db.select(cartLines).all();
      expect(lines.map(line => line.reference)).toEqual(["bolt"]);
    });

    it("sweeps expired carts as a job, and stops at the pass's deadline", async () => {
      const { ctx, clock, cart } = await setup();
      for (const reference of ["drill", "bolt", "bench"]) {
        await cart.add({ token: null, reference, quantity: 1 });
      }
      const job = cartExpiryJob({ db: () => ctx.db });
      expect(job).toMatchObject({ slug: CART_EXPIRY_JOB, sweep: true });

      const later = new Date(clock.now.getTime() + 30 * DAY + SWEEP_GRACE_MS);
      const context = (deadline: Date): JobContext =>
        ({
          jobId: "test",
          attempt: 1,
          user: null,
          now: later,
          deadline,
          content: {},
        }) as unknown as JobContext;

      // A pass already out of time starts nothing.
      await job.handler(null, context(new Date(Date.now() - 1_000)));
      expect(await ctx.db.select(carts).all()).toHaveLength(3);

      await job.handler(null, context(new Date(Date.now() + 60_000)));
      expect(await ctx.db.select(carts).all()).toEqual([]);
      expect(await ctx.db.select(cartLines).all()).toEqual([]);

      // Run again with nothing to do, as a repeated delivery would.
      await job.handler(null, context(new Date(Date.now() + 60_000)));
    });

    it("checks the pass's deadline before every batch, and leaves the rest of a backlog to the next pass", async () => {
      const { ctx, clock, cart } = await setup();
      for (const reference of ["drill", "bolt", "bench", "drill", "bolt"]) {
        await cart.add({ token: null, reference, quantity: 1 });
      }
      const later = new Date(clock.now.getTime() + 30 * DAY + SWEEP_GRACE_MS);
      const deadline = new Date("2030-01-01T00:00:00.000Z");
      // In time for the first batch, out of time before the second.
      const readings = [new Date(deadline.getTime() - 1), deadline];
      const job = cartExpiryJob({
        db: () => ctx.db,
        batchSize: 2,
        clock: () => readings.shift() ?? deadline,
      });
      await job.handler(null, {
        jobId: "test",
        attempt: 1,
        user: null,
        now: later,
        deadline,
        content: {},
      } as unknown as JobContext);
      expect(await ctx.db.select(carts).all()).toHaveLength(3);

      // The next pass, with time to spare, takes the rest.
      await cartExpiryJob({ db: () => ctx.db, batchSize: 2 }).handler(null, {
        jobId: "test",
        attempt: 1,
        user: null,
        now: later,
        deadline: new Date(Date.now() + 60_000),
        content: {},
      } as unknown as JobContext);
      expect(await ctx.db.select(carts).all()).toEqual([]);
    });

    it("keeps a cart's deadline when the lifetime setting changes, until the cart next changes", async () => {
      const { clock, service } = await setup();
      const longLived = service(30);
      const token = tokenOf(
        await longLived.add({ token: null, reference: "drill", quantity: 1 })
      );
      const shorter = service(7);
      expect((await shorter.get({ token })).cart.expiresAt).toBe(
        "2026-11-13T05:00:00.000Z"
      );
      clock.now = new Date(clock.now.getTime() + DAY);
      const changed = await shorter.add({
        token,
        reference: "drill",
        quantity: 1,
      });
      expect(changed.cart.expiresAt).toBe("2026-10-22T05:00:00.000Z");
      expect(changed.cookie).toMatchObject({
        action: "set",
        token,
        expiresAt: new Date("2026-10-22T05:00:00.000Z"),
      });
    });

    it("applies every one of several changes racing on one cart", async () => {
      const { cart } = await setup();
      const token = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 1 })
      );
      // Two kinds of race at once: adds to one line, which must sum, and new
      // lines, which must each appear once.
      await Promise.all([
        ...Array.from({ length: 4 }, () =>
          cart.add({ token, reference: "drill", quantity: 1 })
        ),
        cart.add({ token, reference: "bolt", quantity: 3 }),
        cart.add({ token, reference: "bench", quantity: 2 }),
      ]);
      const view = (await cart.get({ token })).cart;
      expect(
        Object.fromEntries(view.lines.map(l => [l.reference, l.quantity]))
      ).toEqual({ drill: 5, bolt: 3, bench: 2 });
    });

    it("reads the source before a change commits, so a committed change always answers with its cookie", async () => {
      const { outside, ctx, cart } = await setup();
      // A source that answers once and then fails: any read of it after the
      // write would leave a committed cart behind an error, its token never
      // sent.
      const answered = outside.finds();
      const original = outside.source.find.bind(outside.source);
      outside.source.find = async input => {
        if (outside.finds() > answered) throw new Error("the source went away");
        return original(input);
      };
      const added = await cart.add({
        token: null,
        reference: "drill",
        quantity: 1,
      });
      expect(outside.finds()).toBe(answered + 1);
      expect(added.cookie).toMatchObject({ action: "set" });
      expect(added.cart.lines).toMatchObject([
        { reference: "drill", quantity: 1 },
      ]);

      // With the source down before the write, nothing is written.
      expect(
        await codeOf(() =>
          cart.add({ token: tokenOf(added), reference: "bolt", quantity: 1 })
        )
      ).toBe("COMMERCE_CATALOGUE_UNAVAILABLE");
      expect(await ctx.db.select(cartLines).all()).toHaveLength(1);
    });

    it("refuses a change whose answer cannot be built, and writes nothing", async () => {
      const { ctx, outside, cart } = await setup();
      // A price the source may give, whose total for two is past the safe
      // range of whole minor units.
      outside.set(
        listed("statue", Number.MAX_SAFE_INTEGER - 1, { kind: "untracked" })
      );
      expect(
        await codeOf(() =>
          cart.add({ token: null, reference: "statue", quantity: 2 })
        )
      ).toBe("COMMERCE_INVALID_AMOUNT");
      expect(await ctx.db.select(carts).all()).toEqual([]);
    });

    it("empties a cart, and takes its last line out, while the source is down", async () => {
      const { outside, cart } = await setup();
      const single = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 1 })
      );
      const pair = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 1 })
      );
      await cart.add({ token: pair, reference: "bolt", quantity: 1 });
      outside.source.find = async () => {
        throw new Error("the source is down");
      };
      // Nothing is left to show, so nothing is asked of the source.
      expect(
        (await cart.remove({ token: single, reference: "drill" })).cart.lines
      ).toEqual([]);
      expect((await cart.clear({ token: pair })).cart.lines).toEqual([]);
    });

    it("never changes a cart that expired while the source was being read", async () => {
      const { clock, outside, cart } = await setup();
      const old = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 1 })
      );
      const deadline = new Date(clock.now.getTime() + 30 * DAY);
      // Read just before the deadline; the source answers just after it.
      clock.now = new Date(deadline.getTime() - 1_000);
      const original = outside.source.find.bind(outside.source);
      outside.source.find = async input => {
        clock.now = new Date(deadline.getTime() + 1_000);
        return original(input);
      };
      const changed = await cart.add({
        token: old,
        reference: "bolt",
        quantity: 1,
      });
      // A new cart with a new token, holding only the change: the expired one
      // was not extended.
      expect(tokenOf(changed)).not.toBe(old);
      expect(changed.cart.lines.map(l => l.reference)).toEqual(["bolt"]);
      expect(changed.cart.expiresAt).toBe(
        new Date(deadline.getTime() + 1_000 + 30 * DAY).toISOString()
      );
    });

    it("answers a cart that expired while the source was being read as none, and one a change moved on as it now is", async () => {
      const { clock, outside, cart } = await setup();
      const token = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 1 })
      );
      const deadline = new Date(clock.now.getTime() + 30 * DAY);
      const original = outside.source.find.bind(outside.source);

      // The read starts before the deadline, and the source answers after it.
      clock.now = new Date(deadline.getTime() - 1_000);
      outside.source.find = async input => {
        clock.now = new Date(deadline.getTime() + 1_000);
        return original(input);
      };
      expect(await cart.get({ token })).toEqual({
        cart: expect.objectContaining({ lines: [] }),
        cookie: { action: "clear" },
      });

      // The same, but a change lands while the source is read, moving the
      // deadline on: the cart is answered as that change left it.
      const second = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 1 })
      );
      const secondDeadline = new Date(clock.now.getTime() + 30 * DAY);
      clock.now = new Date(secondDeadline.getTime() - 1_000);
      let raced = false;
      outside.source.find = async input => {
        if (!raced) {
          raced = true;
          outside.source.find = original;
          await cart.add({ token: second, reference: "bolt", quantity: 1 });
          clock.now = new Date(secondDeadline.getTime() + 1_000);
        }
        return original(input);
      };
      const read = await cart.get({ token: second });
      expect(read.cookie).toEqual({ action: "keep" });
      expect(read.cart.lines.map(l => l.reference)).toEqual(["drill", "bolt"]);
    });

    it("keeps references that differ only in case as two lines, and changes each alone", async () => {
      const { ctx, outside, cart } = await setup();
      outside.set(listed("Bolt", 30, { kind: "untracked" }));
      const token = tokenOf(
        await cart.add({ token: null, reference: "bolt", quantity: 1 })
      );
      const both = await cart.add({ token, reference: "Bolt", quantity: 2 });
      expect(both.cart.lines.map(l => [l.reference, l.quantity])).toEqual([
        ["bolt", 1],
        ["Bolt", 2],
      ]);
      await cart.setQuantity({ token, reference: "Bolt", quantity: 5 });
      await cart.remove({ token, reference: "bolt" });
      const rows = await ctx.db.select(cartLines).all();
      expect(rows.map(row => [row.reference, row.quantity])).toEqual([
        ["Bolt", 5],
      ]);
    });

    it("refuses an argument it cannot parse as a validation error, before any work", async () => {
      const { ctx, cart } = await setup();
      // The service is server code's to call, so its arguments are outside
      // input: each action is reached here as server code without types would.
      // A method's parameter is compared both ways, so any action fits here.
      interface Untyped {
        call(input: unknown): Promise<unknown>;
      }
      const actions: Record<string, Untyped> = {
        get: { call: cart.get },
        add: { call: cart.add },
        setQuantity: { call: cart.setQuantity },
        remove: { call: cart.remove },
        clear: { call: cart.clear },
      };
      for (const [name, action] of Object.entries(actions)) {
        expect(await codeOf(() => action.call(null)), `${name}(null)`).toBe(
          "VALIDATION_ERROR"
        );
        expect(
          await codeOf(() =>
            action.call({
              token: null,
              reference: "bolt",
              quantity: 1,
              cartId: "x",
            })
          ),
          `${name} with a key it does not know`
        ).toBe("VALIDATION_ERROR");
      }
      expect(await ctx.db.select(carts).all()).toEqual([]);
    });

    it("reads price and availability from the source on every read", async () => {
      const { outside, cart } = await setup();
      const token = tokenOf(
        await cart.add({ token: null, reference: "drill", quantity: 2 })
      );
      outside.set(listed("drill", 13_900, { kind: "counted", available: 0 }));

      const before = outside.finds();
      const [line] = (await cart.get({ token })).cart.lines;
      // One call for the whole cart.
      expect(outside.finds()).toBe(before + 1);
      expect(line).toMatchObject({
        unitPrice: money(13_900, "USD"),
        seenUnitPrice: money(12_900, "USD"),
        priceChanged: true,
        lineTotal: money(27_800, "USD"),
        availability: { kind: "sold-out" },
      });
    });
  }
);
