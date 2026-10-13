import { z } from "zod";

import { commerceError } from "../errors";
import { moneySchema, type Money } from "../money/money";

import { operationIdSchema, type OperationId } from "./operation";

/**
 * What a payment provider can do. Commerce offers an operation only when the
 * provider declares it, so a store never shows "capture" or "refund" for a
 * provider that cannot do it.
 *
 * @experimental
 */
export interface PaymentProviderCapabilities {
  /**
   * Money can be held when the payment starts and captured later. Requires
   * `capture`.
   */
  readonly captureLater: boolean;
  /** A payment not yet paid can be cancelled. Requires `cancel`. */
  readonly cancel: boolean;
  /**
   * A paid payment can be refunded. Requires `refund` and
   * `findRefundByReference`.
   */
  readonly refund: boolean;
  /** A refund may be less than what was captured. Needs `refund`. */
  readonly partialRefund: boolean;
  /**
   * How long, in milliseconds, the provider treats a repeated operation key
   * as the same operation (24 hours at Stripe). Past it, commerce looks a lost
   * answer up by its own reference instead of repeating the call, which the
   * provider would then perform a second time.
   */
  readonly operationKeyLifetimeMs: number;
  /**
   * The ISO 4217 codes it can charge in; omitted when it takes any.
   */
  readonly currencies?: readonly string[];
}

/**
 * A payment's state as the provider reports it.
 *
 * - `pending`: created, waiting for a payment method or confirmation.
 * - `requires_action`: the buyer must do something (a bank's check).
 * - `processing`: confirmed, money not settled yet (a bank debit clearing).
 * - `authorised`: money held, not captured (only with `captureLater`).
 * - `paid`: captured.
 * - `failed`, `cancelled`: over, nothing captured.
 *
 * Refunds are not a payment state: they are counted in `amountRefunded`, and
 * commerce derives "partially refunded" or "refunded" from the amounts.
 *
 * @experimental
 */
export type ProviderPaymentStatus =
  | "pending"
  | "requires_action"
  | "processing"
  | "authorised"
  | "paid"
  | "failed"
  | "cancelled";

/** @experimental */
export interface ProviderPayment {
  /** The provider's identifier for this payment. */
  readonly providerReference: string;
  /** Commerce's own payment reference, sent when the payment started. */
  readonly reference: string;
  readonly status: ProviderPaymentStatus;
  readonly amount: Money;
  readonly amountCaptured: Money;
  readonly amountRefunded: Money;
  /**
   * What the provider's browser component needs to collect and confirm the
   * payment (a client secret, say). Opaque to commerce, passed to the page as
   * is, never stored.
   */
  readonly clientData?: Readonly<Record<string, string>>;
  /** The provider's code for why it failed, when `status` is `failed`. */
  readonly failureCode?: string;
}

/** @experimental */
export interface ProviderRefund {
  /** The provider's identifier for this refund. */
  readonly providerRefundReference: string;
  /** The payment it refunds. */
  readonly providerReference: string;
  /** Commerce's own refund reference, sent when the refund was asked for. */
  readonly reference: string;
  readonly amount: Money;
  readonly status: "pending" | "succeeded" | "failed";
}

/**
 * An inbound webhook, exactly as it arrived: the raw body (signatures are over
 * these bytes, so it is never re-serialised) and the headers, names in lower
 * case.
 *
 * @experimental
 */
export interface WebhookInput {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * A verified webhook, reduced to what commerce needs to act: which event (to
 * record it once), what it is about, and which payment. Commerce then reads
 * the payment from the provider rather than trusting the event's own copy of
 * its state, so a late or repeated event cannot move a payment backwards.
 *
 * @experimental
 */
export interface ProviderWebhookEvent {
  /** The provider's id for the event, unique per provider. */
  readonly eventId: string;
  readonly type:
    | "payment.updated"
    | "refund.updated"
    | "dispute.updated"
    | "other";
  /** The payment it concerns, when it concerns one. */
  readonly providerReference: string | null;
  /** When the provider says it happened, as an ISO 8601 timestamp. */
  readonly occurredAt: string;
}

/** @experimental */
export interface StartPaymentInput {
  readonly operationId: OperationId;
  /** Commerce's own payment reference; the provider keeps it with the payment. */
  readonly reference: string;
  readonly amount: Money;
  /** Capture at once, or hold for capture later (needs `captureLater`). */
  readonly capture: "now" | "later";
  readonly email?: string;
  readonly description?: string;
}

/** @experimental */
export interface ConfirmPaymentInput {
  readonly operationId: OperationId;
  readonly providerReference: string;
  /** The payment method the provider's browser component produced, as it gave it. */
  readonly paymentMethod?: string;
}

/** @experimental */
export interface PaymentOperationInput {
  readonly operationId: OperationId;
  readonly providerReference: string;
}

/** @experimental */
export interface RefundPaymentInput {
  readonly operationId: OperationId;
  readonly providerReference: string;
  /** Commerce's own refund reference; the provider keeps it with the refund. */
  readonly reference: string;
  readonly amount: Money;
  readonly reason?: "requested_by_customer" | "duplicate" | "fraudulent";
}

/**
 * The contract every payment provider plugin implements (Stripe first).
 *
 * Every call that changes something at the provider carries an
 * `operationId`, which the provider must use as its idempotency key: a call
 * repeated with the same `operationId` and the same request within
 * `operationKeyLifetimeMs` returns the first call's result and does nothing
 * more, and the same `operationId` with a different request is refused.
 *
 * Optional methods are present exactly when the matching capability is
 * declared (`assertPaymentProvider` checks).
 *
 * @experimental
 */
export interface PaymentProvider {
  /** A short, stable key for the provider, such as "stripe". */
  readonly id: string;
  readonly capabilities: PaymentProviderCapabilities;
  /** Create the provider's payment for commerce's reference and amount. */
  start(input: StartPaymentInput): Promise<ProviderPayment>;
  /** Confirm it on the server, after the browser collected the method. */
  confirm(input: ConfirmPaymentInput): Promise<ProviderPayment>;
  /** Capture money held at start. With `captureLater` only. */
  capture?(input: PaymentOperationInput): Promise<ProviderPayment>;
  /** Cancel a payment not yet paid. With `cancel` only. */
  cancel?(input: PaymentOperationInput): Promise<ProviderPayment>;
  /** Refund all or, with `partialRefund`, part of what was captured. */
  refund?(input: RefundPaymentInput): Promise<ProviderRefund>;
  /** Find a refund by commerce's own refund reference. With `refund` only. */
  findRefundByReference?(input: {
    readonly reference: string;
  }): Promise<ProviderRefund | null>;
  /** The payment's current state at the provider. */
  read(input: { readonly providerReference: string }): Promise<ProviderPayment>;
  /**
   * Find a payment by commerce's own reference, for an answer that was lost
   * before commerce saved the provider's reference.
   */
  findByReference(input: {
    readonly reference: string;
  }): Promise<ProviderPayment | null>;
  /**
   * Check the webhook's signature over the raw body and parse it, or throw
   * `COMMERCE_WEBHOOK_INVALID`. Never accepts an unsigned or tampered body.
   */
  verifyWebhook(input: WebhookInput): Promise<ProviderWebhookEvent>;
}

/**
 * The operations commerce may ask of a payment provider.
 *
 * @experimental
 */
export type PaymentOperation =
  | "start"
  | "confirm"
  | "capture"
  | "cancel"
  | "refund"
  | "findRefundByReference"
  | "read"
  | "findByReference"
  | "verifyWebhook";

/**
 * The capability each optional operation needs. The others every provider
 * offers.
 */
const OPERATION_CAPABILITY: Partial<
  Record<PaymentOperation, keyof PaymentProviderCapabilities>
> = {
  capture: "captureLater",
  cancel: "cancel",
  refund: "refund",
  findRefundByReference: "refund",
};

const ALL_OPERATIONS: readonly PaymentOperation[] = [
  "start",
  "confirm",
  "capture",
  "cancel",
  "refund",
  "findRefundByReference",
  "read",
  "findByReference",
  "verifyWebhook",
];

/**
 * Whether commerce may offer `operation` for this provider, from its declared
 * capabilities alone. The one place that answers it: screens, routes and jobs
 * all ask here.
 *
 * @experimental
 */
export function supportsPaymentOperation(
  capabilities: PaymentProviderCapabilities,
  operation: PaymentOperation
): boolean {
  const needs = OPERATION_CAPABILITY[operation];
  return needs === undefined ? true : capabilities[needs] === true;
}

/**
 * The operations commerce may offer for this provider, derived from
 * `supportsPaymentOperation`.
 *
 * @experimental
 */
export function supportedPaymentOperations(
  capabilities: PaymentProviderCapabilities
): PaymentOperation[] {
  return ALL_OPERATIONS.filter(op =>
    supportsPaymentOperation(capabilities, op)
  );
}

/**
 * Refuse an operation the provider does not offer, before anything is sent.
 *
 * @experimental
 * @throws `COMMERCE_UNSUPPORTED_OPERATION`
 */
export function requirePaymentOperation(
  provider: PaymentProvider,
  operation: PaymentOperation
): void {
  if (!supportsPaymentOperation(provider.capabilities, operation)) {
    throw commerceError("COMMERCE_UNSUPPORTED_OPERATION", {
      provider: provider.id,
      operation,
    });
  }
}

/** @experimental */
export const paymentProviderCapabilitiesSchema = z
  .strictObject({
    captureLater: z.boolean(),
    cancel: z.boolean(),
    refund: z.boolean(),
    partialRefund: z.boolean(),
    operationKeyLifetimeMs: z.number().int().positive(),
    currencies: z
      .array(z.string().regex(/^[A-Z]{3}$/))
      .min(1)
      .optional(),
  })
  .refine(c => c.refund || !c.partialRefund, {
    message: "partialRefund needs refund",
  });

/**
 * Refuse a provider whose declaration is malformed, or whose methods disagree
 * with its capabilities: a declared operation without its method, or a method
 * for an operation it does not declare. Either would let commerce offer what
 * the provider cannot do, or hide what it can.
 *
 * @experimental
 * @throws `COMMERCE_PROVIDER_CONTRACT`
 */
export function assertPaymentProvider(
  provider: unknown
): asserts provider is PaymentProvider {
  if (typeof provider !== "object" || provider === null) {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      reason: "not an object",
    });
  }
  const candidate = provider as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    !/^[a-z][a-z0-9-]{0,62}$/.test(candidate.id)
  ) {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      reason: "id is not a lower-case slug",
    });
  }
  const capabilities = paymentProviderCapabilitiesSchema.safeParse(
    candidate.capabilities
  );
  if (!capabilities.success) {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      provider: candidate.id,
      reason: "capabilities do not parse",
      issues: capabilities.error.issues.map(i => i.message),
    });
  }
  for (const operation of ALL_OPERATIONS) {
    const offered = supportsPaymentOperation(capabilities.data, operation);
    const implemented = typeof candidate[operation] === "function";
    if (offered !== implemented) {
      throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
        provider: candidate.id,
        operation,
        reason: offered
          ? "declared but not implemented"
          : "implemented but not declared",
      });
    }
  }
}

const statusSchema = z.enum([
  "pending",
  "requires_action",
  "processing",
  "authorised",
  "paid",
  "failed",
  "cancelled",
]);

/**
 * A provider's payment as commerce accepts it: every amount valid and in one
 * currency, and nothing refunded beyond what was captured, nor captured beyond
 * the amount.
 *
 * @experimental
 */
export const providerPaymentSchema = z
  .strictObject({
    providerReference: z.string().min(1),
    reference: z.string().min(1),
    status: statusSchema,
    amount: moneySchema,
    amountCaptured: moneySchema,
    amountRefunded: moneySchema,
    clientData: z.record(z.string(), z.string()).optional(),
    failureCode: z.string().optional(),
  })
  .refine(
    p =>
      p.amountCaptured.currency === p.amount.currency &&
      p.amountRefunded.currency === p.amount.currency,
    { message: "every amount of a payment is in one currency" }
  )
  .refine(
    p =>
      p.amountCaptured.amount >= 0 &&
      p.amountCaptured.amount <= p.amount.amount &&
      p.amountRefunded.amount >= 0 &&
      p.amountRefunded.amount <= p.amountCaptured.amount,
    { message: "0 <= refunded <= captured <= amount" }
  );

/** @experimental */
export const providerRefundSchema = z.strictObject({
  providerRefundReference: z.string().min(1),
  providerReference: z.string().min(1),
  reference: z.string().min(1),
  amount: moneySchema.refine(m => m.amount > 0, {
    message: "a refund is a positive amount",
  }),
  status: z.enum(["pending", "succeeded", "failed"]),
});

/** @experimental */
export const providerWebhookEventSchema = z.strictObject({
  eventId: z.string().min(1),
  type: z.enum([
    "payment.updated",
    "refund.updated",
    "dispute.updated",
    "other",
  ]),
  providerReference: z.string().min(1).nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
});

/**
 * Parse a provider's answer at the boundary, refusing one outside the
 * contract rather than letting it reach commerce's records.
 *
 * @experimental
 * @throws `COMMERCE_PROVIDER_CONTRACT`
 */
export function parseProviderAnswer<S extends z.ZodType>(
  schema: S,
  answer: unknown,
  context: { provider: string; operation: PaymentOperation }
): z.output<S> {
  const parsed = schema.safeParse(answer);
  if (!parsed.success) {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      ...context,
      issues: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
    });
  }
  return parsed.data;
}

/**
 * The start request as commerce sends it, so a provider can parse its input
 * at its own boundary.
 *
 * @experimental
 */
export const startPaymentInputSchema = z.strictObject({
  operationId: operationIdSchema,
  reference: z.string().min(1).max(255),
  amount: moneySchema.refine(m => m.amount > 0, {
    message: "a payment is a positive amount",
  }),
  capture: z.enum(["now", "later"]),
  email: z.email().optional(),
  description: z.string().max(1000).optional(),
});
