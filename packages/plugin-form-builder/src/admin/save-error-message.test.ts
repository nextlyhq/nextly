import { describe, expect, it } from "vitest";

import { saveErrorMessage } from "./FormBuilderView";

/**
 * What a refused save tells the author.
 *
 * Worth pinning because the failure mode is silent: every validation rule in
 * the forms collection throws the same `"Validation failed."` at the top
 * level, so a regression here does not break a save — it leaves an author
 * staring at a form that will not save and no statement of what to change.
 */
describe("saveErrorMessage", () => {
  const envelope = (error: unknown) => ({ error });

  it("prefers the field issue over the generic message", () => {
    expect(
      saveErrorMessage(
        envelope({
          message: "Validation failed.",
          data: {
            errors: [
              {
                path: "settings.redirectPage",
                message: "Choose a page to redirect to.",
              },
            ],
          },
        }),
        "Bad Request"
      )
    ).toBe("Choose a page to redirect to.");
  });

  it("joins several field issues", () => {
    expect(
      saveErrorMessage(
        envelope({
          message: "Validation failed.",
          data: {
            errors: [{ message: "First problem." }, { message: "Second." }],
          },
        }),
        "Bad Request"
      )
    ).toBe("First problem. Second.");
  });

  it("falls back to the top-level message when there are no field issues", () => {
    expect(
      saveErrorMessage(envelope({ message: "Not permitted." }), "Forbidden")
    ).toBe("Not permitted.");
  });

  it("ignores field entries carrying no message", () => {
    // An entry with a path and no message says nothing an author can act on,
    // so it must not win over the top-level sentence or produce a blank one.
    expect(
      saveErrorMessage(
        envelope({
          message: "Validation failed.",
          data: { errors: [{ path: "settings.redirectPage" }] },
        }),
        "Bad Request"
      )
    ).toBe("Validation failed.");
  });

  it("falls back to the status when the body is not an envelope", () => {
    for (const body of [undefined, null, {}, "nonsense", []]) {
      expect(saveErrorMessage(body, "Bad Gateway")).toBe(
        "Failed to save form: Bad Gateway"
      );
    }
  });
});
