/**
 * Two routes that differ only in what they trust must not share a cache entry.
 *
 * The bound changes which related rows a read returns, so it is part of the
 * read's identity. Leaving it out of the key lets a route that trusts `authors`
 * populate the cache, and a route that trusts nothing serve those rows from it
 * — the narrower route inheriting the broader one's results, which is the whole
 * exposure this bound exists to close, reintroduced by the cache.
 *
 * Asserted on the source because the failure needs a warm cache, two routes and
 * a related collection holding a restricted row: a behavioural test that omits
 * any of those passes whether or not the key is right.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RESOLVE_CONTENT = join(__dirname, "..", "resolve-content.ts");

/** The `keyParts` array as written. */
function cacheKeyParts(): string {
  const text = readFileSync(RESOLVE_CONTENT, "utf8");
  const start = text.indexOf("keyParts: [");
  expect(start, "resolve-content no longer builds a cache key").toBeGreaterThan(
    -1
  );
  return text.slice(start, text.indexOf("]", start));
}

describe("the trust bound is part of the cache identity", () => {
  it("is exercised — the read is cached with an explicit key", () => {
    // Without this the assertion below passes against an empty slice, which is
    // the shape of a guard reporting success because it found nothing.
    expect(cacheKeyParts()).toContain("collection");
    expect(cacheKeyParts()).toContain("slug");
  });

  it("keys on the trusted set", () => {
    expect(
      /trustedNames/.test(cacheKeyParts()),
      "the cache key omits the trust bound, so a route trusting more " +
        "collections can populate an entry that a narrower route then serves"
    ).toBe(true);
  });

  it("distinguishes an unbounded read from one that trusts nothing", () => {
    // An empty set and no set are opposite postures — one trusts everything it
    // reaches, the other trusts nothing — and `[].join(",")` is `""`, which is
    // also what a missing key part contributes. Without a distinct token they
    // collide on the same entry.
    const text = readFileSync(RESOLVE_CONTENT, "utf8");
    expect(
      /trustedNames === undefined \? "unbounded"/.test(text),
      "an unbounded read and a trust-nothing read must not produce the same " +
        "key fragment"
    ).toBe(true);
  });
});
