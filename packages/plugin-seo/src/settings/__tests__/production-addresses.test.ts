import { describe, expect, it } from "vitest";

import {
  productionAddressProblem,
  productionAddressesProblem,
} from "../production-addresses";

describe("a production address", () => {
  it.each([
    "https://rext.ai",
    "https://www.nextlyhq.com",
    "http://localhost:3000",
    "https://fr.example.com",
  ])("accepts the bare origin %s", value => {
    expect(productionAddressProblem(value)).toBeNull();
  });

  it.each([
    ["rext.ai", "Start the address with https://"],
    ["ftp://rext.ai", "Start the address with https://"],
    ["https://rext.ai/", "Leave off the / at the end"],
    ["https://rext.ai/blog", "Use the site's address only, without a path"],
    ["https://rext.ai?x=1", "Use the site's address only, without a path"],
    ["https://rext.ai#top", "Use the site's address only, without a path"],
    ["https://user:pass@rext.ai", "without a name or password"],
    ["https://", "Start the address with https://"],
    [" https://rext.ai", "without spaces"],
  ])("refuses %s", (value, said) => {
    expect(productionAddressProblem(value)).toContain(said);
  });
});

describe("the list of production addresses", () => {
  it("accepts none, one or several", () => {
    expect(productionAddressesProblem(undefined)).toBeNull();
    expect(productionAddressesProblem(null)).toBeNull();
    expect(productionAddressesProblem([])).toBeNull();
    expect(
      productionAddressesProblem([
        "https://example.com",
        "https://fr.example.com",
      ])
    ).toBeNull();
  });

  it("names the address that is wrong", () => {
    expect(
      productionAddressesProblem([
        "https://example.com",
        "https://fr.example.com/",
      ])
    ).toMatch(/^https:\/\/fr\.example\.com\/: /);
  });

  it("refuses the same address twice", () => {
    expect(
      productionAddressesProblem(["https://example.com", "https://EXAMPLE.com"])
    ).toContain("more than once");
  });

  it("refuses anything but a list of text", () => {
    expect(productionAddressesProblem("https://example.com")).not.toBeNull();
    expect(productionAddressesProblem([42])).not.toBeNull();
  });
});
