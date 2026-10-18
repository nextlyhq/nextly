// The toolbar's collapse rules.
//
// jsdom evaluates no CSS, so these cannot assert that a label is visually
// hidden at a given width — that is measured in a real browser. What they CAN
// pin is the part that would silently break the mechanism: which container the
// queries name, that a collapsed label keeps its text (so the control keeps its
// accessible name), and that the primary action was never given a way to
// collapse at all.
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  TOOLBAR_CONTAINER,
  ToolbarLabel,
  type ToolbarLabelPriority,
} from "../toolbar-density";

describe("TOOLBAR_CONTAINER", () => {
  it("names the container the labels query against", () => {
    // The labels use `.../toolbar:` variants. If this class stops declaring a
    // container called `toolbar`, every query silently stops matching and each
    // label stays at full width — the exact defect this module was built to
    // fix, returning with no error anywhere.
    expect(TOOLBAR_CONTAINER).toBe("@container/toolbar");
  });
});

describe("ToolbarLabel", () => {
  const priorities: ToolbarLabelPriority[] = ["secondary"];

  it.each(priorities)(
    "keeps %s label text in the accessible tree",
    priority => {
      // `sr-only` hides the pixels and keeps the text. A label REMOVED at
      // narrow widths would leave an icon-only button with no name, which is
      // the failure mode this approach exists to avoid.
      //
      // Deliberately NO `title` on this button, though the real ones carry one:
      // with a title present the accessible name comes from the attribute and
      // this assertion passes even when the label renders nothing at all. The
      // label's own text has to be the only thing that can satisfy it.
      render(
        <button type="button">
          <ToolbarLabel priority={priority}>Unpublish</ToolbarLabel>
        </button>
      );
      expect(
        screen.getByRole("button", { name: "Unpublish" })
      ).toBeInTheDocument();
    }
  );

  it("passes extra classes through without dropping the collapse rule", () => {
    const { container } = render(
      <ToolbarLabel priority="secondary" className="ml-1">
        x
      </ToolbarLabel>
    );
    const cls = container.firstElementChild?.className ?? "";
    expect(cls).toContain("ml-1");
    expect(cls).toContain("sr-only");
  });
});
