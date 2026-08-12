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

  const update = React.useCallback(
    (next: ShellPreferences) => {
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
  update: (next: ShellPreferences) => void;
}) {
  const regionRefs = React.useRef<Record<Region, HTMLElement | null>>({
    rail: null,
    panel: null,
    canvas: null,
    inspector: null,
  });
  useRegionCycling(regionRefs);

  const openPanel = preferences.leftPanel;

  const selectPanel = (panel: LeftPanel) =>
    update({
      ...preferences,
      leftPanel: panelAfterRailClick(openPanel, panel),
    });

  return (
    <div
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
          onLayoutChanged={layout => {
            update({ ...preferences, layout: { ...layout } });
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
  // Built once. A store rebuilt each render would make `usePreferences`'
  // callback identity change on every render, and the write effect with it.
  const [resolvedStore] = React.useState(() => store ?? browserStore());
  const [preferences, update] = usePreferences(resolvedStore);
  const fitsFullShell = useFitsFullShell();

  if (!fitsFullShell) {
    return (
      <div className="nx-builder-chrome flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
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
    );
  }

  return (
    <ShortcutProvider>
      {/* Provided here rather than required of the host: the rail's icon-only
          buttons are unreadable without their tooltips, so a shell that renders
          them depends on this and should not make it someone else's setup step.
          Radix nests providers safely — a host with its own keeps its delay. */}
      <TooltipProvider delayDuration={300}>
        <ShellRegions {...props} preferences={preferences} update={update} />
      </TooltipProvider>
    </ShortcutProvider>
  );
}

export { DEFAULT_PREFERENCES };
