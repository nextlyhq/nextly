/**
 * A queued message as stored, and the failure an attempt that threw is
 * recorded with.
 *
 * - The message is sealed under the current secret, opens under it or a
 *   previous one, and opens in no other row and under no other secret.
 * - A template's variables read back as the values they were, a `markHtml`
 *   mark included, and no data a caller passed reads back as a mark.
 * - A thrown error is retried only when retrying can help.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import {
  openQueuedMessage,
  type QueuedMessage,
  queuedEmailKey,
  sealQueuedMessage,
  thrownAttemptFailure,
} from "../queued-send";
import { markHtml, TrustedHtml } from "../services/liquid-engine";

const CURRENT = "current-secret-at-least-32-characters-long!!";
const PREVIOUS = "previous-secret-at-least-32-characters-long!";
const ID = "0b7c3a52-7f0e-4c1e-9d55-2f1a3f9e4a10";

const message: QueuedMessage = {
  kind: "message",
  send: {
    to: ["a@example.com", "b@example.com"],
    subject: "Your reset link",
    html: "<p>https://example.com/reset?token=abc</p>",
    cc: ["c@example.com"],
    idempotencyKey: "reset:1",
  },
};

describe("a queued message as stored", () => {
  it("is sealed: no address, subject or link is readable", () => {
    const stored = sealQueuedMessage(message, ID, [CURRENT]);
    expect(stored).toMatch(/^sealed:v2:/);
    for (const part of ["example.com", "reset", "token=abc"]) {
      expect(stored).not.toContain(part);
    }
  });

  it("opens to the message it was sealed from", () => {
    const stored = sealQueuedMessage(message, ID, [CURRENT]);
    expect(openQueuedMessage(stored, ID, [CURRENT])).toEqual(message);
  });

  it("still opens once the secret rotates and the old one is kept as previous", () => {
    const stored = sealQueuedMessage(message, ID, [PREVIOUS]);
    expect(openQueuedMessage(stored, ID, [CURRENT, PREVIOUS])).toEqual(message);
  });

  it("does not open under a secret the install no longer has", () => {
    const stored = sealQueuedMessage(message, ID, [PREVIOUS]);
    expect(openQueuedMessage(stored, ID, [CURRENT])).toBeUndefined();
  });

  it("does not open in another row", () => {
    const stored = sealQueuedMessage(message, ID, [CURRENT]);
    const other = "6d0f0d8e-1b2c-4f7a-8e3b-5a9c1d2e3f40";
    expect(openQueuedMessage(stored, other, [CURRENT])).toBeUndefined();
  });

  it("does not open when damaged", () => {
    const stored = sealQueuedMessage(message, ID, [CURRENT]);
    const damaged = `${stored.slice(0, -4)}AAAA`;
    expect(openQueuedMessage(damaged, ID, [CURRENT])).toBeUndefined();
    expect(openQueuedMessage("plain text", ID, [CURRENT])).toBeUndefined();
  });

  it("is stored unsealed, and marked so, only where the install has no secret", () => {
    const stored = sealQueuedMessage(message, ID, []);
    expect(stored.startsWith("unsealed:")).toBe(true);
    expect(openQueuedMessage(stored, ID, [])).toEqual(message);
  });
});

describe("a queued template's variables", () => {
  const when = new Date("2026-10-21T10:00:00.000Z");

  function roundTrip(variables: Record<string, unknown>) {
    const stored = sealQueuedMessage(
      {
        kind: "template",
        slug: "t",
        to: "a@example.com",
        variables,
        options: {},
      },
      ID,
      [CURRENT]
    );
    const opened = openQueuedMessage(stored, ID, [CURRENT]);
    if (opened?.kind !== "template") throw new Error("did not open");
    return opened.variables;
  }

  it("read back as the values they were, nested lists and objects included", () => {
    expect(
      roundTrip({
        name: "Sam",
        count: 3,
        paid: true,
        nothing: null,
        when,
        items: [{ sku: "a", qty: 1 }, "b", [2]],
      })
    ).toEqual({
      name: "Sam",
      count: 3,
      paid: true,
      nothing: null,
      when,
      items: [{ sku: "a", qty: 1 }, "b", [2]],
    });
  });

  it("keep a markHtml mark a mark, wherever it sits", () => {
    const variables = roundTrip({
      body: markHtml("<b>bold</b>"),
      rows: [{ cell: markHtml("<td>1</td>") }],
    });
    expect(TrustedHtml.is(variables.body)).toBe(true);
    expect((variables.body as TrustedHtml).html).toBe("<b>bold</b>");
    const [row] = variables.rows as Array<{ cell: unknown }>;
    expect(TrustedHtml.is(row.cell)).toBe(true);
  });

  it("never read data shaped like a stored mark back as one", () => {
    const variables = roundTrip({ body: { h: "<script>x</script>" } });
    expect(TrustedHtml.is(variables.body)).toBe(false);
    expect(variables.body).toEqual({ h: "<script>x</script>" });
  });

  it("keep a key named __proto__ as the key it is", () => {
    // As JSON from a request arrives: an own `__proto__` key.
    const variables = roundTrip(
      JSON.parse('{"data":{"__proto__":"kept","a":1}}') as Record<
        string,
        unknown
      >
    );
    const data = variables.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["__proto__", "a"]);
    expect(Object.getOwnPropertyDescriptor(data, "__proto__")?.value).toBe(
      "kept"
    );
  });

  it("drop what JSON drops, and honour toJSON as JSON does", () => {
    expect(
      roundTrip({
        gone: undefined,
        fn: () => 1,
        total: { toJSON: () => "12.50" },
        nan: Number.NaN,
      })
    ).toEqual({ total: "12.50", nan: null });
  });

  it("refuse variables that refer to themselves", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => roundTrip({ loop })).toThrow(NextlyError);
  });
});

describe("the failure of an attempt that threw", () => {
  it("is not retried when the send refused its input", () => {
    const failure = thrownAttemptFailure(
      NextlyError.validation({
        errors: [{ path: "to", code: "INVALID", message: "x" }],
      })
    );
    expect(failure).toMatchObject({ retryable: false, status: 400 });
  });

  it("is not retried when the error says so, whatever its status", () => {
    const failure = thrownAttemptFailure(
      NextlyError.internal({ logContext: { retryable: false } })
    );
    expect(failure.retryable).toBe(false);
  });

  it("is retried on a fault of this side, and on anything that is not a NextlyError", () => {
    expect(thrownAttemptFailure(NextlyError.internal()).retryable).toBe(true);
    expect(thrownAttemptFailure(new Error("socket hang up")).retryable).toBe(
      true
    );
  });

  it("keeps no address in its reason", () => {
    const failure = thrownAttemptFailure(
      new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: "Could not send to someone@example.com.",
      })
    );
    expect(failure.reason).not.toContain("someone@example.com");
  });
});

describe("the key a queued email is sent with", () => {
  it("is the same for one email and differs between two", () => {
    expect(queuedEmailKey(ID)).toBe(queuedEmailKey(ID));
    expect(queuedEmailKey(ID)).not.toBe(
      queuedEmailKey("6d0f0d8e-1b2c-4f7a-8e3b-5a9c1d2e3f40")
    );
  });
});
