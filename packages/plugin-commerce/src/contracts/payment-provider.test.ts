import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { createTestPaymentProvider } from "../testing/test-payment-provider";

import {
  assertPaymentProvider,
  parseProviderAnswer,
  providerPaymentSchema,
  requirePaymentOperation,
  supportedPaymentOperations,
  supportsPaymentOperation,
  type PaymentProviderCapabilities,
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
  });

  it("is refused when it refunds more than it captured, mixes currencies or floats an amount", () => {
    const refusals = [
      { ...valid, amountRefunded: { amount: 1001, currency: "USD" } },
      { ...valid, amountCaptured: { amount: 1000, currency: "EUR" } },
      { ...valid, amount: { amount: 10.5, currency: "USD" } },
      { ...valid, status: "refunded" },
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
