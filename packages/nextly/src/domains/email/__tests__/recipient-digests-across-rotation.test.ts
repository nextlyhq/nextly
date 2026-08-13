/**
 * An erasure request reaches rows written before the secret was rotated.
 *
 * The digest is an HMAC keyed with `NEXTLY_SECRET`, so rotating it leaves every
 * older row carrying a value the current key no longer produces. Before this,
 * erasure computed one digest, matched nothing, and returned without error —
 * because "no rows matched" is also what a recipient with no deliveries looks
 * like. A privacy request that silently under-delivers is the failure this
 * exists to make impossible.
 */

import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const CURRENT = "current-secret-long-enough-for-hmac-derivation";
const RETIRED = "retired-secret-long-enough-for-hmac-derivation";

const envMock = {
  NEXTLY_SECRET: CURRENT as string | undefined,
  NEXTLY_SECRET_PREVIOUS: undefined as string | undefined,
};

vi.mock("../../../lib/env", () => ({ env: envMock }));

/** What a row written under a given secret actually carries. */
function digestUnder(secret: string, address: string): string {
  return createHmac("sha256", secret)
    .update(address.trim().toLowerCase())
    .digest("hex");
}

describe("reaching delivery rows across a secret rotation", () => {
  beforeEach(() => {
    envMock.NEXTLY_SECRET = CURRENT;
    envMock.NEXTLY_SECRET_PREVIOUS = undefined;
  });

  it("computes only the current digest when nothing has been retired", async () => {
    const { recipientDigests } = await import("../delivery-record");

    expect(recipientDigests("person@example.com")).toEqual([
      digestUnder(CURRENT, "person@example.com"),
    ]);
  });

  it("also computes the digest a retired secret would have written", async () => {
    envMock.NEXTLY_SECRET_PREVIOUS = RETIRED;
    vi.resetModules();
    const { recipientDigests } = await import("../delivery-record");

    const digests = recipientDigests("person@example.com");

    // The row written before the rotation carries THIS value, and nothing the
    // current key produces equals it. Reaching it is the whole point.
    expect(digests).toContain(digestUnder(RETIRED, "person@example.com"));
    expect(digests).toContain(digestUnder(CURRENT, "person@example.com"));
  });

  it("matches an address however the sender wrote it", async () => {
    envMock.NEXTLY_SECRET_PREVIOUS = RETIRED;
    vi.resetModules();
    const { recipientDigests } = await import("../delivery-record");

    // A display name and casing are how the same person is written in practice;
    // both must reduce to the same mailbox before hashing, under every
    // generation rather than only the current one.
    expect(recipientDigests('"A Person" <Person@Example.COM>')).toEqual(
      recipientDigests("person@example.com")
    );
  });

  it("does not compare the same digest twice", async () => {
    // An install that lists its CURRENT secret again under the retired key is a
    // plausible copy-paste, and it would otherwise widen every erasure
    // predicate with a duplicate for no benefit.
    envMock.NEXTLY_SECRET_PREVIOUS = CURRENT;
    vi.resetModules();
    const { recipientDigests } = await import("../delivery-record");

    expect(recipientDigests("person@example.com")).toHaveLength(1);
  });
});
