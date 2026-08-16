"use client";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ShortcutProvider,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useShortcuts,
} from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import {
  Blocks,
  FileText,
  Layers,
  Palette,
  Plus,
  Settings,
  Type,
} from "lucide-react";
import * as React from "react";

import { devWarnOnce } from "./dev-warn";
import {
  DEFAULT_PREFERENCES,
  LEFT_PANELS,
  MIN_CANVAS_WIDTH,
  MIN_SHELL_WIDTH,
  PANEL_BOUNDS,
  panelAfterRailClick,
  RAIL_WIDTH,
  readPreferences,
  topologyKey,
  writePreferences,
  type LeftPanel,
  type PreferenceStore,
  type ShellPreferences,
} from "./shell-state";

/**
 * The editor shell: rail, one switched panel, canvas, inspector, bars.
 *
 * PURELY PRESENTATIONAL, and that is a contract rather than a current state.
 * It owns which panel is open and how wide the regions are — chrome state, its
 * own business — and owns nothing about the document. Selection arrives as a
 * prop and leaves as a callback.
 *
 * The reason is not tidiness. Document ops INVALIDATE selection: a remove
 * deletes the selected node, a move relocates it. If the shell held selection it
 * would have to be updated in step with every op, which is two things changing
 * together — the drift this codebase keeps paying for. Held outside, selection
 * can be DERIVED from the post-op document ("does this id still resolve?"),
 * which cannot go out of step because there is only one thing to read.
 *
 * Content is passed as slots rather than rendered here, so the layers panel, the
 * inserter and the inspector can be built independently without this file
 * changing. It knows the SHAPE of the editor, never what fills it.
 *
 * @module builder-shell
 */

/** Icons for the rail, one per panel. Kept beside the labels they belong to. */
const PANEL_CHROME: Record<
  LeftPanel,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  insert: { label: "Insert", Icon: Plus },
  layers: { label: "Layers", Icon: Layers },
  components: { label: "Components", Icon: Blocks },
  tokens: { label: "Tokens", Icon: Palette },
  fonts: { label: "Fonts", Icon: Type },
  pages: { label: "Pages", Icon: FileText },
  settings: { label: "Settings", Icon: Settings },
};

/**
 * The regions F6 cycles between, in the order a sighted user reads them.
 *
 * A shell of this size is unusable by keyboard without region navigation: an
 * author who tabs out of the inspector should not traverse every control in the
 * canvas to reach the rail. F6 is the platform convention for exactly this.
 */
const REGIONS = ["rail", "panel", "canvas", "inspector"] as const;
type Region = (typeof REGIONS)[number];

export interface BuilderShellProps {
  /** Rendered inside the switched left panel. Keyed by the panel that is open. */
  renderPanel?: (panel: LeftPanel) => React.ReactNode;
  /**
   * Which panels the host can actually fill.
   *
   * The rail always shows all seven, because the set is the editor's shape and
   * hiding the unbuilt ones would make the chrome change under an author as
   * features land. What it must not do is OPEN one nothing renders into: that
   * reserves a panel and shrinks the canvas to display nothing, which reads as a
   * broken control rather than an absent feature.
   *
   * So a panel outside this list is drawn disabled and labelled as coming soon.
   * Omit the prop entirely and every panel is treated as available, which keeps
   * a host that fills all of them from having to enumerate them.
   *
   * Derived from what the host can render rather than declared twice: pass the
   * same set `renderPanel` returns content for, and the rail cannot disagree with
   * the panel body.
   */
  availablePanels?: readonly LeftPanel[];
  /** The canvas. The shell never looks inside it. */
  children?: React.ReactNode;
  /** The inspector's contents. */
  inspector?: React.ReactNode;
  /** Rendered into the top bar, between the page menu and the actions. */
  topBar?: React.ReactNode;
  /** The ancestor breadcrumb, along the bottom bar. */
  breadcrumb?: React.ReactNode;
  /**
   * Leaving the editor. Explicit and LABELLED, never an unmarked X: the author
   * is one click from losing a canvas full of work, and an ambiguous glyph is
   * how that happens.
   *
   * **Optional, because not every host has a destination.** The editor mounts
   * both as a standalone view, where leaving means navigating away from unsaved
   * canvas state, and EMBEDDED as a field inside an entry form, where there is
   * nowhere to go — the form is already on screen around it. Omitting this
   * renders no exit affordance anywhere, including in the narrow-viewport
   * notice, whose escape sentence travels with the button.
   *
   * The handler IS the capability rather than a mode flag beside it, so the
   * control cannot exist without something to do. A `standalone` boolean would
   * be a second thing to keep in sync, and the state where the two disagree
   * would be representable.
   */
  onExit?: () => void;
  /**
   * Where chrome preferences live. Defaults to `localStorage` in a browser and
   * to a store that remembers nothing anywhere else, so a server render is a
   * default rather than a crash.
   *
   * **Pass a NEW object whenever the data behind it changes** — a different
   * signed-in user, a different workspace. The shell reloads preferences when
   * this identity changes, and cannot see a store that quietly starts reading
   * somewhere else: it would go on showing the previous user's panel widths and
   * write their preferences into the new target.
   *
   * This is the same contract React puts on any value it compares by identity,
   * and it keeps the port at two methods. The alternative — a subscription or a
   * revision token — is a third method every host has to implement correctly
   * for a case that a new object already solves.
   */
  store?: PreferenceStore;
  className?: string;
}

/** A store that forgets, for a server render or a host that supplies its own. */
const NO_STORAGE: PreferenceStore = {
  read: () => null,
  write: () => undefined,
};

const STORAGE_KEY = "nextly.builder.shell";

function browserStore(): PreferenceStore {
  if (typeof window === "undefined") return NO_STORAGE;
  return {
    read: () => window.localStorage.getItem(STORAGE_KEY),
    write: value => window.localStorage.setItem(STORAGE_KEY, value),
  };
}

/**
 * Whether the viewport can carry the full shell, tracked as it changes.
 *
 * Starts as `true` on purpose. The alternative is measuring during render,
 * which the server cannot do — it would emit the narrow-viewport message and the
 * client would replace it, a hydration mismatch on every desktop load. Assuming
 * the supported case and correcting after mount makes both first renders
 * identical.
 */
function useFitsFullShell(): boolean {
  const [fits, setFits] = React.useState(true);

  React.useEffect(() => {
    const query = window.matchMedia(`(min-width: ${MIN_SHELL_WIDTH}px)`);
    const sync = () => setFits(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return fits;
}

/**
 * Whether the shell around this subtree is currently interactive.
 *
 * Defaults to `true`, which covers both callers outside a shell entirely and the server render,
 * where the width is unknowable — the same assumption {@link useFitsFullShell} makes and for the
 * same reason.
 */
const ShellActiveContext = React.createContext(true);

/**
 * Whether the surrounding shell is interactive, for content that has to answer for itself.
 *
 * The shell hides its slots behind `hidden` and `inert` below {@link MIN_SHELL_WIDTH}, which is
 * enough for anything rendering in place. It is NOT enough for anything that portals to the
 * document body — a dialog escapes the wrapper and would sit over the narrow-screen notice, fully
 * interactive. Such a component reads this instead of re-deriving the width, so one media query
 * decides both and they cannot disagree.
 *
 * @experimental
 */
export function useShellIsActive(): boolean {
  return React.useContext(ShellActiveContext);
}

/**
 * Preferences, restored AFTER mount and written back whenever they change.
 *
 * Reading storage in the initializer is the obvious shape and it is wrong here.
 * On a server render the default store answers `null`, so the server emits the
 * defaults; the client initializer reads `localStorage` and emits a restored
 * panel. React 19 treats that divergence as a hydration failure and rebuilds
 * the subtree — so a returning author's restored layout arrives as a flash and
 * a discarded tree rather than as a layout.
 *
 * Both first renders therefore start from the defaults, and the stored
 * preferences are applied in an effect. The cost is one frame of default
 * chrome; the alternative is a mismatch on every load for anyone who has ever
 * moved a panel.
 */
function usePreferences(store: PreferenceStore) {
  const [preferences, setPreferences] =
    React.useState<ShellPreferences>(DEFAULT_PREFERENCES);
  /**
   * How many times a store has been READ into this hook.
   *
   * Downstream, restoring a layout is a once-per-load act, and "once" has to be
   * counted against something. Counted against the component's lifetime it is
   * wrong as soon as the host swaps stores — signing into a second workspace
   * loads that user's preferences, and a guard that already fired leaves the
   * previous user's widths on screen.
   *
   * A counter rather than the store's identity because it is what the guard
   * downstream compares against, and it says WHICH load was applied rather than
   * merely that one was.
   *
   * It does NOT detect a host mutating the data behind a store it keeps
   * handing us: the read below is keyed on the store's identity, so an
   * unchanged object means no read happens at all and this never advances.
   * That is the documented contract on `store` — a new backing user or
   * workspace is a new store object — rather than a gap. Detecting it instead
   * would mean a subscription or a revision token on the port, which is a
   * third method every host implementing it would have to get right, for a
   * case a caller can satisfy by passing a new object.
   */
  const [loadCount, setLoadCount] = React.useState(0);

  React.useEffect(() => {
    const restored = readPreferences(store);
    // Compared before setting so a host with no stored preferences does not
    // take a second render for a value that did not change.
    setPreferences(current =>
      shallowEqualPreferences(current, restored) ? current : restored
    );
    setLoadCount(count => count + 1);
  }, [store]);

  // The newest preferences, reachable from a callback that must not go stale.
  const latest = React.useRef(preferences);
  latest.current = preferences;

  /**
   * Takes a CHANGE rather than a value, and this is load-bearing.
   *
   * `react-resizable-panels` calls `onLayoutChanged` once a drag settles, from
   * a handler React captured when the panel was rendered. Handed a whole
   * record built by spreading `preferences` from that render, a drag begun
   * before an unrelated change would write the OLD record back with only the
   * layout replaced — silently discarding whichever field moved in between.
   *
   * Measured, not theorised: opening a panel and then dragging its separator
   * wrote `leftPanel: null` back over the open panel, so the panel vanished on
   * the next load. jsdom cannot see this — its inert `ResizeObserver` means
   * `onLayoutChanged` never fires there — which is why it took a browser.
   */
  const update = React.useCallback(
    (change: (current: ShellPreferences) => ShellPreferences) => {
      const next = change(latest.current);
      latest.current = next;
      setPreferences(next);
      writePreferences(store, next);
    },
    [store]
  );

  return [preferences, update, loadCount] as const;
}

/**
 * Whether two preference records say the same thing.
 *
 * The layout is compared by its entries rather than by identity: `readPreferences`
 * builds a fresh object every call, so identity is always false and the restore
 * effect would set state on every mount even when nothing changed.
 */
function shallowEqualPreferences(
  a: ShellPreferences,
  b: ShellPreferences
): boolean {
  if (a.leftPanel !== b.leftPanel || a.leftPinned !== b.leftPinned) {
    return false;
  }
  if (a.layouts === b.layouts) return true;
  const topologies = Object.keys(a.layouts);
  if (topologies.length !== Object.keys(b.layouts).length) return false;
  return topologies.every(topology => {
    const left = a.layouts[topology];
    const right = b.layouts[topology];
    if (left === undefined || right === undefined) return false;
    const ids = Object.keys(left);
    return (
      ids.length === Object.keys(right).length &&
      ids.every(id => left[id] === right[id])
    );
  });
}

/**
 * One design-system token, read off the mounted shell.
 *
 * Chosen over any `--nx-builder-*` because those are declared in this package's
 * own stylesheet and would resolve whether or not the design system's had been
 * loaded — the check would pass in exactly the case it exists to catch. The
 * `--nx-*` layer is declared only by `@nextlyhq/ui`, so its absence is the
 * question being asked.
 */
const REQUIRED_HOST_TOKEN = "--nx-background";

/**
 * A token this package's OWN stylesheet declares, used as a positive control.
 *
 * Without it the check cannot tell the two ways of resolving to nothing apart:
 * a host that never imported the design system's sheet, and an environment that
 * applies no stylesheets whatsoever. jsdom is the second, so a bare absence test
 * would warn on every unit test that mounts the shell — noise indistinguishable
 * from the real defect, in the place developers read warnings most.
 *
 * Reading both makes the instrument observable: when this one resolves, styles
 * ARE being applied, and the other one's absence means what it says.
 */
const OWN_STYLESHEET_TOKEN = "--nx-builder-surface";

/**
 * Tell a developer when the design system's stylesheet has not been loaded.
 *
 * The editor's own sheet supplements that one rather than restating it, so a
 * host that imports only `@nextlyhq/builder/styles.css` gets a shell that mounts
 * with every class name in place and renders wrong — unstyled tooltips and drag
 * handles, and chrome colours resolving to nothing. Nothing at build time can
 * see a missing side-effect import in someone else's application, so this is the
 * only layer the requirement can be enforced from.
 */
function useDesignSystemStylesheet(
  rootRef: React.RefObject<HTMLElement | null>
): void {
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;
    const styles = window.getComputedStyle(root);
    const own = styles.getPropertyValue(OWN_STYLESHEET_TOKEN).trim();
    // Nothing resolves here, so the absence of the other token says nothing
    // about the host. Reporting it anyway would put a warning about a missing
    // import in front of every developer running the suite.
    if (own === "") return;
    devWarnOnce(
      styles.getPropertyValue(REQUIRED_HOST_TOKEN).trim() !== "",
      `The design system's stylesheet is not loaded, so the editor will render ` +
        `without its colours, tooltips or drag handles. Import ` +
        `"@nextlyhq/ui/styles.css" (or the admin's stylesheet) alongside ` +
        `"@nextlyhq/builder/styles.css" — the editor's sheet supplements it and ` +
        `does not replace it.`
    );
  }, [rootRef]);
}

/**
 * F6 region cycling, registered with the shared shortcut manager.
 *
 * Through the manager rather than a private key listener, because two
 * independent key layers is how "Escape navigates out of the editor while a drag
 * owns it" happens — the failure the manager exists to prevent.
 */
function useRegionCycling(
  regionRefs: React.RefObject<Record<Region, HTMLElement | null>>,
  enabled: boolean
): void {
  // Read through a ref so the binding's `when` sees the CURRENT answer. The
  // manager checks it at press time, and a value captured when the binding was
  // registered would keep reporting whatever was true then.
  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;

  useShortcuts(
    [
      {
        keys: "F6",
        // Off while the shell is hidden behind the narrow-viewport notice. The
        // subtree stays mounted there to preserve the caller's slots, which
        // leaves this binding registered over regions that are all `inert`:
        // pressing F6 on the notice consumed the key, focused nothing, and —
        // where the host shares the shortcut manager — took the keystroke from
        // whatever binding of its own would otherwise have handled it.
        //
        // `when` rather than skipping registration, because it is the
        // manager's own way of saying "not right now": a binding whose
        // condition is false is passed over and the key goes on to the next
        // layer, which is exactly the behaviour the host needs back.
        when: () => enabledRef.current,
        description: "Move to the next area of the editor",
        // The manager's default asks whether the FIRST chord carries a modifier
        // or is Escape, and answers no for a bare function key — so F6 would be
        // held back by any focused text field. That default is right for the
        // letter keys it was written for and backwards here: moving between
        // areas of the editor is the one thing an author needs MOST while a
        // caption or a field has focus, because it is how they get back out
        // without reaching for the mouse.
        whenTyping: true,
        run: () => {
          focusNextRegion(regionRefs.current);
        },
      },
    ],
    { name: "Builder shell" }
  );
}

/**
 * Move focus to the next rendered region, wrapping around.
 *
 * A named function rather than the body of the binding, because TWO paths have
 * to perform this and they must not be two implementations of it — see
 * `useSeparatorRegionEscape` for why the second exists.
 */
function focusNextRegion(map: Record<Region, HTMLElement | null> | null): void {
  if (!map) return;
  // Only regions that are actually rendered. The left panel is absent whenever
  // the rail has nothing open, and cycling the static list would land on it,
  // focus nothing, and leave the key looking broken for every press after the
  // first.
  const present = REGIONS.filter(region => map[region] !== null);
  if (present.length === 0) return;

  const active = document.activeElement;
  const currentIndex = present.findIndex(region =>
    map[region]?.contains(active)
  );
  // From outside any region, F6 enters the first rather than doing nothing —
  // otherwise the key appears broken until focus happens to land somewhere it
  // recognises.
  const next = present[(currentIndex + 1) % present.length];
  if (next !== undefined) map[next]?.focus();
}

/**
 * Let F6 escape a focused drag handle.
 *
 * The separators run their own key listener, and it claims F6: it cycles
 * between separators and calls `preventDefault()`. The shared shortcut manager
 * deliberately skips an event that has already been prevented — two layers both
 * acting on one keystroke is the failure it exists to stop — so the shell's
 * region binding never ran. In the default topology there is exactly ONE
 * separator, so F6 from a handle re-focused that same handle for ever, which is
 * the state an author lands in immediately after resizing anything.
 *
 * Handled in the CAPTURE phase on the shell root, which is the only place that
 * runs before the separator's own listener at the target. Propagation is stopped
 * so the manager does not then cycle a second time on the way back up.
 *
 * The region binding stays registered: it is what handles F6 from outside this
 * subtree, and what puts the shortcut in front of anything that lists them.
 */
function useSeparatorRegionEscape(
  regionRefs: React.RefObject<Record<Region, HTMLElement | null>>,
  enabled: boolean
): (event: React.KeyboardEvent<HTMLElement>) => void {
  return React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "F6" || !enabled) return;
      // Only from a separator. Everywhere else the manager is the right owner,
      // and intercepting here would take the key from a host binding that has
      // every right to it.
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        target.getAttribute("role") !== "separator"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      focusNextRegion(regionRefs.current);
    },
    [regionRefs, enabled]
  );
}

function ShellRegions({
  renderPanel,
  availablePanels,
  children,
  inspector,
  topBar,
  breadcrumb,
  onExit,
  preferences,
  update,
  className,
  active,
  loadCount,
}: Omit<BuilderShellProps, "store"> & {
  preferences: ShellPreferences;
  update: (change: (current: ShellPreferences) => ShellPreferences) => void;
  /**
   * Whether this subtree is the one the author is using.
   *
   * False while it sits mounted-but-hidden behind the narrow-viewport notice,
   * which is a state it cannot detect for itself: from in here a hidden shell
   * and a visible one render identically.
   */
  active: boolean;
  /**
   * How many times preferences have been loaded from a store.
   *
   * Restoring a layout happens once per load, and this is what "once" is
   * counted against: the group is remounted per load so the library
   * re-reads the restored layout at panel registration.
   */
  loadCount: number;
}) {
  const regionRefs = React.useRef<Record<Region, HTMLElement | null>>({
    rail: null,
    panel: null,
    canvas: null,
    inspector: null,
  });
  useRegionCycling(regionRefs, active);
  const onKeyDownCapture = useSeparatorRegionEscape(regionRefs, active);
  const chromeRef = React.useRef<HTMLDivElement | null>(null);
  useDesignSystemStylesheet(chromeRef);

  /**
   * Whether the host can fill a panel. One predicate, so the rail's disabled
   * state and the panel the layout reserves cannot answer differently.
   */
  const isAvailable = (panel: LeftPanel) =>
    availablePanels === undefined || availablePanels.includes(panel);

  /**
   * The open panel, NORMALISED against what the host can fill.
   *
   * Preferences outlive the code that wrote them, and availability can change
   * between mounts — a store restoring `layers` while the host now offers only
   * `insert` would reserve a left panel whose content renders nothing. Disabling
   * the rail button does not help: nobody clicked it, the selection was restored.
   *
   * Treated as closed instead, which is the same answer the shell gives for a
   * panel name it no longer recognises.
   */
  const restored = preferences.leftPanel;
  const openPanel =
    restored !== null && isAvailable(restored) ? restored : null;
  // The panel set about to be rendered, named the same way a persisted layout
  // is keyed. Derived from `openPanel` because that is what decides the set;
  // the persisted key is derived from the layout's own ids, and the two meet at
  // `topologyKey` rather than being two spellings of one arrangement.
  const mountedTopology = topologyKey(
    openPanel === null
      ? ["canvas", "inspector"]
      : ["panel", "canvas", "inspector"]
  );

  const selectPanel = (panel: LeftPanel) =>
    update(current => ({
      ...current,
      leftPanel: panelAfterRailClick(current.leftPanel, panel),
    }));

  return (
    <div
      ref={chromeRef}
      onKeyDownCapture={onKeyDownCapture}
      className={cn(
        "nx-builder-chrome flex h-full w-full flex-col overflow-hidden",
        className
      )}
    >
      <header
        className="border-[color:var(--nx-builder-border)] flex h-12 shrink-0 items-center gap-2 border-b px-2"
        aria-label="Editor actions"
      >
        {/*
         * Rendered only when there is somewhere to go. A button carrying no
         * handler still looks operable — it takes focus, it depresses — and
         * teaches the author that leaving does nothing, which is worse than
         * offering no exit at all.
         */}
        {onExit ? (
          <button
            type="button"
            onClick={onExit}
            data-builder-animates
            className="border-[color:var(--nx-builder-border)] focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            Exit editor
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">{topBar}</div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          ref={element => {
            regionRefs.current.rail = element;
          }}
          tabIndex={-1}
          aria-label="Editor panels"
          style={{ width: RAIL_WIDTH }}
          className="border-[color:var(--nx-builder-border)] flex shrink-0 flex-col items-center gap-1 border-r py-2"
        >
          {LEFT_PANELS.map(panel => {
            const { label, Icon } = PANEL_CHROME[panel];
            const isOpen = openPanel === panel;
            // A panel the host cannot fill is shown and DISABLED rather than
            // hidden, so the rail describes the editor's full shape while never
            // opening an empty region. Clicking one previously reserved a panel
            // and shrank the canvas to show nothing.
            const ready = isAvailable(panel);
            return (
              <Tooltip key={panel}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-builder-animates
                    data-panel={panel}
                    disabled={!ready}
                    aria-pressed={ready ? isOpen : undefined}
                    aria-label={ready ? label : `${label} — coming soon`}
                    onClick={() => selectPanel(panel)}
                    className={cn(
                      "focus-visible:ring-ring flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none",
                      isOpen && ready
                        ? "bg-[color:var(--nx-builder-accent)] text-[color:var(--nx-builder-accent-text)]"
                        : "text-[color:var(--nx-builder-text-muted)]",
                      // Dimmed rather than removed: the control stays legible as
                      // a place the editor will grow into.
                      !ready && "cursor-not-allowed opacity-40"
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {ready ? label : `${label} — coming soon`}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <ResizablePanelGroup
          // Remounted when a store is LOADED, which is the only way the library
          // applies a layout: it reads `defaultLayout` when the panels REGISTER
          // and a later prop change merely assigns it. Restoration therefore
          // happens where the library already does it, rather than being
          // reapplied afterwards through the imperative API — which is what made
          // the units, the key order and the mount timing this component's
          // problems to solve.
          key={loadCount}
          orientation="horizontal"
          // Selected by the panel set actually mounted, so an arrangement with
          // no stored layout falls through to the panels' declared widths
          // instead of inheriting another arrangement's.
          defaultLayout={preferences.layouts[mountedTopology]}
          onLayoutChanged={(layout, meta) => {
            // The group reports every layout it settles on, not only the ones a
            // person asked for. Mounting, recomputing constraints and reacting
            // to a changed default all arrive here too, and the mount pass
            // arrives BEFORE the restored layout has taken effect — so writing
            // unconditionally saves the freshly measured default over the
            // layout being restored, and the panel widths reset on every
            // reload while appearing to persist within a session.
            //
            // `isUserInteraction` is the library's own account of which of
            // those it was: true only for a pointer drag or a resize key on a
            // separator. Dragging a separator is the one event that states an
            // intent about widths, and it is the only one worth remembering.
            if (!meta.isUserInteraction) return;
            // Stored under the topology it was measured for, and keyed from the
            // layout's OWN ids rather than from a separate description of the
            // panel set. `defaultLayout` consumes the same flex-grow weights
            // this reports, so the value makes a round trip in one unit and
            // never meets the percentage side of the API.
            update(current => ({
              ...current,
              layouts: {
                ...current.layouts,
                [topologyKey(Object.keys(layout))]: { ...layout },
              },
            }));
          }}
          className="min-w-0 flex-1"
        >
          {openPanel !== null ? (
            <>
              <ResizablePanel
                id="panel"
                minSize={PANEL_BOUNDS.left.min}
                maxSize={PANEL_BOUNDS.left.max}
                defaultSize={PANEL_BOUNDS.left.initial}
              >
                <section
                  ref={element => {
                    regionRefs.current.panel = element;
                  }}
                  tabIndex={-1}
                  aria-label={PANEL_CHROME[openPanel].label}
                  className="bg-[color:var(--nx-builder-surface-raised)] h-full overflow-auto"
                >
                  {/* Keyed by the panel, because the prop's contract says the
                      result is keyed by the panel and React's default
                      reconciliation does not honour that. A caller rendering one
                      component for several panels — `<MyPanel kind={panel} />`,
                      which is what this package's own README suggests — puts the
                      same element type at the same position, so switching from
                      Layers to Tokens UPDATES that instance rather than mounting
                      a new one: its state, its effects and any uncontrolled
                      input values follow the author into a different tool. */}
                  <React.Fragment key={openPanel}>
                    {renderPanel?.(openPanel)}
                  </React.Fragment>
                </section>
              </ResizablePanel>
              <ResizableHandle withGrip />
            </>
          ) : null}

          <ResizablePanel id="canvas" minSize={MIN_CANVAS_WIDTH}>
            {/*
             * A named `section`, never `<main>`.
             *
             * HTML allows one non-hidden `main` per document, and every mount this
             * shell has is inside a host that already owns it — the admin's
             * dashboard layout renders one, and the editor is embedded in it. A
             * second gives assistive technology two competing primary landmarks and
             * makes every strict `main` locator ambiguous.
             *
             * Nothing is lost: a `section` carrying an accessible name is still
             * exposed as a landmark, as a `region`. For an editor embedded in a page
             * whose primary content is the surrounding form, `region` is the more
             * accurate description of what this is.
             *
             * The ref and `tabIndex` move with the element deliberately. F6 region
             * cycling focuses this node, and dropping either would lose the canvas as
             * a cycle target — which reads as a focus bug rather than a markup change.
             */}
            <section
              ref={element => {
                regionRefs.current.canvas = element;
              }}
              tabIndex={-1}
              aria-label="Canvas"
              className="h-full overflow-auto"
            >
              {children}
            </section>
          </ResizablePanel>

          <ResizableHandle withGrip />

          <ResizablePanel
            id="inspector"
            minSize={PANEL_BOUNDS.inspector.min}
            maxSize={PANEL_BOUNDS.inspector.max}
            defaultSize={PANEL_BOUNDS.inspector.initial}
          >
            <aside
              ref={element => {
                regionRefs.current.inspector = element;
              }}
              tabIndex={-1}
              aria-label="Inspector"
              className="bg-[color:var(--nx-builder-surface-raised)] h-full overflow-auto"
            >
              {inspector}
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <footer
        className="border-[color:var(--nx-builder-border)] text-[color:var(--nx-builder-text-muted)] flex h-8 shrink-0 items-center gap-2 border-t px-3 text-xs"
        aria-label="Selection path"
      >
        {breadcrumb}
      </footer>
    </div>
  );
}

/**
 * The shell, or a message saying where to edit instead.
 *
 * Below the supported width the shell does not try to compress: the rail, both
 * panels and a usable canvas do not fit at their minimums, and an editor that
 * merely gets cramped is worse than one that says it needs a wider screen —
 * the author otherwise discovers the limit by failing at a task.
 *
 * @experimental
 */
export function BuilderShell({ store, ...props }: BuilderShellProps) {
  // The browser store is built once: rebuilt each render it would change
  // `usePreferences`' callback identity every render, and the write effect with
  // it. Only the FALLBACK needs that treatment though. Capturing the caller's
  // `store` alongside it pinned whichever one arrived first, so a host that
  // swaps stores — signing into a second workspace, promoting a memory store to
  // a persisted one — went on reading and writing the store it had replaced.
  const fallbackStore = React.useRef<PreferenceStore | null>(null);
  fallbackStore.current ??= browserStore();
  const resolvedStore = store ?? fallbackStore.current;
  const [preferences, update, loadCount] = usePreferences(resolvedStore);
  const fitsFullShell = useFitsFullShell();

  return (
    <ShortcutProvider>
      {/* Provided here rather than required of the host: the rail's icon-only
          buttons are unreadable without their tooltips, so a shell that renders
          them depends on this and should not make it someone else's setup step.
          Radix nests providers safely — a host with its own keeps its delay. */}
      <TooltipProvider delayDuration={300}>
        {!fitsFullShell ? (
          <div
            // The caller's className reaches this branch too. It is what
            // positions the shell in the host's layout — a grid area, a height,
            // a border — and dropping it on the narrow path made the fallback
            // escape the box the shell had been given, in the layout least able
            // to absorb it.
            className={cn(
              "nx-builder-chrome flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center",
              props.className
            )}
          >
            <p className="text-sm font-medium">
              The page editor needs a wider screen
            </p>
            {/*
             * The escape sentence and the button below it are ONE UNIT with the
             * handler: all three present, or all three absent.
             *
             * Keeping the copy while dropping the control would instruct the
             * author to go somewhere and then offer nothing to get there — and
             * keeping a button with no handler is worse, because it looks
             * operable. A host that supplies no `onExit` has no destination to
             * offer, and an embedded one needs none: the author is already
             * inside the surrounding form and can scroll to the rest of it.
             */}
            {props.onExit ? (
              <>
                <p className="text-[color:var(--nx-builder-text-muted)] max-w-sm text-sm">
                  Editing a layout needs at least {MIN_SHELL_WIDTH}px. On a
                  smaller screen you can still edit this page&apos;s content
                  from the admin.
                </p>
                <button
                  type="button"
                  onClick={props.onExit}
                  className="border-[color:var(--nx-builder-border)] focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                >
                  Exit editor
                </button>
              </>
            ) : (
              <p className="text-[color:var(--nx-builder-text-muted)] max-w-sm text-sm">
                Editing a layout needs at least {MIN_SHELL_WIDTH}px.
              </p>
            )}
          </div>
        ) : null}

        {/* The editor stays MOUNTED while the notice is up, rather than being
            swapped out for it.

            Returning the notice instead unmounted every slot the caller had
            given us — canvas, inspector, panels — and React discards the state
            inside them: a half-written caption, an open picker, whatever the
            host was holding locally. Narrowing a window or rotating a tablet is
            a transient act, and widening it again produced fresh, empty slot
            instances with no way for the host to have saved anything, because
            nothing told it the subtree was going away.

            `hidden` takes it out of layout and paint; `inert` takes it out of
            the tab order and the accessibility tree, so nothing behind the
            notice is reachable by keyboard or screen reader. The cost is that
            the editor goes on occupying memory while hidden, which is the
            deliberate trade: an author's unsaved work is worth more than the
            allocation. */}
        <div
          hidden={!fitsFullShell}
          inert={!fitsFullShell}
          // `display: contents` while visible, so this wrapper adds no box of
          // its own and the shell keeps sizing against the caller's container.
          // Omitted while hidden, where the `hidden` attribute's own
          // `display: none` has to be the one that applies.
          className={fitsFullShell ? "contents" : undefined}
        >
          {/* Published as context as well as applied as attributes, because `hidden` and `inert`
              only reach what renders INSIDE this wrapper. Slot content that portals to the body
              escapes both, and needs to be told rather than contained. */}
          <ShellActiveContext.Provider value={fitsFullShell}>
            <ShellRegions
              {...props}
              preferences={preferences}
              update={update}
              active={fitsFullShell}
              loadCount={loadCount}
            />
          </ShellActiveContext.Provider>
        </div>
      </TooltipProvider>
    </ShortcutProvider>
  );
}

export { DEFAULT_PREFERENCES };
