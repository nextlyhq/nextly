// @vitest-environment jsdom

/**
 * The reading that says work is outstanding.
 *
 * Its whole reason for existing is the case the status pill cannot cover: a
 * collection with no publish lifecycle, where that pill renders nothing and an
 * author had no reading in the toolbar at all. So the cases below are about
 * WHEN it speaks, not about how it looks.
 *
 * The transition is asserted rather than the dirty state alone. Rendering
 * straight into the dirty state and checking the attribute passes whether or
 * not the region was mounted beforehand — and a region inserted already holding
 * its text is not reliably announced, which would lose the one announcement
 * this exists to make.
 *
 * @module @nextlyhq/plugin-page-builder/admin/UnsavedChangesPill.test
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UnsavedChangesPill } from "./UnsavedChangesPill";

const region = (container: HTMLElement) =>
  container.querySelector("[aria-live]");

describe("the unsaved-work reading", () => {
  it("says so while the document holds uncommitted edits", () => {
    render(<UnsavedChangesPill isDirty />);
    expect(screen.getByText(/unsaved changes/i)).toBeTruthy();
  });

  it("shows NOTHING once everything is committed", () => {
    /*
     * No visible chip. The same `false` is produced by a document that was
     * never saved — a blocks field renders inside a create form and inside
     * previews — so a positive claim there would tell an author their work was
     * safe on the strength of nothing having been typed.
     */
    const { container } = render(<UnsavedChangesPill isDirty={false} />);
    expect(container.textContent).toBe("");
  });

  it("keeps the live region mounted while clean, so the change can be heard", () => {
    // An empty region is what makes the later announcement work. It must also
    // draw nothing: the chip's border and padding belong inside it.
    const { container } = render(<UnsavedChangesPill isDirty={false} />);
    expect(region(container)).not.toBeNull();
    expect(region(container)?.textContent).toBe("");
  });

  it("announces into the SAME region it was already showing", () => {
    /*
     * Node identity across the transition is the property. A region that is
     * unmounted while clean and inserted already holding its text is not
     * reliably announced — the assistive technology never observed it change.
     */
    const { container, rerender } = render(
      <UnsavedChangesPill isDirty={false} />
    );
    const before = region(container);
    expect(before).not.toBeNull();

    rerender(<UnsavedChangesPill isDirty />);
    expect(region(container)).toBe(before);
    expect(before?.textContent).toMatch(/unsaved changes/i);
  });

  it("announces politely, so an edit does not interrupt on every keystroke", () => {
    // The state flips on almost every edit. An assertive region would speak
    // over the author continuously, which is how a reading gets ignored.
    const { container } = render(<UnsavedChangesPill isDirty />);
    expect(region(container)?.getAttribute("aria-live")).toBe("polite");
  });
});
