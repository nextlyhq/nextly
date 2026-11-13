/**
 * Which versions of the site's pages a file's record names: on a site whose
 * languages have domains of their own, an address on a language's domain
 * names that language alone, and one on another site, or a path alone, the
 * default language.
 */
import { describe, expect, it } from "vitest";

import { matcher } from "../plan";
import type { ImportedRecord } from "../records";
import type { ReadVersion } from "../versions";

/** One published version of the About page in `locale`, served at `served`. */
function about(locale: string, served: string): ReadVersion {
  return {
    type: "pages",
    id: "about",
    label: locale === "en" ? "About" : "Über uns",
    path: new URL(served).pathname,
    slug: "about",
    document: {},
    seo: {},
    auto: {},
    levels: {} as ReadVersion["levels"],
    key: `pages|about|${locale}|published`,
    locale,
    form: "published",
    write: "inPlace",
    own: {},
    stored: {},
    inTransaction: locale === "en",
    served,
  };
}

/** A record of a file naming `address`. */
function at(address: string): ImportedRecord {
  const url = new URL(address);
  return {
    label: address,
    match: { origin: url.origin, path: url.pathname },
    values: { title: "A title" },
  };
}

const find = matcher(
  [
    about("en", "https://example.com/about"),
    // The German page has an address of its own.
    about("de", "https://example.de/ueber-uns"),
  ],
  "en"
);
const keys = (found: ReturnType<typeof find>) =>
  Array.isArray(found) ? found.map(each => each.key) : found;

describe("matching a file's addresses on a site with language domains", () => {
  it("finds each language's page by its own domain", () => {
    expect(keys(find(at("https://example.com/about")))).toEqual([
      "pages|about|en|published",
    ]);
    expect(keys(find(at("https://example.de/ueber-uns")))).toEqual([
      "pages|about|de|published",
    ]);
  });

  it("finds no other language's page for an address no page holds on a language's domain", () => {
    expect(find(at("https://example.de/about"))).toBeUndefined();
  });

  it("reads an address on another site by its path, in the default language", () => {
    expect(keys(find(at("https://old.example/about")))).toEqual([
      "pages|about|en|published",
    ]);
  });
});
