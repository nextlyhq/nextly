import { randomUUID } from "node:crypto";

import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  assertPaymentProvider,
  providerPaymentSchema,
  providerRefundSchema,
  providerWebhookEventSchema,
  supportsPaymentOperation,
  type PaymentProvider,
  type ProviderPayment,
  type ProviderRefund,
  type ProviderWebhookEvent,
  type WebhookInput,
} from "../contracts/payment-provider";
import { money } from "../money/money";

import {
  expectContract,
  expectRefusal,
  ContractViolation,
  type ContractCase,
} from "./contract-case";

/**
 * A provider to test, and a way to make webhooks it should accept.
 *
 * @experimental
 */
export interface PaymentProviderUnderTest {
  readonly provider: PaymentProvider;
  /**
   * A webhook for this event, signed with the provider's real scheme and
   * secret. A plain function, not a method, so it can be passed around.
   */
  readonly signWebhook: (event: {
    readonly type: ProviderWebhookEvent["type"];
    readonly providerReference: string | null;
  }) => WebhookInput | Promise<WebhookInput>;
}

/** @experimental */
export interface PaymentProviderContractOptions {
  /** A fresh provider for each case, in its test mode. */
  create(): PaymentProviderUnderTest | Promise<PaymentProviderUnderTest>;
  /** A currency the provider charges in. */
  readonly currency: string;
  /** A positive amount, in minor units, to charge; even, so it halves exactly. */
  readonly amount: number;
  /** Payment methods the provider's test mode treats as succeeding and as declined. */
  readonly paymentMethods: {
    readonly succeeds: string;
    readonly declines: string;
  };
}

/**
 * The payment contract's test suite. Every payment provider plugin runs it in
 * its own tests, against its test mode.
 *
 * Each case that changes something at the provider loses the provider's
 * answer once and repeats the call with the same operation key, then checks
 * the change happened exactly once, and that the payment or refund can be
 * found again by commerce's own reference.
 *
 * It is async because it builds one provider first to read its capabilities:
 * a case for an operation the provider does not declare is left out, rather
 * than included and passing without checking anything.
 *
 * ```ts
 * for (const c of await paymentProviderContract(options)) it(c.name, c.run);
 * ```
 *
 * @experimental
 */
export async function paymentProviderContract(
  options: PaymentProviderContractOptions
): Promise<ContractCase[]> {
  if (!Number.isSafeInteger(options.amount) || options.amount <= 0) {
    throw new ContractViolation("the contract needs a positive whole amount");
  }
  if (options.amount % 2 !== 0) {
    throw new ContractViolation("the contract needs an even amount to halve");
  }
  const amount = money(options.amount, options.currency);
  const unique = (label: string) => `${label}-${randomUUID()}`;

  // Each case gets a fresh provider and references of its own, so cases never
  // see each other's payments, even against a shared real test account.
  async function setUp() {
    const underTest = await options.create();
    return { ...underTest, p: underTest.provider };
  }

  async function startPayment(
    p: PaymentProvider,
    capture: "now" | "later" = "now"
  ) {
    const reference = unique("pay");
    const started = asPayment(
      await p.start({ operationId: unique("op"), reference, amount, capture })
    );
    return { reference, started };
  }

  async function paidPayment(p: PaymentProvider) {
    const { reference, started } = await startPayment(p);
    const confirmed = asPayment(
      await p.confirm({
        operationId: unique("op"),
        providerReference: started.providerReference,
        paymentMethod: options.paymentMethods.succeeds,
      })
    );
    expectContract(
      confirmed.status === "paid",
      `a payment confirmed with a succeeding method is paid, not ${confirmed.status}`
    );
    return { reference, payment: confirmed };
  }

  // An answer about a payment must be about that payment: a structurally valid
  // answer for another one would corrupt the record commerce keeps of it.
  function expectAnswerFor(answer: ProviderPayment, started: ProviderPayment) {
    expectContract(
      answer.providerReference === started.providerReference &&
        answer.reference === started.reference &&
        answer.amount.amount === started.amount.amount &&
        answer.amount.currency === started.amount.currency,
      "the answer is for the payment asked about"
    );
  }

  // What a repeated confirm or capture must leave behind: the amount captured
  // once, read back from the provider rather than taken from the answer.
  async function expectCapturedOnce(
    p: PaymentProvider,
    providerReference: string
  ) {
    const read = asPayment(await p.read({ providerReference }));
    expectContract(
      read.amountCaptured.amount === amount.amount,
      `the amount was captured once (${read.amountCaptured.amount} captured of ${amount.amount})`
    );
  }

  const cases: ContractCase[] = [];
  const add = (name: string, run: () => Promise<void>) =>
    cases.push({ name, run });

  add(
    "declares a valid id and capabilities that match its methods",
    async () => {
      const { p } = await setUp();
      try {
        assertPaymentProvider(p);
      } catch (error) {
        throw new ContractViolation(
          `the provider's declaration is refused: ${describeError(error)}`
        );
      }
    }
  );

  add("starts a payment for commerce's reference and amount", async () => {
    const { p } = await setUp();
    const { reference, started } = await startPayment(p);
    expectContract(
      started.reference === reference,
      "the payment keeps commerce's reference"
    );
    expectContract(
      started.amount.amount === amount.amount &&
        started.amount.currency === amount.currency,
      "the payment is for the amount asked"
    );
    expectContract(
      started.amountCaptured.amount === 0,
      "a started payment has captured nothing"
    );
    expectContract(
      started.status === "pending" || started.status === "requires_action",
      `a started payment waits for the buyer, not ${started.status}`
    );
  });

  add(
    "reads a payment back, and finds it by commerce's reference",
    async () => {
      const { p } = await setUp();
      const { reference, started } = await startPayment(p);
      const read = asPayment(
        await p.read({ providerReference: started.providerReference })
      );
      expectContract(
        read.providerReference === started.providerReference,
        "read returns the payment asked for"
      );
      const found = await p.findByReference({ reference });
      expectContract(
        found !== null,
        "a payment is found by commerce's reference"
      );
      expectContract(
        asPayment(found).providerReference === started.providerReference,
        "the payment found by reference is the one started"
      );
      expectContract(
        (await p.findByReference({ reference: unique("unknown") })) === null,
        "an unknown reference finds nothing"
      );
    }
  );

  add(
    "starts once when the answer to a start is lost and the start is repeated",
    async () => {
      const { p } = await setUp();
      const reference = unique("pay");
      const request = {
        operationId: unique("op"),
        reference,
        amount,
        capture: "now" as const,
      };
      // The answer commerce never saw is kept here, so the repeat and the
      // lookup can both be held to the payment the first call made.
      const lost = asPayment(await p.start(request));
      const repeated = asPayment(await p.start(request));
      expectContract(
        repeated.providerReference === lost.providerReference,
        "the repeated start returns the first payment, not a second one"
      );
      const found = await p.findByReference({ reference });
      expectContract(
        found !== null,
        "the payment whose answer was lost is found by reference"
      );
      expectContract(
        asPayment(found).providerReference === lost.providerReference,
        "the payment found by reference is the one the first start made"
      );
    }
  );

  add("refuses an operation key reused for a different request", async () => {
    const { p } = await setUp();
    const operationId = unique("op");
    await p.start({
      operationId,
      reference: unique("pay"),
      amount,
      capture: "now",
    });
    const reference = unique("pay");
    const error = await expectRefusal(
      () =>
        p.start({
          operationId,
          reference,
          amount: money(options.amount + 2, options.currency),
          capture: "now",
        }),
      "a key reused for a different request is refused"
    );
    expectContract(
      NextlyError.isCode(error, "COMMERCE_OPERATION_KEY_REUSED"),
      `the refusal is COMMERCE_OPERATION_KEY_REUSED, not ${describeError(error)}`
    );
    expectContract(
      (await p.findByReference({ reference })) === null,
      "a refused request leaves nothing at the provider"
    );
  });

  add(
    "charges once when the answer to a confirm is lost and the confirm is repeated",
    async () => {
      const { p } = await setUp();
      const { started } = await startPayment(p);
      const request = {
        operationId: unique("op"),
        providerReference: started.providerReference,
        paymentMethod: options.paymentMethods.succeeds,
      };
      await p.confirm(request); // the answer is lost
      const repeated = asPayment(await p.confirm(request));
      expectAnswerFor(repeated, started);
      expectContract(
        repeated.status === "paid",
        `the payment is paid, not ${repeated.status}`
      );
      await expectCapturedOnce(p, started.providerReference);
    }
  );

  add("reports a declined payment as failed, never as paid", async () => {
    const { p } = await setUp();
    const { started } = await startPayment(p);
    const declined = asPayment(
      await p.confirm({
        operationId: unique("op"),
        providerReference: started.providerReference,
        paymentMethod: options.paymentMethods.declines,
      })
    );
    expectAnswerFor(declined, started);
    expectContract(
      declined.status === "failed",
      `a declined payment is failed, not ${declined.status}`
    );
    expectContract(
      declined.amountCaptured.amount === 0,
      "a declined payment captured nothing"
    );
  });

  add(
    "verifies a signed webhook, and refuses a tampered or unsigned one",
    async () => {
      const { p, signWebhook } = await setUp();
      const { started } = await startPayment(p);
      const signed = await signWebhook({
        type: "payment.updated",
        providerReference: started.providerReference,
      });
      const event = asEvent(await p.verifyWebhook(signed));
      expectContract(
        event.providerReference === started.providerReference,
        "the verified event names the payment"
      );
      const again = asEvent(await p.verifyWebhook(signed));
      expectContract(
        again.eventId === event.eventId,
        "the same delivery has the same event id"
      );
      const other = asEvent(
        await p.verifyWebhook(
          await signWebhook({
            type: "payment.updated",
            providerReference: started.providerReference,
          })
        )
      );
      expectContract(
        other.eventId !== event.eventId,
        "another event has another id, so commerce does not drop it as a repeat"
      );

      const tampered = await expectRefusal(
        () => p.verifyWebhook({ ...signed, rawBody: tamper(signed.rawBody) }),
        "a webhook whose body was changed after signing is refused"
      );
      expectContract(
        NextlyError.isCode(tampered, "COMMERCE_WEBHOOK_INVALID"),
        `a tampered webhook is refused as COMMERCE_WEBHOOK_INVALID, not ${describeError(tampered)}`
      );
      const forged = await expectRefusal(
        () =>
          p.verifyWebhook({
            rawBody: signed.rawBody,
            headers: tamperHeaders(signed.headers),
          }),
        "a webhook whose signature was changed is refused"
      );
      expectContract(
        NextlyError.isCode(forged, "COMMERCE_WEBHOOK_INVALID"),
        `a changed signature is refused as COMMERCE_WEBHOOK_INVALID, not ${describeError(forged)}`
      );
      const unsigned = await expectRefusal(
        () => p.verifyWebhook({ rawBody: signed.rawBody, headers: {} }),
        "a webhook without its signature is refused"
      );
      expectContract(
        NextlyError.isCode(unsigned, "COMMERCE_WEBHOOK_INVALID"),
        `an unsigned webhook is refused as COMMERCE_WEBHOOK_INVALID, not ${describeError(unsigned)}`
      );
    }
  );

  // The cases below exist only for a provider that declares the operation or
  // the limit; the declaration case above holds it to having the method.
  const declared = (await setUp()).p.capabilities;
  const limit = declared.maxAmounts?.[options.currency];
  if (limit !== undefined) {
    add(
      "starts a payment at its declared limit, and refuses one above it",
      async () => {
        const { p } = await setUp();
        const atLimit = asPayment(
          await p.start({
            operationId: unique("op"),
            reference: unique("pay"),
            amount: money(limit, options.currency),
            capture: "now",
          })
        );
        expectContract(
          atLimit.amount.amount === limit,
          "a payment at the limit starts"
        );
        // No amount exists above the largest safe one, so a provider whose
        // limit is that has nothing to refuse.
        if (limit >= Number.MAX_SAFE_INTEGER) return;
        const reference = unique("pay");
        const error = await expectRefusal(
          () =>
            p.start({
              operationId: unique("op"),
              reference,
              amount: money(limit + 1, options.currency),
              capture: "now",
            }),
          "a payment above the declared limit is refused"
        );
        expectContract(
          NextlyError.isCode(error, "COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT"),
          `the refusal is COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT, not ${describeError(error)}`
        );
        expectContract(
          (await p.findByReference({ reference })) === null,
          "a refused payment leaves nothing at the provider"
        );
      }
    );
  }
  return cases.concat(optionalCases());

  function optionalCases(): ContractCase[] {
    const extra: ContractCase[] = [];
    const addIf = (
      applies: boolean,
      name: string,
      run: (p: PaymentProvider) => Promise<void>
    ) => {
      if (!applies) return;
      extra.push({
        name,
        async run() {
          await run((await setUp()).p);
        },
      });
    };

    addIf(
      supportsPaymentOperation(declared, "capture"),
      "holds money, and captures it once when the answer to a capture is lost",
      async p => {
        const { started } = await startPayment(p, "later");
        const held = asPayment(
          await p.confirm({
            operationId: unique("op"),
            providerReference: started.providerReference,
            paymentMethod: options.paymentMethods.succeeds,
          })
        );
        expectContract(
          held.status === "authorised",
          `held money is authorised, not ${held.status}`
        );
        expectContract(
          held.amountCaptured.amount === 0,
          "held money is not captured yet"
        );
        const request = {
          operationId: unique("op"),
          providerReference: started.providerReference,
        };
        await call(p, "capture", request); // the answer is lost
        const captured = asPayment(await call(p, "capture", request));
        expectContract(
          captured.status === "paid",
          `a captured payment is paid, not ${captured.status}`
        );
        await expectCapturedOnce(p, started.providerReference);
      }
    );

    addIf(
      supportsPaymentOperation(declared, "cancel"),
      "cancels a payment once when the answer to a cancel is lost",
      async p => {
        const { started } = await startPayment(p);
        const request = {
          operationId: unique("op"),
          providerReference: started.providerReference,
        };
        await call(p, "cancel", request); // the answer is lost
        const cancelled = asPayment(await call(p, "cancel", request));
        expectContract(
          cancelled.status === "cancelled",
          `the payment is cancelled, not ${cancelled.status}`
        );
        const read = asPayment(
          await p.read({ providerReference: started.providerReference })
        );
        expectContract(read.status === "cancelled", "the cancellation stays");
      }
    );

    addIf(
      supportsPaymentOperation(declared, "refund"),
      "refunds once when the answer to a refund is lost, and finds the refund by commerce's reference",
      async p => {
        const { payment } = await paidPayment(p);
        const reference = unique("refund");
        const refundAmount = p.capabilities.partialRefund
          ? money(options.amount / 2, options.currency)
          : amount;
        const request = {
          operationId: unique("op"),
          providerReference: payment.providerReference,
          reference,
          amount: refundAmount,
        };
        await call(p, "refund", request); // the answer is lost
        const repeated = asRefund(await call(p, "refund", request));
        expectContract(
          repeated.reference === reference &&
            repeated.providerReference === payment.providerReference,
          "the refund keeps commerce's reference and names its payment"
        );
        expectContract(
          repeated.amount.amount === refundAmount.amount &&
            repeated.amount.currency === refundAmount.currency,
          `the refund is for the amount asked (${repeated.amount.amount} answered, ${refundAmount.amount} asked)`
        );
        const read = asPayment(
          await p.read({ providerReference: payment.providerReference })
        );
        expectContract(
          read.amountRefunded.amount === refundAmount.amount,
          `the refund happened once (${read.amountRefunded.amount} refunded, ${refundAmount.amount} asked)`
        );
        const found = await call(p, "findRefundByReference", { reference });
        expectContract(
          found !== null,
          "a refund is found by commerce's reference"
        );
        expectContract(
          asRefund(found).providerRefundReference ===
            repeated.providerRefundReference,
          "the refund found is the one made"
        );
      }
    );

    addIf(
      supportsPaymentOperation(declared, "refund") && declared.partialRefund,
      "refuses to refund more than is left to refund",
      async p => {
        const { payment } = await paidPayment(p);
        await call(p, "refund", {
          operationId: unique("op"),
          providerReference: payment.providerReference,
          reference: unique("refund"),
          amount: money(options.amount / 2, options.currency),
        });
        await expectRefusal(
          () =>
            call(p, "refund", {
              operationId: unique("op"),
              providerReference: payment.providerReference,
              reference: unique("refund"),
              amount,
            }),
          "a refund beyond what is left to refund is refused"
        );
        const read = asPayment(
          await p.read({ providerReference: payment.providerReference })
        );
        expectContract(
          read.amountRefunded.amount === options.amount / 2,
          "the refused refund changed nothing"
        );
      }
    );

    return extra;
  }
}

function asPayment(answer: unknown): ProviderPayment {
  const parsed = providerPaymentSchema.safeParse(answer);
  if (!parsed.success) {
    throw new ContractViolation(
      `a payment answer is outside the contract: ${issues(parsed.error.issues)}`
    );
  }
  return parsed.data;
}

function asRefund(answer: unknown): ProviderRefund {
  const parsed = providerRefundSchema.safeParse(answer);
  if (!parsed.success) {
    throw new ContractViolation(
      `a refund answer is outside the contract: ${issues(parsed.error.issues)}`
    );
  }
  return parsed.data;
}

function asEvent(answer: unknown): ProviderWebhookEvent {
  const parsed = providerWebhookEventSchema.safeParse(answer);
  if (!parsed.success) {
    throw new ContractViolation(
      `a webhook event is outside the contract: ${issues(parsed.error.issues)}`
    );
  }
  return parsed.data;
}

type OptionalOperation =
  | "capture"
  | "cancel"
  | "refund"
  | "findRefundByReference";

/**
 * Call an optional operation on the provider itself, so a provider written as
 * a class keeps its `this`, and fail the case when a declared one is missing.
 */
async function call<K extends OptionalOperation>(
  p: PaymentProvider,
  operation: K,
  input: Parameters<NonNullable<PaymentProvider[K]>>[0]
): Promise<Awaited<ReturnType<NonNullable<PaymentProvider[K]>>>> {
  const method = p[operation] as
    | ((this: PaymentProvider, arg: typeof input) => Promise<unknown>)
    | undefined;
  if (typeof method !== "function") {
    throw new ContractViolation(
      `the declared operation ${operation} has no method`
    );
  }
  return (await method.call(p, input)) as Awaited<
    ReturnType<NonNullable<PaymentProvider[K]>>
  >;
}

/**
 * Change the body's bytes while keeping it well formed: a space before its
 * last character is still valid JSON (and still the same form fields), so a
 * provider can refuse it only by checking the signature, never because the
 * body no longer parses.
 */
function tamper(rawBody: string): string {
  return `${rawBody.slice(0, -1)} ${rawBody.slice(-1)}`;
}

/**
 * Change the last character of every header while keeping its form (a hex
 * digit stays a hex digit), so the signature no longer matches the body that
 * is still exactly as signed: only a check of the signature itself can refuse
 * it, not a check that the header is present or well formed.
 */
function tamperHeaders(
  headers: Readonly<Record<string, string>>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      const last = value.slice(-1);
      const swapped = /[0-9a-f]/i.test(last)
        ? last === "0"
          ? "1"
          : "0"
        : last === "x"
          ? "y"
          : "x";
      return [name, `${value.slice(0, -1)}${swapped}`];
    })
  );
}

function issues(
  list: readonly { path: PropertyKey[]; message: string }[]
): string {
  return list
    .map(i => `${i.path.map(String).join(".")}: ${i.message}`)
    .join("; ");
}

function describeError(error: unknown): string {
  if (NextlyError.is(error)) return String(error.code);
  return error instanceof Error ? error.message : String(error);
}
