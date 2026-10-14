import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { money } from "../money/money";
import { createTestPaymentProvider } from "../testing/test-payment-provider";

import {
  assertPaymentProvider,
  parseProviderAnswer,
  providerPaymentSchema,
  requirePaymentOperation,
  startProviderPayment,
  supportedPaymentOperations,
  supportsPaymentOperation,
  type PaymentProvider,
  type PaymentProviderCapabilities,
  type StartPaymentInput,
} from "./payment-provider";

const everything: PaymentProviderCapabilities = {
  captureLater: true,
  cancel: true,
  refund: true,
  partialRefund: true,
  operationKeyLifetimeMs: 1000,
};

const codeOf = (body: () => unknown) => {
  try {
    body();
  } catch (error) {
    return NextlyError.is(error) ? String(error.code) : "not a NextlyError";
  }
  return undefined;
};

describe("what commerce offers for a provider", () => {
  it("offers capture, cancel and refund only when the provider declares them", () => {
    const nothingOptional = {
      ...everything,
      captureLater: false,
      cancel: false,
      refund: false,
      partialRefund: false,
    };
    expect(supportedPaymentOperations(nothingOptional)).toEqual([
      "start",
      "confirm",
      "read",
      "findByReference",
      "verifyWebhook",
    ]);
    expect(supportsPaymentOperation(everything, "capture")).toBe(true);
    expect(
      supportsPaymentOperation(
        { ...everything, captureLater: false },
        "capture"
      )
    ).toBe(false);
    expect(
      supportsPaymentOperation(
        { ...everything, refund: false },
        "findRefundByReference"
      )
    ).toBe(false);
  });

  it("refuses an operation the provider does not offer, before anything is sent", () => {
    const { provider } = createTestPaymentProvider({
      capabilities: { captureLater: false },
    });
    expect(codeOf(() => requirePaymentOperation(provider, "capture"))).toBe(
      "COMMERCE_UNSUPPORTED_OPERATION"
    );
    expect(
      codeOf(() => requirePaymentOperation(provider, "refund"))
    ).toBeUndefined();
  });
});

describe("a provider's declaration", () => {
  it("accepts a provider whose methods match its capabilities", () => {
    expect(() =>
      assertPaymentProvider(createTestPaymentProvider().provider)
    ).not.toThrow();
    const reduced = createTestPaymentProvider({
      capabilities: {
        captureLater: false,
        cancel: false,
        refund: false,
        partialRefund: false,
      },
    }).provider;
    expect(() => assertPaymentProvider(reduced)).not.toThrow();
    expect(reduced.capture).toBeUndefined();
    expect(reduced.refund).toBeUndefined();
  });

  it("refuses a capability declared without its method, and a method without its capability", () => {
    const { provider } = createTestPaymentProvider();
    const declaredNotImplemented = { ...provider, refund: undefined };
    expect(codeOf(() => assertPaymentProvider(declaredNotImplemented))).toBe(
      "COMMERCE_PROVIDER_CONTRACT"
    );
    const implementedNotDeclared = {
      ...provider,
      capabilities: { ...provider.capabilities, cancel: false },
    };
    expect(codeOf(() => assertPaymentProvider(implementedNotDeclared))).toBe(
      "COMMERCE_PROVIDER_CONTRACT"
    );
  });

  it("refuses a malformed id or capabilities", () => {
    const { provider } = createTestPaymentProvider();
    expect(
      codeOf(() => assertPaymentProvider({ ...provider, id: "Stripe Pay" }))
    ).toBe("COMMERCE_PROVIDER_CONTRACT");
    expect(
      codeOf(() =>
        assertPaymentProvider({
          ...provider,
          capabilities: {
            ...provider.capabilities,
            refund: false,
            partialRefund: true,
          },
        })
      )
    ).toBe("COMMERCE_PROVIDER_CONTRACT");
    expect(codeOf(() => assertPaymentProvider(null))).toBe(
      "COMMERCE_PROVIDER_CONTRACT"
    );
  });

  it("refuses a currency no amount could be in: a typo, or a code that is not a sales currency", () => {
    const { provider } = createTestPaymentProvider();
    const declaring = (
      capabilities: Partial<PaymentProvider["capabilities"]>
    ) => ({
      ...provider,
      capabilities: { ...provider.capabilities, ...capabilities },
    });
    for (const currencies of [["USX"], ["XXX"], ["USD", "CLF"]]) {
      expect(
        codeOf(() => assertPaymentProvider(declaring({ currencies })))
      ).toBe("COMMERCE_PROVIDER_CONTRACT");
    }
    expect(
      codeOf(() =>
        assertPaymentProvider(declaring({ maxAmounts: { XXX: 100 } }))
      )
    ).toBe("COMMERCE_PROVIDER_CONTRACT");
    expect(() =>
      assertPaymentProvider(declaring({ currencies: ["USD", "JPY"] }))
    ).not.toThrow();
  });
});

describe("a provider's answer", () => {
  const valid = {
    providerReference: "pay_1",
    reference: "p-1",
    status: "paid",
    amount: { amount: 1000, currency: "USD" },
    amountCaptured: { amount: 1000, currency: "USD" },
    amountRefunded: { amount: 0, currency: "USD" },
  };

  it("is accepted when it keeps the payment's invariants", () => {
    expect(
      parseProviderAnswer(providerPaymentSchema, valid, {
        provider: "x",
        operation: "read",
      }).amountCaptured.amount
    ).toBe(1000);
    expect(
      parseProviderAnswer(
        providerPaymentSchema,
        { ...valid, providerReference: "p".repeat(255) },
        { provider: "x", operation: "read" }
      ).providerReference
    ).toHaveLength(255);
    const nothingCaptured = { amount: 0, currency: "USD" };
    for (const status of ["pending", "authorised", "failed"] as const) {
      expect(
        parseProviderAnswer(
          providerPaymentSchema,
          { ...valid, status, amountCaptured: nothingCaptured },
          { provider: "x", operation: "read" }
        ).status
      ).toBe(status);
    }
  });

  it("is refused when it refunds more than it captured, mixes currencies or floats an amount", () => {
    const refusals = [
      { ...valid, amountRefunded: { amount: 1001, currency: "USD" } },
      { ...valid, amountCaptured: { amount: 1000, currency: "EUR" } },
      { ...valid, amount: { amount: 10.5, currency: "USD" } },
      { ...valid, status: "refunded" },
      // A status and amounts that contradict each other: paid is captured,
      // and nothing else has captured anything.
      { ...valid, amountCaptured: { amount: 0, currency: "USD" } },
      ...(
        [
          "pending",
          "requires_action",
          "processing",
          "authorised",
          "failed",
          "cancelled",
        ] as const
      ).map(status => ({ ...valid, status })),
      // Identifiers longer than commerce's columns hold on every dialect.
      { ...valid, providerReference: "p".repeat(256) },
      { ...valid, failureCode: "f".repeat(256) },
      // A payment is for a positive amount; no provider holds one for nothing.
      {
        ...valid,
        status: "pending",
        amount: { amount: 0, currency: "USD" },
        amountCaptured: { amount: 0, currency: "USD" },
      },
    ];
    for (const answer of refusals) {
      expect(
        codeOf(() =>
          parseProviderAnswer(providerPaymentSchema, answer, {
            provider: "x",
            operation: "read",
          })
        )
      ).toBe("COMMERCE_PROVIDER_CONTRACT");
    }
  });
});

describe("starting a payment through commerce", () => {
  // A provider that counts the starts that reach it, to prove a refusal
  // happens before anything is sent.
  function counted(
    options: Parameters<typeof createTestPaymentProvider>[0] = {},
    answer?: (input: StartPaymentInput) => Promise<unknown>
  ) {
    const { provider } = createTestPaymentProvider(options);
    const calls: StartPaymentInput[] = [];
    const spy: PaymentProvider = {
      ...provider,
      start: input => {
        calls.push(input);
        return (answer ? answer(input) : provider.start(input)) as ReturnType<
          PaymentProvider["start"]
        >;
      },
    };
    return { spy, calls };
  }
  const start = (
    amount: number,
    currency = "USD",
    capture: "now" | "later" = "now"
  ) => ({
    operationId: "op-1",
    reference: "p-1",
    amount: money(amount, currency),
    capture,
  });
  const asyncCodeOf = async (body: () => Promise<unknown>) => {
    try {
      await body();
    } catch (error) {
      return NextlyError.is(error) ? String(error.code) : "not a NextlyError";
    }
    return undefined;
  };

  it("refuses a request outside the contract before calling the provider", async () => {
    const { spy, calls } = counted();
    for (const request of [
      start(0),
      start(-100),
      { ...start(100), operationId: "has space" },
      { ...start(100), reference: "" },
    ]) {
      expect(
        await asyncCodeOf(() => startProviderPayment(spy, request)),
        JSON.stringify(request)
      ).toBe("VALIDATION_ERROR");
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a total above the provider's limit before calling it", async () => {
    const { spy, calls } = counted({
      capabilities: { maxAmounts: { USD: 99_999_999 } },
    });
    expect(
      await asyncCodeOf(() => startProviderPayment(spy, start(100_000_000)))
    ).toBe("COMMERCE_AMOUNT_ABOVE_PROVIDER_LIMIT");
    expect(calls).toHaveLength(0);
  });

  it("starts a payment exactly at the limit", async () => {
    const { spy, calls } = counted({
      capabilities: { maxAmounts: { USD: 99_999_999 } },
    });
    const started = await startProviderPayment(spy, start(99_999_999));
    expect(started.amount.amount).toBe(99_999_999);
    expect(calls).toHaveLength(1);
  });

  it("applies no limit to a currency the provider states none for", async () => {
    const { spy } = counted({ capabilities: { maxAmounts: { USD: 1000 } } });
    await expect(
      startProviderPayment(spy, start(5000, "EUR"))
    ).resolves.toBeDefined();
  });

  it("refuses a currency or a hold the provider cannot take, before calling it", async () => {
    const usdOnly = counted({ capabilities: { currencies: ["USD"] } });
    expect(
      await asyncCodeOf(() =>
        startProviderPayment(usdOnly.spy, start(100, "EUR"))
      )
    ).toBe("COMMERCE_UNSUPPORTED_OPERATION");
    expect(usdOnly.calls).toHaveLength(0);
    const noHolds = counted({ capabilities: { captureLater: false } });
    expect(
      await asyncCodeOf(() =>
        startProviderPayment(noHolds.spy, start(100, "USD", "later"))
      )
    ).toBe("COMMERCE_UNSUPPORTED_OPERATION");
    expect(noHolds.calls).toHaveLength(0);
  });

  it("refuses a provider's answer outside the contract", async () => {
    const { spy } = counted({}, async input => ({
      providerReference: "pay_1",
      reference: input.reference,
      status: "paid",
      amount: input.amount,
      amountCaptured: { amount: input.amount.amount * 2, currency: "USD" },
      amountRefunded: { amount: 0, currency: "USD" },
    }));
    expect(await asyncCodeOf(() => startProviderPayment(spy, start(100)))).toBe(
      "COMMERCE_PROVIDER_CONTRACT"
    );
  });

  it("refuses a provider's answer for another payment: another reference, amount or currency", async () => {
    // Each answer is well formed, so only comparing it with the request can
    // refuse it; the unchanged answer is the control that the comparison, not
    // the shape, is what refuses the others.
    const answering =
      (changes: Record<string, unknown>) =>
      async (input: StartPaymentInput) => ({
        providerReference: "pay_1",
        reference: input.reference,
        status: "pending",
        amount: input.amount,
        amountCaptured: money(0, input.amount.currency),
        amountRefunded: money(0, input.amount.currency),
        ...changes,
      });
    const exact = counted({}, answering({}));
    await expect(
      startProviderPayment(exact.spy, start(100))
    ).resolves.toMatchObject({
      reference: "p-1",
    });
    for (const changes of [
      { reference: "p-elsewhere" },
      { amount: money(101, "USD") },
      {
        amount: money(100, "EUR"),
        amountCaptured: money(0, "EUR"),
        amountRefunded: money(0, "EUR"),
      },
    ]) {
      const { spy } = counted({}, answering(changes));
      expect(
        await asyncCodeOf(() => startProviderPayment(spy, start(100))),
        JSON.stringify(changes)
      ).toBe("COMMERCE_PROVIDER_CONTRACT");
    }
  });
});
