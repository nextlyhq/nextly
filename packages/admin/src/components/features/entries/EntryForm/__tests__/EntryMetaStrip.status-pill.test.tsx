/**
 * The status pill mirrors the Document panel's lifecycle state wherever that
 * panel is not on screen: collapsed, or on a window too narrow to draw it. It carries Draft / Published and the working-draft
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

  it("steps aside only where the expanded document panel is on screen", () => {
    // The panel is drawn from `@4xl/content` up, and below that width it is
    // not drawn at all, so the pill is how a phone says the status. With the
    // panel expanded the pill is hidden where the panel shows, never removed.
    render(
      <EntryMetaStrip
        hasStatus
        status="published"
        isRailCollapsed={false}
        hasWorkingDraft
      />
    );
    expect(screen.getByText("Changed").className).toContain(
      "@4xl/content:hidden"
    );
  });

  it("shows at every width once the panel is collapsed", () => {
    render(<EntryMetaStrip hasStatus status="draft" isRailCollapsed />);
    expect(screen.getByText("Draft").className).not.toContain(
      "@4xl/content:hidden"
    );
  });
});
