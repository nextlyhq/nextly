// The save gate's contract: a form needs a field, a consent needs its text,
// and a field's numeric bounds must stand as typed — the same rule the field's
// settings panel says under each bound (`boundProblem`), which the Schema
// Builder's save already refuses by. Here a stored `maxLength: 0` once
// reached `generate-schema.ts` as `.max(0)`, failing every nonempty
// submission the form it saved ever received.
import { describe, expect, it } from "vitest";

import type { AnyFormField } from "../types";

import { blockedBeforeSave } from "./FormBuilderView";

const field = (overrides: Record<string, unknown>): AnyFormField =>
  ({
    type: "text",
    name: "email",
    label: "Email",
    ...overrides,
  }) as AnyFormField;

describe("blockedBeforeSave", () => {
  it("refuses a bound the field's own panel flags, by the field's name", () => {
    const fields = [
      field({ validation: { maxLength: 0 } }),
    ] as readonly AnyFormField[];
    expect(blockedBeforeSave(fields, [])).toEqual({
      message: "Email: Max length must be at least 1.",
      page: "builder",
    });
  });

  it("refuses a minimum above its maximum, as the panel says it", () => {
    // A number field: min and max are its enforced bounds. On a text field
    // they are nothing the form reads, so they are not this save's to judge.
    const fields = [
      field({
        type: "number",
        name: "votes",
        label: "Votes",
        validation: { min: 10, max: 5 },
      }),
    ] as readonly AnyFormField[];
    expect(blockedBeforeSave(fields, [])).toEqual({
      message: "Votes: Min can't be more than max.",
      page: "builder",
    });
  });

  it("keeps a save free for bounds that stand, and for fields with none", () => {
    const fields = [
      field({ validation: { minLength: 2, maxLength: 10 } }),
      field({ name: "notes", label: "Notes" }),
    ] as readonly AnyFormField[];
    expect(blockedBeforeSave(fields, [])).toBeUndefined();
  });

  it("does not judge a bound the form's checks never enforce for the type", () => {
    // Why: an email field arrived from the API with a length bound nothing
    // reads — the email schema applies its own format check and a pattern,
    // and reads neither `minLength` nor `maxLength`. Refusing it would hold
    // the save with no control offered to fix, since the panel narrows its
    // rules by the same enforced answer.
    const fields = [
      field({ type: "email", validation: { maxLength: 0 } }),
    ] as readonly AnyFormField[];
    expect(blockedBeforeSave(fields, [])).toBeUndefined();
  });

  it("still asks for a field before anything else", () => {
    expect(blockedBeforeSave([], [])).toEqual({
      message: "Add at least one field to the form.",
      page: "builder",
    });
  });
});
