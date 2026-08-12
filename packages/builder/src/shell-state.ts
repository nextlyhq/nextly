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
 * Lower bounds are the point below which the region stops being usable rather
 * than round numbers: a layers tree needs room for an indent plus a label, and
 * the inspector carries two-column controls. Upper bounds keep the canvas —
 * the thing being edited — the largest region at the minimum supported width.
 */
export const PANEL_BOUNDS = {
  left: { min: 240, max: 480, initial: 300 },
  inspector: { min: 280, max: 520, initial: 320 },
} as const;

export type PanelRegion = keyof typeof PANEL_BOUNDS;

/**
 * A width brought inside its region's bounds.
 *
 * Clamped rather than rejected. A width arrives from a drag that continues past
 * the edge and from a stored preference written when the bounds were different;
 * in both cases the nearest legal width is what the author meant, and refusing
 * would leave the panel at whatever it was.
 *
 * A value that is not a finite number — `NaN` from a malformed stored string,
 * `Infinity` from a division — answers the region's initial width rather than
 * propagating. `Math.min`/`Math.max` pass `NaN` straight through, so a bare
 * clamp would store it and the panel would collapse.
 */
export function clampPanelWidth(region: PanelRegion, width: number): number {
  const { min, max, initial } = PANEL_BOUNDS[region];
  if (!Number.isFinite(width)) return initial;
  return Math.min(max, Math.max(min, width));
}

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

/** The rail's fixed width in CSS pixels (PB-D17: 48px, icons only). */
export const RAIL_WIDTH = 48;

/**
 * The narrowest the canvas may become before a panel drag stops taking from it.
 *
 * The canvas is the thing being edited, so it is the region with a floor rather
 * than the one that absorbs whatever is left.
 */
export const MIN_CANVAS_WIDTH = 480;

/**
 * Both panel widths, brought inside bounds that DEPEND ON EACH OTHER.
 *
 * Per-panel bounds alone are the wrong model, and the arithmetic says so: at the
 * minimum supported viewport with both panels at their individual maximums the
 * canvas is 232px — narrower than either panel, in an editor whose subject is
 * the canvas. Nothing about either panel's own bounds is violated, because the
 * constraint was never per-panel.
 *
 * So the canvas floor is enforced jointly, and the panels give way in a defined
 * order: the INSPECTOR yields first, then the left panel. That order is not
 * arbitrary — the left panel is the one the author opened deliberately from the
 * rail and can dismiss with the same click, while the inspector is always
 * present. Taking from the deliberate choice first would read as the editor
 * undoing an action.
 *
 * Panels below their own minimum are not squeezed further; a viewport too narrow
 * to hold both at minimum plus the canvas floor is one where
 * {@link fitsFullShell} is already false, and the shell shows the narrow-viewport
 * path instead of a broken layout.
 */
export function fitPanels(input: {
  viewportWidth: number;
  leftWidth: number;
  inspectorWidth: number;
  leftOpen: boolean;
}): { leftWidth: number; inspectorWidth: number } {
  const leftWidth = clampPanelWidth("left", input.leftWidth);
  const inspectorWidth = clampPanelWidth("inspector", input.inspectorWidth);
  const occupiedLeft = input.leftOpen ? leftWidth : 0;

  const spare =
    input.viewportWidth -
    RAIL_WIDTH -
    occupiedLeft -
    inspectorWidth -
    MIN_CANVAS_WIDTH;
  if (spare >= 0) return { leftWidth, inspectorWidth };

  // The inspector yields first, never below its own minimum.
  const inspectorGive = Math.min(
    -spare,
    inspectorWidth - PANEL_BOUNDS.inspector.min
  );
  const fittedInspector = inspectorWidth - inspectorGive;
  const stillOver = -spare - inspectorGive;
  if (stillOver <= 0 || !input.leftOpen) {
    return { leftWidth, inspectorWidth: fittedInspector };
  }

  const leftGive = Math.min(stillOver, leftWidth - PANEL_BOUNDS.left.min);
  return { leftWidth: leftWidth - leftGive, inspectorWidth: fittedInspector };
}

/**
 * What the shell remembers between sessions.
 *
 * Widths and the open panel only. Deliberately NOT selection, scroll position
 * or anything describing the document: those belong to the document's own
 * state, and persisting a copy here is a second source that goes stale the
 * first time the document changes underneath it.
 */
export interface ShellPreferences {
  leftPanel: LeftPanel | null;
  leftWidth: number;
  inspectorWidth: number;
  leftPinned: boolean;
}

export const DEFAULT_PREFERENCES: ShellPreferences = {
  leftPanel: null,
  leftWidth: PANEL_BOUNDS.left.initial,
  inspectorWidth: PANEL_BOUNDS.inspector.initial,
  leftPinned: true,
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
 * Preferences parsed from whatever was stored.
 *
 * Every field is validated separately and falls back on its own, rather than
 * one malformed field discarding the rest. A stored width from an older release
 * with different bounds should move the panel, not reset the author's panel
 * choice alongside it.
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
    leftWidth: clampPanelWidth(
      "left",
      typeof record.leftWidth === "number"
        ? record.leftWidth
        : PANEL_BOUNDS.left.initial
    ),
    inspectorWidth: clampPanelWidth(
      "inspector",
      typeof record.inspectorWidth === "number"
        ? record.inspectorWidth
        : PANEL_BOUNDS.inspector.initial
    ),
    leftPinned:
      typeof record.leftPinned === "boolean"
        ? record.leftPinned
        : DEFAULT_PREFERENCES.leftPinned,
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
