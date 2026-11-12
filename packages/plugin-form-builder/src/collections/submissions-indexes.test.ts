/**
 * The submissions collection always keeps the unique index one response per
 * person rests on, beside any indexes a site adds through its overrides.
 */
import { describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

const RESPONSE_KEY = { fields: ["form", "responseKey"], unique: true };

function submissionsIndexes(overrides?: Record<string, unknown>) {
  const { collections } = formBuilder(
    overrides ? { formSubmissionOverrides: overrides } : {}
  );
  const submissions = collections.find(c => c.slug === "form-submissions");
  return (submissions as { indexes?: unknown[] } | undefined)?.indexes;
}

describe("the submissions collection's indexes", () => {
  it("include the one-response key's unique index", () => {
    expect(submissionsIndexes()).toEqual([RESPONSE_KEY]);
  });

  it("keep it beside a site's own indexes, once", () => {
    expect(
      submissionsIndexes({
        indexes: [{ fields: ["submittedAt"] }, RESPONSE_KEY],
      })
    ).toEqual([RESPONSE_KEY, { fields: ["submittedAt"] }]);
  });
});
