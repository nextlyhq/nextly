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
  DEFAULT_PREFERENCES,
  fitsFullShell,
  isLeftPanel,
  LEFT_PANELS,
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
    // hand the library a set of bounds with no solution.
    expect(
      RAIL_WIDTH +
        PANEL_BOUNDS.left.min +
        PANEL_BOUNDS.inspector.min +
        MIN_CANVAS_WIDTH
    ).toBeLessThanOrEqual(MIN_SHELL_WIDTH);
  });
});

describe("preferences round-trip", () => {
  const stored: ShellPreferences = {
    leftPanel: "tokens",
    leftPinned: false,
    layouts: {
      "canvas,inspector,left": { left: 22, canvas: 54, inspector: 24 },
    },
  };

  it("restores what was written", () => {
    const store = memoryStore();
    writePreferences(store, stored);
    expect(readPreferences(store)).toEqual(stored);
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
