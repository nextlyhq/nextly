import { NextlyError } from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import { commerceError } from "../errors";
import { currencyCodeSchema } from "../money/currency";
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
  /**
   * The largest amount it accepts in one payment, in minor units, by
   * currency (Stripe: 99999999, that is $999,999.99, for USD cards). A
   * currency left out has no stated limit. Commerce refuses a larger total
   * before calling the provider, so the buyer gets a clear answer rather than
   * a provider error part-way through paying.
   */
  readonly maxAmounts?: Readonly<Record<string, number>>;
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
 * Only a `paid` payment has anything captured, and it always has some; an
 * answer whose status and amounts disagree is refused.
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
  /**
   * Which account at the provider this instance acts for, for a provider a
   * store can point at more than one: a stable identifier that is not a
   * secret, such as an account's own id. Commerce records it with each
   * payment and never sends a payment's later steps to another account,
   * since an operation key one account issued means nothing to the next.
   * Left out, the provider is taken to have one account.
   */
  readonly account?: string;
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

/**
 * Why this provider cannot take a payment of `amount`, or `null` when it can:
 * a currency it does not charge in, or more than it accepts in one payment.
 *
 * The one answer to the question, read by checkout (to tell the buyer before
 * they pay), by `startProviderPayment`, and by the test provider.
 *
 * @experimental
 */
export function paymentAmountRefusal(
  capabilities: PaymentProviderCapabilities,
  amount: Money
): "currency" | "above-limit" | null {
  if (
    capabilities.currencies &&
    !capabilities.currencies.includes(amount.currency)
  ) {
    return "currency";
  }
  const limit = capabilities.maxAmounts?.[amount.currency];
  return limit !== undefined && amount.amount > limit ? "above-limit" : null;
}

/**
 * Whether a payment can be started for `amount`: a payment is a positive
 * amount. The start's own input is held to this, and checkout asks it before
 * an order is placed, so an order that could never start its payment is
 * never made.
 *
 * @experimental
 */
export function isPayableAmount(amount: Money): boolean {
  return amount.amount > 0;
}

/**
 * Whether `provider` is the one a payment was begun with: the same provider,
 * acting for the same account. Only that one knows the payment's operation
 * keys and can answer for it.
 */
export function isRecordedProvider(
  payment: {
    readonly provider: string;
    readonly providerAccount: string;
  },
  provider: Pick<PaymentProvider, "id" | "account">
): boolean {
  return (
    payment.provider === provider.id &&
    payment.providerAccount === storedAccount(provider)
  );
}

/**
 * A provider's account as a payment records it: the account it names, or
 * the empty string for a provider that names none, which an account never
 * is. Never null, so a unique index over it keeps one account's references
 * apart from another's and still holds for a provider with one account.
 */
export function storedAccount(
  provider: Pick<PaymentProvider, "account">
): string {
  return provider.account ?? "";
}

/**
 * Refuse a payment the provider cannot take, before anything is sent.
 *
 * @experimental
 * @throws `COMMERCE_UNSUPPORTED_OPERATION` for a currency it does not charge
 *   in, `COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT` for more than it accepts.
 */
export function requirePaymentAmount(
  provider: PaymentProvider,
  amount: Money
): void {
  const refusal = paymentAmountRefusal(provider.capabilities, amount);
  if (refusal === "currency") {
    throw commerceError("COMMERCE_UNSUPPORTED_OPERATION", {
      provider: provider.id,
      currency: amount.currency,
    });
  }
  if (refusal === "above-limit") {
    throw commerceError("COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT", {
      provider: provider.id,
      currency: amount.currency,
      limit: provider.capabilities.maxAmounts?.[amount.currency],
    });
  }
}

/**
 * Start a payment with a provider: the way commerce starts every payment.
 *
 * Its preconditions run before the provider is called, so a request outside
 * the contract (a zero amount, a malformed operation key) or a payment the
 * provider cannot take (a currency it does not charge in, more than it
 * accepts, a hold it cannot capture) creates nothing at the provider; its
 * answer is then held to the contract before anything reads it, including
 * being the payment asked for: commerce's reference and the amount requested.
 *
 * @experimental
 */
export async function startProviderPayment(
  provider: PaymentProvider,
  request: StartPaymentInput
): Promise<ProviderPayment> {
  const input = parseStartPaymentInput(request);
  if (input.capture === "later") requirePaymentOperation(provider, "capture");
  requirePaymentAmount(provider, input.amount);
  const context = { provider: provider.id, operation: "start" as const };
  const started = parseProviderAnswer(
    providerPaymentSchema,
    await provider.start(input),
    context
  );
  // A well-formed answer for another payment would have commerce record the
  // wrong reference or amount against this order.
  if (
    started.reference !== input.reference ||
    started.amount.amount !== input.amount.amount ||
    started.amount.currency !== input.amount.currency
  ) {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      ...context,
      reason: "the answer is for another payment",
    });
  }
  return started;
}

/** The fields of {@link paymentProviderCapabilitiesSchema}. */
type PaymentProviderCapabilitiesShape = {
  captureLater: z.ZodBoolean;
  cancel: z.ZodBoolean;
  refund: z.ZodBoolean;
  partialRefund: z.ZodBoolean;
  operationKeyLifetimeMs: z.ZodNumber;
  currencies: z.ZodOptional<z.ZodArray<typeof currencyCodeSchema>>;
  maxAmounts: z.ZodOptional<
    z.ZodRecord<typeof currencyCodeSchema, z.ZodNumber>
  >;
};

/** @experimental */
export const paymentProviderCapabilitiesSchema: z.ZodObject<
  PaymentProviderCapabilitiesShape,
  z.core.$strict
> = z
  .strictObject<PaymentProviderCapabilitiesShape>({
    captureLater: z.boolean(),
    cancel: z.boolean(),
    refund: z.boolean(),
    partialRefund: z.boolean(),
    operationKeyLifetimeMs: z.number().int().positive(),
    currencies: z.array(currencyCodeSchema).min(1).optional(),
    maxAmounts: z
      .record(currencyCodeSchema, z.number().int().positive())
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
  if (
    candidate.account !== undefined &&
    (typeof candidate.account !== "string" ||
      candidate.account.length === 0 ||
      candidate.account.length > 255)
  ) {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      provider: candidate.id,
      reason: "account is not a string of 1 to 255 characters",
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

/** The states a provider reports a payment in. */
type PaymentStatuses = readonly [
  "pending",
  "requires_action",
  "processing",
  "authorised",
  "paid",
  "failed",
  "cancelled",
];

const statusSchema: z.ZodEnum<{ [K in PaymentStatuses[number]]: K }> =
  z.enum<PaymentStatuses>([
    "pending",
    "requires_action",
    "processing",
    "authorised",
    "paid",
    "failed",
    "cancelled",
  ]);

/**
 * A provider's own identifier or code, as commerce stores it: at most 255
 * characters, the most its columns hold on every dialect. Longer is refused
 * here, as a broken answer, rather than by one database alone.
 */
const providerStringSchema: z.ZodString = z.string().min(1).max(255);

/** The fields of {@link providerPaymentSchema}. */
type ProviderPaymentShape = {
  providerReference: typeof providerStringSchema;
  reference: z.ZodString;
  status: typeof statusSchema;
  amount: typeof moneySchema;
  amountCaptured: typeof moneySchema;
  amountRefunded: typeof moneySchema;
  clientData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  failureCode: z.ZodOptional<z.ZodString>;
};

/**
 * A provider's payment as commerce accepts it: every amount valid and in one
 * currency, nothing refunded beyond what was captured, nor captured beyond
 * the amount, and money captured exactly when the payment is paid.
 *
 * @experimental
 */
export const providerPaymentSchema: z.ZodObject<
  ProviderPaymentShape,
  z.core.$strict
> = z
  .strictObject<ProviderPaymentShape>({
    providerReference: providerStringSchema,
    reference: z.string().min(1),
    status: statusSchema,
    amount: moneySchema,
    amountCaptured: moneySchema,
    amountRefunded: moneySchema,
    clientData: z.record(z.string(), z.string()).optional(),
    failureCode: z.string().max(255).optional(),
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
  )
  .refine(p => p.amount.amount > 0, {
    message: "a payment is a positive amount",
  })
  .refine(p => (p.status === "paid") === p.amountCaptured.amount > 0, {
    message: "a paid payment has money captured, and no other has any",
  });

/** The states a provider reports a refund in. */
type RefundStatuses = readonly ["pending", "succeeded", "failed"];
/** The fields of {@link providerRefundSchema}. */
type ProviderRefundShape = {
  providerRefundReference: typeof providerStringSchema;
  providerReference: typeof providerStringSchema;
  reference: z.ZodString;
  amount: typeof moneySchema;
  status: z.ZodEnum<{ [K in RefundStatuses[number]]: K }>;
};

/** @experimental */
export const providerRefundSchema: z.ZodObject<
  ProviderRefundShape,
  z.core.$strict
> = z.strictObject<ProviderRefundShape>({
  providerRefundReference: providerStringSchema,
  providerReference: providerStringSchema,
  reference: z.string().min(1),
  amount: moneySchema.refine(m => m.amount > 0, {
    message: "a refund is a positive amount",
  }),
  status: z.enum<RefundStatuses>(["pending", "succeeded", "failed"]),
});

/** The kinds of event a provider's webhook carries. */
type WebhookEventTypes = readonly [
  "payment.updated",
  "refund.updated",
  "dispute.updated",
  "other",
];
/** The fields of {@link providerWebhookEventSchema}. */
type ProviderWebhookEventShape = {
  eventId: z.ZodString;
  type: z.ZodEnum<{ [K in WebhookEventTypes[number]]: K }>;
  providerReference: z.ZodNullable<typeof providerStringSchema>;
  occurredAt: z.ZodISODateTime;
};

/** @experimental */
export const providerWebhookEventSchema: z.ZodObject<
  ProviderWebhookEventShape,
  z.core.$strict
> = z.strictObject<ProviderWebhookEventShape>({
  eventId: z.string().min(1),
  type: z.enum<WebhookEventTypes>([
    "payment.updated",
    "refund.updated",
    "dispute.updated",
    "other",
  ]),
  providerReference: providerStringSchema.nullable(),
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

/** When a payment is captured. */
type CaptureTimes = readonly ["now", "later"];
/** The fields of {@link startPaymentInputSchema}. */
type StartPaymentInputShape = {
  operationId: typeof operationIdSchema;
  reference: z.ZodString;
  amount: typeof moneySchema;
  capture: z.ZodEnum<{ [K in CaptureTimes[number]]: K }>;
  email: z.ZodOptional<z.ZodEmail>;
  description: z.ZodOptional<z.ZodString>;
};

/**
 * The start request as commerce sends it, so a provider can parse its input
 * at its own boundary.
 *
 * @experimental
 */
export const startPaymentInputSchema: z.ZodObject<
  StartPaymentInputShape,
  z.core.$strict
> = z.strictObject<StartPaymentInputShape>({
  operationId: operationIdSchema,
  reference: z.string().min(1).max(255),
  amount: moneySchema.refine(isPayableAmount, {
    message: "a payment is a positive amount",
  }),
  capture: z.enum<CaptureTimes>(["now", "later"]),
  email: z.email().optional(),
  description: z.string().max(1000).optional(),
});

/**
 * The start request held to `startPaymentInputSchema`: what commerce checks
 * before calling a provider, and what a provider checks at its own boundary.
 *
 * @experimental
 * @throws `VALIDATION_ERROR` naming each field outside the contract.
 */
export function parseStartPaymentInput(input: unknown): StartPaymentInput {
  const parsed = startPaymentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.join("."),
        code: "INVALID",
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}
