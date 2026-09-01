// @vitest-environment jsdom

/**
 * The reading that says work is outstanding.
 *
 * Its whole reason for existing is the case the status pill cannot cover: a
 * collection with no publish lifecycle, where that pill renders nothing and an
 * author had no reading in the toolbar at all. So the cases below are about
 * WHEN it speaks, not about how it looks.
 *
 * @module @nextlyhq/plugin-page-builder/admin/UnsavedChangesPill.test
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UnsavedChangesPill } from "./UnsavedChangesPill";

describe("the unsaved-work reading", () => {
  it("says so while the document holds uncommitted edits", () => {
    render(<UnsavedChangesPill isDirty />);
    expect(screen.getByText(/unsaved changes/i)).toBeTruthy();
  });

  it("says NOTHING once everything is committed", () => {
    /*
     * Silence rather than "Saved". The same `false` is produced by a document
     * that was never saved — a blocks field renders inside a create form and
     * inside previews — so a positive claim there would tell an author their
     * work was safe on the strength of nothing having been typed.
     */
    const { container } = render(<UnsavedChangesPill isDirty={false} />);
    expect(container.textContent).toBe("");
  });

  it("announces politely, so an edit does not interrupt on every keystroke", () => {
    // The state flips on almost every edit. An assertive region would speak
    // over the author continuously, which is how a reading gets ignored.
    render(<UnsavedChangesPill isDirty />);
    const region = screen.getByText(/unsaved changes/i).closest("[aria-live]");
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });
});
