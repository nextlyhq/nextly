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
   */
  onExit: () => void;
  /**
   * Where chrome preferences live. Defaults to `localStorage` in a browser and
   * to a store that remembers nothing anywhere else, so a server render is a
   * default rather than a crash.
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

  React.useEffect(() => {
    const restored = readPreferences(store);
    // Compared before setting so a host with no stored preferences does not
    // take a second render for a value that did not change.
    setPreferences(current =>
      shallowEqualPreferences(current, restored) ? current : restored
    );
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

  return [preferences, update] as const;
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
  if (a.leftPanel !== b.leftPanel || a.leftPinned !== b.leftPinned)
    return false;
  if (a.layout === b.layout) return true;
  if (a.layout === null || b.layout === null) return false;
  const aKeys = Object.keys(a.layout);
  const bKeys = Object.keys(b.layout);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every(key => a.layout?.[key] === b.layout?.[key])
  );
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
  regionRefs: React.RefObject<Record<Region, HTMLElement | null>>
): void {
  useShortcuts(
    [
      {
        keys: "F6",
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
          const map = regionRefs.current;
          if (!map) return;
          // Only regions that are actually rendered. The left panel is absent
          // whenever the rail has nothing open, and cycling the static list
          // would land on it, focus nothing, and leave the key looking broken
          // for every press after the first.
          const present = REGIONS.filter(region => map[region] !== null);
          if (present.length === 0) return;

          const active = document.activeElement;
          const currentIndex = present.findIndex(region =>
            map[region]?.contains(active)
          );
          // From outside any region, F6 enters the first rather than doing
          // nothing — otherwise the key appears broken until focus happens to
          // land somewhere it recognises.
          const next = present[(currentIndex + 1) % present.length];
          if (next !== undefined) map[next]?.focus();
        },
      },
    ],
    { name: "Builder shell" }
  );
}

function ShellRegions({
  renderPanel,
  children,
  inspector,
  topBar,
  breadcrumb,
  onExit,
  preferences,
  update,
  className,
}: Omit<BuilderShellProps, "store"> & {
  preferences: ShellPreferences;
  update: (change: (current: ShellPreferences) => ShellPreferences) => void;
}) {
  const regionRefs = React.useRef<Record<Region, HTMLElement | null>>({
    rail: null,
    panel: null,
    canvas: null,
    inspector: null,
  });
  useRegionCycling(regionRefs);
  const chromeRef = React.useRef<HTMLDivElement | null>(null);
  useDesignSystemStylesheet(chromeRef);

  const openPanel = preferences.leftPanel;

  const selectPanel = (panel: LeftPanel) =>
    update(current => ({
      ...current,
      leftPanel: panelAfterRailClick(current.leftPanel, panel),
    }));

  return (
    <div
      ref={chromeRef}
      className={cn(
        "nx-builder-chrome flex h-full w-full flex-col overflow-hidden",
        className
      )}
    >
      <header
        className="border-[color:var(--nx-builder-border)] flex h-12 shrink-0 items-center gap-2 border-b px-2"
        aria-label="Editor actions"
      >
        <button
          type="button"
          onClick={onExit}
          data-builder-animates
          className="border-[color:var(--nx-builder-border)] focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
        >
          Exit editor
        </button>
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
            return (
              <Tooltip key={panel}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-builder-animates
                    data-panel={panel}
                    aria-pressed={isOpen}
                    aria-label={label}
                    onClick={() => selectPanel(panel)}
                    className={cn(
                      "focus-visible:ring-ring flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none",
                      isOpen
                        ? "bg-[color:var(--nx-builder-accent)] text-[color:var(--nx-builder-accent-text)]"
                        : "text-[color:var(--nx-builder-text-muted)]"
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={preferences.layout ?? undefined}
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
            update(current => ({ ...current, layout: { ...layout } }));
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
                  {renderPanel?.(openPanel)}
                </section>
              </ResizablePanel>
              <ResizableHandle withGrip />
            </>
          ) : null}

          <ResizablePanel id="canvas" minSize={MIN_CANVAS_WIDTH}>
            <main
              ref={element => {
                regionRefs.current.canvas = element;
              }}
              tabIndex={-1}
              aria-label="Canvas"
              className="h-full overflow-auto"
            >
              {children}
            </main>
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
  const [preferences, update] = usePreferences(resolvedStore);
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
            <p className="text-[color:var(--nx-builder-text-muted)] max-w-sm text-sm">
              Editing a layout needs at least {MIN_SHELL_WIDTH}px. On a smaller
              screen you can still edit this page&apos;s content from the admin.
            </p>
            <button
              type="button"
              onClick={props.onExit}
              className="border-[color:var(--nx-builder-border)] focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              Exit editor
            </button>
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
          <ShellRegions {...props} preferences={preferences} update={update} />
        </div>
      </TooltipProvider>
    </ShortcutProvider>
  );
}

export { DEFAULT_PREFERENCES };
