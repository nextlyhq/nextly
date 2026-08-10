// @vitest-environment jsdom
/**
 * A slider renders one thumb per VALUE, and the count comes from props rather than from children.
 *
 * Radix renders exactly the thumbs it is given, so a two-value slider handed one thumb drops the
 * second silently: the value stays in state and no thumb can reach it. Nothing else reports that —
 * the markup is valid, the first thumb works, and the control looks finished.
 *
 * The count is therefore measured here rather than assumed, in both directions (controlled and
 * uncontrolled), because the two props are read on different code paths.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { resetDevWarnings } from "../lib/dev-warn";

import { Slider } from "./slider";

beforeAll(() => {
  // Radix measures the track, and jsdom has no ResizeObserver. A stub is enough: these
  // assertions are about emitted roles and attributes, not about measured geometry.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

/**
 * Thumbs within ONE render's container.
 *
 * This package's vitest setup does not unmount between tests, so a document-wide query counts
 * every earlier render too and a per-test count assertion would drift upward as cases are added.
 */
const thumbsIn = (container: HTMLElement): Element[] =>
  Array.from(container.querySelectorAll('[role="slider"]'));

afterEach(() => {
  resetDevWarnings();
});

describe("Slider", () => {
  it("renders one thumb for a single controlled value", () => {
    const { container } = render(
      <Slider aria-label="Opacity" value={[40]} onValueChange={() => {}} />
    );
    expect(thumbsIn(container)).toHaveLength(1);
  });

  it("renders two thumbs for a two-value range, from defaultValue", () => {
    // The uncontrolled path reads a different prop than the controlled one, so a fix that
    // consulted only `value` would leave this case broken.
    const { container } = render(
      <Slider aria-label="Size range" defaultValue={[25, 75]} />
    );
    expect(thumbsIn(container)).toHaveLength(2);
  });

  it("renders one thumb when neither value nor defaultValue is given", () => {
    // The fallback matters: a slider with no initial value is still a usable control, and
    // rendering zero thumbs would make it operable by nobody.
    const { container } = render(<Slider aria-label="Blur" />);
    expect(thumbsIn(container)).toHaveLength(1);
  });

  it("carries the bounds a screen reader announces", () => {
    // A slider that announces only a position is not much use; the bounds are what make the
    // number mean something.
    const { container } = render(
      <Slider
        aria-label="Opacity"
        value={[40]}
        min={0}
        max={200}
        onValueChange={() => {}}
      />
    );
    const thumb = thumbsIn(container)[0];
    expect(thumb.getAttribute("aria-valuenow")).toBe("40");
    expect(thumb.getAttribute("aria-valuemin")).toBe("0");
    expect(thumb.getAttribute("aria-valuemax")).toBe("200");
  });

  it("marks the whole control disabled, not just its appearance", () => {
    // Opacity alone would leave a control that looks unavailable and still responds to keys.
    const { container } = render(
      <Slider aria-label="Opacity" defaultValue={[10]} disabled />
    );
    expect(thumbsIn(container)[0].hasAttribute("data-disabled")).toBe(true);
  });

  it("names the thumb, not the root, for a single-value slider", () => {
    // The root is not focusable and carries no slider role; a name left there is
    // announced by nothing. Screen readers meet the THUMB, so that is what has
    // to carry the name.
    const { container } = render(
      <Slider aria-label="Opacity" value={[40]} onValueChange={() => {}} />
    );
    expect(thumbsIn(container)[0].getAttribute("aria-label")).toBe("Opacity");
  });

  it("gives a range's two thumbs distinct names", () => {
    // A shared root name announces both ends identically, so nothing tells the
    // user which one they are holding.
    const { container } = render(
      <Slider
        aria-label="Size range"
        defaultValue={[25, 75]}
        thumbs={[
          { "aria-label": "Minimum size" },
          { "aria-label": "Maximum size" },
        ]}
      />
    );
    const [lower, upper] = thumbsIn(container);
    expect(lower.getAttribute("aria-label")).toBe("Minimum size");
    expect(upper.getAttribute("aria-label")).toBe("Maximum size");
  });

  it("does not put a shared labelledby on both thumbs of a range", () => {
    // One id cannot name two ends distinctly, so applying it to both would be
    // worse than leaving them to `thumbLabels`.
    const { container } = render(
      <Slider aria-labelledby="size-heading" defaultValue={[25, 75]} />
    );
    for (const thumb of thumbsIn(container)) {
      expect(thumb.hasAttribute("aria-labelledby")).toBe(false);
    }
  });

  it("pads the root so the target clears the 24px minimum", () => {
    // A 16px thumb on a 6px track is under WCAG 2.5.8, and on touch the gap
    // between grabbing the thumb and missing the control is exactly this
    // padding. The docs claimed it before the code did.
    const { container } = render(
      <Slider aria-label="Opacity" defaultValue={[10]} />
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain("py-2");
  });

  it("puts value-text and description on the thumb, where they are read", () => {
    // The general form of the naming defect: every attribute assistive
    // technology reads from a slider is read from the THUMB, and none are
    // inherited from the root. Fixing only the name left the rest unreachable,
    // since the thumbs are generated internally.
    const { container } = render(
      <Slider
        value={[40]}
        onValueChange={() => {}}
        thumbs={[
          {
            "aria-label": "Opacity",
            "aria-valuetext": "40 percent",
            "aria-describedby": "opacity-help",
          },
        ]}
      />
    );
    const thumb = thumbsIn(container)[0];
    expect(thumb.getAttribute("aria-valuetext")).toBe("40 percent");
    expect(thumb.getAttribute("aria-describedby")).toBe("opacity-help");
  });

  it("keeps the name off the roleless root", () => {
    // A second copy on the root is not merely redundant: it is a name on an
    // element nothing announces, which reads as correct in a DOM dump.
    const { container } = render(
      <Slider aria-label="Opacity" value={[40]} onValueChange={() => {}} />
    );
    expect(container.firstElementChild?.hasAttribute("aria-label")).toBe(false);
  });

  it("lets a thumb entry override the root name for a single thumb", () => {
    const { container } = render(
      <Slider
        aria-label="Fallback"
        value={[40]}
        onValueChange={() => {}}
        thumbs={[{ "aria-label": "Specific" }]}
      />
    );
    expect(thumbsIn(container)[0].getAttribute("aria-label")).toBe("Specific");
  });

  it("warns in development when a range names neither end", () => {
    // The requirement the type system cannot express: how many thumbs there
    // are is the length of an array. Documented and tested is not the same as
    // enforced, and an unnamed range fails silently — the control renders and
    // is unusable with a screen reader.
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(<Slider aria-label="Size" defaultValue={[25, 75]} />);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "one `thumbs` entry per thumb"
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("stays silent when the range names both ends", () => {
    // The positive control. Without it, a warning that fired unconditionally
    // would pass the case above and be useless.
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <Slider
          defaultValue={[25, 75]}
          thumbs={[{ "aria-label": "Minimum" }, { "aria-label": "Maximum" }]}
        />
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("stays silent for a single thumb named through the root", () => {
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(<Slider aria-label="Opacity" defaultValue={[40]} />);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not let a root labelledby outrank a thumb's own label", () => {
    // The two naming attributes are alternatives, and `aria-labelledby` WINS
    // name computation. Emitting the root's labelledby beside the thumb's own
    // label would silently discard the caller's explicit name — and the
    // same-attribute override test passes either way, so it cannot catch this.
    const { container } = render(
      <Slider
        aria-labelledby="size-heading"
        value={[40]}
        onValueChange={() => {}}
        thumbs={[{ "aria-label": "Opacity" }]}
      />
    );
    const thumb = thumbsIn(container)[0];
    expect(thumb.getAttribute("aria-label")).toBe("Opacity");
    expect(thumb.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("still falls back to the root when the thumb names itself in no way", () => {
    // The positive control for the rule above: an all-or-nothing fallback that
    // never fell back would pass the case above and break the documented
    // single-thumb API.
    const { container } = render(
      <Slider
        aria-labelledby="size-heading"
        value={[40]}
        onValueChange={() => {}}
        thumbs={[{ "aria-valuetext": "40 percent" }]}
      />
    );
    const thumb = thumbsIn(container)[0];
    expect(thumb.getAttribute("aria-labelledby")).toBe("size-heading");
    expect(thumb.getAttribute("aria-valuetext")).toBe("40 percent");
  });
});
