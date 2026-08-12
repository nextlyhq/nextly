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

/**
 * The panels the left rail switches between.
 *
 * One at a time, by decision (PB-D17 D10-1): fixed sides, no docking, no
 * floating. The rail selects; it never opens a second panel beside the first.
 */
export const LEFT_PANELS = [
  "insert",
  "layers",
  "components",
  "tokens",
  "fonts",
  "pages",
  "settings",
] as const;

export type LeftPanel = (typeof LEFT_PANELS)[number];

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

/** The rail's fixed width in CSS pixels (PB-D17: 48px, icons only). */
export const RAIL_WIDTH = 48;

/**
 * The narrowest the canvas may become before a drag stops taking from it.
 *
 * The canvas is the thing being edited, so it is the region with a floor rather
 * than the one that absorbs whatever is left.
 */
export const MIN_CANVAS_WIDTH = 480;

/**
 * The narrowest viewport the full shell is supported at (PB-D17 D10-5).
 *
 * Below this the rail, both panels and a usable canvas do not fit at their
 * minimum widths, so the shell does not try: it shows the canvas and says where
 * to edit instead. A builder that merely gets cramped is worse than one that
 * says it needs a wider screen, because the author discovers the limit by
 * failing at a task.
 */
export const MIN_SHELL_WIDTH = 1280;

/** Whether the viewport can carry the full shell. */
export function fitsFullShell(viewportWidth: number): boolean {
  return viewportWidth >= MIN_SHELL_WIDTH;
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
  leftPinned: boolean;
  /** Panel id to percentage, or null when the author has never resized. */
  layout: Record<string, number> | null;
}

export const DEFAULT_PREFERENCES: ShellPreferences = {
  leftPanel: null,
  leftPinned: true,
  layout: null,
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

/**
 * A stored layout, accepted only if every entry is a usable percentage.
 *
 * Partial acceptance would be worse than rejection here: the library
 * distributes a layout across ALL panels, so a map missing one or carrying a
 * `NaN` resolves to a layout nobody chose. The whole map is the unit.
 */
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

  return {
    leftPanel: isLeftPanel(record.leftPanel) ? record.leftPanel : null,
    leftPinned:
      typeof record.leftPinned === "boolean"
        ? record.leftPinned
        : DEFAULT_PREFERENCES.leftPinned,
    layout: isLayout(record.layout) ? record.layout : null,
  };
}

/** Preferences written back, ignoring a store that refuses. */
export function writePreferences(
  store: PreferenceStore,
  preferences: ShellPreferences
): void {
  try {
    store.write(JSON.stringify(preferences));
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
