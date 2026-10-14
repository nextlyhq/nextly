import { eq, isNull } from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import { allOf } from "../cart/conditions";
import type { CatalogueSource } from "../contracts/catalogue-source";
import {
  parseProviderAnswer,
  providerPaymentSchema,
  startProviderPayment,
  type PaymentProvider,
  type ProviderPayment,
} from "../contracts/payment-provider";
import { commerceError } from "../errors";
import { money, type Money } from "../money/money";
import { ownTransaction } from "../own-transaction";
import { orders, payments, stockHolds } from "../schema/tables";
import type { WorkHandler, WorkItem } from "../work/work-runner";

/** The kinds of follow-up work checkout records. */
export const START_PAYMENT = "commerce.start-payment";
export const REPORT_HOLD = "commerce.report-hold";

/** The operation id a hold's report is sent under: its own hold's id. */
export function holdReportOperationId(holdId: string): string {
  return `hold:${holdId}`;
}

/**
 * The work handlers checkout's steps run with.
 *
 * `started` hears each payment start's answer as it arrives: completion uses
 * it to hand the provider's browser data to the buyer at once, since that
 * data is never stored.
 */
export function checkoutWorkHandlers(deps: {
  readonly db: PluginDatabase;
  readonly provider: PaymentProvider | undefined;
  readonly source: CatalogueSource;
  readonly now: () => Date;
  readonly started?: (paymentId: string, answer: ProviderPayment) => void;
}): Record<string, WorkHandler> {
  return {
    [START_PAYMENT]: item => startPayment(deps, item),
    [REPORT_HOLD]: item => reportHold(deps, item),
  };
}

/**
 * Start a payment with the provider, exactly once however often it runs.
 *
 * The call goes under the payment's own operation id, saved with the order
 * before any call, which the provider takes as its idempotency key. Inside
 * the provider's key lifetime, counted from the first attempt, a retry makes
 * the same call again and gets the first call's answer. Past it, a retry
 * would make a second payment, so the payment is looked up by commerce's own
 * reference instead: adopted if the provider has it, failed if it has none.
 */
async function startPayment(
  deps: Parameters<typeof checkoutWorkHandlers>[0],
  item: WorkItem
): Promise<void> {
  const provider = deps.provider;
  if (!provider) {
    throw commerceError("COMMERCE_PAYMENTS_NOT_CONFIGURED");
  }
  const pending = await pendingStart(deps.db, item.operationId);
  // Already started, or gone: a repeat of a step whose earlier attempt
  // succeeded but could not record it as done.
  if (!pending) return;
  const { payment, email } = pending;

  const amount = money(payment.chargeAmount, payment.chargeCurrency);
  // The first attempt always calls: no call has been made yet, so there is
  // nothing to look up, and the first attempt's moment is stored to the
  // second, which could otherwise read as older than a short key lifetime.
  const withinKeyLifetime =
    item.attempt === 1 ||
    deps.now().getTime() - item.firstAttemptAt.getTime() <
      provider.capabilities.operationKeyLifetimeMs;
  const answer = withinKeyLifetime
    ? await startProviderPayment(provider, {
        operationId: payment.startOperationId,
        reference: payment.reference,
        amount,
        capture: "now",
        email,
      })
    : await findStarted(provider, payment.reference);

  const recorded = answer ?? null;
  if (recorded) assertAnswerFor(provider, recorded, payment.reference, amount);
  await recordStart(deps.db, payment, recorded, deps.now());
  if (recorded) deps.started?.(payment.id, recorded);
}

/** The payment a start step is for, with its order's email, while it is still unstarted. */
async function pendingStart(db: PluginDatabase, operationId: string) {
  const p = db.table(payments);
  const payment = await db
    .select(payments)
    .where(eq(p.startOperationId, operationId))
    .first();
  if (!payment || payment.providerReference !== null) return null;
  const o = db.table(orders);
  const order = await db
    .select(orders)
    .where(eq(o.id, payment.orderId))
    .first();
  return order ? { payment, email: order.email } : null;
}

/** Refuse a start answer that is not for the payment asked about. */
function assertAnswerFor(
  provider: PaymentProvider,
  answer: ProviderPayment,
  reference: string,
  amount: Money
): void {
  if (
    answer.reference !== reference ||
    answer.amount.amount !== amount.amount ||
    answer.amount.currency !== amount.currency
  ) {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      provider: provider.id,
      operation: "start",
      reason: "the provider answered for another payment",
    });
  }
}

/**
 * Record what the provider said of a start: its reference and state, or, for
 * a payment it has no record of past the key's lifetime, that the attempt
 * failed. Written against the payment as it was read, in a transaction of
 * its own.
 */
async function recordStart(
  db: PluginDatabase,
  payment: { readonly id: string; readonly version: number },
  answer: ProviderPayment | null,
  now: Date
): Promise<void> {
  await ownTransaction(db, tx => {
    const tp = tx.table(payments);
    return tx
      .update(
        payments,
        answer
          ? {
              providerReference: answer.providerReference,
              status: answer.status,
              failureCode: answer.failureCode ?? null,
              version: payment.version + 1,
              updatedAt: now,
            }
          : {
              status: "failed",
              failureCode: "not_found_at_provider",
              version: payment.version + 1,
              updatedAt: now,
            }
      )
      .where(allOf(eq(tp.id, payment.id), eq(tp.version, payment.version)));
  });
}

async function findStarted(
  provider: PaymentProvider,
  reference: string
): Promise<ProviderPayment | null> {
  const found = await provider.findByReference({ reference });
  if (found === null) return null;
  return parseProviderAnswer(providerPaymentSchema, found, {
    provider: provider.id,
    operation: "findByReference",
  });
}

/**
 * Tell a catalogue source that hears reports about a hold, once however often
 * it runs: the report goes under the hold's own operation id, which the
 * source records once. When it has, the hold is marked confirmed. The hold
 * still comes off the source's figure until it ends, since the contract
 * leaves the source free to count holds in that figure or not.
 */
async function reportHold(
  deps: Parameters<typeof checkoutWorkHandlers>[0],
  item: WorkItem
): Promise<void> {
  const listener = deps.source.stock;
  if (!listener) return;
  const h = deps.db.table(stockHolds);
  const hold = await deps.db
    .select(stockHolds)
    .where(eq(h.id, item.operationId.slice("hold:".length)))
    .first();
  if (!hold || hold.confirmedAt !== null) return;
  const o = deps.db.table(orders);
  const order = await deps.db
    .select(orders)
    .where(eq(o.id, hold.orderId))
    .first();
  if (!order) return;

  await listener.report({
    operationId: item.operationId,
    kind: "hold",
    reference: hold.reference,
    quantity: hold.quantity,
    orderReference: String(order.number),
  });

  const now = deps.now();
  await ownTransaction(deps.db, tx => {
    const th = tx.table(stockHolds);
    return tx
      .update(stockHolds, { confirmedAt: now, updatedAt: now })
      .where(allOf(eq(th.id, hold.id), isNull(th.confirmedAt)));
  });
}
