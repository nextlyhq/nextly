/**
 * What `claimDelivery` refuses before it writes anything: an answer `verify`
 * did not return, a call beside an open transaction, and a bad provider, id
 * or lease. The adapter here records every use, so a refusal that reached the
 * database shows; claims themselves are exercised on every dialect in
 * `received-webhooks.integration.test.ts`.
 *
 * @module plugins/security/__tests__/received-webhooks.test
 */
import { describe, expect, it } from "vitest";

import { buildSignatureHeaders } from "../../../domains/webhooks/signing";
import { NextlyError } from "../../../errors/nextly-error";
import {
  standardWebhooks,
  verifyWebhookDelivery,
  type VerifiedWebhook,
  type WebhookVerification,
} from "../inbound-webhooks";
import {
  createPluginReceivedWebhooks,
  type ReceivedWebhooksAdapter,
} from "../received-webhooks";

const SECRET = Buffer.from("current-key-material-0123456789").toString(
  "base64"
);
const SIGNED_AT = 1_752_796_800;
const AT = new Date(SIGNED_AT * 1000);
const BODY = '{"type":"order.paid","id":"ord_1"}';

/** A real verified answer, from a delivery signed in the common scheme. */
function verifiedAnswer(): VerifiedWebhook {
  const headers = buildSignatureHeaders({
    id: "msg_1",
    timestamp: String(SIGNED_AT),
    body: BODY,
    secrets: [SECRET],
  });
  const answer = verifyWebhookDelivery(
    { headers: new Headers(headers), bytes: new TextEncoder().encode(BODY) },
    { scheme: standardWebhooks, secrets: [SECRET] },
    AT
  );
  if (!answer.verified) throw new Error(`not verified: ${answer.reason}`);
  return answer;
}

/** The helper on an adapter that records whether anything reached it. */
function helper(options: { transactionOpen?: boolean } = {}) {
  const uses: string[] = [];
  const adapter: ReceivedWebhooksAdapter = {
    dialect: "sqlite",
    transactionOpenInFlow: () => {
      uses.push("transactionOpenInFlow");
      return options.transactionOpen ?? false;
    },
    transaction: async () => {
      uses.push("transaction");
      throw new Error("a refused claim reached the database");
    },
  };
  const webhooks = createPluginReceivedWebhooks({
    owner: "@test/claims",
    adapter: () => adapter,
    now: () => AT,
  });
  return { webhooks, uses };
}

async function refusal(promise: Promise<unknown>): Promise<NextlyError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(NextlyError);
  return error as NextlyError;
}

describe("claimDelivery's refusals", () => {
  it("a plain object that looks like a verified result is refused, and so is a copy of a real one", async () => {
    const { webhooks, uses } = helper();
    const real = verifiedAnswer();
    const lookAlike: VerifiedWebhook = {
      verified: true,
      body: BODY,
      bytes: new TextEncoder().encode(BODY),
      deliveryId: "msg_1",
      timestamp: SIGNED_AT,
      freshness: "checked",
    };
    for (const forged of [lookAlike, { ...real }, Object.assign({}, real)]) {
      const error = await refusal(
        webhooks.claimDelivery(forged, { provider: "acme" })
      );
      expect(error.code).toBe("INVALID_INPUT");
      expect(error.publicMessage).toContain("verify returned");
    }
    expect(uses).toEqual([]);
    // The answer itself is frozen: nothing can be written into it.
    expect(Object.isFrozen(real)).toBe(true);
  });

  it("refuses an unverified result, an open outer transaction and a bad provider or id", async () => {
    const { webhooks, uses } = helper();
    const unverified: WebhookVerification = {
      verified: false,
      reason: "mismatch",
    };
    expect(
      (
        await refusal(
          webhooks.claimDelivery(unverified as unknown as VerifiedWebhook, {
            provider: "acme",
          })
        )
      ).code
    ).toBe("INVALID_INPUT");

    const real = verifiedAnswer();
    const long = "p".repeat(192);
    // NUL is well-formed Unicode, but PostgreSQL text cannot hold it: refused
    // on every dialect, so a claim does not fail on one alone.
    for (const provider of ["", long, "bad\uD800", "nul\u0000name"]) {
      expect(
        (await refusal(webhooks.claimDelivery(real, { provider }))).code
      ).toBe("INVALID_INPUT");
    }
    for (const id of ["", long, "bad\uDC00", "evt\u0000_1"]) {
      expect(
        (await refusal(webhooks.claimDelivery(real, { provider: "acme", id })))
          .code
      ).toBe("INVALID_INPUT");
    }
    for (const leaseSeconds of [0, 3601, Number.NaN, Infinity, -5]) {
      expect(
        (
          await refusal(
            webhooks.claimDelivery(real, { provider: "acme", leaseSeconds })
          )
        ).code
      ).toBe("INVALID_INPUT");
    }
    // None of those reached the database, not even to ask about a
    // transaction.
    expect(uses).toEqual([]);

    // Valid in every part, but called while the flow holds a transaction and
    // passing none: refused before it writes.
    const open = helper({ transactionOpen: true });
    await refusal(
      open.webhooks.claimDelivery(real, {
        provider: "acme",
        id: "p".repeat(191),
      })
    );
    expect(open.uses).toEqual(["transactionOpenInFlow"]);
  });
});
