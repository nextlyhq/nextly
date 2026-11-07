/**
 * The addresses an entry holds under its collection's address: one per
 * language while it is published, none while it is not, and none it could
 * be served at when its slug names no address.
 */
import { describe, expect, it } from "vitest";

import { claimKey } from "./claim-key";
import { entryAddresses, NO_ADDRESS } from "./entry-claims";

const keys = (found: ReturnType<typeof entryAddresses>) =>
  found === NO_ADDRESS ? found : found.map(at => claimKey("address", at));

describe("an entry's addresses", () => {
  it("are <address>/<slug> in each language while it is published", () => {
    expect(
      keys(
        entryAddresses(
          { status: "published", slug: "hello" },
          ["blog"],
          ["en", "fr"]
        )
      )
    ).toEqual(["addr:en|/blog/hello", "addr:fr|/blog/hello"]);
  });

  it("are held for a collection without a lifecycle, whose entries are all live", () => {
    expect(keys(entryAddresses({ slug: "hello" }, ["blog"], ["en"]))).toEqual([
      "addr:en|/blog/hello",
    ]);
  });

  it("are none while it is a draft", () => {
    expect(
      entryAddresses({ status: "draft", slug: "hello" }, ["blog"], ["en"])
    ).toEqual([]);
  });

  it("keep a slug's characters as one segment of the address", () => {
    expect(
      keys(
        entryAddresses(
          { status: "published", slug: "café 2" },
          ["news", "2026"],
          ["en"]
        )
      )
    ).toEqual(["addr:en|/news/2026/caf%C3%A9%202"]);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["holding a slash", "a/b"],
    ["a dot segment", ".."],
    ["not text", 7],
  ])("are refused when the slug is %s", (_why, slug) => {
    expect(
      entryAddresses({ status: "published", slug }, ["blog"], ["en"])
    ).toBe(NO_ADDRESS);
  });
});
