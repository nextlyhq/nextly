/**
 * A slug as a collection stores it: one part by `generateSlug` where the
 * collection keeps no paths, each part of a path where it sets
 * `db.slugPaths`. Core's own writes and a plugin that says an address before
 * it is written both read it, so the two never disagree about where an entry
 * lands.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  publishCollectionDbOptions,
  publishedCollectionDbOptions,
} from "../collection-id";
import { slugAsStored } from "../slug-as-stored";

const before = publishedCollectionDbOptions();

afterEach(() => {
  publishCollectionDbOptions(before);
});

describe("a slug as its collection stores it", () => {
  it("drops the `/` of a path where the collection keeps no paths", () => {
    publishCollectionDbOptions([{ slug: "articles", db: {} }]);
    expect(slugAsStored("articles", "docs/install")).toEqual({
      slug: "docsinstall",
    });
    expect(slugAsStored("articles", "About Us")).toEqual({ slug: "about-us" });
  });

  it("keeps a path where the collection sets `db.slugPaths`", () => {
    publishCollectionDbOptions([{ slug: "pages", db: { slugPaths: true } }]);
    expect(slugAsStored("pages", "Docs/Install")).toEqual({
      slug: "docs/install",
    });
  });

  it("says why a path can't be stored, rather than rewriting it", () => {
    publishCollectionDbOptions([{ slug: "pages", db: { slugPaths: true } }]);
    const read = slugAsStored("pages", "docs//install");
    expect("problem" in read && read.problem).toContain("an empty part");
  });

  it("reads a collection that declares no options as one keeping no paths", () => {
    publishCollectionDbOptions([]);
    expect(slugAsStored("anything", "a/b")).toEqual({ slug: "ab" });
  });
});
