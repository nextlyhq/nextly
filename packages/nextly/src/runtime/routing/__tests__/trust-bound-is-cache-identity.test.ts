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

/**
 * The `keyParts` array as written.
 *
 * Bracket-matched rather than sliced to the first `]`: the entries carry
 * explanatory comments, and a comment containing a bracket would otherwise
 * truncate the region this reads — reporting a key part missing because the
 * search stopped before reaching it.
 */
function cacheKeyParts(): string {
  const text = readFileSync(RESOLVE_CONTENT, "utf8");
  const start = text.indexOf("keyParts: [");
  expect(start, "resolve-content no longer builds a cache key").toBeGreaterThan(
    -1
  );
  let depth = 0;
  let end = -1;
  for (let i = text.indexOf("[", start); i < text.length && end < 0; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) end = i;
  }
  // An assertion rather than a thrown error: an unterminated array means this
  // helper could not read the thing under test, which is a failure of the test
  // and not a product fault to model with a `NextlyError`.
  expect(end, "the keyParts array is unterminated").toBeGreaterThan(-1);
  return text.slice(start, end);
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

  it("encodes the set injectively", () => {
    // The encoding has to distinguish every distinct set, over an UNVALIDATED
    // string array. A join does not: `["a", "b"]` and `["a,b"]` produce the
    // same text while trusting different collections, and any sentinel string
    // is itself a legal slug that a one-element array can collide with.
    const text = readFileSync(RESOLVE_CONTENT, "utf8");
    expect(
      /JSON\.stringify\(trustedNames \?\? null\)/.test(text),
      "the trusted set must be encoded injectively — a join collides on " +
        "separator-containing slugs, and a sentinel collides with a real one"
    ).toBe(true);

    // The property itself, not just the call: three cases that a join or a
    // sentinel would conflate.
    const key = (v: readonly string[] | undefined): string =>
      JSON.stringify(v ?? null);
    expect(key(["authors", "media"])).not.toBe(key(["authors,media"]));
    expect(key(undefined)).not.toBe(key(["unbounded"]));
    expect(key(undefined)).not.toBe(key([]));
  });
});
