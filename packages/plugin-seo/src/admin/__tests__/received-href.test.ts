/**
 * The SEO tab's way to the check of what search engines received names the
 * page at the address its language serves it at, not the address it is kept
 * under: on a site that puts the language in every address, with it.
 */
import { describe, expect, it } from "vitest";

import { RECEIVED_PAGE_HREF } from "../../received/contract";
import type { SeoTabContext } from "../../tab/contract";
import { receivedHrefOf } from "../SeoTab";

/** The tab's answer for a page kept at `/blog/harbour`, served at `served`. */
function context(served: string | undefined): SeoTabContext {
  return {
    levels: {
      site: {},
      type: {},
      content: {},
      page: {},
      address: "/blog/harbour",
    } as unknown as SeoTabContext["levels"],
    site: { origin: "https://acme.example" },
    typeLabel: "Blog post",
    fieldLabels: {},
    fields: [],
    mayChange: true,
    ...(served === undefined ? {} : { served }),
  };
}

/** The address the link asks the check for. */
const asked = (href: string | undefined) =>
  href === undefined
    ? undefined
    : new URL(href, "https://admin.example").searchParams.get("address");

describe("the way to what search engines received", () => {
  it("asks for the page at the address its language serves it at", () => {
    const href = receivedHrefOf("7", context("/en/blog/harbour"));
    expect(href?.startsWith(RECEIVED_PAGE_HREF)).toBe(true);
    expect(asked(href)).toBe("https://acme.example/en/blog/harbour");
  });

  it("asks on a language's own domain where it is served there", () => {
    const href = receivedHrefOf("7", context("https://acme.de/blog/hafen"));
    expect(asked(href)).toBe("https://acme.de/blog/hafen");
  });

  it("offers none for a page being created, or with no address served", () => {
    expect(receivedHrefOf(null, context("/en/blog/harbour"))).toBeUndefined();
    expect(receivedHrefOf("7", context(undefined))).toBeUndefined();
  });
});
