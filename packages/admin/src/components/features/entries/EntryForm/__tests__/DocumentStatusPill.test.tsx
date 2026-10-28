/**
 * The status pill says where the document stands in the language being
 * edited: Draft, Published, or Changed for a published document with a
 * working draft pending. It sits in the document bar and shows at every width;
 * local unsaved edits are the save state's to report, beside it.
 */
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { DocumentStatusPill } from "../DocumentStatusPill";

describe("DocumentStatusPill", () => {
  it("shows Published for a published entry", () => {
    render(<DocumentStatusPill status="published" hasWorkingDraft={false} />);
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("shows Draft for a draft entry", () => {
    render(<DocumentStatusPill status="draft" hasWorkingDraft={false} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows Changed when a published entry has a pending working draft", () => {
    render(<DocumentStatusPill status="published" hasWorkingDraft />);
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("shows Draft, not Changed, for a draft with a working draft", () => {
    // A working draft only changes what a PUBLISHED document is called.
    render(<DocumentStatusPill status="draft" hasWorkingDraft />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows at every width, beside the panel or not", () => {
    // It no longer steps aside for the document panel: the bar is the one
    // place the status is drawn.
    render(<DocumentStatusPill status="draft" hasWorkingDraft={false} />);
    expect(screen.getByText("Draft").className).not.toMatch(/hidden/);
  });
});
