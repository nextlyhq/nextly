import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { money } from "../money/money";

import {
  createTestPaymentProvider,
  TEST_PAYMENT_METHODS,
  TEST_SIGNATURE_HEADER,
} from "./test-payment-provider";

function present<T>(method: T | undefined): T {
  if (method === undefined)
    throw new Error("the provider lacks a declared method");
  return method;
}

async function codeOf(
  body: () => Promise<unknown>
): Promise<string | undefined> {
  try {
    await body();
  } catch (error) {
    return NextlyError.is(error) ? String(error.code) : "not a NextlyError";
  }
  return undefined;
}

// The parts of the test provider the contract suite cannot reach: they need a
// clock it controls or states only the provider can produce.
describe("the test payment provider", () => {
  it("forgets an operation key once its lifetime passes, so a late repeat runs again", async () => {
    let now = 1_000_000;
    const { provider, control } = createTestPaymentProvider({
      now: () => now,
      capabilities: { operationKeyLifetimeMs: 60_000 },
    });
    const request = {
      operationId: "op-1",
      reference: "p-1",
      amount: money(1000, "USD"),
      capture: "now" as const,
    };
    const first = await provider.start(request);
    now += 59_999;
    expect((await provider.start(request)).providerReference).toBe(
      first.providerReference
    );
    now += 1;
    // This is why commerce looks a lost answer up by its own reference once
    // the lifetime has passed, instead of repeating the call.
    expect((await provider.start(request)).providerReference).not.toBe(
      first.providerReference
    );
    expect(control.payments()).toHaveLength(2);
  });

  it("keeps a bank debit processing until the bank settles it", async () => {
    const { provider, control } = createTestPaymentProvider();
    const { providerReference } = await provider.start({
      operationId: "op-1",
      reference: "p-1",
      amount: money(1000, "USD"),
      capture: "now",
    });
    const processing = await provider.confirm({
      operationId: "op-2",
      providerReference,
      paymentMethod: TEST_PAYMENT_METHODS.processing,
    });
    expect(processing.status).toBe("processing");
    expect(processing.amountCaptured.amount).toBe(0);
    expect(control.settle(providerReference, "paid").status).toBe("paid");
  });

  it("refuses a webhook signed too long ago, even with a valid signature", async () => {
    let now = 1_000_000_000;
    const { provider, control } = createTestPaymentProvider({ now: () => now });
    const signed = control.signWebhook({
      type: "payment.updated",
      providerReference: null,
    });
    await expect(provider.verifyWebhook(signed)).resolves.toMatchObject({
      providerReference: null,
    });
    now += 301_000;
    expect(await codeOf(() => provider.verifyWebhook(signed))).toBe(
      "COMMERCE_WEBHOOK_INVALID"
    );
  });

  it("refuses a webhook signed with another secret", async () => {
    const ours = createTestPaymentProvider({ webhookSecret: "ours" });
    const theirs = createTestPaymentProvider({ webhookSecret: "theirs" });
    const signed = theirs.control.signWebhook({
      type: "payment.updated",
      providerReference: null,
    });
    expect(signed.headers[TEST_SIGNATURE_HEADER]).toBeDefined();
    expect(await codeOf(() => ours.provider.verifyWebhook(signed))).toBe(
      "COMMERCE_WEBHOOK_INVALID"
    );
  });

  it("refuses to capture or refund a payment in the wrong state", async () => {
    const { provider } = createTestPaymentProvider();
    const { providerReference } = await provider.start({
      operationId: "op-1",
      reference: "p-1",
      amount: money(1000, "USD"),
      capture: "now",
    });
    expect(
      await codeOf(() =>
        present(provider.capture)({ operationId: "op-2", providerReference })
      )
    ).toBe("COMMERCE_PAYMENT_STATE");
    expect(
      await codeOf(() =>
        present(provider.refund)({
          operationId: "op-3",
          providerReference,
          reference: "r-1",
          amount: money(1000, "USD"),
        })
      )
    ).toBe("COMMERCE_PAYMENT_STATE");
  });

  it("refuses a partial refund when it does not offer them", async () => {
    const { provider } = createTestPaymentProvider({
      capabilities: { partialRefund: false },
    });
    const { providerReference } = await provider.start({
      operationId: "op-1",
      reference: "p-1",
      amount: money(1000, "USD"),
      capture: "now",
    });
    await provider.confirm({
      operationId: "op-2",
      providerReference,
      paymentMethod: TEST_PAYMENT_METHODS.succeeds,
    });
    expect(
      await codeOf(() =>
        present(provider.refund)({
          operationId: "op-3",
          providerReference,
          reference: "r-1",
          amount: money(400, "USD"),
        })
      )
    ).toBe("COMMERCE_UNSUPPORTED_OPERATION");
  });
});
