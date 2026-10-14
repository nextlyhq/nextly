import { createHash, randomUUID } from "node:crypto";

import { asc, eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";
import { z } from "zod";

import {
  findLiveCart,
  moveCart,
  readCartLines,
  type LiveCart,
} from "../cart/cart-store";
import { findItems } from "../cart/catalogue-read";
import {
  pricedLineSchema,
  type CatalogueSource,
  type CatalogueStock,
} from "../contracts/catalogue-source";
import {
  requirePaymentAmount,
  type PaymentProvider,
  type ProviderPayment,
  type ProviderPaymentStatus,
} from "../contracts/payment-provider";
import { commerceError } from "../errors";
import { money, multiply, sum, type Money } from "../money/money";
import { parseRequest } from "../request-input";
import { referenceKey } from "../schema/reference-key";
import { orderLines, orderNumbers, orders, payments } from "../schema/tables";
import {
  holdStock,
  StockRecordMoved,
  withCommerceStock,
} from "../stock/stock-ledger";
import { assertJobsRunning } from "../work/job-health";
import {
  recordWork,
  runDueWork,
  wholeSecond,
  type WorkAlerts,
} from "../work/work-runner";

import { checkoutAddressesSchema, type CheckoutAddresses } from "./addresses";
import {
  checkoutWorkHandlers,
  holdReportOperationId,
  REPORT_HOLD,
  START_PAYMENT,
} from "./checkout-work";

/** The job whose runs the checkout gate reads. */
export const WORK_JOB = "commerce:work";

/** @experimental */
export interface CheckoutSummaryLine {
  readonly reference: string;
  readonly name: string;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly lineTotal: Money;
  /** Units that can be bought now, or `null` for an item nothing is held for. */
  readonly available: number | null;
}

/**
 * The one priced summary a checkout shows: every figure the server's own,
 * from the catalogue source at the moment of asking. `quoteKey` names it:
 * completion is refused unless the cart still prices to the same summary.
 *
 * @experimental
 */
export interface CheckoutSummary {
  readonly currency: string;
  readonly lines: readonly CheckoutSummaryLine[];
  readonly subtotal: Money;
  readonly total: Money;
  readonly quoteKey: string;
}

/** @experimental */
export interface OrderView {
  readonly number: number;
  readonly status: string;
  readonly currency: string;
  readonly email: string;
  readonly lines: readonly {
    readonly reference: string;
    readonly name: string;
    readonly sku: string | null;
    readonly quantity: number;
    readonly unitPrice: Money;
    readonly lineTotal: Money;
  }[];
  readonly subtotal: Money;
  readonly total: Money;
  /** When the order is given up if it is still unpaid. */
  readonly expiresAt: string;
}

/** @experimental */
export interface CheckoutPaymentView {
  readonly reference: string;
  readonly status: ProviderPaymentStatus;
  /**
   * What the provider's browser component needs to take the payment, passed
   * on as the provider gave it and never stored; `null` while the payment
   * has not started yet.
   */
  readonly clientData: Readonly<Record<string, string>> | null;
}

/** @experimental */
export interface CompletedCheckout {
  readonly order: OrderView;
  readonly payment: CheckoutPaymentView;
}

/**
 * Checkout: one priced summary, then exactly one order and one payment for a
 * cart, however often or however concurrently completion is called.
 *
 * @experimental
 */
export interface CheckoutService {
  quote(input: { readonly token: string | null }): Promise<CheckoutSummary>;
  complete(input: {
    readonly token: string | null;
    readonly quoteKey: string;
    readonly email: string;
    readonly addresses: CheckoutAddresses;
  }): Promise<CompletedCheckout>;
}

/** @experimental */
export interface CheckoutServiceOptions {
  readonly db: PluginDatabase;
  readonly dialect: Parameters<typeof isUniqueViolation>[0];
  readonly source: CatalogueSource;
  readonly payments: PaymentProvider | undefined;
  readonly currency: string;
  /** How long an unpaid order holds its stock. */
  readonly unpaidOrderMs: number;
  /** How long the work job may go without running before checkout is refused. */
  readonly jobsStaleAfterMs: number;
  readonly alerts: WorkAlerts & {
    jobsNotRunning(lastRunAt: Date | null): void;
  };
  readonly now?: () => Date;
  /**
   * Called inside the order's transaction once its stock is held, before the
   * payment row and the work are written. For tests proving that a failure
   * there saves nothing at all.
   */
  readonly onStockHeld?: () => void | Promise<void>;
}

/**
 * How many times a completion is tried again when another checkout changed
 * what it read: the cart, or an item's stock record. Each attempt reads
 * everything afresh, so a retry is never a blind repeat.
 */
const MAX_ATTEMPTS = 8;

const completeSchema = z.strictObject({
  quoteKey: z.string().regex(/^[0-9a-f]{64}$/),
  email: z.email().max(320),
  addresses: checkoutAddressesSchema,
});

/** A priced cart line, with what checkout needs to snapshot and hold it. */
interface PricedCartLine extends CheckoutSummaryLine {
  readonly stock: CatalogueStock;
}

/** @experimental */
export function createCheckoutService(
  options: CheckoutServiceOptions
): CheckoutService {
  const { db, dialect, source, currency } = options;
  const clock = options.now ?? (() => new Date());
  const sourceListens = source.stock !== undefined;

  /**
   * Price the cart for checkout: the source's `price`, its authoritative
   * answer at this moment, for every figure, and its `find` for the names
   * the order keeps. Both outside any transaction.
   *
   * @throws `COMMERCE_ITEM_NOT_FOUND`, `COMMERCE_PRICE_ON_REQUEST`,
   *   `COMMERCE_PROVIDER_CONTRACT`, `COMMERCE_CATALOGUE_UNAVAILABLE`
   */
  async function summarize(cart: LiveCart): Promise<{
    summary: CheckoutSummary;
    lines: readonly PricedCartLine[];
  }> {
    const stored = await readCartLines(db, cart.id);
    const asked = stored.map(line => ({
      reference: line.reference,
      quantity: line.quantity,
    }));
    const [priced, named] = await Promise.all([
      priceLines(asked),
      findItems(
        source,
        currency,
        asked.map(line => line.reference)
      ),
    ]);
    const stocked = await withCommerceStock(
      db,
      new Map(
        priced.map(line => [
          line.reference,
          {
            reference: line.reference,
            name: named.get(line.reference)?.name ?? line.reference,
            ...(named.get(line.reference)?.sku
              ? { sku: named.get(line.reference)?.sku }
              : {}),
            price: { kind: "listed" as const, unitPrice: line.unitPrice },
            stock: line.stock,
          },
        ])
      )
    );
    const lines: PricedCartLine[] = priced.map(line => {
      const item = stocked.get(line.reference);
      const stock = item?.stock ?? line.stock;
      return {
        reference: line.reference,
        name: item?.name ?? line.reference,
        sku: item?.sku ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: multiply(line.unitPrice, line.quantity),
        available:
          stock.kind === "counted" || stock.kind === "one-off"
            ? stock.available
            : null,
        // The source's own figure, which the hold re-reads commerce's
        // records against inside the order's transaction.
        stock: line.stock,
      };
    });
    const subtotal = sum(
      currency,
      lines.map(line => line.lineTotal)
    );
    const total = subtotal;
    return {
      lines,
      summary: {
        currency,
        lines: lines.map(({ stock: _stock, ...line }) => line),
        subtotal,
        total,
        quoteKey: quoteKeyOf(cart, lines, total),
      },
    };
  }

  async function priceLines(
    asked: readonly { reference: string; quantity: number }[]
  ) {
    if (asked.length === 0) return [];
    const answer = await source.price({ currency, lines: asked });
    if (!Array.isArray(answer) || answer.length !== asked.length) {
      throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
        source: source.id,
        reason: "price did not answer one line per line asked",
      });
    }
    return asked.map((line, index) => {
      const parsed = pricedLineSchema.safeParse(answer[index]);
      if (
        !parsed.success ||
        parsed.data.reference !== line.reference ||
        parsed.data.quantity !== line.quantity
      ) {
        throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
          source: source.id,
          reason: "price answered a line outside the contract, or out of order",
        });
      }
      const priced = parsed.data;
      if (!priced.found) {
        throw commerceError("COMMERCE_ITEM_NOT_FOUND", {
          reference: line.reference,
        });
      }
      if (priced.price.kind !== "listed") {
        throw commerceError("COMMERCE_PRICE_ON_REQUEST", {
          reference: line.reference,
        });
      }
      if (priced.price.unitPrice.currency !== currency) {
        throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
          source: source.id,
          reason: "price answered another currency",
        });
      }
      return {
        reference: line.reference,
        quantity: line.quantity,
        unitPrice: priced.price.unitPrice,
        stock: priced.stock,
      };
    });
  }

  async function orderFor(cartId: string) {
    const o = db.table(orders);
    return db.select(orders).where(eq(o.checkoutKey, cartId)).first();
  }

  /**
   * Run whatever of an order's setup is still due, then answer it. The start
   * of its payment answers the provider's browser data, which is never
   * stored: an answer heard here is passed on, and otherwise the payment is
   * read back from the provider.
   */
  async function answer(orderId: string): Promise<CompletedCheckout> {
    const heard = new Map<string, ProviderPayment>();
    await runDueWork({
      db,
      handlers: checkoutWorkHandlers({
        db,
        provider: options.payments,
        source,
        now: clock,
        started: (paymentId, payment) => heard.set(paymentId, payment),
      }),
      alerts: options.alerts,
      now: clock,
      subjectId: orderId,
    });
    return readCompleted(orderId, heard);
  }

  async function readCompleted(
    orderId: string,
    heard: ReadonlyMap<string, ProviderPayment>
  ): Promise<CompletedCheckout> {
    const o = db.table(orders);
    const order = await db.select(orders).where(eq(o.id, orderId)).first();
    if (!order) {
      throw commerceError("COMMERCE_CART_BUSY", { reason: "order vanished" });
    }
    const l = db.table(orderLines);
    const lines = await db
      .select(orderLines)
      .where(eq(l.orderId, orderId))
      .orderBy(asc(l.position))
      .all();
    const p = db.table(payments);
    const [payment] = await db
      .select(payments)
      .where(eq(p.orderId, orderId))
      .orderBy(asc(p.id))
      .all()
      .then(rows => rows.slice(-1));
    if (!payment) {
      throw commerceError("COMMERCE_CART_BUSY", { reason: "payment missing" });
    }
    let clientData = heard.get(payment.id)?.clientData ?? null;
    if (
      clientData === null &&
      payment.providerReference !== null &&
      options.payments
    ) {
      clientData =
        (
          await options.payments.read({
            providerReference: payment.providerReference,
          })
        ).clientData ?? null;
    }
    return {
      order: {
        number: order.number,
        status: stored(order.status, "orders.status"),
        currency: order.currency,
        email: order.email,
        lines: lines.map(line => ({
          reference: line.reference,
          name: line.name,
          sku: line.sku,
          quantity: line.quantity,
          unitPrice: money(line.unitPriceAmount, line.unitPriceCurrency),
          lineTotal: money(line.lineTotalAmount, line.lineTotalCurrency),
        })),
        subtotal: money(order.subtotalAmount, order.subtotalCurrency),
        total: money(order.totalAmount, order.totalCurrency),
        expiresAt: order.expiresAt.toISOString(),
      },
      payment: {
        reference: payment.reference,
        status: stored(payment.status, "payments.status"),
        clientData,
      },
    };
  }

  return {
    async quote(input) {
      const cart = await findLiveCart(db, input.token, currency, clock());
      // A cart that has become an order has nothing left to quote.
      if (!cart || cart.checkedOut) throw commerceError("COMMERCE_CART_EMPTY");
      const { summary } = await summarize(cart);
      if (summary.lines.length === 0)
        throw commerceError("COMMERCE_CART_EMPTY");
      return summary;
    },

    async complete(input) {
      const request = parseRequest(completeSchema, {
        quoteKey: input.quoteKey,
        email: input.email,
        addresses: input.addresses,
      });
      // Preconditions, before anything is written: money is never taken
      // while the work that must follow it cannot run, nor by a store with
      // no way to take it.
      await assertJobsRunning({
        db,
        job: WORK_JOB,
        now: clock(),
        staleAfterMs: options.jobsStaleAfterMs,
        alert: lastRunAt => options.alerts.jobsNotRunning(lastRunAt),
      });
      const provider = options.payments;
      if (!provider) throw commerceError("COMMERCE_PAYMENTS_NOT_CONFIGURED");

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const done = await attemptCompletion(input.token, request, provider);
        if (done) return done;
      }
      throw commerceError("COMMERCE_CART_BUSY", { attempts: MAX_ATTEMPTS });
    },
  };

  /**
   * One try at completing the checkout: the order this cart already has, or
   * a new one placed, or `null` when another checkout changed what this try
   * read and it must start again.
   */
  async function attemptCompletion(
    token: string | null,
    request: z.infer<typeof completeSchema>,
    provider: PaymentProvider
  ): Promise<CompletedCheckout | null> {
    const now = clock();
    const cart = await findLiveCart(db, token, currency, now);
    if (!cart) throw commerceError("COMMERCE_CART_EMPTY");
    const placed = await orderFor(cart.id);
    if (placed) return answer(placed.id);

    const { summary, lines } = await summarize(cart);
    if (lines.length === 0) throw commerceError("COMMERCE_CART_EMPTY");
    if (summary.quoteKey !== request.quoteKey) {
      throw commerceError("COMMERCE_QUOTE_CHANGED");
    }
    requirePaymentAmount(provider, summary.total);

    try {
      const orderId = await placeOrder({
        cart,
        summary,
        lines,
        email: request.email,
        addresses: request.addresses,
        provider,
        now,
      });
      return await answer(orderId);
    } catch (error) {
      if (!(error instanceof StockRecordMoved) && !isRace(error)) throw error;
      // Another checkout changed what this one read. If it was a second
      // completion of this cart, its order is the one to answer.
      const winner = await orderFor(cart.id);
      return winner ? answer(winner.id) : null;
    }
  }

  function isRace(error: unknown): boolean {
    return (
      isUniqueViolation(dialect, error) ||
      (error instanceof Error && error.name === "CartMoved")
    );
  }

  /**
   * Create the order, in one transaction: the cart's version moved by
   * compare-and-set, so it cannot change underneath the order; the order's
   * number; its snapshot; its stock held; its pending payment; and the work
   * that must follow, recorded with it. Nothing reaches the provider before
   * this commits.
   */
  async function placeOrder(placing: {
    readonly cart: LiveCart;
    readonly summary: CheckoutSummary;
    readonly lines: readonly PricedCartLine[];
    readonly email: string;
    readonly addresses: CheckoutAddresses;
    readonly provider: PaymentProvider;
    readonly now: Date;
  }): Promise<string> {
    const { cart, summary, lines, now } = placing;
    const expiresAt = wholeSecond(
      new Date(now.getTime() + options.unpaidOrderMs)
    );
    const paymentReference = `pay_${randomUUID().replace(/-/g, "")}`;
    return db.transaction(async tx => {
      if (!(await moveCart(tx, cart, now, { checkedOutAt: now }))) {
        throw cartMoved();
      }

      const { number } = await tx.insertReturning(orderNumbers, {
        checkoutKey: cart.id,
        createdAt: now,
        updatedAt: now,
      });
      const order = await tx.insertReturning(orders, {
        number,
        checkoutKey: cart.id,
        status: "awaiting_payment",
        currency,
        subtotalAmount: summary.subtotal.amount,
        subtotalCurrency: summary.subtotal.currency,
        totalAmount: summary.total.amount,
        totalCurrency: summary.total.currency,
        email: placing.email,
        addresses: placing.addresses,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(
        orderLines,
        lines.map((line, position) => ({
          orderId: order.id,
          position,
          reference: line.reference,
          referenceKey: referenceKey(line.reference),
          name: line.name,
          sku: line.sku,
          quantity: line.quantity,
          unitPriceAmount: line.unitPrice.amount,
          unitPriceCurrency: line.unitPrice.currency,
          lineTotalAmount: line.lineTotal.amount,
          lineTotalCurrency: line.lineTotal.currency,
          createdAt: now,
          updatedAt: now,
        }))
      );
      const held = await holdStock(tx, {
        orderId: order.id,
        lines,
        expiresAt,
        now,
      });
      await options.onStockHeld?.();
      const startOperationId = `${paymentReference}:start`;
      await tx.insert(payments, {
        orderId: order.id,
        reference: paymentReference,
        provider: placing.provider.id,
        status: "pending",
        chargeAmount: summary.total.amount,
        chargeCurrency: summary.total.currency,
        startOperationId,
        createdAt: now,
        updatedAt: now,
      });
      await recordWork(tx, {
        kind: START_PAYMENT,
        subjectId: order.id,
        operationId: startOperationId,
        now,
      });
      if (sourceListens) {
        for (const line of held) {
          await recordWork(tx, {
            kind: REPORT_HOLD,
            subjectId: order.id,
            operationId: holdReportOperationId(line.holdId),
            now,
          });
        }
      }
      return order.id;
    });
  }
}

/**
 * A value read from a NOT NULL column. Enum columns are typed as possibly
 * empty whatever their declaration says, so a read is narrowed here, and a
 * value that is somehow missing is refused rather than defaulted.
 */
function stored<T>(value: T | null, column: string): T {
  if (value === null) {
    throw commerceError("COMMERCE_CART_BUSY", {
      reason: "a required column was empty",
      column,
    });
  }
  return value;
}

function cartMoved(): Error {
  const error = new Error("the cart changed while its order was placed");
  error.name = "CartMoved";
  return error;
}

/**
 * The name of one summary: the cart as it was read (its id and version) and
 * every figure priced for it. Completion compares it with the one the buyer
 * was shown, so an order is never placed for a cart or a price the buyer did
 * not see.
 */
function quoteKeyOf(
  cart: LiveCart,
  lines: readonly PricedCartLine[],
  total: Money
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        cart.id,
        cart.version,
        lines.map(line => [
          line.reference,
          line.quantity,
          line.unitPrice.amount,
          line.unitPrice.currency,
        ]),
        total.amount,
        total.currency,
      ])
    )
    .digest("hex");
}
