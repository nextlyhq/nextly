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
    // Asserts the stated MINIMUM, not the padding that contributes to it:
    // padding alone reached only 22px, and a test naming `py-2` passed while
    // the documented 24px was never met.
    const root = container.firstElementChild;
    expect(root?.className).toContain("min-h-6");
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

  it("keeps the uncontrolled thumb count fixed once Radix has captured it", () => {
    // Radix captures an uncontrolled value array once, at mount. Recomputing
    // the count from a later `defaultValue` drops a thumb while Radix still
    // holds its value — an endpoint nothing can reach and nothing reports.
    const { container, rerender } = render(
      <Slider
        defaultValue={[25, 75]}
        thumbs={[{ "aria-label": "Min" }, { "aria-label": "Max" }]}
      />
    );
    expect(thumbsIn(container)).toHaveLength(2);

    rerender(
      <Slider
        defaultValue={[25]}
        thumbs={[{ "aria-label": "Min" }, { "aria-label": "Max" }]}
      />
    );
    expect(thumbsIn(container)).toHaveLength(2);
  });

  it("still follows a controlled value's length across rerenders", () => {
    // The positive control: freezing BOTH paths would make a controlled range
    // unable to change arity, which is a legitimate thing for a caller to do.
    const { container, rerender } = render(
      <Slider
        value={[40]}
        onValueChange={() => {}}
        thumbs={[{ "aria-label": "One" }]}
      />
    );
    expect(thumbsIn(container)).toHaveLength(1);

    rerender(
      <Slider
        value={[25, 75]}
        onValueChange={() => {}}
        thumbs={[{ "aria-label": "Min" }, { "aria-label": "Max" }]}
      />
    );
    expect(thumbsIn(container)).toHaveLength(2);
  });

  it("warns when a SINGLE thumb has no name anywhere", () => {
    // Previously exempt: the check short-circuited on `count === 1`, so the
    // simplest unnamed slider of all went unreported.
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(<Slider defaultValue={[40]} />);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("accessible name");
    } finally {
      warn.mockRestore();
    }
  });

  describe("an empty value array", () => {
    // Zero values is a state the control cannot represent. The naive count arithmetic produced
    // zero THUMBS from it — a track with no `slider` role in it at all, inert and looking
    // finished. The two ways out are not symmetric: the uncontrolled case has a correct value to
    // fall back to, and the controlled case does not.

    it("renders nothing at all for an empty controlled value", () => {
      // Not merely "no thumb": a lone track is the inert bar this started as. And a thumb
      // without a value would be worse still — Radix routes a track click through
      // `getClosestValueIndex`, which answers -1 for an empty array and writes nowhere, so the
      // control would look operable and move for no input at all.
      const { container } = render(
        <Slider aria-label="Opacity" value={[]} onValueChange={() => {}} />
      );
      expect(container.firstElementChild).toBeNull();
    });

    it("still renders an operable thumb for an empty defaultValue", () => {
      const { container } = render(
        <Slider aria-label="Opacity" defaultValue={[]} />
      );
      expect(thumbsIn(container)).toHaveLength(1);
    });

    it("falls back to `min` when defaultValue is empty, rather than to nothing", () => {
      // The uncontrolled case is repairable, and repairing it means landing on the value an
      // omitted prop would have produced. Asserting the NUMBER rather than the thumb count is
      // what separates a real fallback from a thumb rendered over no value at all.
      const { container } = render(
        <Slider aria-label="Opacity" defaultValue={[]} min={10} max={90} />
      );
      const [thumb] = thumbsIn(container);
      expect(thumb.getAttribute("aria-valuenow")).toBe("10");
    });

    it("does not seize state the caller owns when a controlled value is empty", () => {
      // The tempting repair — substituting a value — would either flip the control to
      // uncontrolled or display a number the caller's state does not hold. Rendering nothing is
      // what keeps a controlled slider from inventing state on the caller's behalf.
      const onValueChange = vi.fn();
      const { container } = render(
        <Slider aria-label="Opacity" value={[]} onValueChange={onValueChange} />
      );
      // Counting thumbs would NOT distinguish this from the original defect: a bare track has
      // zero thumbs too, so the assertion would hold while the inert control was still there.
      expect(container.firstElementChild).toBeNull();
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("returns to a working control once the value arrives", () => {
      // The scenario this whole case exists for is a value that loads late, so the empty render
      // has to be a passing phase rather than a dead end. Without this, "render nothing" could
      // be satisfied by a component that never recovers.
      const { container, rerender } = render(
        <Slider aria-label="Opacity" value={[]} onValueChange={() => {}} />
      );
      expect(container.firstElementChild).toBeNull();

      rerender(
        <Slider aria-label="Opacity" value={[40]} onValueChange={() => {}} />
      );
      const [thumb] = thumbsIn(container);
      expect(thumb?.getAttribute("aria-valuenow")).toBe("40");
    });

    it("reports the empty array rather than failing silently", () => {
      resetDevWarnings();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        render(
          <Slider aria-label="Opacity" value={[]} onValueChange={() => {}} />
        );
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("empty array");
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("an empty accessible name", () => {
    // `aria-label={field.label}` before the label loads produces `aria-label=""`. The attribute
    // is present, so a `!== undefined` check calls the thumb named; the accessible name computes
    // to the empty string, so a screen reader announces a bare number. The warning existing at
    // all is what made this worth catching — a safeguard that stays silent on the case it was
    // built for is worse than none, because it certifies the defect.

    it("reports a blank aria-label as unnamed", () => {
      resetDevWarnings();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        render(<Slider aria-label="   " defaultValue={[40]} />);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("accessible name");
      } finally {
        warn.mockRestore();
      }
    });

    it("reports a range whose second thumb is named with an empty string", () => {
      resetDevWarnings();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        render(
          <Slider
            defaultValue={[25, 75]}
            thumbs={[{ "aria-label": "Minimum" }, { "aria-label": "" }]}
          />
        );
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it("does not emit an empty naming attribute onto the thumb", () => {
      // Present-and-empty is worse than absent: it states that a name was chosen. Omitting the
      // attribute leaves the element honestly unnamed for anything auditing the DOM.
      const { container } = render(
        <Slider
          defaultValue={[25, 75]}
          thumbs={[{ "aria-label": "Min" }, { "aria-label": "" }]}
        />
      );
      const thumbs = thumbsIn(container);
      expect(thumbs[0].getAttribute("aria-label")).toBe("Min");
      expect(thumbs[1].hasAttribute("aria-label")).toBe(false);
    });

    it("falls back to the root name when a single thumb's own label is blank", () => {
      // A blank per-thumb label is not a name, so it must not suppress the root fallback the
      // one-thumb API documents.
      const { container } = render(
        <Slider
          aria-label="Opacity"
          defaultValue={[40]}
          thumbs={[{ "aria-label": "" }]}
        />
      );
      const [thumb] = thumbsIn(container);
      expect(thumb.getAttribute("aria-label")).toBe("Opacity");
    });
  });

  describe("a vertical slider's length", () => {
    // The cross-axis rules were written as `data-[orientation=vertical]:` variants, which compile
    // to attribute selectors and therefore OUTRANK a plain utility passed in `className`. The
    // caller's override lost the cascade silently, and the forced `h-full` collapsed to zero
    // inside any auto-height parent — a slider with no track to drag along.

    it("carries a length of its own rather than inheriting one", () => {
      const { container } = render(
        <Slider
          aria-label="Opacity"
          orientation="vertical"
          defaultValue={[40]}
        />
      );
      const root = container.firstElementChild;
      expect(root?.className).toContain("h-44");
      expect(root?.className).not.toContain("h-full");
    });

    it("lets a caller replace that length, including with h-full", () => {
      // Both directions matter: a fixed override, and the fill-the-parent behaviour the default
      // gives up. Neither can work while the wrapper's own class outranks the caller's.
      const { container: fixed } = render(
        <Slider
          aria-label="A"
          orientation="vertical"
          defaultValue={[40]}
          className="h-64"
        />
      );
      expect(fixed.firstElementChild?.className).toContain("h-64");
      expect(fixed.firstElementChild?.className).not.toContain("h-44");

      const { container: filled } = render(
        <Slider
          aria-label="B"
          orientation="vertical"
          defaultValue={[40]}
          className="h-full"
        />
      );
      expect(filled.firstElementChild?.className).toContain("h-full");
      expect(filled.firstElementChild?.className).not.toContain("h-44");
    });

    it("keeps the 24px target on the axis a vertical slider is thin in", () => {
      const { container } = render(
        <Slider
          aria-label="Opacity"
          orientation="vertical"
          defaultValue={[40]}
        />
      );
      expect(container.firstElementChild?.className).toContain("min-w-6");
    });

    it("still tells Radix which orientation it is", () => {
      // Orientation drives the arrow keys a slider responds to. Reading it in JS to pick classes
      // would be worthless if it stopped reaching the primitive that acts on it.
      const { container } = render(
        <Slider
          aria-label="Opacity"
          orientation="vertical"
          defaultValue={[40]}
        />
      );
      expect(
        container.firstElementChild?.getAttribute("data-orientation")
      ).toBe("vertical");
    });
  });
});
