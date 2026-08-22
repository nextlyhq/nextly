/**
 * Turning a server's field errors into something a form can point at.
 *
 * The subject here is the NARROWING, not the reading. `parseServerErrors` wants
 * a path, a code and a message on every issue, because it names a form control
 * with them and an issue missing any of the three cannot address one. That is a
 * stricter requirement than a consumer showing a sentence has — and the two
 * used to be expressed as two separate traversals of `data.errors`, which is
 * how they came to disagree.
 *
 * So what this file asserts is that the strict view is DERIVED from the shared
 * one: same reading, different requirement.
 *
 * @module lib/errors/error-mapping.test
 */
import { describe, expect, it } from "vitest";

import { validationIssues, parseApiError } from "../api/parseApiError";
import { parseServerErrors } from "./error-mapping";

/** A canonical validation body, as the wire carries it. */
const body = (errors: unknown[]) => ({
  error: {
    code: "VALIDATION_ERROR",
    message: "Validation failed.",
    requestId: "req_x",
    data: { errors },
  },
});

const COMPLETE = {
  path: "email",
  code: "INVALID_FORMAT",
  message: "Must be a valid email address.",
};

describe("parseServerErrors", () => {
  it("keeps an issue that can name a field", () => {
    expect(parseServerErrors(body([COMPLETE]))).toEqual([COMPLETE]);
  });

  it("returns null for anything that is not a canonical error body", () => {
    expect(parseServerErrors({ oops: true })).toBeNull();
    expect(parseServerErrors(null)).toBeNull();
    expect(parseServerErrors("nope")).toBeNull();
  });

  it("unwraps a fetch/axios-style response before reading it", () => {
    // The wrapper case the function has always accepted, asserted because the
    // derivation below must not quietly drop it.
    expect(parseServerErrors({ response: { data: body([COMPLETE]) } })).toEqual(
      [COMPLETE]
    );
  });

  describe("the requirement it adds on top of the shared reading", () => {
    it.each([
      ["no path", { code: "REQUIRED", message: "Need it." }],
      ["no code", { path: "email", message: "Need it." }],
      ["no message", { path: "email", code: "REQUIRED" }],
      ["a blank message", { path: "email", code: "REQUIRED", message: "  " }],
    ])("drops an issue with %s", (_name, issue) => {
      expect(parseServerErrors(body([issue]))).toEqual([]);
    });

    it("drops only the unusable one, keeping the rest", () => {
      expect(parseServerErrors(body([COMPLETE, { path: "name" }]))).toEqual([
        COMPLETE,
      ]);
    });
  });

  // The property the derivation exists for. Two independent traversals of
  // `data.errors` agreed on the day they were written and disagreed on partial
  // issues; anything this file can assert about one reading has to hold for the
  // other, on the same input.
  describe("agrees with the shared reading", () => {
    it("is exactly the subset of validationIssues that names all three", () => {
      const errors = [
        COMPLETE,
        { path: "name" },
        { path: "slug", code: "REQUIRED", message: "" },
        { code: "REQUIRED", message: "Orphaned." },
        "not an object",
      ];

      const shared = validationIssues(parseApiError(body(errors), 400));
      const strict = parseServerErrors(body(errors));

      expect(strict).toEqual(
        shared.filter(
          i =>
            i.path !== undefined &&
            i.code !== undefined &&
            i.message !== undefined
        )
      );
      // And the shared reading really did see more than the strict one, or the
      // assertion above is satisfied by both being empty.
      expect(shared.length).toBeGreaterThan((strict ?? []).length);
    });
  });
});
