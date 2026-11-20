import { afterEach, describe, expect, it } from "vitest";

import { editorMainAction } from "../useDialogReturnFocus";

/**
 * Where a step dialog's focus goes when what opened it is gone: the editor's main action, and
 * where a step took that away too (a person who may only read and approve has approved), the
 * review section, so focus never falls to the page's body.
 */
describe("editorMainAction", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is the editor's main action where there is one", () => {
    document.body.innerHTML =
      '<section data-review-focus="" tabindex="-1"></section><button data-primary="true">Publish</button>';

    expect(editorMainAction()?.textContent).toBe("Publish");
  });

  it("is the review section where no main action is left", () => {
    document.body.innerHTML =
      '<section data-review-focus="" tabindex="-1" aria-label="Review"></section>';

    expect(editorMainAction()?.getAttribute("aria-label")).toBe("Review");
  });
});
