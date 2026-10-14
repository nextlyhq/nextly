import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { assertPaymentProvider } from "../contracts/payment-provider";
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

/** A payment of `amount` cents, confirmed with `method`. */
async function confirmed(
  provider: ReturnType<typeof createTestPaymentProvider>["provider"],
  amount: number,
  method: string = TEST_PAYMENT_METHODS.succeeds
) {
  const { providerReference } = await provider.start({
    operationId: "op-start",
    reference: "p-1",
    amount: money(amount, "USD"),
    capture: "now",
  });
  return provider.confirm({
    operationId: "op-confirm",
    providerReference,
    paymentMethod: method,
  });
}

function syncCodeOf(body: () => unknown): string | undefined {
  try {
    body();
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
    expect(control.settle(providerReference, "succeeded").status).toBe("paid");
  });

  it("holds a settled bank debit for capture when the payment captures later", async () => {
    const { provider, control } = createTestPaymentProvider();
    const { providerReference } = await provider.start({
      operationId: "op-1",
      reference: "p-1",
      amount: money(1000, "USD"),
      capture: "later",
    });
    await provider.confirm({
      operationId: "op-2",
      providerReference,
      paymentMethod: TEST_PAYMENT_METHODS.processing,
    });
    const settled = control.settle(providerReference, "succeeded");
    expect(settled.status).toBe("authorised");
    expect(settled.amountCaptured.amount).toBe(0);
    const captured = await present(provider.capture)({
      operationId: "op-3",
      providerReference,
    });
    expect(captured.status).toBe("paid");
    expect(captured.amountCaptured.amount).toBe(1000);
  });

  it("refuses a malformed operation key on every changing call, and changes nothing", async () => {
    const { provider, control } = createTestPaymentProvider();
    const { providerReference } = await provider.start({
      operationId: "op-1",
      reference: "p-1",
      amount: money(1000, "USD"),
      capture: "later",
    });
    for (const operationId of ["", "has space", "x".repeat(256)]) {
      expect(
        await codeOf(() =>
          provider.confirm({
            operationId,
            providerReference,
            paymentMethod: TEST_PAYMENT_METHODS.succeeds,
          })
        )
      ).toBe("COMMERCE_INVALID_OPERATION_ID");
      expect(
        await codeOf(() =>
          present(provider.cancel)({ operationId, providerReference })
        )
      ).toBe("COMMERCE_INVALID_OPERATION_ID");
    }
    expect(control.payments()[0].status).toBe("pending");
  });

  it("completes a partial override into a declaration commerce accepts", () => {
    // Turning refunds off turns partial refunds off with them, unless the
    // caller says otherwise.
    const { provider } = createTestPaymentProvider({
      capabilities: { refund: false },
    });
    expect(provider.capabilities.partialRefund).toBe(false);
    expect(() => assertPaymentProvider(provider)).not.toThrow();
  });

  it("refuses an override commerce would refuse, when it is made", () => {
    for (const options of [
      { capabilities: { operationKeyLifetimeMs: 0 } },
      { capabilities: { refund: false, partialRefund: true } },
      { capabilities: { currencies: ["USX"] } },
      { id: "Test Provider" },
    ]) {
      expect(syncCodeOf(() => createTestPaymentProvider(options))).toBe(
        "COMMERCE_PROVIDER_CONTRACT"
      );
    }
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

  it("answers a refund as pending when asked to, holding its amount back without counting it refunded", async () => {
    const { provider } = createTestPaymentProvider({ refundStatus: "pending" });
    const { providerReference } = await confirmed(provider, 1000);
    const refund = present(provider.refund);
    const pending = await refund({
      operationId: "op-3",
      providerReference,
      reference: "r-1",
      amount: money(600, "USD"),
    });
    expect(pending.status).toBe("pending");
    expect(
      (await provider.read({ providerReference })).amountRefunded.amount
    ).toBe(0);
    // Held back: 400 is left to refund, so another 600 is refused.
    expect(
      await codeOf(() =>
        refund({
          operationId: "op-4",
          providerReference,
          reference: "r-2",
          amount: money(600, "USD"),
        })
      )
    ).toBe("COMMERCE_PAYMENT_STATE");
  });

  it("refuses a refund with an empty reference before anything changes", async () => {
    const { provider, control } = createTestPaymentProvider();
    const { providerReference } = await confirmed(provider, 1000);
    expect(
      await codeOf(() =>
        present(provider.refund)({
          operationId: "op-3",
          providerReference,
          reference: "",
          amount: money(400, "USD"),
        })
      )
    ).toBe("VALIDATION_ERROR");
    expect(
      (await provider.read({ providerReference })).amountRefunded.amount
    ).toBe(0);
    expect(control.refunds()).toHaveLength(0);
  });

  it("cancels a payment still processing, as its cancel capability promises for an unpaid one", async () => {
    const { provider } = createTestPaymentProvider();
    const processing = await confirmed(
      provider,
      1000,
      TEST_PAYMENT_METHODS.processing
    );
    expect(processing.status).toBe("processing");
    const cancelled = await present(provider.cancel)({
      operationId: "op-3",
      providerReference: processing.providerReference,
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.amountCaptured.amount).toBe(0);
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
