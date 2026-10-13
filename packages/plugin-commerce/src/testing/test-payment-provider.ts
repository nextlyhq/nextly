import { Buffer } from "node:buffer";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { NextlyError } from "@nextlyhq/plugin-sdk";

import { assertOperationId } from "../contracts/operation";
import {
  assertPaymentProvider,
  parseStartPaymentInput,
  paymentAmountRefusal,
  providerWebhookEventSchema,
  type ConfirmPaymentInput,
  type PaymentOperationInput,
  type PaymentProvider,
  type PaymentProviderCapabilities,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderRefund,
  type ProviderWebhookEvent,
  type RefundPaymentInput,
  type StartPaymentInput,
  type WebhookInput,
} from "../contracts/payment-provider";
import { commerceError } from "../errors";
import { assertSameCurrency, money } from "../money/money";

import { later } from "./later";

/**
 * The payment methods the test provider understands, standing in for what a
 * real provider's browser component produces.
 *
 * @experimental
 */
export const TEST_PAYMENT_METHODS = {
  /** Paid at once, or held when the payment captures later. */
  succeeds: "test_succeeds",
  /** Declined: the payment fails with `card_declined`. */
  declines: "test_declines",
  /** The buyer must act (a bank's check); confirming again completes it. */
  requiresAction: "test_requires_action",
  /** Accepted but not settled, like a bank debit; `control.settle` ends it. */
  processing: "test_processing",
} as const;

/** @experimental */
export interface TestPaymentProviderOptions {
  /** The provider's id. Defaults to "test". */
  readonly id?: string;
  /**
   * Capabilities to change from the defaults, which offer everything. Turning
   * `refund` off turns `partialRefund` off too, unless it is given. A result
   * commerce would refuse is refused here, when the provider is made.
   */
  readonly capabilities?: Partial<PaymentProviderCapabilities>;
  /** The webhook signing secret. Defaults to a random one per provider. */
  readonly webhookSecret?: string;
  /** The clock, in milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * What a test drives the provider with, kept apart from the provider itself so
 * the provider object is exactly the contract.
 *
 * @experimental
 */
export interface TestPaymentProviderControl {
  /** A webhook for this event, signed as the provider signs them. */
  signWebhook(event: {
    readonly type: ProviderWebhookEvent["type"];
    readonly providerReference: string | null;
    readonly eventId?: string;
  }): WebhookInput;
  /** Every payment the provider holds, oldest first. */
  payments(): readonly ProviderPayment[];
  /** Every refund the provider holds, oldest first. */
  refunds(): readonly ProviderRefund[];
  /**
   * End a `processing` payment the way the bank later would. Success makes it
   * paid, or authorised for a payment that captures later, which then waits
   * for `capture` like any other hold.
   */
  settle(
    providerReference: string,
    outcome: "succeeded" | "failed"
  ): ProviderPayment;
}

/** The signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256>`. */
export const TEST_SIGNATURE_HEADER = "x-test-signature";

/** How far a webhook's timestamp may be from the provider's clock. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

const DEFAULT_CAPABILITIES: PaymentProviderCapabilities = {
  captureLater: true,
  cancel: true,
  refund: true,
  partialRefund: true,
  operationKeyLifetimeMs: 24 * 60 * 60 * 1000,
  // Stripe's limit for one USD card payment, $999,999.99, so a test meets the
  // same ceiling a store on Stripe would.
  maxAmounts: { USD: 99_999_999 },
};

interface PaymentRecord {
  providerReference: string;
  reference: string;
  status: ProviderPaymentStatus;
  currency: string;
  amount: number;
  captured: number;
  refunded: number;
  capture: "now" | "later";
  clientSecret: string;
  failureCode?: string;
}

interface KeyRecord {
  fingerprint: string;
  at: number;
  result: unknown;
}

/**
 * A payment provider that keeps everything in memory, for tests and for a
 * store running without a real provider. It honours the payment contract
 * strictly, so commerce's own tests can rely on it, and passes the payment
 * contract suite.
 *
 * Operation keys behave as a real provider's do: within the key lifetime, a
 * repeated request returns the first answer and the same key with a different
 * request is refused; past it, the key is forgotten and the request runs
 * again. That last part is deliberate: it is what makes commerce look a lost
 * answer up instead of retrying late.
 *
 * @experimental
 */
export function createTestPaymentProvider(
  options: TestPaymentProviderOptions = {}
): { provider: PaymentProvider; control: TestPaymentProviderControl } {
  const id = options.id ?? "test";
  const refundOn = options.capabilities?.refund ?? DEFAULT_CAPABILITIES.refund;
  const capabilities: PaymentProviderCapabilities = {
    ...DEFAULT_CAPABILITIES,
    partialRefund: refundOn && DEFAULT_CAPABILITIES.partialRefund,
    ...options.capabilities,
  };
  const secret = options.webhookSecret ?? randomBytes(32).toString("hex");
  const now = options.now ?? Date.now;

  const payments = new Map<string, PaymentRecord>();
  const refunds = new Map<string, ProviderRefund>();
  const keys = new Map<string, KeyRecord>();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${++sequence}`;

  // Runs `perform` once per operation key within the key's lifetime, and
  // answers a repeat with a copy of the first result, as the contract asks.
  // Every changing call comes through here, so a malformed key is refused
  // before anything changes, whichever operation carries it.
  function once<T>(
    operation: string,
    input: { readonly operationId: string },
    perform: () => T
  ): T {
    assertOperationId(input.operationId);
    const fingerprint = `${operation}:${stableStringify(input)}`;
    const seen = keys.get(input.operationId);
    if (seen && now() - seen.at < capabilities.operationKeyLifetimeMs) {
      if (seen.fingerprint !== fingerprint) {
        throw commerceError("COMMERCE_OPERATION_KEY_REUSED", {
          provider: id,
          operation,
        });
      }
      return structuredClone(seen.result) as T;
    }
    const result = perform();
    keys.set(input.operationId, {
      fingerprint,
      at: now(),
      result: structuredClone(result),
    });
    return result;
  }

  function record(providerReference: string): PaymentRecord {
    const found = payments.get(providerReference);
    if (!found) {
      throw NextlyError.notFound({
        logContext: { provider: id, providerReference },
      });
    }
    return found;
  }

  function view(p: PaymentRecord): ProviderPayment {
    return {
      providerReference: p.providerReference,
      reference: p.reference,
      status: p.status,
      amount: money(p.amount, p.currency),
      amountCaptured: money(p.captured, p.currency),
      amountRefunded: money(p.refunded, p.currency),
      clientData: { clientSecret: p.clientSecret },
      ...(p.failureCode ? { failureCode: p.failureCode } : {}),
    };
  }

  function requireStatus(
    p: PaymentRecord,
    allowed: readonly ProviderPaymentStatus[],
    operation: string
  ): void {
    if (!allowed.includes(p.status)) {
      throw commerceError("COMMERCE_PAYMENT_STATE", {
        provider: id,
        operation,
        status: p.status,
      });
    }
  }

  function start(request: StartPaymentInput): ProviderPayment {
    const input = parseStartPaymentInput(request);
    if (input.capture === "later" && !capabilities.captureLater) {
      throw commerceError("COMMERCE_UNSUPPORTED_OPERATION", {
        provider: id,
        operation: "capture later",
      });
    }
    // The same refusal commerce applies before calling a provider, so the test
    // provider also refuses when it is called directly, as a real one would.
    const refusal = paymentAmountRefusal(capabilities, input.amount);
    if (refusal === "currency") {
      throw commerceError("COMMERCE_UNSUPPORTED_OPERATION", {
        provider: id,
        currency: input.amount.currency,
      });
    }
    if (refusal === "above-limit") {
      throw commerceError("COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT", {
        provider: id,
        currency: input.amount.currency,
      });
    }
    const providerReference = nextId("pay");
    const p: PaymentRecord = {
      providerReference,
      reference: input.reference,
      status: "pending",
      currency: input.amount.currency,
      amount: input.amount.amount,
      captured: 0,
      refunded: 0,
      capture: input.capture,
      clientSecret: `${providerReference}_secret_${randomBytes(8).toString("hex")}`,
    };
    payments.set(providerReference, p);
    return view(p);
  }

  function confirm(input: ConfirmPaymentInput): ProviderPayment {
    const p = record(input.providerReference);
    requireStatus(p, ["pending", "requires_action"], "confirm");
    // Confirming a payment that waits on the buyer's action completes it with
    // the method it already has.
    const method =
      input.paymentMethod ??
      (p.status === "requires_action"
        ? TEST_PAYMENT_METHODS.succeeds
        : undefined);
    switch (method) {
      case TEST_PAYMENT_METHODS.succeeds:
        succeed(p);
        break;
      case TEST_PAYMENT_METHODS.declines:
        p.status = "failed";
        p.failureCode = "card_declined";
        break;
      case TEST_PAYMENT_METHODS.requiresAction:
        p.status = "requires_action";
        break;
      case TEST_PAYMENT_METHODS.processing:
        p.status = "processing";
        break;
      default:
        throw NextlyError.validation({
          errors: [
            {
              path: "paymentMethod",
              code: "INVALID",
              message: "Not a payment method the test provider knows.",
            },
          ],
        });
    }
    return view(p);
  }

  // Money arriving at the provider: taken at once, or held when the payment
  // captures later. Confirming and a bank's later settlement both end here.
  function succeed(p: PaymentRecord): void {
    if (p.capture === "now") {
      p.status = "paid";
      p.captured = p.amount;
    } else {
      p.status = "authorised";
    }
  }

  function capture(input: PaymentOperationInput): ProviderPayment {
    const p = record(input.providerReference);
    requireStatus(p, ["authorised"], "capture");
    p.status = "paid";
    p.captured = p.amount;
    return view(p);
  }

  function cancel(input: PaymentOperationInput): ProviderPayment {
    const p = record(input.providerReference);
    requireStatus(p, ["pending", "requires_action", "authorised"], "cancel");
    p.status = "cancelled";
    return view(p);
  }

  function refund(input: RefundPaymentInput): ProviderRefund {
    const p = record(input.providerReference);
    requireStatus(p, ["paid"], "refund");
    assertSameCurrency(input.amount, money(0, p.currency));
    const refundable = p.captured - p.refunded;
    if (input.amount.amount <= 0 || input.amount.amount > refundable) {
      throw commerceError("COMMERCE_PAYMENT_STATE", {
        provider: id,
        operation: "refund",
        reason: "more than is left to refund",
      });
    }
    if (!capabilities.partialRefund && input.amount.amount !== refundable) {
      throw commerceError("COMMERCE_UNSUPPORTED_OPERATION", {
        provider: id,
        operation: "partial refund",
      });
    }
    p.refunded += input.amount.amount;
    const r: ProviderRefund = {
      providerRefundReference: nextId("ref"),
      providerReference: p.providerReference,
      reference: input.reference,
      amount: money(input.amount.amount, p.currency),
      status: "succeeded",
    };
    refunds.set(r.providerRefundReference, r);
    return r;
  }

  function signature(timestamp: number, rawBody: string): string {
    return createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
  }

  function invalidWebhook(reason: string) {
    return commerceError("COMMERCE_WEBHOOK_INVALID", { provider: id, reason });
  }

  // The header's timestamp and signature, refused when either is missing or
  // the timestamp is outside the tolerance (an old delivery replayed).
  function signedParts(header: string | undefined) {
    if (!header) throw invalidWebhook("no signature");
    const fields = new Map(
      header.split(",").map(part => {
        const at = part.indexOf("=");
        return [part.slice(0, at), part.slice(at + 1)] as const;
      })
    );
    const timestamp = Number(fields.get("t"));
    if (!Number.isInteger(timestamp)) throw invalidWebhook("no timestamp");
    if (Math.abs(now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
      throw invalidWebhook("timestamp outside the tolerance");
    }
    return { timestamp, given: fields.get("v1") ?? "" };
  }

  // Compared in constant time, and only at equal length, which
  // `timingSafeEqual` requires; a wrong length is simply a wrong signature.
  function signatureMatches(given: string, expectedHex: string): boolean {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = Buffer.from(
      given,
      /^[0-9a-f]*$/.test(given) ? "hex" : "utf8"
    );
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  function parsedEvent(rawBody: string): ProviderWebhookEvent {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw invalidWebhook("body is not JSON");
    }
    // The test provider's body is the contract's event itself, so the
    // contract's schema is the one that reads it.
    const parsed = providerWebhookEventSchema.safeParse(body);
    if (!parsed.success) throw invalidWebhook("body is not an event");
    return parsed.data;
  }

  // The signature is checked before the body is read, so nothing in an
  // unverified body is ever parsed.
  function verifyWebhook(input: WebhookInput): ProviderWebhookEvent {
    const { timestamp, given } = signedParts(
      input.headers[TEST_SIGNATURE_HEADER]
    );
    if (!signatureMatches(given, signature(timestamp, input.rawBody))) {
      throw invalidWebhook("signature does not match");
    }
    return parsedEvent(input.rawBody);
  }

  const provider: PaymentProvider = {
    id,
    capabilities,
    start: input => later(() => once("start", input, () => start(input))),
    confirm: input => later(() => once("confirm", input, () => confirm(input))),
    read: input => later(() => view(record(input.providerReference))),
    findByReference: input =>
      later(() => {
        const found = [...payments.values()].find(
          p => p.reference === input.reference
        );
        return found ? view(found) : null;
      }),
    verifyWebhook: input => later(() => verifyWebhook(input)),
    // Present exactly when the matching capability is, as the contract asks.
    ...(capabilities.captureLater
      ? {
          capture: (input: PaymentOperationInput) =>
            later(() => once("capture", input, () => capture(input))),
        }
      : {}),
    ...(capabilities.cancel
      ? {
          cancel: (input: PaymentOperationInput) =>
            later(() => once("cancel", input, () => cancel(input))),
        }
      : {}),
    ...(capabilities.refund
      ? {
          refund: (input: RefundPaymentInput) =>
            later(() => once("refund", input, () => refund(input))),
          findRefundByReference: (input: { readonly reference: string }) =>
            later(
              () =>
                [...refunds.values()].find(
                  r => r.reference === input.reference
                ) ?? null
            ),
        }
      : {}),
  };

  const control: TestPaymentProviderControl = {
    signWebhook(event) {
      const timestamp = Math.floor(now() / 1000);
      const rawBody = JSON.stringify({
        eventId: event.eventId ?? nextId("evt"),
        type: event.type,
        providerReference: event.providerReference,
        occurredAt: new Date(now()).toISOString(),
      });
      return {
        rawBody,
        headers: {
          [TEST_SIGNATURE_HEADER]: `t=${timestamp},v1=${signature(timestamp, rawBody)}`,
        },
      };
    },
    payments: () => [...payments.values()].map(view),
    refunds: () => [...refunds.values()],
    settle(providerReference, outcome) {
      const p = record(providerReference);
      requireStatus(p, ["processing"], "settle");
      if (outcome === "succeeded") {
        succeed(p);
      } else {
        p.status = "failed";
        p.failureCode = "debit_returned";
      }
      return view(p);
    },
  };

  // The reference provider is never one commerce would refuse, so an
  // override that makes it so fails here rather than in the test using it.
  assertPaymentProvider(provider);
  return { provider, control };
}

/**
 * JSON with object keys sorted, so two requests that differ only in key order
 * have the same fingerprint.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
