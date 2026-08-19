/**
 * Telling COERCION apart from LOSS in a stored provider configuration.
 *
 * The stored configuration is its serialisation, and the founder's decision is
 * that a value JSON can only carry as text is coerced SILENTLY rather than
 * refused: a `Date` becoming an ISO string keeps the information, and the DX
 * wrinkle is accepted deliberately.
 *
 * Nothing in that decision permits LOSS, and loss is what the old guard was
 * really catching alongside the coercion. It arrives in two shapes that need
 * different questions:
 *
 *   - a KEY disappears, because JSON drops `undefined` values and an array's
 *     named properties;
 *   - a key SURVIVES while its content vanishes, because a `Map` or a `Set`
 *     holds its data somewhere JSON cannot see and serialises to `{}`.
 *
 * A single comparison cannot separate the three. Refusing everything that
 * changes is the old behaviour; accepting everything that serialises is the
 * candidate that failed. This module answers only "was anything lost".
 */
import { describe, expect, it } from "vitest";

import { findConfigurationLoss } from "../configuration-loss";

/** What the column will hold for a given parsed value. */
function serialised(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** The answer for a value, as the service asks it. */
function lossIn(value: unknown): string | null {
  return findConfigurationLoss(value, serialised(value));
}

describe("values that are COERCED, and must be accepted", () => {
  it("accepts a Date, which JSON carries as text", () => {
    // The decision's own example. The information survives; only the type
    // does not, and that cost was taken deliberately.
    expect(lossIn({ apiKey: "k", issuedAt: new Date(0) })).toBeNull();
  });

  it("accepts a Date nested inside an object", () => {
    expect(lossIn({ a: { issuedAt: new Date(0) } })).toBeNull();
  });

  it("accepts a Date nested inside an array", () => {
    expect(lossIn({ stamps: [new Date(0)] })).toBeNull();
  });

  it("accepts a plain configuration unchanged", () => {
    expect(lossIn({ apiKey: "k", port: 587, secure: true })).toBeNull();
  });

  it("accepts an array of scalars", () => {
    expect(lossIn({ scopes: ["send", "read"] })).toBeNull();
  });

  it("accepts a genuinely empty object", () => {
    // The control for the exotic-object rule below: `{}` serialising to `{}`
    // has lost nothing, and a rule that cannot tell it from a Map would
    // refuse a legitimate empty configuration.
    expect(lossIn({ headers: {} })).toBeNull();
  });

  it("accepts a nested empty array", () => {
    expect(lossIn({ scopes: [] })).toBeNull();
  });
});

describe("KEYS that disappear, which must be refused", () => {
  it("refuses an undefined-valued key, which JSON drops", () => {
    expect(lossIn({ apiKey: "k", label: undefined })).toMatch(/label/);
  });

  it("refuses a plain object whose toJSON discards its fields", () => {
    const headers = { token: "ops", toJSON: () => ({}) };
    expect(lossIn({ apiKey: "k", headers })).toMatch(/headers/);
  });

  it("refuses an array carrying named properties JSON cannot keep", () => {
    const scopes = Object.assign(["send"], { region: "eu" });
    expect(lossIn({ apiKey: "k", scopes })).toMatch(/scopes/);
  });

  it("names the PATH to the loss, not just that there was one", () => {
    // The message reaches an author who has to find the field. A bare "this
    // configuration loses data" makes them search their own parser.
    expect(lossIn({ outer: { inner: { gone: undefined } } })).toMatch(
      /outer\.inner\.gone/
    );
  });
});

describe("CONTENT that vanishes while its key survives", () => {
  it("refuses a Map, whose entries JSON cannot see", () => {
    // `headers` exists on both sides, so a key comparison passes it. What is
    // lost is inside a value that reports no own enumerable keys at all.
    expect(lossIn({ apiKey: "k", headers: new Map([["x", "y"]]) })).toMatch(
      /headers/
    );
  });

  it("refuses a Set", () => {
    expect(lossIn({ apiKey: "k", tags: new Set(["primary"]) })).toMatch(/tags/);
  });

  it("refuses a Set reached through an array", () => {
    expect(
      lossIn({ routes: [{ region: "eu", tags: new Set(["primary"]) }] })
    ).toMatch(/routes/);
  });

  it("refuses a class instance carrying its data privately", () => {
    class Credential {
      readonly #secret: string;
      constructor(secret: string) {
        this.#secret = secret;
      }
      reveal() {
        return this.#secret;
      }
    }

    expect(lossIn({ cred: new Credential("s") })).toMatch(/cred/);
  });
});
