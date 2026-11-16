// @vitest-environment jsdom
/**
 * The shell's decisions, asserted where they can be measured.
 *
 * Everything here is arithmetic and set membership. The LAYOUT these decisions
 * produce is not checkable from a unit test — jsdom reports every element as
 * zero-sized, so an assertion about a panel's width passes whatever the CSS
 * does — and is verified in a real browser instead.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  CANVAS_GUTTER,
  DEFAULT_PREFERENCES,
  fitsFullShell,
  isLeftPanel,
  RAIL_GROUPS,
  LEFT_PANELS,
  MIN_CANVAS_PANEL_WIDTH,
  MIN_CANVAS_WIDTH,
  MIN_SHELL_WIDTH,
  panelAfterRailClick,
  PANEL_BOUNDS,
  RAIL_WIDTH,
  readPreferences,
  SHELL_PREFERENCES_KEY,
  userPreferenceStore,
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
      "add",
      "components",
      "design",
      "layers",
      "pages",
      "settings",
    ]);
  });

  it("opens the panel that was clicked", () => {
    expect(panelAfterRailClick(null, "layers")).toBe("layers");
    expect(panelAfterRailClick("add", "layers")).toBe("layers");
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
    // narrower than either panel — with no per-panel bound violated. Pinned,
    // so the figure stated here moves with the widths it is made of.
    const canvasIfPanelsMaxed =
      MIN_SHELL_WIDTH -
      RAIL_WIDTH -
      PANEL_BOUNDS.left.max -
      PANEL_BOUNDS.inspector.max;
    expect(canvasIfPanelsMaxed).toBe(232);
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
    leftPanel: "design",
    // Non-default, so the round trip carries the open panel's tab rather
    // than passing on a default that a read which drops it also produces.
    leftPanelView: "fonts",
    leftPinned: false,
    // Both non-default, so the round trip carries a hidden side.
    leftPanelHidden: true,
    inspectorHidden: true,
    layouts: {
      "canvas,inspector,left": { left: 22, canvas: 54, inspector: 24 },
    },
    // Non-default for the same reason, and FIXED rather than fit: fit is the
    // default, and it is also what a read falls back to when it cannot make
    // sense of what was stored — so a round trip carrying fit would pass
    // whether the value survived or was discarded.
    zoom: { kind: "fixed", scale: 1.5 },
    // Non-default as well: null, the base breakpoint, is the default.
    editingBreakpoint: "tablet",
    // Off, the non-default: a read that dropped it would answer on.
    panelKeys: false,
  };

  it("restores what was written", () => {
    const store = memoryStore();
    writePreferences(store, stored);
    expect(readPreferences(store)).toEqual(stored);
  });

  it("loads a record carrying the removed showEmptyElements whole, without it", () => {
    // Every other field is non-default (the round-trip record above), so a
    // read that refused the record, or fell back to the defaults on meeting an
    // unknown key, cannot also produce this answer. Compared with `toEqual`
    // against the exact record, so a read that carried the old field through
    // fails as well.
    // Built from what the editor writes, so every field is in its stored
    // spelling, with the old field added the way an earlier release wrote it.
    const written = memoryStore();
    writePreferences(written, stored);
    const record: unknown = JSON.parse(written.value ?? "null");
    if (typeof record !== "object" || record === null) {
      throw new Error("the editor wrote no record");
    }
    const store = memoryStore(
      JSON.stringify({ ...record, showEmptyElements: false })
    );
    const read = readPreferences(store);
    expect(read).toEqual(stored);

    // Writing what was read drops the old field for good.
    const rewritten = memoryStore();
    writePreferences(rewritten, read);
    const after: unknown = JSON.parse(rewritten.value ?? "null");
    expect(after).not.toHaveProperty("showEmptyElements");
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

  it("starts on the base breakpoint when the stored device is not a name", () => {
    // Preferences from before there was a device have no such field; an empty
    // or non-string value names no breakpoint either.
    for (const bad of [undefined, "", 3, null]) {
      const store = memoryStore(
        JSON.stringify({ ...stored, editingBreakpoint: bad })
      );
      expect(readPreferences(store).editingBreakpoint).toBeNull();
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
      leftPanelView: null,
      leftPinned: DEFAULT_PREFERENCES.leftPinned,
      leftPanelHidden: false,
      inspectorHidden: false,
      layouts: { "canvas,inspector": { canvas: 70, inspector: 30 } },
      zoom: DEFAULT_PREFERENCES.zoom,
      editingBreakpoint: DEFAULT_PREFERENCES.editingBreakpoint,
      // Absent as well, as in every record written before the keys could be
      // turned off: on.
      panelKeys: true,
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

describe("the rail's items, in the order an author meets them", () => {
  it("puts the daily tools at the top and Settings at the bottom", () => {
    expect(RAIL_GROUPS.top).toEqual([
      "add",
      "layers",
      "pages",
      "components",
      "design",
    ]);
    expect(RAIL_GROUPS.bottom).toEqual(["settings"]);
  });

  it("covers every panel exactly once between the two groups", () => {
    expect([...RAIL_GROUPS.top, ...RAIL_GROUPS.bottom].sort()).toEqual(
      [...LEFT_PANELS].sort()
    );
  });
});

/*
 * Panels stored by an earlier release, under the ids the rail used before it
 * was relabelled. Each is mapped to where its contents live now, explicitly —
 * not dropped as unknown, which would close the panel an author left open.
 */
describe("preferences saved before panels had parts", () => {
  it("load whole, with no part chosen and Desktop as the device", () => {
    // Written by the editor before the Design panel's tabs and the stored
    // device existed: no leftPanelView, no editingBreakpoint. Every other
    // preference must survive.
    const yesterday = {
      leftPanel: "layers",
      leftPinned: false,
      zoom: 1.5,
      layouts: {
        "canvas,inspector,left": { left: 22, canvas: 54, inspector: 24 },
      },
      showEmptyElements: false,
    };
    expect(readPreferences(memoryStore(JSON.stringify(yesterday)))).toEqual({
      leftPanel: "layers",
      leftPanelView: null,
      leftPinned: false,
      leftPanelHidden: false,
      inspectorHidden: false,
      zoom: { kind: "fixed", scale: 1.5 },
      editingBreakpoint: null,
      layouts: {
        "canvas,inspector,left": { left: 22, canvas: 54, inspector: 24 },
      },
      panelKeys: true,
    });
  });
});

describe("a panel stored under an id from before the rail was relabelled", () => {
  it.each([
    ["insert", "add", null],
    ["tokens", "design", "variables"],
    ["classes", "design", "classes"],
    ["fonts", "design", "fonts"],
  ] as const)("opens %s as %s, on %s", (stored, panel, view) => {
    const read = readPreferences(
      memoryStore(JSON.stringify({ leftPanel: stored }))
    );
    expect(read.leftPanel).toBe(panel);
    expect(read.leftPanelView).toBe(view);
  });

  it("keeps the view stored with a current id", () => {
    const read = readPreferences(
      memoryStore(
        JSON.stringify({ leftPanel: "design", leftPanelView: "classes" })
      )
    );
    expect(read).toMatchObject({
      leftPanel: "design",
      leftPanelView: "classes",
    });
  });

  it("ignores a view that is not a string", () => {
    const read = readPreferences(
      memoryStore(JSON.stringify({ leftPanel: "design", leftPanelView: 4 }))
    );
    expect(read.leftPanelView).toBeNull();
  });
});

describe("preferences kept per signed-in user", () => {
  // The shell's preferences as a browser stored them before they were kept
  // per user, under the one key every author on the browser shared.
  const LEGACY = JSON.stringify({ ...DEFAULT_PREFERENCES, zoom: 1.5 });

  beforeEach(() => window.localStorage.clear());

  it("keeps two users of one browser apart", () => {
    userPreferenceStore("ada").write("ada's");
    userPreferenceStore("grace").write("grace's");
    expect(userPreferenceStore("ada").read()).toBe("ada's");
    expect(userPreferenceStore("grace").read()).toBe("grace's");
  });

  it("stores each user's under the shell's key with their id", () => {
    userPreferenceStore("ada").write("ada's");
    expect(window.localStorage.getItem(`${SHELL_PREFERENCES_KEY}:ada`)).toBe(
      "ada's"
    );
  });

  it("moves the record from before, once, to the first user who loads it", () => {
    window.localStorage.setItem(SHELL_PREFERENCES_KEY, LEGACY);
    expect(userPreferenceStore("ada").read()).toBe(LEGACY);
    expect(window.localStorage.getItem(SHELL_PREFERENCES_KEY)).toBeNull();
    // The next author starts from the defaults rather than inheriting it.
    expect(userPreferenceStore("grace").read()).toBeNull();
    expect(userPreferenceStore("ada").read()).toBe(LEGACY);
  });

  it("keeps a user's own record over the one from before", () => {
    window.localStorage.setItem(`${SHELL_PREFERENCES_KEY}:ada`, "ada's");
    window.localStorage.setItem(SHELL_PREFERENCES_KEY, LEGACY);
    expect(userPreferenceStore("ada").read()).toBe("ada's");
    // Left for an author who has no record of their own yet.
    expect(window.localStorage.getItem(SHELL_PREFERENCES_KEY)).toBe(LEGACY);
  });

  it("is the same store for the same user, so a host may call it on every render", () => {
    // A new store each time reads as a store swap, and the shell reloads.
    expect(userPreferenceStore("ada")).toBe(userPreferenceStore("ada"));
    expect(userPreferenceStore("ada")).not.toBe(userPreferenceStore("grace"));
    expect(userPreferenceStore(null)).toBe(userPreferenceStore(null));
  });

  it("keeps each user's record, and moves the one from before, in the stores the host opens", () => {
    // A host whose browser storage follows rules of its own (a site that
    // keeps nothing on the device) hands the shell its own stores; nothing
    // then reaches the browser's storage directly.
    const held = new Map<string, string>();
    const open = (key: string) => ({
      read: () => held.get(key) ?? null,
      write: (value: string) => {
        held.set(key, value);
      },
      remove: () => {
        held.delete(key);
      },
    });
    held.set(SHELL_PREFERENCES_KEY, LEGACY);

    const store = userPreferenceStore("ada", open);
    expect(store.read()).toBe(LEGACY);
    expect([...held.entries()]).toEqual([
      [`${SHELL_PREFERENCES_KEY}:ada`, LEGACY],
    ]);
    store.write("ada's");
    expect(held.get(`${SHELL_PREFERENCES_KEY}:ada`)).toBe("ada's");
    expect(window.localStorage.length).toBe(0);
    // One store per user and opener, so a host may still call it every render.
    expect(userPreferenceStore("ada", open)).toBe(store);
    expect(userPreferenceStore("ada")).not.toBe(store);
  });

  it("remembers nothing for no one", () => {
    // Unknown, signed out or unread: nothing is kept for a guess.
    window.localStorage.setItem(SHELL_PREFERENCES_KEY, LEGACY);
    const store = userPreferenceStore(null);
    store.write("whose?");
    expect(store.read()).toBeNull();
    expect(window.localStorage.getItem(SHELL_PREFERENCES_KEY)).toBe(LEGACY);
  });
});
