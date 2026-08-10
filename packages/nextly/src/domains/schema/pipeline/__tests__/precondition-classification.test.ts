// A refusal must survive the trip out of the pipeline, or it may as well not carry a reason.
//
// The pre-resolution phase can decline to START — when the stored values would not survive a
// conversion — and that answer names the column, says nothing has changed, and tells the operator
// what to do instead. Every one of those facts is lost if the refusal is classified as a failed DDL
// statement: the caller is told a statement failed, which is both untrue and unactionable, and the
// message it carries is the deliberately generic "Validation failed."
//
// The distinction is not cosmetic. "Nothing ran, your schema is untouched, here is the column" and
// "a statement failed partway" call for opposite responses from whoever reads them.

import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import { classifyError } from "../errors";

describe("classifying a refused precondition", () => {
  const refusal = () =>
    NextlyError.validation({
      errors: [
        {
          path: "posts._body",
          code: "COLUMN_NOT_CONVERTIBLE",
          message:
            'Column "_body" on "posts" holds values that are not valid JSON.',
        },
      ],
    });

  it("is its own outcome, not a DDL failure", () => {
    expect(classifyError(refusal()).code).toBe("PRECONDITION_FAILED");
  });

  it("carries the text that names the column, not the generic public message", () => {
    // `NextlyError.validation` sets `publicMessage` to "Validation failed." and puts the substance
    // in `publicData`. Reading `.message` here would compile, pass a "did it classify" test, and
    // hand the operator a failure with no subject.
    const classified = classifyError(refusal());
    expect(classified.message).toContain("_body");
    expect(classified.message).not.toBe("Validation failed.");
  });

  it("keeps the payload so a caller can render the column and code itself", () => {
    expect(classifyError(refusal()).details).toMatchObject({
      errors: [expect.objectContaining({ code: "COLUMN_NOT_CONVERTIBLE" })],
    });
  });

  it("still degrades to the public message when the payload carries no text", () => {
    // The control for the fallback branch: an empty error list must not produce an empty message.
    const bare = NextlyError.validation({ errors: [] });
    expect(classifyError(bare).message.length).toBeGreaterThan(0);
  });

  it("leaves an ordinary error classified as it was", () => {
    // Without this, widening the classifier could quietly capture unrelated failures and report
    // every one of them as "nothing ran" — the opposite of the truth.
    expect(classifyError(new Error("boom")).code).not.toBe(
      "PRECONDITION_FAILED"
    );
  });
});
