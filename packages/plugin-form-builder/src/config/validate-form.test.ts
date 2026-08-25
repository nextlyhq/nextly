/**
 * Settings validation, through the public entry point.
 *
 * The redirect rules are the reason this file exists: a form set to send
 * visitors somewhere, with nowhere recorded, saves cleanly and then fails at
 * submit time — where there is no author to tell. Validation is the only point
 * at which that is still a correctable mistake.
 */
import { describe, expect, it } from "vitest";

import { validateFormConfig } from "./validate-form";
import type { FormConfig } from "../types";

/** A form that is valid but for whatever `settings` the case supplies. */
function formWith(settings: Record<string, unknown>): FormConfig {
  return {
    name: "Contact",
    slug: "contact",
    fields: [{ type: "text", name: "message", label: "Message" }],
    settings,
  } as unknown as FormConfig;
}

const codes = (settings: Record<string, unknown>) =>
  validateFormConfig(formWith(settings)).errors.map(error => error.code);

describe("redirect settings", () => {
  it("accepts a form that shows a message", () => {
    expect(codes({ confirmationType: "message" })).toEqual([]);
  });

  it("requires a destination for a URL redirect", () => {
    expect(codes({ confirmationType: "redirect" })).toContain(
      "REDIRECT_URL_REQUIRED"
    );
    expect(
      codes({ confirmationType: "redirect", redirectUrl: "/thanks" })
    ).toEqual([]);
  });

  it("accepts a URL redirect that names a document instead", () => {
    expect(
      codes({
        confirmationType: "redirect",
        redirectRelation: { relationTo: "pages", value: "pg1" },
      })
    ).toEqual([]);
  });

  it("requires a page when the form redirects to one", () => {
    // The case that motivated the rule: this saved happily and then sent
    // nobody anywhere.
    expect(codes({ confirmationType: "relationship" })).toContain(
      "REDIRECT_PAGE_REQUIRED"
    );
  });

  it("accepts a page redirect that names its page", () => {
    expect(
      codes({
        confirmationType: "relationship",
        redirectPage: { relationTo: "pages", value: "pg1" },
      })
    ).toEqual([]);
  });

  it("does not ask a page redirect for a URL", () => {
    // The two options have separate requirements; reporting the URL rule here
    // would send an author to a field the option does not use.
    expect(codes({ confirmationType: "relationship" })).not.toContain(
      "REDIRECT_URL_REQUIRED"
    );
  });

  it("reports a valid form as valid", () => {
    const result = validateFormConfig(
      formWith({
        confirmationType: "relationship",
        redirectPage: { relationTo: "pages", value: "pg1" },
      })
    );
    expect(result.valid).toBe(true);
  });
});
