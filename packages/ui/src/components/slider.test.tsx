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
import { beforeAll, describe, expect, it } from "vitest";

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
});
