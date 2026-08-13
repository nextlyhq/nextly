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

  it("reaches rows written unkeyed while retired secrets are still listed", async () => {
    // An install mid-rotation that has REMOVED `NEXTLY_SECRET` but not yet
    // cleared `NEXTLY_SECRET_PREVIOUS`. The writer hashes unkeyed whenever no
    // current secret is set, so every row written today carries the unkeyed
    // digest — while the retired generations are HMACs. Computing only those
    // reaches the OLD rows and misses the new ones, which is the wrong half:
    // the recent mail is what an erasure request is most likely about.
    envMock.NEXTLY_SECRET = undefined;
    envMock.NEXTLY_SECRET_PREVIOUS = RETIRED;
    vi.resetModules();
    const { recipientDigests, hashRecipient } = await import(
      "../delivery-record"
    );

    const digests = recipientDigests("person@example.com");

    // Taken from the WRITER rather than recomputed here: a hand-built
    // expectation agrees until the writer changes, which is the drift these
    // two functions exist to prevent.
    expect(digests).toContain(hashRecipient("person@example.com"));
    expect(digests).toContain(digestUnder(RETIRED, "person@example.com"));
  });

  it("writes under the first digest it would later look for", async () => {
    // The invariant that makes one of these a narrower view of the other
    // rather than a second opinion. Checked across every arrangement of the
    // two variables, because the branch that broke was the one nobody pictured.
    const arrangements: Array<[string | undefined, string | undefined]> = [
      [CURRENT, undefined],
      [CURRENT, RETIRED],
      [undefined, RETIRED],
      [undefined, undefined],
    ];

    for (const [current, previous] of arrangements) {
      envMock.NEXTLY_SECRET = current;
      envMock.NEXTLY_SECRET_PREVIOUS = previous;
      vi.resetModules();
      const { recipientDigest, recipientDigests, hashRecipient } = await import(
        "../delivery-record"
      );

      expect(recipientDigest("person@example.com")).toBe(
        recipientDigests("person@example.com")[0]
      );
      // And that head is what the row actually carries.
      expect(recipientDigest("person@example.com")).toBe(
        hashRecipient("person@example.com")
      );
    }
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
