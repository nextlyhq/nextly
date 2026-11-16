/**
 * The height a loading card holds: the height its placement was last drawn at with an answer,
 * and nothing for a placement never drawn with one.
 */
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act } from "@testing-library/react";

import {
  applyRememberingSwitch,
  confirmLabels,
  forgetPerson,
  recallLayout,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";

import {
  forgetCardHeightsExcept,
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

/** Every kept layout part, by name, as the device holds them. */
function keptParts(): Record<string, number> {
  const raw = window.localStorage.getItem("nextly:admin:memory:layout");
  return raw === null
    ? {}
    : (JSON.parse(raw) as { data: Record<string, number> }).data;
}

describe("what the device keeps of card heights", () => {
  it("keeps a few recent widths per card, drops cards no longer drawn, and stays under the cap", () => {
    measureFromDataHeight();
    // Fifteen cards, each drawn at forty widths, as a window resized often.
    for (let card = 0; card < 15; card += 1) {
      for (let width = 300; width < 300 + 40 * 40; width += 40) {
        render(
          <Cell
            id={`c${card}`}
            loading={false}
            height={200 + card}
            width={width}
            onHeld={() => {}}
          />
        ).unmount();
      }
    }
    const perCard = Object.keys(keptParts()).filter(part =>
      part.startsWith("card-height:c3:")
    );
    expect(perCard.length).toBeLessThanOrEqual(3);
    // Cards taken off the dashboard leave nothing behind.
    forgetCardHeightsExcept(new Set(["c0", "c1"]));
    const left = Object.keys(keptParts()).filter(part =>
      part.startsWith("card-height:")
    );
    expect(left.every(part => /^card-height:c[01]:/.test(part))).toBe(true);
    // And a new width still records, beside the other kinds of size.
    render(
      <Cell
        id="c0"
        loading={false}
        height={321}
        width={999}
        onHeld={() => {}}
      />
    );
    expect(Object.values(keptParts())).toContain(321);
  });

  it("never fails a write silently past the cap: the oldest size gives way", async () => {
    const { rememberLayout } = await import(
      "@admin/lib/device-memory/device-memory"
    );
    for (let part = 0; part < 500; part += 1) {
      rememberLayout(`list-rows:list-${part}`, part + 1);
    }
    expect(rememberLayout("list-rows:newest", 7)).toBe(true);
    expect(recallLayout("list-rows:newest")).toBe(7);
    expect(recallLayout("list-rows:list-0")).toBeUndefined();
  });
});

describe("a kept height at a width a hair away", () => {
  it("is held across the edge of a width band", () => {
    measureFromDataHeight();
    render(
      <Cell
        id="a"
        loading={false}
        height={247}
        width={527.5}
        onHeld={() => {}}
      />
    );
    forgetHeldCardHeights();
    const held: (number | undefined)[] = [];
    render(
      <Cell
        id="a"
        loading
        height={90}
        width={528.5}
        onHeld={h => held.push(h)}
      />
    );
    expect(held.at(-1)).toBe(247);
  });
});

describe("a kept height the device then refuses", () => {
  it("is let go when the person turns out to be another", () => {
    measureFromDataHeight();
    render(<Cell id="a" loading={false} height={247} onHeld={() => {}} />);
    // A fresh tab, before the server has said who is signed in.
    forgetHeldCardHeights();
    resetDeviceMemoryForTests();
    const held: (number | undefined)[] = [];
    render(<Cell id="a" loading height={90} onHeld={h => held.push(h)} />);
    expect(held.at(-1)).toBe(247);
    // The server answers for someone else: the kept height is not theirs.
    act(() => {
      confirmLabels({
        user: "other",
        schemaVersion: "1",
        permissionVersion: "p",
      });
    });
    expect(held.at(-1)).toBeUndefined();
  });

  it("is let go when the person is forgotten", () => {
    measureFromDataHeight();
    render(<Cell id="a" loading={false} height={247} onHeld={() => {}} />);
    const held: (number | undefined)[] = [];
    render(<Cell id="a" loading height={90} onHeld={h => held.push(h)} />);
    expect(held.at(-1)).toBe(247);
    act(() => {
      forgetPerson();
    });
    expect(held.at(-1)).toBeUndefined();
  });
});
