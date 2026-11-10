/**
 * The height a loading card holds: the height its placement was last drawn at with an answer,
 * and nothing for a placement never drawn with one.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetHeldCardHeights, useHeldCardHeight } from "../held-height";

/** A cell measuring `height` px tall, which reports the height it holds through `onHeld`. */
function Cell({
  id,
  loading,
  height,
  onHeld,
}: {
  id: string;
  loading: boolean;
  height: number;
  onHeld: (held: number | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  onHeld(useHeldCardHeight(id, loading, ref));
  return <div ref={ref} data-height={height} />;
}

/** jsdom lays nothing out: each cell measures the height its `data-height` names. */
function measureFromDataHeight() {
  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const height = Number(this.dataset.height ?? 0);
      return {
        height,
        width: 100,
        top: 0,
        left: 0,
        right: 100,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
}

afterEach(() => {
  vi.restoreAllMocks();
  forgetHeldCardHeights();
});

describe("useHeldCardHeight", () => {
  it("holds nothing for a placement never drawn with an answer", () => {
    measureFromDataHeight();
    const held: (number | undefined)[] = [];
    render(<Cell id="a" loading height={0} onHeld={h => held.push(h)} />);
    expect(held.at(-1)).toBeUndefined();
  });

  it("holds nothing while the card has its answer", () => {
    measureFromDataHeight();
    const held: (number | undefined)[] = [];
    render(
      <Cell id="a" loading={false} height={240} onHeld={h => held.push(h)} />
    );
    expect(held.at(-1)).toBeUndefined();
  });

  it("holds the height the placement was last drawn at once it loads again", () => {
    measureFromDataHeight();
    const held: (number | undefined)[] = [];
    const { rerender } = render(
      <Cell id="a" loading={false} height={240} onHeld={h => held.push(h)} />
    );
    // Reloading: the cell itself now measures its skeleton's height, but holds the drawn one.
    rerender(<Cell id="a" loading height={90} onHeld={h => held.push(h)} />);
    expect(held.at(-1)).toBe(240);
    // Answered again: nothing held, and the new height is the one remembered.
    rerender(
      <Cell id="a" loading={false} height={180} onHeld={h => held.push(h)} />
    );
    expect(held.at(-1)).toBeUndefined();
    rerender(<Cell id="a" loading height={90} onHeld={h => held.push(h)} />);
    expect(held.at(-1)).toBe(180);
  });

  it("remembers by placement, across a remount, and never lends one card's height to another", () => {
    measureFromDataHeight();
    const first = render(
      <Cell id="a" loading={false} height={300} onHeld={() => {}} />
    );
    first.unmount();
    const held: (number | undefined)[] = [];
    render(<Cell id="a" loading height={90} onHeld={h => held.push(h)} />);
    expect(held[0]).toBe(300);
    const other: (number | undefined)[] = [];
    render(<Cell id="b" loading height={90} onHeld={h => other.push(h)} />);
    expect(other.at(-1)).toBeUndefined();
  });
});
