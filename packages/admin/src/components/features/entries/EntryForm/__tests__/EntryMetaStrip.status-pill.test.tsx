/**
 * The collapsed-rail status pill mirrors the Document panel's lifecycle state
 * when the rail is hidden. It carries Draft / Published and the working-draft
 * "Changed" state; local-dirty "Modified" stays a Document-panel-only affordance.
 */
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntryMetaStrip } from "../EntryMetaStrip";

describe("EntryMetaStrip — status pill", () => {
  it("shows Published for a published entry when the rail is collapsed", () => {
    render(<EntryMetaStrip hasStatus status="published" isRailCollapsed />);
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("shows Draft for a draft entry when the rail is collapsed", () => {
    render(<EntryMetaStrip hasStatus status="draft" isRailCollapsed />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows Changed when a published entry has a pending working draft", () => {
    render(
      <EntryMetaStrip
        hasStatus
        status="published"
        isRailCollapsed
        hasWorkingDraft
      />
    );
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("hides the pill while the rail is expanded (Document panel owns it)", () => {
    render(
      <EntryMetaStrip
        hasStatus
        status="published"
        isRailCollapsed={false}
        hasWorkingDraft
      />
    );
    expect(screen.queryByText("Changed")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });
});
