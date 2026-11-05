import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { STORED_FORMS, showsUnpublished } from "../stored-field-read";

describe("showsUnpublished", () => {
  it("shows unpublished work for the draft form alone", () => {
    expect(showsUnpublished("draft")).toBe(true);
    expect(showsUnpublished("published")).toBe(false);
    expect(STORED_FORMS).toEqual(["published", "draft"]);
  });

  it("refuses a form it does not know, rather than reading it as either", () => {
    // What plain JavaScript, or an object passed on unchecked, could carry
    // past a boundary that did not parse it.
    for (const form of ["anything", "", undefined, "Draft"]) {
      let thrown: unknown;
      try {
        showsUnpublished(form as unknown as "draft");
      } catch (error) {
        thrown = error;
      }
      expect(NextlyError.isCode(thrown, "INTERNAL_ERROR")).toBe(true);
    }
  });
});
