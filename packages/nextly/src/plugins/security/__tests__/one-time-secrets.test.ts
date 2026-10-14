/**
 * The bounds `ctx.security.secrets` holds a plugin's input to.
 *
 * Each value just outside a bound is refused with a validation error naming
 * it, before anything reaches the database; each value on a bound is
 * accepted. What the helper does with the database is the integration suite's
 * business, on every dialect.
 */
import { describe, expect, it, vi } from "vitest";

import { createOneTimeSecrets } from "../one-time-secrets";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** An adapter that records every call, and whose writes all succeed. */
function recordingAdapter() {
  const calls: string[] = [];
  const tx = {
    insert: vi.fn(async () => {
      calls.push("insert");
    }),
    updateCount: vi.fn(async () => {
      calls.push("updateCount");
      return 0;
    }),
    select: vi.fn(async () => {
      calls.push("select");
      return [];
    }),
  };
  const adapter = {
    transaction: vi.fn(async (work: (handle: typeof tx) => unknown) => {
      calls.push("transaction");
      return work(tx);
    }),
    transactionOpenInFlow: vi.fn(() => false),
    select: tx.select,
  };
  return { adapter, calls };
}

function secretsOver(adapter: ReturnType<typeof recordingAdapter>["adapter"]) {
  return createOneTimeSecrets({
    owner: "@test/secrets",
    adapter: () =>
      adapter as unknown as ReturnType<
        Parameters<typeof createOneTimeSecrets>[0]["adapter"]
      >,
    secrets: () => ["a-secret-that-is-long-enough-for-the-tests"],
  });
}

const token = {
  purpose: "reset",
  subject: "account-1",
  expiresInMs: MINUTE,
};
const code = {
  purpose: "sign-in",
  subject: "account-1",
  expiresInMs: MINUTE,
  maxWrongTries: 5,
};

/** Every call that takes the bounded input, with one field replaced. */
const calls = {
  mintToken: (field: Record<string, unknown>) => (s: Secrets) =>
    s.mintToken({ ...token, ...field } as Parameters<Secrets["mintToken"]>[0]),
  mintCode: (field: Record<string, unknown>) => (s: Secrets) =>
    s.mintCode({ ...code, ...field } as Parameters<Secrets["mintCode"]>[0]),
};
type Secrets = ReturnType<typeof createOneTimeSecrets>;

const refusals: Array<[string, (s: Secrets) => Promise<unknown>, RegExp]> = [
  // The purpose: a lowercase letter, then up to 63 of `[a-z0-9.-]`.
  ["an empty purpose", calls.mintToken({ purpose: "" }), /purpose must be/],
  [
    "a purpose starting with a digit",
    calls.mintToken({ purpose: "1reset" }),
    /purpose must be/,
  ],
  [
    "an uppercase purpose",
    calls.mintToken({ purpose: "Reset" }),
    /purpose must be/,
  ],
  [
    "a purpose of 65 characters",
    calls.mintToken({ purpose: `a${"b".repeat(64)}` }),
    /purpose must be/,
  ],
  [
    "a purpose with a slash",
    calls.mintToken({ purpose: "a/b" }),
    /purpose must be/,
  ],
  // The subject: 1 to 255 characters, no NUL.
  [
    "an empty subject",
    calls.mintToken({ subject: "" }),
    /subject must be from 1 to 255/,
  ],
  [
    "a subject of 256 characters",
    calls.mintToken({ subject: "s".repeat(256) }),
    /subject must be from 1 to 255/,
  ],
  [
    "a subject with a NUL",
    calls.mintToken({ subject: "a\u0000b" }),
    /subject must be from 1 to 255/,
  ],
  // Lone surrogates all encode to one character, so two would share a key.
  [
    "a subject holding a lone high surrogate",
    calls.mintToken({ subject: "account-\ud800" }),
    /well-formed Unicode/,
  ],
  [
    "a void for a subject holding a lone low surrogate",
    s => s.voidFor({ subject: "\udc00account" }),
    /well-formed Unicode/,
  ],
  // A token lives 1 minute to 30 days, in whole milliseconds.
  [
    "a token living under a minute",
    calls.mintToken({ expiresInMs: MINUTE - 1 }),
    /expiresInMs must be a whole number from 60000 to 2592000000/,
  ],
  [
    "a token living over 30 days",
    calls.mintToken({ expiresInMs: 30 * DAY + 1 }),
    /expiresInMs must be a whole number from 60000 to 2592000000/,
  ],
  [
    "a token's fractional lifetime",
    calls.mintToken({ expiresInMs: MINUTE + 0.5 }),
    /expiresInMs must be a whole number/,
  ],
  // A code lives 1 to 60 minutes.
  [
    "a code living under a minute",
    calls.mintCode({ expiresInMs: MINUTE - 1 }),
    /expiresInMs must be a whole number from 60000 to 3600000/,
  ],
  [
    "a code living over an hour",
    calls.mintCode({ expiresInMs: 60 * MINUTE + 1 }),
    /expiresInMs must be a whole number from 60000 to 3600000/,
  ],
  // A code allows 1 to 10 wrong tries.
  [
    "no wrong tries",
    calls.mintCode({ maxWrongTries: 0 }),
    /maxWrongTries must be a whole number from 1 to 10/,
  ],
  [
    "11 wrong tries",
    calls.mintCode({ maxWrongTries: 11 }),
    /maxWrongTries must be a whole number from 1 to 10/,
  ],
  // A code is 6, 7 or 8 digits.
  ["a 5-digit code", calls.mintCode({ digits: 5 }), /digits must be 6, 7 or 8/],
  ["a 9-digit code", calls.mintCode({ digits: 9 }), /digits must be 6, 7 or 8/],
  // Data: a flat record of primitives, at most 1 KB as JSON.
  [
    "data over 1 KB",
    calls.mintToken({ data: { note: "x".repeat(1014) } }),
    /at most 1024 bytes/,
  ],
  [
    "nested data",
    calls.mintToken({ data: { nested: { a: 1 } } }),
    /flat record/,
  ],
  ["data holding a list", calls.mintToken({ data: [1, 2] }), /flat record/],
  // Serialised other than validated: a Date has no own values to check.
  [
    "data that is a Date",
    calls.mintToken({ data: new Date(0) }),
    /flat record/,
  ],
  [
    "data that is a class instance",
    calls.mintToken({
      data: new (class Note {
        text = "x";
      })(),
    }),
    /flat record/,
  ],
  [
    "data holding a number that is not finite",
    calls.mintCode({ data: { n: Number.NaN } }),
    /flat record/,
  ],
  // The calls that spend, read and void check what they are given too.
  [
    "a spend of a bad purpose",
    s => s.consumeToken({ purpose: "Bad", token: "t" }),
    /purpose must be/,
  ],
  [
    "a read of a bad purpose",
    s => s.peekToken({ purpose: "Bad", token: "t" }),
    /purpose must be/,
  ],
  [
    "a code's spend for an empty subject",
    s => s.consumeCode({ purpose: "sign-in", subject: "", code: "123456" }),
    /subject must be/,
  ],
  [
    "a void for an empty subject",
    s => s.voidFor({ subject: "" }),
    /subject must be/,
  ],
  [
    "a void naming a bad purpose",
    s => s.voidFor({ subject: "account-1", purposes: ["ok", "Bad"] }),
    /purpose must be/,
  ],
];

describe("refuses input outside its bounds before touching the database", () => {
  it.each(refusals)("%s", async (_, call, message) => {
    const { adapter, calls: made } = recordingAdapter();
    const caught = await call(secretsOver(adapter)).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(caught).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(JSON.stringify(caught)).toMatch(message);
    expect(made).toEqual([]);
  });
});

describe("accepts input on its bounds", () => {
  it.each([
    ["a purpose of one letter", calls.mintToken({ purpose: "a" })],
    [
      "a purpose of 64 characters",
      calls.mintToken({ purpose: `a${"b.-9".repeat(15)}cde` }),
    ],
    [
      "a subject of 255 characters",
      calls.mintToken({ subject: "s".repeat(255) }),
    ],
    [
      "a subject holding a surrogate pair",
      calls.mintToken({ subject: "account-\ud83d\ude00" }),
    ],
    [
      "data with no prototype",
      calls.mintToken({ data: Object.assign(Object.create(null), { a: 1 }) }),
    ],
    ["a token living a minute", calls.mintToken({ expiresInMs: MINUTE })],
    ["a token living 30 days", calls.mintToken({ expiresInMs: 30 * DAY })],
    ["a code living an hour", calls.mintCode({ expiresInMs: 60 * MINUTE })],
    ["one wrong try", calls.mintCode({ maxWrongTries: 1 })],
    ["10 wrong tries", calls.mintCode({ maxWrongTries: 10 })],
    [
      "data of exactly 1 KB",
      calls.mintToken({ data: { note: "x".repeat(1013) } }),
    ],
  ])("%s", async (_, call) => {
    const { adapter, calls: made } = recordingAdapter();
    await expect(call(secretsOver(adapter))).resolves.toBeDefined();
    expect(made).toContain("insert");
  });

  it.each([6, 7, 8] as const)(
    "a %i-digit code, of exactly that many digits",
    async digits => {
      const { adapter } = recordingAdapter();
      const { code: minted } = await secretsOver(adapter).mintCode({
        ...code,
        digits,
      });
      expect(minted).toMatch(new RegExp(`^\\d{${digits}}$`));
    }
  );
});
