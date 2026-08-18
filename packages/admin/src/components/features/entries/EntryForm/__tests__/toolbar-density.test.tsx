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
  const priorities: ToolbarLabelPriority[] = ["secondary", "lifecycle"];

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

  it("collapses a secondary label before a lifecycle one", () => {
    // Ordering is the whole design: supporting actions give up their words
    // first, and publish/unpublish hold theirs longer. Equal thresholds would
    // read as working while making the priority meaningless.
    const { container: secondary } = render(
      <ToolbarLabel priority="secondary">a</ToolbarLabel>
    );
    const { container: lifecycle } = render(
      <ToolbarLabel priority="lifecycle">b</ToolbarLabel>
    );
    const cls = (c: HTMLElement) => c.firstElementChild?.className ?? "";

    expect(cls(secondary)).toContain("/toolbar:sr-only");
    expect(cls(lifecycle)).toContain("/toolbar:sr-only");

    // Compared as WIDTHS rather than as positions on Tailwind's named scale.
    // The thresholds are deliberately arbitrary values — they carry the rows'
    // horizontal padding, which no named step accounts for — so a rank lookup
    // over `sm`/`md`/`lg` cannot read them and would report a false ordering.
    const remOf = (c: string) => {
      const arbitrary = /@max-\[(\d+(?:\.\d+)?)rem\]/.exec(c);
      if (arbitrary) return Number(arbitrary[1]);
      const named: Record<string, number> = {
        xs: 20,
        sm: 24,
        md: 28,
        lg: 32,
        xl: 36,
        "2xl": 42,
        "3xl": 48,
        "4xl": 56,
        "5xl": 64,
      };
      const step = /@max-([a-z0-9]+)\//.exec(c)?.[1] ?? "";
      const value = named[step];
      if (value === undefined) {
        throw new Error(`unreadable toolbar threshold: ${c}`);
      }
      return value;
    };

    // `@max-*` applies BELOW its value, so the label that collapses first is the
    // one with the LARGER threshold.
    expect(remOf(cls(secondary))).toBeGreaterThan(remOf(cls(lifecycle)));
  });

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
