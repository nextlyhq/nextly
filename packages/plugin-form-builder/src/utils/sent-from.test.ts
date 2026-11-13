/**
 * The page a submission keeps: a web page's origin and path, never its query
 * or fragment, and nothing for an address that is not a web page.
 */
import { describe, expect, it } from "vitest";

import { pageFromReferer } from "./sent-from";

describe("the page a submission was sent from", () => {
  it("keeps a web page's origin and path", () => {
    expect(pageFromReferer("https://acme.test/careers/backend")).toBe(
      "https://acme.test/careers/backend"
    );
    expect(pageFromReferer("http://localhost:3000/contact")).toBe(
      "http://localhost:3000/contact"
    );
  });

  it("drops the query and fragment, which may carry personal data", () => {
    expect(
      pageFromReferer("https://acme.test/apply?email=ana%40mail.test#form")
    ).toBe("https://acme.test/apply");
  });

  it("keeps nothing that is not a web page", () => {
    expect(pageFromReferer(undefined)).toBeUndefined();
    expect(pageFromReferer("")).toBeUndefined();
    expect(pageFromReferer("not an address")).toBeUndefined();
    expect(pageFromReferer("javascript:alert(1)")).toBeUndefined();
    expect(pageFromReferer("mailto:ana@mail.test")).toBeUndefined();
  });

  it("keeps nothing longer than an address may be", () => {
    expect(
      pageFromReferer(`https://acme.test/${"a".repeat(2100)}`)
    ).toBeUndefined();
  });
});
