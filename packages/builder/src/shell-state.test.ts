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
  clampPanelWidth,
  DEFAULT_PREFERENCES,
  fitsFullShell,
  isLeftPanel,
  LEFT_PANELS,
  fitPanels,
  MIN_CANVAS_WIDTH,
  MIN_SHELL_WIDTH,
  panelAfterRailClick,
  RAIL_WIDTH,
  PANEL_BOUNDS,
  readPreferences,
  writePreferences,
  type PreferenceStore,
} from "./shell-state";

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

describe("panel widths", () => {
  it.each(["left", "inspector"] as const)(
    "clamps %s into its bounds",
    region => {
      const { min, max } = PANEL_BOUNDS[region];
      expect(clampPanelWidth(region, min - 100)).toBe(min);
      expect(clampPanelWidth(region, max + 100)).toBe(max);
      expect(clampPanelWidth(region, min + 1)).toBe(min + 1);
    }
  );

  it("answers the initial width for a value that is not a number", () => {
    // `Math.min`/`Math.max` pass NaN straight through, so a bare clamp would
    // store it and collapse the panel. The two sources are a malformed stored
    // string and a division by a zero-height frame.
    expect(clampPanelWidth("left", Number.NaN)).toBe(PANEL_BOUNDS.left.initial);
    expect(clampPanelWidth("left", Number.POSITIVE_INFINITY)).toBe(
      PANEL_BOUNDS.left.initial
    );
  });
});

describe("panels give way to the canvas floor", () => {
  const canvasFor = (
    viewportWidth: number,
    fitted: { leftWidth: number; inspectorWidth: number },
    leftOpen = true
  ) =>
    viewportWidth -
    RAIL_WIDTH -
    (leftOpen ? fitted.leftWidth : 0) -
    fitted.inspectorWidth;

  it("keeps the canvas floor at the minimum supported viewport", () => {
    // The case that drove this design. Per-panel bounds alone are satisfied by
    // both panels at maximum here, and leave the canvas at 232px — narrower
    // than either panel, in an editor whose subject IS the canvas. Nothing
    // per-panel is violated, because the constraint was never per-panel.
    const fitted = fitPanels({
      viewportWidth: MIN_SHELL_WIDTH,
      leftWidth: PANEL_BOUNDS.left.max,
      inspectorWidth: PANEL_BOUNDS.inspector.max,
      leftOpen: true,
    });
    expect(canvasFor(MIN_SHELL_WIDTH, fitted)).toBeGreaterThanOrEqual(
      MIN_CANVAS_WIDTH
    );
  });

  it("takes from the inspector before the panel the author opened", () => {
    // The left panel is a deliberate choice, dismissible with the same click
    // that opened it; the inspector is always there. Shrinking the deliberate
    // choice first reads as the editor undoing an action.
    const fitted = fitPanels({
      viewportWidth: MIN_SHELL_WIDTH,
      leftWidth: PANEL_BOUNDS.left.max,
      inspectorWidth: PANEL_BOUNDS.inspector.max,
      leftOpen: true,
    });
    // The ordering property, stated as what it actually is: the inspector is
    // exhausted to its own minimum BEFORE the left panel gives up a pixel. At
    // this viewport both must move, so "the left panel is untouched" would be
    // overstating it — and asserting that was wrong, not the implementation.
    expect(fitted.inspectorWidth).toBe(PANEL_BOUNDS.inspector.min);
    expect(fitted.leftWidth).toBeLessThan(PANEL_BOUNDS.left.max);
  });

  it("does not touch the left panel while the inspector still has room", () => {
    // The ordering, isolated: one viewport wider, so the inspector alone can
    // absorb the overflow. If the order were reversed this is where it shows.
    const fitted = fitPanels({
      viewportWidth: 1400,
      leftWidth: PANEL_BOUNDS.left.max,
      inspectorWidth: PANEL_BOUNDS.inspector.max,
      leftOpen: true,
    });
    expect(fitted.leftWidth).toBe(PANEL_BOUNDS.left.max);
    expect(fitted.inspectorWidth).toBeLessThan(PANEL_BOUNDS.inspector.max);
    expect(fitted.inspectorWidth).toBeGreaterThan(PANEL_BOUNDS.inspector.min);
  });

  it("never squeezes a panel below its own minimum", () => {
    const fitted = fitPanels({
      viewportWidth: MIN_SHELL_WIDTH,
      leftWidth: PANEL_BOUNDS.left.max,
      inspectorWidth: PANEL_BOUNDS.inspector.max,
      leftOpen: true,
    });
    expect(fitted.inspectorWidth).toBeGreaterThanOrEqual(
      PANEL_BOUNDS.inspector.min
    );
    expect(fitted.leftWidth).toBeGreaterThanOrEqual(PANEL_BOUNDS.left.min);
  });

  it("leaves both alone when there is room", () => {
    // The control: a fit that shrank panels on a wide viewport would satisfy
    // every assertion above.
    const fitted = fitPanels({
      viewportWidth: 1920,
      leftWidth: PANEL_BOUNDS.left.max,
      inspectorWidth: PANEL_BOUNDS.inspector.max,
      leftOpen: true,
    });
    expect(fitted).toEqual({
      leftWidth: PANEL_BOUNDS.left.max,
      inspectorWidth: PANEL_BOUNDS.inspector.max,
    });
  });

  it("gives the closed left panel's space to the canvas, not the inspector", () => {
    const fitted = fitPanels({
      viewportWidth: MIN_SHELL_WIDTH,
      leftWidth: PANEL_BOUNDS.left.max,
      inspectorWidth: PANEL_BOUNDS.inspector.max,
      leftOpen: false,
    });
    expect(fitted.inspectorWidth).toBe(PANEL_BOUNDS.inspector.max);
    expect(canvasFor(MIN_SHELL_WIDTH, fitted, false)).toBeGreaterThanOrEqual(
      MIN_CANVAS_WIDTH
    );
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

describe("preferences round-trip", () => {
  it("restores what was written", () => {
    const store = memoryStore();
    const preferences = {
      leftPanel: "tokens" as const,
      leftWidth: 360,
      inspectorWidth: 400,
      leftPinned: false,
    };
    writePreferences(store, preferences);
    expect(readPreferences(store)).toEqual(preferences);
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

  it("survives a stored value that is not JSON", () => {
    expect(readPreferences(memoryStore("{not json"))).toEqual(
      DEFAULT_PREFERENCES
    );
  });

  it("survives JSON that is not an object", () => {
    expect(readPreferences(memoryStore("42"))).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences(memoryStore("null"))).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps the fields it can read when one is malformed", () => {
    // Field-by-field, deliberately. A width written under different bounds
    // should move the panel, not discard the author's panel choice with it —
    // one bad field taking the whole record is the failure worth guarding.
    const store = memoryStore(
      JSON.stringify({
        leftPanel: "layers",
        leftWidth: "wide",
        inspectorWidth: 999999,
        leftPinned: "yes",
      })
    );
    expect(readPreferences(store)).toEqual({
      leftPanel: "layers",
      leftWidth: PANEL_BOUNDS.left.initial,
      inspectorWidth: PANEL_BOUNDS.inspector.max,
      leftPinned: DEFAULT_PREFERENCES.leftPinned,
    });
  });
});
