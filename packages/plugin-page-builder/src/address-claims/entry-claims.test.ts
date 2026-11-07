/**
 * The addresses an entry holds under its collection's address: one per
 * language while it is published, none while it is not, and none it could
 * be served at when its slug names no address.
 */
import { describe, expect, it } from "vitest";

import { claimKey, servedAddress, type ServedAddress } from "./claim-key";
import {
  designedEntry,
  entryAddresses,
  NO_ADDRESS,
  pageCandidates,
  servedAt,
  templateChanges,
} from "./entry-claims";

const keys = (found: ReturnType<typeof entryAddresses>) =>
  found === NO_ADDRESS ? found : found.map(at => claimKey("address", at));

describe("an entry's addresses", () => {
  it("are <address>/<slug> in each language while it is published", () => {
    expect(
      keys(
        entryAddresses(
          { status: "published", slug: "hello" },
          ["blog"],
          ["en", "fr"],
          true
        )
      )
    ).toEqual(["addr:en|/blog/hello", "addr:fr|/blog/hello"]);
  });

  it("are held for a collection without a lifecycle, whatever a field of it named status holds", () => {
    expect(
      keys(
        entryAddresses(
          { status: "archived", slug: "hello" },
          ["blog"],
          ["en"],
          false
        )
      )
    ).toEqual(["addr:en|/blog/hello"]);
  });

  it("are none while it is a draft", () => {
    expect(
      entryAddresses({ status: "draft", slug: "hello" }, ["blog"], ["en"], true)
    ).toEqual([]);
  });

  it("keep a slug's characters as one segment of the address", () => {
    expect(
      keys(
        entryAddresses(
          { status: "published", slug: "café 2" },
          ["news", "2026"],
          ["en"],
          true
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
    ["not well-formed Unicode", "\ud800"],
  ])("are refused when the slug is %s", (_why, slug) => {
    expect(
      entryAddresses({ status: "published", slug }, ["blog"], ["en"], true)
    ).toBe(NO_ADDRESS);
  });
});

const addressOf = (path: string, locale = "en"): ServedAddress => {
  const address = servedAddress(locale, path);
  if (address === null) throw new Error(`${path} names no address`);
  return address;
};

describe("the pages an entry's address could fall on", () => {
  it("are those whose slug is an ending of the path, with the address's keys", () => {
    const found = pageCandidates([
      addressOf("/blog/hello"),
      addressOf("/blog/hello", "fr"),
    ]);
    expect(found.slugs).toEqual(["blog/hello", "hello"]);
    expect([...found.addresses]).toEqual([
      "addr:en|/blog/hello",
      "addr:fr|/blog/hello",
    ]);
    expect([...found.lists]).toEqual([]);
  });

  it("include the page whose paginated list the address is a later page of", () => {
    const found = pageCandidates([addressOf("/blog/page/2")]);
    expect(found.slugs).toEqual(["blog/page/2", "page/2", "2", "blog"]);
    expect([...found.lists]).toEqual(["space:en|/blog"]);
  });

  it("are none for no address", () => {
    expect(pageCandidates([]).slugs).toEqual([]);
  });
});

describe("what a template's write changes about the entries it serves", () => {
  const published = (collection: string) => ({
    collection,
    status: "published",
  });
  const draft = (collection: string) => ({ collection, status: "draft" });

  it("starts serving on a first publish, as created or as updated", () => {
    expect(templateChanges("create", published("posts"), null)).toEqual([
      { collection: "posts", served: true },
    ]);
    expect(
      templateChanges("update", published("posts"), draft("posts"))
    ).toEqual([{ collection: "posts", served: true }]);
  });

  it("stops serving on an unpublish or a delete of a published template", () => {
    expect(
      templateChanges("update", draft("posts"), published("posts"))
    ).toEqual([{ collection: "posts", served: false }]);
    expect(templateChanges("delete", published("posts"), null)).toEqual([
      { collection: "posts", served: false },
    ]);
  });

  it("moves serving from the old collection to the new when a published template is pointed at another", () => {
    expect(
      templateChanges("update", published("articles"), published("posts"))
    ).toEqual([
      { collection: "posts", served: false },
      { collection: "articles", served: true },
    ]);
  });

  it("changes nothing for a write that leaves it serving what it served", () => {
    expect(
      templateChanges("update", published("posts"), published("posts"))
    ).toEqual([]);
    expect(templateChanges("update", draft("posts"), draft("posts"))).toEqual(
      []
    );
    expect(templateChanges("create", draft("posts"), null)).toEqual([]);
    expect(templateChanges("delete", draft("posts"), null)).toEqual([]);
  });
});

describe("where an entry is served", () => {
  /** An own design's state that fails the test if it is asked. */
  const unasked = () => {
    throw new Error("the own design was asked for");
  };

  it("is its collection's address while the template is published, without asking for its own design", async () => {
    expect(
      await servedAt({
        address: ["blog"],
        templatePublished: true,
        ownDesignPublished: unasked,
      })
    ).toEqual(["blog"]);
  });

  it("is its collection's address while only its own design is published", async () => {
    expect(
      await servedAt({
        address: ["blog"],
        templatePublished: false,
        ownDesignPublished: async () => true,
      })
    ).toEqual(["blog"]);
  });

  it("is nowhere while neither the template nor its own design is published", async () => {
    expect(
      await servedAt({
        address: ["blog"],
        templatePublished: false,
        ownDesignPublished: () => false,
      })
    ).toBeNull();
  });

  it("is nowhere when the collection has no address left, whatever is published", async () => {
    for (const templatePublished of [true, false]) {
      expect(
        await servedAt({
          address: null,
          templatePublished,
          ownDesignPublished: () => true,
        })
      ).toBeNull();
    }
  });
});

describe("the entry an own design serves", () => {
  it("is named by the design's entry collection and id, with whether it is published", () => {
    expect(
      designedEntry({
        collection: null,
        entry: "posts/e1",
        entryCollection: "posts",
        entryId: "e1",
        status: "published",
      })
    ).toEqual({ collection: "posts", id: "e1", published: true });
    expect(
      designedEntry({
        entryCollection: "posts",
        entryId: "e1",
        status: "draft",
      })
    ).toEqual({ collection: "posts", id: "e1", published: false });
  });

  it("is none for a collection's template, a row naming its entry in part, or no row", () => {
    expect(
      designedEntry({ collection: "posts", status: "published" })
    ).toBeNull();
    expect(designedEntry({ entryCollection: "posts", entryId: "" })).toBeNull();
    expect(designedEntry({ entryId: "e1" })).toBeNull();
    expect(designedEntry(null)).toBeNull();
  });
});
