import { describe, it, expect } from "vitest";

import { fieldLabel, humanizeFieldName } from "../field-label";

describe("humanizeFieldName", () => {
  it("treats snake and kebab as the same word boundary", () => {
    // One of the copies this replaces split on `_` alone, so a kebab key came
    // out "User-email" — legal in a schema, and the only surface that showed it
    // was the one a translator reads.
    expect(humanizeFieldName("user_email")).toBe("User Email");
    expect(humanizeFieldName("user-email")).toBe("User Email");
  });

  it("splits camelCase, including after a digit", () => {
    expect(humanizeFieldName("firstName")).toBe("First Name");
    expect(humanizeFieldName("address1Line")).toBe("Address1 Line");
  });

  it("collapses a run of separators rather than emitting blank words", () => {
    expect(humanizeFieldName("meta__og-title")).toBe("Meta Og Title");
  });

  it("answers an empty key with an empty string", () => {
    expect(humanizeFieldName("")).toBe("");
  });
});

describe("fieldLabel", () => {
  it("prefers a declared label over the key", () => {
    expect(fieldLabel({ name: "excerpt", label: "Summary" })).toBe("Summary");
  });

  it("humanizes the key when no label is declared", () => {
    // The defect this exists for: the version diff printed `excerpt` where the
    // form printed "Excerpt", so the same field had two names.
    expect(fieldLabel({ name: "excerpt" })).toBe("Excerpt");
  });

  it("lets a blank label lose to the key", () => {
    // A label of spaces is not a name anyone chose. Rendered as-is it names
    // nothing while looking deliberate, so the heading goes silently missing.
    expect(fieldLabel({ name: "excerpt", label: "   " })).toBe("Excerpt");
    expect(fieldLabel({ name: "excerpt", label: "" })).toBe("Excerpt");
  });

  it("keeps a declared label's own spelling, lower case included", () => {
    // A field genuinely labelled "excerpt" is indistinguishable from one with
    // no label ONLY if the resolver second-guesses the author. It does not.
    expect(fieldLabel({ name: "excerpt", label: "excerpt" })).toBe("excerpt");
  });

  it("trims a declared label rather than passing the padding through", () => {
    expect(fieldLabel({ name: "x", label: "  Summary  " })).toBe("Summary");
  });

  it("answers a field it cannot name with an empty string, not a phrase", () => {
    // The fallback copy belongs to the surface: a version diff wants "Untitled
    // field", a table column wants a blank header rather than that phrase
    // repeated down the page.
    expect(fieldLabel({})).toBe("");
  });
});
