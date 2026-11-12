/**
 * The editor shell's state, kept apart from the components that render it.
 *
 * Two reasons, and the second is why this file exists at all rather than the
 * state living in the shell component:
 *
 * - It is arithmetic and set membership — which panel is open, how wide it may
 *   be, whether the viewport can carry the full layout. None of it needs React.
 * - A layout cannot be checked by rendering it in jsdom, which reports every
 *   element as zero-sized. A component test of "the panel is 320px" measures
 *   nothing and passes whatever the CSS does. The decisions are made here,
 *   where they can be asserted, and the browser verifies the LAYOUT separately.
 *
 * @module shell-state
 */

import { FIT_ZOOM, readZoom, writeZoom, type CanvasZoom } from "./canvas-zoom";

/**
 * The panels the left rail switches between.
 *
 * One at a time, by decision (PB-D17 D10-1): fixed sides, no docking, no
 * floating. The rail selects; it never opens a second panel beside the first.
 */
export const LEFT_PANELS = [
  "add",
  "layers",
  "pages",
  "components",
  "design",
  "settings",
] as const;

export type LeftPanel = (typeof LEFT_PANELS)[number];

/**
 * The rail's two groups, in the order an author meets them: the daily tools at
 * the top, and the page's settings at the bottom with Help, which opens a
 * dialog rather than a panel and so is not one of these.
 */
export const RAIL_GROUPS: {
  readonly top: readonly LeftPanel[];
  readonly bottom: readonly LeftPanel[];
} = {
  top: ["add", "layers", "pages", "components", "design"],
  bottom: ["settings"],
};

/**
 * Where a panel stored under an id from before the rail was relabelled lives
 * now: Insert became Add, and Tokens, Classes and Fonts became the tabs of one
 * Design panel. Mapped explicitly rather than dropped as unknown, which would
 * close the panel an author left open.
 */
const RENAMED_PANELS: Readonly<
  Record<string, { panel: LeftPanel; view: string | null }>
> = {
  insert: { panel: "add", view: null },
  tokens: { panel: "design", view: "variables" },
  classes: { panel: "design", view: "classes" },
  fonts: { panel: "design", view: "fonts" },
};

/** The panel and view a stored preference names, renamed ids included. */
function storedPanel(
  panel: unknown,
  view: unknown
): { panel: LeftPanel | null; view: string | null } {
  if (isLeftPanel(panel)) {
    return { panel, view: typeof view === "string" ? view : null };
  }
  if (typeof panel === "string" && Object.hasOwn(RENAMED_PANELS, panel)) {
    return RENAMED_PANELS[panel];
  }
  // No panel open, or one this shell no longer has: the part an author last
  // chose is kept, so the panel reopens on it, as it does when a panel is
  // closed and opened again in one session.
  return { panel: null, view: typeof view === "string" ? view : null };
}

/**
 * Whether a stored value still names a panel.
 *
 * Persisted preferences outlive the code that wrote them. A panel removed in a
 * later release leaves a string nothing answers to, and restoring it blindly
 * opens a panel that renders nothing — an empty region with no way back to a
 * real one.
 */
export function isLeftPanel(value: unknown): value is LeftPanel {
  return (
    typeof value === "string" &&
    (LEFT_PANELS as readonly string[]).includes(value)
  );
}

/**
 * Width bounds for the two resizable regions, in CSS pixels.
 *
 * DECLARED here and enforced by `react-resizable-panels`, which takes pixel
 * bounds directly (`minSize={240}`) and solves them — including which region
 * yields when a window resize leaves no room. This module deliberately does NOT
 * solve them a second time: a hand-rolled clamp beside a library that already
 * constrains the same drag is two answers to one question, and the two disagree
 * the first time the library changes how it distributes a shortfall.
 *
 * Lower bounds are the point below which a region stops being usable rather than
 * round numbers: a layers tree needs an indent plus a label, and the inspector
 * carries two-column controls.
 *
 * `MIN_CANVAS_WIDTH` is the reason bounds cannot be read per-panel. At the
 * minimum supported viewport, both panels at their individual maximums leave the
 * canvas at 232px — narrower than either panel, in an editor whose subject IS
 * the canvas — and no per-panel bound is violated, because the constraint was
 * never per-panel. Expressed as the canvas panel's OWN minimum, the library
 * enforces it jointly during a drag.
 */
export const PANEL_BOUNDS = {
  left: { min: 240, max: 480, initial: 300 },
  inspector: { min: 280, max: 520, initial: 320 },
} as const;

/**
 * The rail's fixed width in CSS pixels: a 36px icon square with 6px either
 * side. The rail shows icons alone, each named by its tooltip, so it gives the
 * canvas back the width a labelled rail took.
 */
export const RAIL_WIDTH = 48;

/**
 * The narrowest the canvas may become before a drag stops taking from it.
 *
 * The canvas is the thing being edited, so it is the region with a floor rather
 * than the one that absorbs whatever is left.
 *
 * This is the EDITING SURFACE, not the panel holding it. The panel is wider by
 * its gutters, and {@link MIN_CANVAS_PANEL_WIDTH} is what a bound is read from.
 */
export const MIN_CANVAS_WIDTH = 480;

/**
 * The gap between the canvas region's edge and the page inside it, per side.
 *
 * Declared rather than written as a utility class because it is load-bearing
 * twice: it is the space the page's own edge is painted into, and it is the
 * difference between the editing surface and the panel that has to contain it.
 * Spelled in one place so the two cannot drift.
 */
export const CANVAS_GUTTER = 16;

/**
 * The narrowest the canvas PANEL may become, gutters included.
 *
 * DERIVED, because the constraint is on the editing surface and the panel is
 * the thing a resize bound can be expressed on. Bounding the panel at the
 * surface's own floor spends the gutters out of the surface: at 480px of panel
 * the page has 448px, so the drag stops only once the canvas is already
 * narrower than the floor that exists to stop it.
 */
export const MIN_CANVAS_PANEL_WIDTH: number =
  MIN_CANVAS_WIDTH + CANVAS_GUTTER * 2;

/**
 * The narrowest viewport the full shell is supported at (PB-D17 D10-5).
 *
 * Below this the rail, both panels and a usable canvas do not fit at their
 * minimum widths, so the shell does not try: it shows the canvas and says where
 * to edit instead. A builder that merely gets cramped is worse than one that
 * says it needs more width, because the author discovers the limit by failing
 * at a task.
 */
export const MIN_SHELL_WIDTH = 1280;

/**
 * Whether a box of this width can carry the full shell.
 *
 * The parameter is the width of the space the shell was GIVEN, not the
 * window's. The shell sizes to its container, so the two differ whenever it is
 * embedded — a narrow column on a wide display being the case that matters.
 */
export function fitsFullShell(width: number): boolean {
  return width >= MIN_SHELL_WIDTH;
}

/**
 * What the shell remembers between sessions.
 *
 * The layout is stored as the PROPORTIONAL map `react-resizable-panels` reports
 * from `onLayoutChanged` — panel id to a percentage — never as pixel widths. A
 * pixel layout is wrong on the next monitor; a proportional one survives a
 * window resize, and the pixel BOUNDS still hold because the library re-applies
 * them to whatever the proportions resolve to.
 *
 * Deliberately NOT stored: selection, scroll position, or anything describing
 * the document. Those belong to the document's own state, and a copy here is a
 * second source that goes stale the first time the document changes underneath
 * it.
 */
export interface ShellPreferences {
  leftPanel: LeftPanel | null;
  /**
   * Which part of a panel is showing, for a panel with parts — the Design
   * panel's tab. The host decides what the names mean; the shell only keeps
   * the one the author last chose.
   */
  leftPanelView: string | null;
  leftPinned: boolean;
  /**
   * Whether the author has hidden a side of the editor to give the canvas the
   * room. Kept apart from which left panel is open, so hiding the left side
   * and showing it again comes back to the same panel. The top bar's panel
   * buttons and mod+backslash set them.
   */
  leftPanelHidden: boolean;
  inspectorHidden: boolean;
  /**
   * How large the canvas draws the page, as the author last left it.
   *
   * Chrome rather than document state, like everything else here: it describes
   * how one person is looking at the editor, not what the page IS, so it must
   * not travel with the document to another author.
   */
  zoom: CanvasZoom;
  /**
   * The breakpoint the author is styling, as they last chose it: an id from the
   * site's breakpoints, or null for the base one, which is named Desktop.
   *
   * A choice, never a reading. Taking it from the width the canvas measured
   * made opening a panel, or a narrower window, move every edit to a narrower
   * breakpoint the author never picked. Opening and closing panels changes
   * only how far the canvas is zoomed to fit.
   *
   * Stored as the author left it even when the site no longer defines that
   * breakpoint: the host resolves an unknown id to the base one, so removing a
   * breakpoint and adding it back does not lose the choice.
   */
  editingBreakpoint: string | null;
  /**
   * Layouts, one per PANEL TOPOLOGY.
   *
   * Keyed rather than singular because a layout only means anything alongside
   * the panel set it was measured for. The left panel is conditionally
   * rendered, so the group has two shapes — with it and without — and their
   * layouts have different keys and different arithmetic. Stored as one record
   * they overwrote each other: resizing with a panel open and then closing it
   * left a three-key layout that no two-panel group could accept, so the widths
   * were dropped on the next load.
   *
   * This is the shape the panel library's own persistence helper uses, for the
   * same reason — its `panelIds` prop exists so a group with conditionally
   * rendered panels can "save and restore multiple layouts".
   *
   * Outer key: {@link topologyKey} over the mounted panel ids.
   * Inner: panel id to percentage.
   */
  layouts: Record<string, Record<string, number>>;
  /**
   * Whether the rail's single-letter keys (A, L, P, C, D) open its panels.
   *
   * ON by default, and a preference because a key with no modifier can be
   * set off by speech input or a stray press: WCAG 2.1.4 asks that such a
   * shortcut can be turned off. Help holds the switch, beside the keys.
   *
   * Optional in this published type, so a host that builds preferences
   * written before the switch still compiles; absent reads as on.
   */
  panelKeys?: boolean;
}

/**
 * The class marking the editor shell's own root element.
 *
 * The scope every piece of editor chrome is drawn inside. Kept here and away
 * from the component because `builder-chrome.css` has to spell it out
 * literally, and a marker spelled out literally is one a rename can break
 * silently: so it has one exported spelling that the shell writing it, the
 * code asking about it and the test pinning the stylesheet all take from.
 */
export const BUILDER_CHROME_CLASS = "nx-builder-chrome";

/**
 * A scope that resolves `--nx-builder-*` without claiming to be the chrome root.
 *
 * For a surface the shell mounts OUTSIDE {@link BUILDER_CHROME_CLASS} — custom
 * properties inherit down and never across, so such a surface needs the tokens
 * declared on an ancestor of its own. Giving it the chrome class instead would
 * put a second chrome root in the document, and every selector and query
 * meaning "the editor" would match whichever came first.
 */
export const BUILDER_TOKENS_CLASS = "nx-builder-tokens";

/**
 * The class marking the canvas root, and the boundary the hit-test stops at.
 *
 * Here rather than in `canvas.tsx` for the reason above: it is the middle term
 * of the empty-container affordance's selector, which `empty-slot.ts` composes
 * — and reaching into the canvas COMPONENT for it would pull a React module
 * into every consumer of that constant, for one string. `canvas.tsx` re-exports
 * it, so callers reading it as the canvas's own marker are unaffected.
 *
 * The hit-test walk needs an upper bound (see `nodeIdFromEvent`), and that
 * bound has to be identifiable from a DOM node rather than from React state,
 * because the walk starts at an event target and climbs.
 */
export const CANVAS_ROOT_CLASS = "nx-canvas";

/**
 * The identity of a panel arrangement, from the panels themselves.
 *
 * Sorted and joined rather than taken from `leftPanel`, so it is derived from
 * what is actually MOUNTED rather than from a second description of it that can
 * disagree. Sorting makes it independent of the order the ids arrive in, which
 * varies with how a host's JSON was serialised.
 */
export function topologyKey(panelIds: readonly string[]): string {
  return [...panelIds].sort().join(",");
}

export const DEFAULT_PREFERENCES: ShellPreferences = {
  leftPanel: null,
  leftPanelView: null,
  leftPinned: true,
  leftPanelHidden: false,
  inspectorHidden: false,
  zoom: FIT_ZOOM,
  editingBreakpoint: null,
  layouts: {},
  panelKeys: true,
};

/**
 * Where preferences are read and written.
 *
 * A PORT rather than a direct `localStorage` call, for two reasons that both
 * bite later. The ratified plan wants these durable per user on the server
 * eventually, and a component reaching for `localStorage` makes that a rewrite
 * instead of a different argument. And `localStorage` does not exist while the
 * shell renders on a server, so a direct call is a crash rather than a default.
 *
 * Both methods may fail and the shell must not care: storage is unavailable in
 * private browsing on some engines, and a quota error is possible on write.
 */
export interface PreferenceStore {
  read: () => string | null;
  write: (value: string) => void;
}

/** A store that remembers nothing, for a server render and for a browser that refuses storage. */
export const NO_STORAGE: PreferenceStore = {
  read: () => null,
  write: () => undefined,
};

/**
 * A `localStorage`-backed store under one key.
 *
 * Takes the key rather than owning one, so the shell's chrome preferences and
 * anything else the editor remembers share this port instead of each writing
 * their own `typeof window` check and their own swallow. Outside a browser it
 * degrades to {@link NO_STORAGE} rather than throwing, which is the whole
 * reason the port exists.
 *
 * @param key - where to store the value
 * @returns a store, or one that remembers nothing outside a browser
 *
 * @experimental
 */
export function browserStore(key: string): PreferenceStore {
  if (typeof window === "undefined") return NO_STORAGE;
  return {
    read: () => window.localStorage.getItem(key),
    write: value => window.localStorage.setItem(key, value),
  };
}

/**
 * Where the shell keeps its preferences in a browser: under this key alone
 * for a host that names no user, and under this key and the user's id for
 * one that does.
 */
export const SHELL_PREFERENCES_KEY = "nextly.builder.shell";

/**
 * The shell's preferences for one signed-in user, so two authors of one
 * browser each get their own panel, device and zoom.
 *
 * Preferences stored before they were kept per user sit under the shell's key
 * alone. The first user to load with no record of their own takes that one:
 * it is copied to theirs and removed, so it moves once and no second author
 * inherits it. With no user known (signed out, or not read yet), nothing is
 * remembered: a record kept for a guess would be read by the wrong author.
 *
 * A host whose browser storage follows rules of its own (a site that keeps
 * nothing on the device, a sign-out that forgets the person) passes `open`,
 * which opens the store under a key; both records, the user's and the one
 * from before, are then read, written and removed through it alone.
 *
 * @param userId - the signed-in user's id, or null when there is none
 * @param open - opens the store under a key; this browser's storage by default
 * @returns a store under that user's own key, or one that keeps nothing
 */
export function userPreferenceStore(
  userId: string | null,
  open: OpenPreferenceStore = browserStoreWithRemove
): PreferenceStore {
  if (userId === null || typeof window === "undefined") return NO_STORAGE;
  // One store per user and opener, so a host may call this on every render:
  // a new object would read as a different store, and the shell would reload.
  let stores = userStores.get(open);
  if (stores === undefined) {
    stores = new Map();
    userStores.set(open, stores);
  }
  const cached = stores.get(userId);
  if (cached !== undefined) return cached;
  const store = keyedStore(userId, open);
  stores.set(userId, store);
  return store;
}

/**
 * Opens the store under a key, one that can also remove what it holds: the
 * record from before is removed once moved, so no second author inherits it.
 *
 * @experimental
 */
export type OpenPreferenceStore = (
  key: string
) => PreferenceStore & { remove: () => void };

/** {@link browserStore}, able to remove what it holds. */
function browserStoreWithRemove(
  key: string
): PreferenceStore & { remove: () => void } {
  return {
    ...browserStore(key),
    remove: () => window.localStorage.removeItem(key),
  };
}

/** The stores handed out so far, by opener and then user id. */
const userStores = new WeakMap<
  OpenPreferenceStore,
  Map<string, PreferenceStore>
>();

/** The store under one user's own key, moving the earlier record on a read. */
function keyedStore(
  userId: string,
  open: OpenPreferenceStore
): PreferenceStore {
  const own = open(`${SHELL_PREFERENCES_KEY}:${userId}`);
  const before = open(SHELL_PREFERENCES_KEY);
  return {
    read: () => {
      const kept = own.read();
      if (kept !== null) return kept;
      const moved = before.read();
      if (moved === null) return null;
      own.write(moved);
      before.remove();
      return moved;
    },
    write: own.write,
  };
}

/**
 * A stored layout, accepted only if every entry is a usable percentage.
 *
 * Partial acceptance would be worse than rejection here: the library
 * distributes a layout across ALL panels, so a map missing one or carrying a
 * `NaN` resolves to a layout nobody chose. The whole map is the unit.
 */
/**
 * The stored layouts, dropping any entry that is not usable.
 *
 * Per-topology rather than all-or-nothing: a layout written under a panel set
 * that no longer exists should cost the author only that arrangement's widths,
 * not the ones they set for every other arrangement.
 */
function readLayouts(value: unknown): Record<string, Record<string, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const layouts: Record<string, Record<string, number>> = {};
  for (const [key, layout] of Object.entries(value)) {
    if (isLayout(layout)) layouts[key] = layout;
  }
  return layouts;
}

function isLayout(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    entries.length > 0 &&
    entries.every(
      ([, size]) =>
        typeof size === "number" && Number.isFinite(size) && size > 0
    )
  );
}

/**
 * Preferences parsed from whatever was stored.
 *
 * Every field is validated separately and falls back on its own, rather than
 * one malformed field discarding the rest. A layout written under a different
 * panel set should reset the layout, not the author's panel choice with it.
 *
 * Only the fields named below are read, and anything else in the record is
 * ignored rather than refused. Records written by an earlier release still
 * carry `showEmptyElements`, a preference that no longer exists because empty
 * containers are always shown: such a record loads whole, without it.
 */
export function readPreferences(store: PreferenceStore): ShellPreferences {
  let raw: unknown;
  try {
    const stored = store.read();
    if (stored === null) return DEFAULT_PREFERENCES;
    raw = JSON.parse(stored);
  } catch {
    // Unreadable storage or malformed JSON. Neither says anything about the
    // author's intent, so the defaults are the honest answer.
    return DEFAULT_PREFERENCES;
  }

  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFERENCES;
  const record = raw as Record<string, unknown>;

  const left = storedPanel(record.leftPanel, record.leftPanelView);
  return {
    leftPanel: left.panel,
    leftPanelView: left.view,
    leftPinned:
      typeof record.leftPinned === "boolean"
        ? record.leftPinned
        : DEFAULT_PREFERENCES.leftPinned,
    // Shown unless a stored true says otherwise, which covers every
    // preference written before a side could be hidden.
    leftPanelHidden: record.leftPanelHidden === true,
    inspectorHidden: record.inspectorHidden === true,
    // Fit when the stored value is not a zoom, which includes every preference
    // written before there was one. `readZoom` refuses a scale outside the
    // bounds rather than painting the canvas somewhere the control cannot be
    // reached to undo it.
    zoom: readZoom(record.zoom) ?? DEFAULT_PREFERENCES.zoom,
    editingBreakpoint:
      typeof record.editingBreakpoint === "string" &&
      record.editingBreakpoint !== ""
        ? record.editingBreakpoint
        : DEFAULT_PREFERENCES.editingBreakpoint,
    layouts: readLayouts(record.layouts),
    // On unless a stored false says otherwise, which covers every preference
    // written before the keys could be turned off.
    panelKeys: record.panelKeys !== false,
  };
}

/** Preferences written back, ignoring a store that refuses. */
export function writePreferences(
  store: PreferenceStore,
  preferences: ShellPreferences
): void {
  try {
    // Narrowed on the way out for the reason it is checked on the way in: what
    // is stored is a value this can read back, not whatever shape the running
    // editor happens to hold.
    store.write(
      JSON.stringify({ ...preferences, zoom: writeZoom(preferences.zoom) })
    );
  } catch {
    // A quota error or unavailable storage. Losing a panel width is not worth
    // interrupting an edit over, and there is nothing the author could do.
  }
}

/**
 * The panel a rail click selects.
 *
 * Clicking the open panel's own rail item CLOSES it. That is what makes the
 * rail a toggle rather than a one-way switch, and it is the only way to reach a
 * full-width canvas without a separate control.
 */
export function panelAfterRailClick(
  current: LeftPanel | null,
  clicked: LeftPanel
): LeftPanel | null {
  return current === clicked ? null : clicked;
}
