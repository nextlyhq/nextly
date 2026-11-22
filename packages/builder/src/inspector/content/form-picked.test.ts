/**
 * The Form block's picked form, read the way the renderer reads it: one
 * implementation, so the panel, the canvas notice and the page's checks agree
 * with what a visitor is shown.
 */
import { pickedForm } from "@nextlyhq/blocks-react";
import { describe, expect, it } from "vitest";

import { answersGoNowhere, pickedFormOf } from "./form-picked";

describe("the picked form's reading", () => {
  it("is the renderer's own", () => {
    expect(pickedFormOf).toBe(pickedForm);
  });

  it("treats the page builder's own provider as a simple form", () => {
    expect(pickedFormOf({ provider: "simple", ref: "x" })).toBeUndefined();
    expect(answersGoNowhere({ form: { provider: "simple" }, action: "" })).toBe(
      true
    );
    expect(pickedFormOf({ provider: "forms", ref: "contact" })).toEqual({
      provider: "forms",
      ref: "contact",
    });
  });
});
