import { describe, expect, it } from "vitest";

import type { PaymentProvider } from "../contracts/payment-provider";
import { commerceError } from "../errors";
import { money } from "../money/money";

import { runContractCases, type ContractCase } from "./contract-case";
import { paymentProviderContract } from "./payment-provider-contract";
import {
  createTestPaymentProvider,
  TEST_PAYMENT_METHODS,
  TEST_SIGNATURE_HEADER,
  type TestPaymentProviderOptions,
} from "./test-payment-provider";

const base = {
  currency: "USD",
  amount: 2500,
  paymentMethods: {
    succeeds: TEST_PAYMENT_METHODS.succeeds,
    declines: TEST_PAYMENT_METHODS.declines,
  },
};

function suiteFor(
  options: TestPaymentProviderOptions = {},
  breakIt: (provider: PaymentProvider) => PaymentProvider = p => p
): Promise<ContractCase[]> {
  return paymentProviderContract({
    ...base,
    create() {
      const { provider, control } = createTestPaymentProvider(options);
      return { provider: breakIt(provider), signWebhook: control.signWebhook };
    },
  });
}

describe("the payment contract suite against the test provider", async () => {
  for (const c of await suiteFor()) it(c.name, c.run);
});

describe("the payment contract suite against a provider offering no optional operation", async () => {
  const cases = await suiteFor({
    capabilities: {
      captureLater: false,
      cancel: false,
      refund: false,
      partialRefund: false,
    },
  });
  for (const c of cases) it(c.name, c.run);

  it("leaves out the cases for operations the provider does not declare", () => {
    const names = cases.map(c => c.name).join("\n");
    expect(names).not.toMatch(/capture|cancel|refund/i);
  });
});

describe("the payment contract suite against a provider whose limit is the largest safe amount", async () => {
  // No amount above it can be made, so the suite checks the limit itself and
  // leaves out the payment above it rather than failing to build one.
  const cases = await suiteFor({
    capabilities: { maxAmounts: { USD: Number.MAX_SAFE_INTEGER } },
  });
  for (const c of cases) it(c.name, c.run);
});

describe("the payment contract suite catches a broken provider", () => {
  // Each provider below breaks one rule of the contract. The suite must fail
  // the case that guards that rule; otherwise the case proves nothing.
  async function failingCases(
    breakIt: (p: PaymentProvider) => PaymentProvider
  ) {
    const run = await runContractCases(await suiteFor({}, breakIt));
    return run.failed.map(f => f.name);
  }

  it("fails a provider that starts a second payment when a start is repeated", async () => {
    const failed = await failingCases(p => {
      let n = 0;
      return {
        ...p,
        start: input =>
          p.start({ ...input, operationId: `${input.operationId}-${++n}` }),
      };
    });
    expect(failed).toContain(
      "starts once when the answer to a start is lost and the start is repeated"
    );
  });

  it("fails a provider that starts a second payment and finds the latest one by reference", async () => {
    // Finding the newest match hides the orphaned first payment from a check
    // that only compares the repeat with what is found.
    const failed = await failingCases(p => {
      let n = 0;
      const latest = new Map<string, string>();
      return {
        ...p,
        start: async input => {
          const started = await p.start({
            ...input,
            operationId: `${input.operationId}-${++n}`,
          });
          latest.set(input.reference, started.providerReference);
          return started;
        },
        findByReference: async input => {
          const providerReference = latest.get(input.reference);
          return providerReference === undefined
            ? null
            : p.read({ providerReference });
        },
      };
    });
    expect(failed).toContain(
      "starts once when the answer to a start is lost and the start is repeated"
    );
  });

  it("fails a provider that refuses a reused key only after starting the payment", async () => {
    const failed = await failingCases(p => {
      const requests = new Map<string, string>();
      let n = 0;
      return {
        ...p,
        start: async input => {
          const request = `${input.reference}:${input.amount.amount}`;
          const seen = requests.get(input.operationId);
          requests.set(input.operationId, request);
          if (seen !== undefined && seen !== request) {
            await p.start({ ...input, operationId: `late-${++n}` });
            throw commerceError("COMMERCE_OPERATION_KEY_REUSED");
          }
          return p.start(input);
        },
      };
    });
    expect(failed).toContain(
      "refuses an operation key reused for a different request"
    );
  });

  it("fails a provider whose refund answer misstates the amount refunded", async () => {
    const failed = await failingCases(p => {
      const refund = p.refund;
      return {
        ...p,
        refund: refund
          ? async input => {
              const made = await refund(input);
              return {
                ...made,
                amount: money(made.amount.amount + 1, made.amount.currency),
              };
            }
          : undefined,
      };
    });
    expect(failed).toContain(
      "refunds once when the answer to a refund is lost, and finds the refund by commerce's reference"
    );
  });

  it("fails a provider whose confirm answer names another payment", async () => {
    const failed = await failingCases(p => ({
      ...p,
      confirm: async input => ({
        ...(await p.confirm(input)),
        providerReference: "pay_elsewhere",
      }),
    }));
    expect(failed).toContain(
      "charges once when the answer to a confirm is lost and the confirm is repeated"
    );
  });

  it("fails a provider that checks a signature is present but not that it is right", async () => {
    // It refuses a missing header and a body that is not canonical JSON, so
    // only a changed signature over an unchanged body can catch it.
    const failed = await failingCases(p => ({
      ...p,
      verifyWebhook: async input => {
        if (!input.headers[TEST_SIGNATURE_HEADER]) {
          throw commerceError("COMMERCE_WEBHOOK_INVALID");
        }
        const body = JSON.parse(input.rawBody) as {
          eventId: string;
          type: "payment.updated";
          providerReference: string | null;
          occurredAt: string;
        };
        if (JSON.stringify(body) !== input.rawBody) {
          throw commerceError("COMMERCE_WEBHOOK_INVALID");
        }
        return body;
      },
    }));
    expect(failed).toContain(
      "verifies a signed webhook, and refuses a tampered or unsigned one"
    );
  });

  it("fails a provider that gives every webhook the same event id", async () => {
    // Commerce records an event once by its id, so one id for every delivery
    // would drop every update after the first.
    const failed = await failingCases(p => ({
      ...p,
      verifyWebhook: async input => ({
        ...(await p.verifyWebhook(input)),
        eventId: "evt_always",
      }),
    }));
    expect(failed).toContain(
      "verifies a signed webhook, and refuses a tampered or unsigned one"
    );
  });

  it("fails a provider that ignores the key when a confirm is repeated", async () => {
    // Sending each confirm under a new key is what ignoring the key amounts
    // to: the repeat is then a second confirm, which a paid payment refuses.
    const failed = await failingCases(p => {
      let n = 0;
      return {
        ...p,
        confirm: input =>
          p.confirm({ ...input, operationId: `${input.operationId}-${++n}` }),
      };
    });
    expect(failed).toContain(
      "charges once when the answer to a confirm is lost and the confirm is repeated"
    );
  });

  it("fails a provider that refunds twice when a refund is repeated", async () => {
    const failed = await failingCases(p => {
      let n = 0;
      const refund = p.refund;
      return {
        ...p,
        refund: refund
          ? input =>
              refund({ ...input, operationId: `${input.operationId}-${++n}` })
          : undefined,
      };
    });
    expect(failed).toContain(
      "refunds once when the answer to a refund is lost, and finds the refund by commerce's reference"
    );
  });

  it("fails a provider that accepts a key reused for a different request", async () => {
    const failed = await failingCases(p => {
      let n = 0;
      return {
        ...p,
        start: input =>
          p.start({ ...input, operationId: `${input.operationId}-${++n}` }),
      };
    });
    expect(failed).toContain(
      "refuses an operation key reused for a different request"
    );
  });

  it("fails a provider that cannot find a payment by commerce's reference", async () => {
    const failed = await failingCases(p => ({
      ...p,
      findByReference: async () => null,
    }));
    expect(failed).toContain(
      "reads a payment back, and finds it by commerce's reference"
    );
  });

  it("fails a provider that accepts any webhook", async () => {
    const failed = await failingCases(p => ({
      ...p,
      verifyWebhook: async input => {
        const body = JSON.parse(input.rawBody) as {
          eventId: string;
          providerReference: string | null;
        };
        return {
          eventId: body.eventId,
          type: "payment.updated",
          providerReference: body.providerReference,
          occurredAt: new Date().toISOString(),
        };
      },
    }));
    expect(failed).toContain(
      "verifies a signed webhook, and refuses a tampered or unsigned one"
    );
  });

  it("fails a provider that reports a declined payment as paid", async () => {
    const failed = await failingCases(p => ({
      ...p,
      confirm: input =>
        p.confirm({
          ...input,
          paymentMethod:
            input.paymentMethod === TEST_PAYMENT_METHODS.declines
              ? TEST_PAYMENT_METHODS.succeeds
              : input.paymentMethod,
        }),
    }));
    expect(failed).toContain(
      "reports a declined payment as failed, never as paid"
    );
  });

  it("fails a provider that declares a limit it does not enforce", async () => {
    const unlimited = createTestPaymentProvider({
      capabilities: { maxAmounts: {} },
    }).provider;
    const failed = await failingCases(p => ({ ...p, start: unlimited.start }));
    expect(failed).toContain(
      "starts a payment at its declared limit, and refuses one above it"
    );
  });

  it("fails a provider that declares a refund it does not implement", async () => {
    const failed = await failingCases(p => ({
      ...p,
      findRefundByReference: undefined,
    }));
    expect(failed).toContain(
      "declares a valid id and capabilities that match its methods"
    );
  });

  it("passes every case for the unbroken provider, so the failures above are the breaks", async () => {
    expect(await failingCases(p => p)).toEqual([]);
  });
});
