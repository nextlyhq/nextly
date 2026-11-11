/**
 * How an address of a page built in code is kept, the name it goes by, the
 * page the resolver reads for it, and when a route's call writes nothing.
 */
import { describe, expect, it } from "vitest";

import {
  codeAddressOf,
  codePageDocument,
  nameOfAddress,
  recorded,
  type CodePageRow,
} from "../store";

describe("an address of a page built in code", () => {
  it("is kept from the root, with no trailing slash but the root's", () => {
    expect(codeAddressOf("/pricing")).toBe("/pricing");
    expect(codeAddressOf("/pricing/")).toBe("/pricing");
    expect(codeAddressOf("/")).toBe("/");
  });

  it("is refused where it is not an address from the root", () => {
    expect(codeAddressOf("pricing")).toBeUndefined();
    expect(codeAddressOf("//elsewhere.com/x")).toBeUndefined();
    expect(codeAddressOf("/pricing?plan=pro")).toBeUndefined();
    expect(codeAddressOf("/pricing#faq")).toBeUndefined();
    expect(codeAddressOf(`/${"a".repeat(2048)}`)).toBeUndefined();
  });
});

describe("the name a page goes by", () => {
  it("is its address's last part, in words", () => {
    expect(nameOfAddress("/thank-you")).toBe("Thank you");
    expect(nameOfAddress("/integrations/web_flow")).toBe("Web flow");
    expect(nameOfAddress("/caf%C3%A9")).toBe("Café");
    expect(nameOfAddress("/")).toBe("Home");
  });
});

const ROW: CodePageRow = {
  id: "7",
  path: "/pricing",
  metaTitle: "Plans and prices",
  noindex: true,
  connected: true,
  codeTitle: "Pricing",
};

describe("the page the resolver reads", () => {
  it("holds what a person typed as an entry's seo group, and the page's name", () => {
    expect(codePageDocument("/pricing", ROW, undefined)).toEqual({
      id: "7",
      path: "/pricing",
      title: "Pricing",
      seo: { metaTitle: "Plans and prices", noindex: true },
    });
  });

  it("is named by the route where it gives a name, and is visible with nothing typed", () => {
    expect(codePageDocument("/pricing", undefined, "Our plans")).toEqual({
      id: "",
      path: "/pricing",
      title: "Our plans",
      seo: { noindex: false },
    });
  });
});

describe("what a route's call records", () => {
  it("is nothing where the row already says it", () => {
    expect(recorded(ROW, { codeTitle: "Pricing" })).toBe(true);
  });

  it("is the call where the route's code or its name changed, or it never called", () => {
    expect(recorded(ROW, { codeTitle: "Prices" })).toBe(false);
    expect(recorded(ROW, { codeTitle: "Pricing", name: "Plans" })).toBe(false);
    expect(
      recorded({ ...ROW, connected: false }, { codeTitle: "Pricing" })
    ).toBe(false);
    expect(recorded(undefined, {})).toBe(false);
  });
});
