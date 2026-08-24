// @vitest-environment jsdom
/**
 * FormActions never computes dirtiness: the page passes it down from the form
 * state that already tracks it, because two implementations of "has this
 * changed" drift apart and both look correct.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FormActions } from "./form-actions";

// Each `it` below renders into the shared jsdom document, and unmounting after
// every test keeps a leftover mount from one case out of the next case's DOM.
afterEach(cleanup);

describe("FormActions", () => {
  it("renders its buttons", () => {
    render(
      <FormActions>
        <button type="submit">Create key</button>
      </FormActions>
    );
    expect(screen.getByRole("button", { name: "Create key" })).toBeDefined();
  });

  it("announces unsaved changes in a live region only when the page says so", () => {
    // `role="status"` implies `aria-live="polite"`, so a screen-reader user is
    // told when the flag flips false to true, not only sighted users watching
    // the bar. Assert the semantics, not only that the text exists — text
    // alone is what the previous version of this test checked, and it passed
    // on a plain `<span>` that announced nothing.
    const { rerender } = render(
      <FormActions dirty>
        <button type="submit">Save</button>
      </FormActions>
    );
    expect(screen.getByRole("status").textContent).toMatch(/unsaved/i);

    rerender(
      <FormActions>
        <button type="submit">Save</button>
      </FormActions>
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/unsaved/i)).toBeNull();
  });
});
