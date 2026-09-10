/**
 * A blank answer and a rejected one are different things to say.
 *
 * The public submission error carries a code, and a client uses it to decide
 * what to put in front of the visitor: "you left this blank" points at an empty
 * box, "this is not an email" points at what they typed. Getting it wrong tells
 * someone to fill in a field they have already filled in.
 *
 * The code cannot be read off the Zod issue, which is what these pin. Zod's
 * codes do not divide the same way: `too_small` covers both a blank answer and
 * a value that is present but under a minimum, and `invalid_type` covers both
 * an absent key and a value of the wrong type. So the decision is made by
 * looking at what the visitor actually submitted.
 */

import { describe, expect, it } from "vitest";

import { generateZodSchema, getValidationIssues } from "./generate-schema";
import type { FormFieldConfig } from "../types";

function issuesFor(
  fields: FormFieldConfig[],
  submitted: Record<string, unknown>
) {
  const result = generateZodSchema(fields).safeParse(submitted);
  return getValidationIssues(result, submitted);
}

const email: FormFieldConfig = {
  name: "email",
  label: "Email",
  type: "email",
  required: true,
};

const bio: FormFieldConfig = {
  name: "bio",
  label: "Bio",
  type: "textarea",
  required: true,
  validation: { minLength: 10 },
};

describe("validation issue codes", () => {
  it("reports REQUIRED for an answer that was never sent", () => {
    expect(issuesFor([email], {})).toEqual([
      expect.objectContaining({ path: "email", code: "REQUIRED" }),
    ]);
  });

  it("reports REQUIRED for an answer sent empty", () => {
    expect(issuesFor([email], { email: "" })).toEqual([
      expect.objectContaining({ path: "email", code: "REQUIRED" }),
    ]);
  });

  it("reports INVALID for a value that was supplied and rejected", () => {
    // The case the Zod-code mapping got wrong. `not-an-email` is present, so
    // telling the visitor it is required would point them at a full box.
    expect(issuesFor([email], { email: "not-an-email" })).toEqual([
      expect.objectContaining({ path: "email", code: "INVALID" }),
    ]);
  });

  it("reports INVALID for a value under its minimum, not REQUIRED", () => {
    // Zod says `too_small` here AND for a blank answer, which is exactly why
    // the code cannot be read off the issue.
    expect(issuesFor([bio], { bio: "too short" })).toEqual([
      expect.objectContaining({ path: "bio", code: "INVALID" }),
    ]);
  });

  it("separates the two when one submission carries both", () => {
    // The control. A rule that answered one code for everything would satisfy
    // some of the assertions above while telling a visitor with a half-filled
    // form the same thing about every field.
    const issues = issuesFor([email, bio], { email: "", bio: "too short" });

    expect(
      Object.fromEntries(issues.map(issue => [issue.path, issue.code]))
    ).toEqual({ email: "REQUIRED", bio: "INVALID" });
  });
});
