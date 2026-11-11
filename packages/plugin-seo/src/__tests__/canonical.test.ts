/**
 * The one rule for a canonical address, and where a typed one may stand.
 */
import { describe, expect, it } from "vitest";

import { typedCanonical, usableCanonical } from "../canonical";

describe("a usable canonical", () => {
  it.each([
    ["/about", "/about"],
    ["  /about  ", "/about"],
    ["https://acme.example/about", "https://acme.example/about"],
    ["http://acme.example/", "http://acme.example/"],
  ])("%s is %s", (value, expected) => {
    expect(usableCanonical(value)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "mailto:hi@acme.example",
    "javascript:alert(1)",
    "ftp://acme.example/file",
    "//elsewhere.example/page",
    "about",
  ])("%s is none", value => {
    expect(usableCanonical(value)).toBeUndefined();
  });
});

describe("a typed canonical", () => {
  const site = (productionAddresses: string[], elsewhere = false) => ({
    productionAddresses,
    elsewhere,
  });

  it("is taken from the site's own root or production addresses", () => {
    expect(typedCanonical("/about", site([]))).toBe("/about");
    expect(
      typedCanonical(
        "https://acme.example/about",
        site(["https://acme.example", "https://acme.de"])
      )
    ).toBe("https://acme.example/about");
    expect(
      typedCanonical(
        "https://ACME.example/about",
        site(["https://acme.example"])
      )
    ).toBe("https://ACME.example/about");
  });

  it("is refused off the site, unless the page first appeared there", () => {
    expect(
      typedCanonical(
        "https://elsewhere.example/a",
        site(["https://acme.example"])
      )
    ).toBeUndefined();
    // No production address known: an absolute address can't be shown to be
    // on the site.
    expect(typedCanonical("https://acme.example/a", site([]))).toBeUndefined();
    expect(typedCanonical("https://elsewhere.example/a", site([], true))).toBe(
      "https://elsewhere.example/a"
    );
  });

  it("is never an unusable value, confirmed or not", () => {
    expect(
      typedCanonical("javascript:alert(1)", site([], true))
    ).toBeUndefined();
  });
});
