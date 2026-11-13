/**
 * The height a loading card holds: the height its placement was last drawn at with an answer,
 * and nothing for a placement never drawn with one.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyRememberingSwitch,
  confirmLabels,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";

import {
  forgetHeldCardHeights,
  heldCellStyle,
  useHeldCardHeight,
} from "../held-height";

/** A cell measuring `height` px tall, which reports the height it holds through `onHeld`. */
function Cell({
  id,
  loading,
  height,
  width = 100,
  onHeld,
}: {
  id: string;
  loading: boolean;
  height: number;
  width?: number;
  onHeld: (held: number | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  onHeld(useHeldCardHeight(id, loading, ref));
  return <div ref={ref} data-height={height} data-width={width} />;
}

/** jsdom lays nothing out: each cell measures the height its `data-height` names. */
function measureFromDataHeight() {
  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const height = Number(this.dataset.height ?? 0);
      const width = Number(this.dataset.width ?? 100);
      return {
        height,
        width,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
}

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceMemoryForTests();
  confirmLabels({ user: "u", schemaVersion: "1", permissionVersion: "p" });
});

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
    // Read before the browser paints, where the cell's width is known.
    expect(held.at(-1)).toBe(300);
    const other: (number | undefined)[] = [];
    render(<Cell id="b" loading height={90} onHeld={h => other.push(h)} />);
    expect(other.at(-1)).toBeUndefined();
  });
});

describe("a card's height in a fresh tab", () => {
  it("is held from the device, where this page has drawn nothing yet", () => {
    measureFromDataHeight();
    render(<Cell id="a" loading={false} height={247} onHeld={() => {}} />);
    // A fresh tab: this page's memory is empty, the device's is not.
    forgetHeldCardHeights();
    const held: (number | undefined)[] = [];
    render(<Cell id="a" loading height={90} onHeld={h => held.push(h)} />);
    expect(held.at(-1)).toBe(247);
  });

  it("is held only for a cell about as wide as the one it was drawn in", () => {
    measureFromDataHeight();
    render(
      <Cell id="a" loading={false} height={247} width={520} onHeld={() => {}} />
    );
    forgetHeldCardHeights();
    const near: (number | undefined)[] = [];
    render(
      <Cell id="a" loading height={90} width={524} onHeld={h => near.push(h)} />
    );
    expect(near.at(-1)).toBe(247);
    // Half as wide, its rows wrap otherwise: no height of another width.
    const narrow: (number | undefined)[] = [];
    render(
      <Cell
        id="a"
        loading
        height={90}
        width={260}
        onHeld={h => narrow.push(h)}
      />
    );
    expect(narrow.at(-1)).toBeUndefined();
  });

  it("is kept nowhere but this page where the site turned remembering off", () => {
    measureFromDataHeight();
    applyRememberingSwitch(false);
    render(<Cell id="a" loading={false} height={247} onHeld={() => {}} />);
    forgetHeldCardHeights();
    const held: (number | undefined)[] = [];
    render(<Cell id="a" loading height={90} onHeld={h => held.push(h)} />);
    expect(held.at(-1)).toBeUndefined();
  });
});

describe("heldCellStyle", () => {
  it("draws a loading cell at exactly the held height, its skeleton clipped to it", () => {
    // Exactly, not at least: a skeleton taller than the answer it stands in for would otherwise
    // grow the row while loading, and the row would close up again when the answer lands.
    expect(heldCellStyle(240)).toEqual({ height: "240px", overflow: "hidden" });
  });

  it("styles nothing for a cell that holds no height", () => {
    expect(heldCellStyle(undefined)).toBeUndefined();
  });
});
