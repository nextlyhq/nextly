/**
 * The shell's decisions, asserted where they can be measured.
 *
 * Everything here is arithmetic and set membership. The LAYOUT these decisions
 * produce is not checkable from a unit test — jsdom reports every element as
 * zero-sized, so an assertion about a panel's width passes whatever the CSS
 * does — and is verified in a real browser instead.
 */
import { describe, expect, it } from "vitest";

import {
  CANVAS_GUTTER,
  DEFAULT_PREFERENCES,
  fitsFullShell,
  isLeftPanel,
  LEFT_PANELS,
  MIN_CANVAS_PANEL_WIDTH,
  MIN_CANVAS_WIDTH,
  MIN_SHELL_WIDTH,
  panelAfterRailClick,
  PANEL_BOUNDS,
  RAIL_WIDTH,
  readPreferences,
  writePreferences,
} from "./shell-state";
import type { PreferenceStore, ShellPreferences } from "./shell-state";

/** A store standing in for `localStorage`, plus the two ways one really fails. */
function memoryStore(initial: string | null = null): PreferenceStore & {
  value: string | null;
} {
  return {
    value: initial,
    read() {
      return this.value;
    },
    write(next: string) {
      this.value = next;
    },
  };
}

const refusingStore: PreferenceStore = {
  read() {
    throw new Error("storage unavailable");
  },
  write() {
    throw new Error("quota exceeded");
  },
};

describe("which panel the rail selects", () => {
  it("names every panel the rail offers", () => {
    // Pinned as a literal, because the per-panel cases below cannot guard the
    // list they iterate: removing a panel deletes its own case, the suite
    // shrinks by one, and everything remaining passes. A vanishing test reads
    // exactly like a passing one.
    expect([...LEFT_PANELS].sort()).toEqual([
      "classes",
      "components",
      "fonts",
      "insert",
      "layers",
      "pages",
      "settings",
      "tokens",
    ]);
  });

  it("opens the panel that was clicked", () => {
    expect(panelAfterRailClick(null, "layers")).toBe("layers");
    expect(panelAfterRailClick("insert", "layers")).toBe("layers");
  });

  it("closes the open panel when its own rail item is clicked again", () => {
    // The rail is the only route to a full-width canvas. Without the toggle the
    // author can switch panels forever and never dismiss one.
    expect(panelAfterRailClick("layers", "layers")).toBeNull();
  });
});

describe("a stored panel name that no longer names a panel", () => {
  it.each([...LEFT_PANELS])("accepts %s", panel => {
    expect(isLeftPanel(panel)).toBe(true);
  });

  it("rejects anything else", () => {
    // The positive control for the cases above: an `isLeftPanel` returning true
    // for everything satisfies every one of them.
    expect(isLeftPanel("history")).toBe(false);
    expect(isLeftPanel("")).toBe(false);
    expect(isLeftPanel(null)).toBe(false);
    expect(isLeftPanel(7)).toBe(false);
  });

  it("falls back to no panel rather than opening an empty one", () => {
    // A preference outlives the release that wrote it. Restoring a removed
    // panel blindly leaves a region rendering nothing, with no obvious way back.
    const store = memoryStore(JSON.stringify({ leftPanel: "history" }));
    expect(readPreferences(store).leftPanel).toBeNull();
  });
});

describe("the viewport the full shell needs", () => {
  it("carries the full shell at the supported width and above", () => {
    expect(fitsFullShell(MIN_SHELL_WIDTH)).toBe(true);
    expect(fitsFullShell(1920)).toBe(true);
  });

  it("refuses one pixel below it", () => {
    // The boundary itself, because an off-by-one here is the difference between
    // supporting 1280 and silently not.
    expect(fitsFullShell(MIN_SHELL_WIDTH - 1)).toBe(false);
    expect(fitsFullShell(768)).toBe(false);
  });
});

describe("the bounds the library is handed", () => {
  it("declares a canvas floor that per-panel bounds cannot express", () => {
    // This is the number that decided the design, kept as an assertion so the
    // reasoning cannot quietly stop being true. Both panels at their individual
    // maximums on the minimum supported viewport leave the canvas at 232px —
    // narrower than either panel — with no per-panel bound violated.
    const canvasIfPanelsMaxed =
      MIN_SHELL_WIDTH -
      RAIL_WIDTH -
      PANEL_BOUNDS.left.max -
      PANEL_BOUNDS.inspector.max;
    expect(canvasIfPanelsMaxed).toBeLessThan(MIN_CANVAS_WIDTH);

    // So the floor is declared on the canvas itself, and the supported viewport
    // must be able to satisfy every minimum at once — otherwise the shell would
    // hand the library a set of bounds with no solution. The PANEL width is
    // what the library is handed, so it is the term that has to fit.
    expect(
      RAIL_WIDTH +
        PANEL_BOUNDS.left.min +
        PANEL_BOUNDS.inspector.min +
        MIN_CANVAS_PANEL_WIDTH
    ).toBeLessThanOrEqual(MIN_SHELL_WIDTH);
  });

  it("spends the gutters on top of the floor, not out of it", () => {
    /*
     * The floor is a statement about the EDITING SURFACE, and the panel is the
     * only thing a resize bound can be expressed on. Bounding the panel at the
     * surface's own number spends the gap out of the page: the drag would stop
     * at 480px of panel holding 448px of canvas, which is past the floor that
     * exists to stop it.
     *
     * Asserted as the subtraction the layout actually performs rather than as
     * the sum the constant is defined by — restating `min + 2 * gutter` here
     * would pass on any pair of numbers, including a gutter of zero that the
     * region's padding contradicts.
     */
    expect(MIN_CANVAS_PANEL_WIDTH - CANVAS_GUTTER * 2).toBe(MIN_CANVAS_WIDTH);
    expect(CANVAS_GUTTER).toBeGreaterThan(0);
  });
});

describe("preferences round-trip", () => {
  const stored: ShellPreferences = {
    leftPanel: "tokens",
    leftPinned: false,
    layouts: {
      "canvas,inspector,left": { left: 22, canvas: 54, inspector: 24 },
    },
    // Non-default like its neighbours above, so the round trip below actually
    // exercises this field rather than passing on the strength of a default
    // that both the write and a no-op read would agree on.
    showEmptyElements: false,
    // Non-default for the same reason, and FIXED rather than fit: fit is the
    // default, and it is also what a read falls back to when it cannot make
    // sense of what was stored — so a round trip carrying fit would pass
    // whether the value survived or was discarded.
    zoom: { kind: "fixed", scale: 1.5 },
  };

  it("restores what was written", () => {
    const store = memoryStore();
    writePreferences(store, stored);
    expect(readPreferences(store)).toEqual(stored);
  });

  it("falls back to fitting when the stored zoom is not one", () => {
    /*
     * Preferences written before there was a zoom have no such field, and a
     * hand-edited or later-version file can carry anything. A scale outside the
     * bounds is the case that matters: it would paint the canvas at a size from
     * which the control that sets it cannot be reached.
     */
    for (const bad of [undefined, "1.5", 0, 99, null]) {
      const store = memoryStore(JSON.stringify({ ...stored, zoom: bad }));
      expect(readPreferences(store).zoom).toEqual(DEFAULT_PREFERENCES.zoom);
    }
  });

  it("uses the defaults when nothing was ever stored", () => {
    expect(readPreferences(memoryStore(null))).toEqual(DEFAULT_PREFERENCES);
  });

  it("survives storage that refuses to answer", () => {
    // Private browsing on some engines throws on read, and a write can exceed
    // quota. Losing a panel width is not worth interrupting an edit over.
    expect(readPreferences(refusingStore)).toEqual(DEFAULT_PREFERENCES);
    expect(() =>
      writePreferences(refusingStore, DEFAULT_PREFERENCES)
    ).not.toThrow();
  });

  it("survives a stored value that is not JSON, or not an object", () => {
    expect(readPreferences(memoryStore("{not json"))).toEqual(
      DEFAULT_PREFERENCES
    );
    expect(readPreferences(memoryStore("42"))).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences(memoryStore("null"))).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps the fields it can read when one is malformed", () => {
    // Field by field, deliberately. A layout written under a different panel
    // set should reset the LAYOUT, not discard the author's panel choice with
    // it — one bad field taking the whole record is the failure worth guarding.
    const store = memoryStore(
      JSON.stringify({
        leftPanel: "layers",
        leftPinned: "yes",
        layouts: {
          "canvas,inspector": { canvas: 70, inspector: 30 },
          "canvas,inspector,panel": { panel: Number.NaN, canvas: 60 },
        },
      })
    );
    // The good arrangement survives, the malformed one does not, and neither
    // takes the author's panel choice with it.
    expect(readPreferences(store)).toEqual({
      leftPanel: "layers",
      leftPinned: DEFAULT_PREFERENCES.leftPinned,
      layouts: { "canvas,inspector": { canvas: 70, inspector: 30 } },
      // Absent from the stored JSON above, so it falls back the same way
      // `leftPinned` does here rather than surfacing as `undefined`.
      showEmptyElements: DEFAULT_PREFERENCES.showEmptyElements,
      zoom: DEFAULT_PREFERENCES.zoom,
    });
  });

  it("rejects a layout whole rather than in part", () => {
    // The library distributes a layout across ALL panels, so a map carrying one
    // unusable entry resolves to a layout nobody chose. Partial acceptance is
    // worse than falling back, which is why the map is the unit.
    const cases = [
      { left: 20, canvas: "wide" },
      { left: 20, canvas: 0 },
      { left: 20, canvas: -5 },
      {},
      [],
    ];
    for (const layout of cases) {
      // Nested under a topology now: a malformed layout costs that arrangement
      // its widths and leaves every other arrangement's intact.
      const store = memoryStore(
        JSON.stringify({ layouts: { "canvas,inspector": layout } })
      );
      expect(readPreferences(store).layouts).toEqual({});
    }
  });
});

describe("the show-empty-elements preference", () => {
  it("defaults to showing them", () => {
    const store = { read: () => null, write: () => undefined };
    expect(readPreferences(store).showEmptyElements).toBe(true);
  });

  it("reads a stored false", () => {
    const store = {
      read: () => JSON.stringify({ showEmptyElements: false }),
      write: () => undefined,
    };
    expect(readPreferences(store).showEmptyElements).toBe(false);
  });

  it("falls back to the default for a non-boolean", () => {
    // A stored value can arrive from a hand-edited localStorage entry or an
    // older shape. Anything that is not a boolean says nothing about intent.
    const store = {
      read: () => JSON.stringify({ showEmptyElements: "no" }),
      write: () => undefined,
    };
    expect(readPreferences(store).showEmptyElements).toBe(true);
  });

  it("round-trips through a write", () => {
    let written = "";
    const store = {
      read: () => written,
      write: (v: string) => {
        written = v;
      },
    };
    writePreferences(store, {
      ...DEFAULT_PREFERENCES,
      showEmptyElements: false,
    });
    expect(readPreferences(store).showEmptyElements).toBe(false);
  });
});
