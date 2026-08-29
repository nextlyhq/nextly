"use client";

import {
  Label,
  PortalProvider,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ShortcutProvider,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useShortcuts,
} from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import {
  Blocks,
  Braces,
  FileText,
  Layers,
  Palette,
  Plus,
  Settings,
  Type,
} from "lucide-react";
import * as React from "react";

import {
  BuilderNoticeRegion,
  NoticeSinkProvider,
  useNoticeQueue,
} from "./builder-notices";
import type { CanvasZoom } from "./canvas-zoom";
import { CanvasZoomControl } from "./canvas-zoom-control";
import { devWarnOnce } from "./dev-warn";
import {
  BUILDER_CHROME_CLASS,
  DEFAULT_PREFERENCES,
  EMPTY_ELEMENTS_ATTRIBUTE,
  browserStore,
  fitsFullShell,
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
  classes: { label: "Classes", Icon: Braces },
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
   * The rail always shows every panel, because the set is the editor's shape
   * and hiding the unbuilt ones would make the chrome change under an author
   * as features land. What it must not do is OPEN one nothing renders into: that
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
  /**
   * Opens a panel from OUTSIDE the shell, once per distinct count.
   *
   * The rail is normally the only way to change which panel is open, and its
   * own click handler is a TOGGLE — pressing an already-open panel's item
   * closes it. A control drawn on the canvas itself (the empty-container
   * appender) needs the opposite contract: pressing it must show the insert
   * panel whether or not it is already open, and pressing it again for a
   * DIFFERENT empty container must show it again even if the author closed it
   * by hand in between.
   *
   * A plain boolean or a bare panel name cannot express "again" — the second
   * press would carry the same value as the first, and an effect keyed on it
   * would never re-run. A counter the caller bumps on every press is the same
   * shape {@link PreferencesLoad.count} below has: not the state itself, but a
   * count of how many times the thing behind it happened.
   *
   * The panel travels WITH the count rather than in a second prop. One caller
   * asking for insert and another for tokens are the same request with a
   * different subject, and two props would be two answers to one question —
   * free to disagree about which panel a given count refers to.
   *
   * Left `undefined` this does nothing, which is what every host that has no
   * such control gets by default.
   */
  openPanelRequest?: { readonly panel: LeftPanel; readonly count: number };
  /**
   * Reports `showEmptyElements` to a host that needs to know whether the
   * canvas's empty-container chrome should be showing right now.
   *
   * The preference lives entirely inside this shell — see `store` below —
   * and a caller drawing a SEPARATE overlay over the same canvas (the
   * empty-container appender, mounted through `Canvas`'s own `overlay` prop
   * rather than through this component's internals) has no way to reach it.
   * This is the read half of that gap; `openPanelRequest` above is the
   * write half of a different one.
   *
   * Called for every value the preference takes, including the very first
   * one: a host that waited for a change would have no answer at all until
   * the author touched the control, and would have to guess the default in
   * the meantime — a guess that silently goes stale the day the default
   * changes here and not at every call site that duplicated it.
   */
  onShowEmptyElementsChange?: (showEmptyElements: boolean) => void;
  /**
   * Reports the canvas zoom, and takes the change back.
   *
   * The shell owns it because the shell owns preferences, and a host owns what
   * to DO with it — the canvas is the host's to render, so only it can apply a
   * scale. Reported the same way `showEmptyElements` is, including on the first
   * value, so a host never has to assume the default.
   */
  onZoomChange?: (zoom: CanvasZoom) => void;
  /**
   * The scale the canvas is actually painting at, for the zoom control.
   *
   * Travels UP because only the canvas can know it — while fitting it is
   * derived from a region the canvas measures — and the canvas is the host's to
   * render. The zoom itself travels DOWN, because this shell owns preferences
   * and therefore owns the choice.
   *
   * One direction each is the whole design. Holding the zoom on both sides and
   * syncing them is what produced an oscillating write of `fit, 2, fit, 2` on
   * every open: two owners, each correcting the other.
   */
  appliedScale?: number;
  /** The canvas. The shell never looks inside it. */
  children?: React.ReactNode;
  /** The inspector's contents. */
  inspector?: React.ReactNode;
  /** Rendered into the top bar, between the page menu and the actions. */
  topBar?: React.ReactNode;
  /** The ancestor breadcrumb, along the bottom bar. */
  breadcrumb?: React.ReactNode;
  /**
   * A card floated over the canvas — the getting-started checklist today.
   *
   * Positioned by the shell rather than passed through `Canvas.overlay`,
   * because that overlay lives in the canvas's own content coordinates and
   * would scroll away with the page. This one belongs to the editor's chrome
   * and stays where it is put.
   */
  checklist?: React.ReactNode;
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

const STORAGE_KEY = "nextly.builder.shell";

/**
 * Whether the shell's own CONTAINER can carry the full layout, as it changes.
 *
 * The container rather than the viewport, because that is what the shell sizes
 * to — `h-full w-full`, no viewport units anywhere. The two agree only when the
 * shell happens to fill the window, so an editor embedded in a narrow column on
 * a wide display was told it fitted and compressed its regions past their
 * minimums.
 *
 * Starts as `true` on purpose. The alternative is measuring during render,
 * which the server cannot do — it would emit the narrow-viewport message and the
 * client would replace it, a hydration mismatch on every desktop load. Assuming
 * the supported case and correcting after mount makes both first renders
 * identical.
 */
function useFitsFullShell(): [(node: HTMLElement | null) => void, boolean] {
  const [fits, setFits] = React.useState(true);
  const observer = React.useRef<ResizeObserver | null>(null);

  /*
   * A CALLBACK ref, not an effect over a `useRef`.
   *
   * The observed element is REPLACED when the answer flips — the notice and the
   * shell root are different nodes, and only one of them is on screen at a time
   * — so an effect keyed on mount would observe whichever rendered first and go
   * on observing it after React swapped it out.
   */
  const measure = React.useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (node === null) return;
    // jsdom implements no `ResizeObserver`. Falling back to `fits` rather than
    // to a notice matches the initial state's reasoning: a shell that cannot
    // measure renders fully rather than showing a message it has no evidence
    // for.
    if (typeof ResizeObserver === "undefined") {
      setFits(true);
      return;
    }
    const next = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      if (entry === undefined) return;
      // The CONTENT box of the measuring wrapper, which is by construction the
      // space the regions are laid out in.
      //
      // Two properties make that the right quantity, and both are easy to lose:
      //
      // The wrapper carries the caller's `className` and nothing else, so its
      // content box is the space INSIDE whatever padding or border the host
      // applied — decoration the regions never receive. A border box would
      // report a 1280px root with `p-6` as fitting while leaving 1232px to lay
      // out in.
      //
      // It is also the SAME element whichever branch renders, so no branch's
      // own padding can move the threshold. The notice is `p-6` and sits inside
      // this box, where it is invisible to the measurement; measuring a branch
      // instead would make the answer depend on which one happened to be up.
      //
      // `contentRect` rather than `getBoundingClientRect`: both are layout
      // sizes, so a transformed ancestor — this editor has canvas zoom — does
      // not scale the number against a minimum expressed in CSS pixels.

      // The comparison itself comes from `shell-state`, which exports and tests
      // it. Repeating `>= MIN_SHELL_WIDTH` here would be a second answer to one
      // question, and the two would first disagree exactly at the boundary the
      // helper's tests pin.
      setFits(fitsFullShell(entry.contentRect.width));
    });
    next.observe(node);
    observer.current = next;
  }, []);

  React.useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    []
  );

  return [measure, fits];
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
 * What the newest completed read of a preference store left behind.
 *
 * TWO fields because there are two different questions downstream, and one
 * value cannot answer both:
 *
 * - `count` answers "has a NEW record arrived", which is what a remount is
 *   keyed on. Any read qualifies: the panel group has to re-register against
 *   whatever layout landed, whoever it belongs to.
 * - `store` answers "whose record is `preferences` holding right now", which is
 *   what any guard protecting a WRITE needs. The count cannot answer it — it is
 *   monotonic, so it is already nonzero for the previous store the moment a host
 *   swaps in a new one, and a write let through in that window spreads the old
 *   store's record and persists it into the new store, replacing the layout and
 *   the `showEmptyElements` of whichever user or workspace the new store belongs
 *   to.
 *
 * `store` is the store OBJECT rather than a name or an index, for the reason
 * the identity is already the read's dependency: it is the thing itself, and no
 * two live stores can compare equal without being the same store.
 *
 * `null` is the state before any read has completed, and it is deliberately not
 * a fourth thing to test for: every caller compares this against the store it
 * is about to act on, and `null` is not any store, so "no read yet" and "a
 * different store's read" answer alike without either being spelled out.
 */
interface PreferencesLoad {
  readonly count: number;
  readonly store: PreferenceStore | null;
}

/** Before any read has reached state. */
const NO_LOAD: PreferencesLoad = { count: 0, store: null };

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
  const [load, setLoad] = React.useState<PreferencesLoad>(NO_LOAD);

  React.useEffect(() => {
    const restored = readPreferences(store);
    // Compared before setting so a host with no stored preferences does not
    // take a second render for a value that did not change.
    setPreferences(current =>
      shallowEqualPreferences(current, restored) ? current : restored
    );
    // Set in the SAME effect as the preferences it describes, which is what
    // makes `store` below an honest account of whose record `preferences`
    // holds: React applies both updates in one commit, so no render can see
    // one without the other.
    setLoad(current => ({ count: current.count + 1, store }));
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

  /*
   * The store-specific answer is derived HERE rather than handed out for a
   * caller to work out, because the comparison is only sound against the same
   * store the read was keyed on — and that is this argument. Returning
   * `load.store` instead would leave every caller re-deriving it, and a caller
   * holding a different store variable (the shell resolves a fallback of its
   * own) would compare the wrong pair while looking correct.
   */
  return [preferences, update, load.count, load.store === store] as const;
}

/**
 * Whether two preference records say the same thing.
 *
 * EVERY field has to be compared here, because this is what the restore
 * effect gates on: a field missing from this function reads as "unchanged"
 * for any two records that differ only in it, so a stored non-default value
 * for that field is silently dropped on mount whenever the rest of the record
 * already matches the default — which a fresh session with nothing else
 * customised does by construction.
 *
 * The layout is compared by its entries rather than by identity: `readPreferences`
 * builds a fresh object every call, so identity is always false and the restore
 * effect would set state on every mount even when nothing changed.
 */
/** Whether two zooms mean the same thing, which is not object identity. */
function sameZoom(a: CanvasZoom, b: CanvasZoom): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "fixed" && b.kind === "fixed" ? a.scale === b.scale : true;
}

function shallowEqualPreferences(
  a: ShellPreferences,
  b: ShellPreferences
): boolean {
  if (
    a.leftPanel !== b.leftPanel ||
    a.leftPinned !== b.leftPinned ||
    a.showEmptyElements !== b.showEmptyElements ||
    !sameZoom(a.zoom, b.zoom)
  ) {
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
 * How many shells are ACTIVE right now — mounted and wide enough to be used.
 *
 * Read only to decide whether "focus is nowhere in particular" identifies a
 * shell unambiguously. With one usable editor on the page it does; with several
 * it does not, and the tie has to be declined rather than won by whichever
 * registered last.
 *
 * Active rather than merely mounted, and that distinction only became
 * observable once each shell measured its OWN container: siblings in columns of
 * different widths can now disagree about whether they fit, so a form can hold
 * one usable editor beside several showing their narrow notices. Counting every
 * mount there makes the one editor that CAN answer decline, because it sees
 * more than one — and the others decline too, since their binding is disabled.
 * F6 would reach nothing at all. A shell behind its notice is not a candidate
 * for the key, so it is not part of the ambiguity either.
 */
let activeShells = 0;

function useActiveShellCount(active: boolean): () => number {
  React.useEffect(() => {
    if (!active) return;
    activeShells += 1;
    return () => {
      activeShells -= 1;
    };
  }, [active]);
  return () => activeShells;
}

/**
 * Whether THIS shell should act on F6 right now.
 *
 * The binding is registered on the document, so on a page holding a shell
 * beside other controls — the field mount, embedded in an entry form — every
 * shell sees every press. Eligibility therefore cannot come from viewport
 * state alone: with several page-builder fields in one form, all of them were
 * eligible at once and the most recently registered answered, which moved
 * focus into an editor the author was not in.
 *
 * Ownership is asked of the shell ROOT, not of the regions. The two are
 * different questions and only look like one: the root answers "is the author
 * inside this editor", while the region list answers "where can cycling land".
 * The chrome header — the exit button and whatever the host puts in the top
 * bar — is inside the editor and inside no region, so asking the regions
 * rejected the shell whenever focus was on one of those controls and left F6
 * doing nothing from the very chrome it belongs to.
 *
 * The `document.body` case is what keeps the key working from a cold page: the
 * full Edit view owns its page and nothing inside it has focus yet, and
 * refusing there would make F6 look broken until focus happened to land
 * somewhere it recognised. It is allowed only while this is the sole shell,
 * because with more than one the press names none of them.
 */
function shellClaimsRegionCycling(
  root: HTMLElement | null,
  shellCount: number
): boolean {
  const active = document.activeElement;
  if (root?.contains(active)) return true;
  // `null` as well as `body`: a document that has never been clicked reports
  // no active element at all in some engines, which is the same "nowhere".
  const nowhere = active === null || active === document.body;
  return nowhere && shellCount === 1;
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
  rootRef: React.RefObject<HTMLElement | null>,
  enabled: boolean
): void {
  const shellCount = useActiveShellCount(enabled);
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
        //
        // Focus is consulted for the same reason it is passed on: a shell the
        // author is not in should let the key reach whatever they ARE in.
        when: () =>
          enabledRef.current &&
          shellClaimsRegionCycling(rootRef.current, shellCount()),
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
  appliedScale = 1,
  onZoomPick,
  renderPanel,
  availablePanels,
  children,
  inspector,
  topBar,
  breadcrumb,
  checklist,
  onExit,
  preferences,
  update,
  className,
  active,
  loadCount,
}: Omit<BuilderShellProps, "store"> & {
  /** The zoom picker, or absent where the host wired none. */
  onZoomPick: ((next: CanvasZoom) => void) | undefined;
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
   *
   * ANY load, deliberately — unlike the write guard on the token effect, which
   * has to know WHOSE record arrived. A remount is a response to a new layout
   * being on screen, and the panels have to re-register against it whichever
   * store produced it: the swap that makes a count useless for deciding a write
   * is exactly a case that must remount. So the count and the identity are two
   * separate answers rather than one this could share.
   */
  loadCount: number;
}) {
  const regionRefs = React.useRef<Record<Region, HTMLElement | null>>({
    rail: null,
    panel: null,
    canvas: null,
    inspector: null,
  });
  // Declared before the hook that reads it: `chromeRef` is the shell's own root
  // element, which is what decides whether the author is inside this editor at
  // all — the chrome header sits outside every region but inside this.
  const chromeRef = React.useRef<HTMLDivElement | null>(null);
  useRegionCycling(regionRefs, chromeRef, active);
  const onKeyDownCapture = useSeparatorRegionEscape(regionRefs, active);
  useDesignSystemStylesheet(chromeRef);
  // Pairs the header's visibility-toggle label with its switch. Generated
  // rather than a literal so two shells mounted on one page — unlikely, but
  // nothing here forbids it — cannot collide on the same id.
  const emptyElementsToggleId = React.useId();

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
        BUILDER_CHROME_CLASS,
        "flex h-full w-full flex-col overflow-hidden",
        className
      )}
      // Absent when empty containers are shown, which is the default. A state
      // name rather than a boolean attribute so the shown case needs nothing
      // written: a rule that depended on an attribute being present would
      // silently stop applying anywhere the shell had not written one yet.
      {...(preferences.showEmptyElements
        ? {}
        : { [EMPTY_ELEMENTS_ATTRIBUTE]: "hidden" })}
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
        {/*
         * The only reachable control for `showEmptyElements` — before this it
         * changed only by an author editing storage by hand. Lives on the
         * shell's own chrome rather than inside a switched panel, because it
         * has to stay visible whichever panel is open or closed, and because
         * it is this component's own state rather than a slot a host fills.
         *
         * A labelled switch rather than an icon: the control governs a
         * VISIBILITY affordance, and one an author cannot read at a glance
         * would repeat the exact failure this feature exists to fix.
         */}
        <Label
          htmlFor={emptyElementsToggleId}
          className="text-[color:var(--nx-builder-text-muted)] shrink-0"
        >
          Show empty containers
          <Switch
            id={emptyElementsToggleId}
            checked={preferences.showEmptyElements}
            onCheckedChange={checked =>
              update(current => ({ ...current, showEmptyElements: checked }))
            }
          />
        </Label>
        {/*
          Rendered by the shell, not handed to the host as a slot, because the
          shell owns preferences and this control edits one. A host drawing its
          own would hold the value in a second place, and the two would correct
          each other on every open.

          Only where the host has WIRED it, though. The canvas belongs to the
          host, so without `onZoomChange` there is nothing to apply a choice to:
          the control would store a preference, report a percentage the canvas
          does not honour, and read 100% whatever was picked. A shell that
          predates this — the README example and the playground harness among
          them — should gain no control rather than a dead one.
        */}
        <CanvasZoomControl
          zoom={preferences.zoom}
          appliedScale={appliedScale}
          onChange={onZoomPick}
        />
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
              {/* Named for what it DIVIDES rather than for itself. A keyboard
                  user lands here between two regions and hears its position;
                  "Panel and canvas" is what makes the position mean something.
                  The panel side is named by its role rather than by which
                  panel is open, because the name would otherwise change under
                  a user who is standing on it. */}
              <ResizableHandle withGrip aria-label="Panel and canvas" />
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
            <div className="relative h-full">
              <section
                ref={element => {
                  regionRefs.current.canvas = element;
                }}
                /*
                 * `0`, not `-1`. This region SCROLLS, and nothing inside it is
                 * focusable — blocks are selected by pointer, not by tab — so
                 * at `-1` a keyboard user could not scroll the canvas at all.
                 * Programmatically focusable was enough for F6 region cycling
                 * and not enough to read the page.
                 */
                tabIndex={0}
                aria-label="Canvas"
                className="h-full overflow-auto"
              >
                {children}
              </section>
              {checklist === undefined ? null : (
                // The positioner takes no pointer events, so it cannot swallow
                // a click aimed at the page underneath it; the card itself
                // takes them back.
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end p-4">
                  <div className="pointer-events-auto">{checklist}</div>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withGrip aria-label="Canvas and inspector" />

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

      {/*
        No `aria-label`. A `<footer>` nested inside a section is `generic`, and
        `aria-label` is PROHIBITED on that role — so the name was not announced
        and the element was invalid. Nothing is lost: the breadcrumb inside
        names itself ("Selected block's ancestors"), which is the thing a
        reader actually lands on.
      */}
      <footer className="border-[color:var(--nx-builder-border)] text-[color:var(--nx-builder-text-muted)] flex h-8 shrink-0 items-center gap-2 border-t px-3 text-xs">
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
 * merely gets cramped is worse than one that says it needs more width — the
 * author otherwise discovers the limit by failing at a task.
 *
 * @experimental
 */
export function BuilderShell({
  store,
  openPanelRequest,
  onShowEmptyElementsChange,
  onZoomChange,
  appliedScale = 1,
  ...props
}: BuilderShellProps) {
  // The browser store is built once: rebuilt each render it would change
  // `usePreferences`' callback identity every render, and the write effect with
  // it. Only the FALLBACK needs that treatment though. Capturing the caller's
  // `store` alongside it pinned whichever one arrived first, so a host that
  // swaps stores — signing into a second workspace, promoting a memory store to
  // a persisted one — went on reading and writing the store it had replaced.
  const fallbackStore = React.useRef<PreferenceStore | null>(null);
  fallbackStore.current ??= browserStore(STORAGE_KEY);
  const resolvedStore = store ?? fallbackStore.current;
  const [preferences, update, loadCount, loadedFromCurrentStore] =
    usePreferences(resolvedStore);
  const [measureShell, shellFits] = useFitsFullShell();

  /*
   * Applies an `openPanelRequest` change AT MOST ONCE — a ref rather than
   * state, because recording that a token was handled is not itself something a
   * re-render should follow from.
   *
   * The ref deliberately survives a store swap. A token already applied belongs
   * to the session the author pressed the control in, so re-applying it to the
   * store that replaced it would open a panel nobody asked this store for.
   *
   * FORCES `leftPanel` to `"insert"` rather than routing through
   * `panelAfterRailClick`: that helper TOGGLES, and toggling is exactly wrong
   * for a control whose contract is "show the panel this fills" — never
   * "close it if it happens to already be open", which is what a second rail
   * click on the same item means.
   *
   * No availability check against `availablePanels` here: `ShellRegions`
   * below already normalises `preferences.leftPanel` against it when deriving
   * the panel it actually renders, so a request naming a panel the host
   * cannot fill is absorbed there rather than needing a second check here.
   */
  const handledPanelRequest = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (openPanelRequest === undefined) return;
    /*
     * Nothing is applied until THIS store's read has landed, and that ordering
     * is the whole of this guard.
     *
     * `update` takes the newest preferences this hook has seen and writes the
     * result straight back through the store it currently holds. Reading a
     * store is itself an effect, so in the commit a store first arrives in it
     * has only SCHEDULED that store's record — what `update` would spread here
     * is still whatever `preferences` held before. Both ways that happens end
     * in a write of the wrong record:
     *
     * - at MOUNT, `preferences` is `DEFAULT_PREFERENCES`, so a token defined on
     *   the first render persists the defaults over the author's own panel
     *   widths and `showEmptyElements`.
     * - after a store SWAP — signing into a second workspace, promoting a
     *   memory store to a persisted one — `preferences` is the PREVIOUS store's
     *   record, so a token arriving in the same render writes one user's or
     *   workspace's saved layout into another's.
     *
     * Either way the panel the token asked for opens and looks entirely
     * correct, which is what makes the write invisible until the next load.
     *
     * So the arrival this waits on is store-specific rather than "some read has
     * happened": a COUNT of reads is already nonzero for the outgoing store at
     * the moment of a swap, which is precisely the window the second case sits
     * in. Once it is true, it stays true for as long as the store does — a read
     * cannot fail (`readPreferences` answers with the defaults for unreadable
     * or malformed storage) and one that remembers nothing still answers — so
     * this delays a token by a single render and can never hold one
     * indefinitely. A token arriving any later than that render applies in the
     * same flush it arrived in.
     */
    if (!loadedFromCurrentStore) return;
    if (handledPanelRequest.current === openPanelRequest.count) return;
    handledPanelRequest.current = openPanelRequest.count;
    const panel = openPanelRequest.panel;
    update(current => ({ ...current, leftPanel: panel }));
  }, [openPanelRequest, update, loadedFromCurrentStore]);

  /*
   * The read half of the same gap: told on every value `showEmptyElements`
   * takes, including the first, so a host answers "should my own overlay be
   * showing" honestly from the start rather than assuming the default and
   * drifting from it the day that default changes here.
   *
   * No once-per-value guard here, unlike the token above. Reporting the same
   * value twice is calling the host back with information it already has —
   * inert, not incorrect — where applying the SAME token twice would have
   * been a second unwanted forced-open.
   */
  // Held in a ref rather than read straight from the prop. A host passing the
  // conventional inline callback — `value => setState(c => ({ ...c, value }))`
  // — hands this a NEW function identity on every one of its own renders, and
  // that identity was a dependency here: the effect re-ran even though
  // `showEmptyElements` had not changed, called the callback again, and a host
  // whose state update itself triggers a re-render — an ordinary spread
  // creates a new object every time, whether or not any field actually
  // differs — closes that into a render loop. The ref always holds the latest
  // callback without needing to be a dependency, so the effect below runs only
  // when the PREFERENCE changes.
  const onShowEmptyElementsChangeRef = React.useRef(onShowEmptyElementsChange);
  React.useEffect(() => {
    onShowEmptyElementsChangeRef.current = onShowEmptyElementsChange;
  });
  React.useEffect(() => {
    onShowEmptyElementsChangeRef.current?.(preferences.showEmptyElements);
  }, [preferences.showEmptyElements]);
  /*
   * A zoom chosen outside this shell, stored here.
   *
   * Compared by VALUE rather than by object identity: a host rebuilding the
   * object each render — which the conventional inline handler does — would
   * write preferences on every render, and every write reports back out, which
   * is a loop rather than a preference.
   */
  /*
   * The zoom picker, resolved here rather than where it is drawn.
   *
   * `undefined` when the host has wired nothing, which is what makes the
   * control render nothing — see its own documentation for why a dead one is
   * worse than none. Deciding it at the render site put the branch inside a
   * region that is already the largest function in this file.
   */
  const onZoomPick = React.useMemo(
    () =>
      onZoomChange === undefined
        ? undefined
        : (next: CanvasZoom) => update(current => ({ ...current, zoom: next })),
    [onZoomChange, update]
  );

  /*
   * The zoom, held and reported the same way and for the same reasons, plus
   * one the value above does not have: whether a listener EXISTS is itself a
   * dependency.
   *
   * A host can resolve `onZoomChange` from its own state, so the prop moves
   * from `undefined` to a callback after the first render. Keyed on the value
   * alone, the effect would not re-run at that moment and the host would carry
   * the default zoom until the author happened to pick another — its canvas
   * drawn at a scale the control does not claim.
   */
  const onZoomChangeRef = React.useRef(onZoomChange);
  React.useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  });
  const reportingZoom = onZoomChange !== undefined;
  React.useEffect(() => {
    onZoomChangeRef.current?.(preferences.zoom);
  }, [reportingZoom, preferences.zoom]);

  /*
   * Where overlays inside this shell portal to. State rather than a ref,
   * because `PortalProvider` has to RE-RENDER once the node exists; a ref
   * mutation would leave the provider holding `null` for the life of the mount.
   */
  const [overlayHost, setOverlayHost] = React.useState<HTMLDivElement | null>(
    null
  );
  /*
   * Reports from controls that could not make one themselves. Owned at this
   * level because it must survive everything below it being unmounted, which
   * is exactly what the inspector's per-node keys do on every selection change.
   */
  const notices = useNoticeQueue();

  return (
    <ShortcutProvider>
      {/* Provided here rather than required of the host: the rail's icon-only
          buttons are unreadable without their tooltips, so a shell that renders
          them depends on this and should not make it someone else's setup step.
          Radix nests providers safely — a host with its own keeps its delay. */}
      <TooltipProvider delayDuration={300}>
        {/*
         * THE measured element, and the only one.
         *
         * Always rendered, whichever branch is showing, so it always has a box
         * to measure — which is what makes the decision reversible. Observing a
         * branch instead made the answer depend on that branch's own padding
         * and, in the editor's case, on a wrapper that is `display: contents`
         * when visible and `hidden` when narrow and therefore reports 0.
         *
         * It carries the caller's `className` and nothing else of its own, so
         * its CONTENT box is the space inside whatever padding, border or grid
         * area the host gave the shell — which is precisely the space its
         * children have to lay out in. Both branches are sized from it rather
         * than from the host directly, so neither can disagree with the
         * measurement.
         */}
        <div
          ref={measureShell}
          className={cn("h-full w-full", props.className)}
        >
          {!shellFits ? (
            <div
              // No caller `className` here: the wrapper above owns the host's
              // positioning now, and repeating it would apply a grid area or a
              // border twice.
              className={cn(
                BUILDER_CHROME_CLASS,
                "flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center"
              )}
            >
              {/*
               * Worded as WIDTH rather than as a screen, because the shell
               * measures the space it was given. An editor embedded in a narrow
               * column on a large display is the case that named the wrong
               * cause: the author's screen is fine and widening it changes
               * nothing.
               */}
              <p className="text-sm font-medium">
                The page editor needs more width
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
                    Editing a layout needs at least {MIN_SHELL_WIDTH}px of
                    width. In a narrower space you can still edit this
                    page&apos;s content from the admin.
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
                  Editing a layout needs at least {MIN_SHELL_WIDTH}px of width.
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
            hidden={!shellFits}
            inert={!shellFits}
            // `display: contents` while visible, so this wrapper adds no box of
            // its own and the shell keeps sizing against the caller's container.
            // Omitted while hidden, where the `hidden` attribute's own
            // `display: none` has to be the one that applies.
            className={shellFits ? "contents" : undefined}
          >
            {/* Published as context as well as applied as attributes, because `hidden` and `inert`
              only reach what renders INSIDE this wrapper. Slot content that reads this answers for
              itself; content that PORTALS is contained by `overlayHost` below instead. */}
            <ShellActiveContext.Provider value={shellFits}>
              {/*
               * Overlays portal to a host INSIDE the inert wrapper, so `hidden`
               * and `inert` reach them.
               *
               * A portalled dropdown is not a descendant of the region that
               * opened it, so neither attribute could ever reach it: an open
               * `Select` stayed visible and clickable on top of the notice
               * saying the editor was unavailable. Redirecting the portal is a
               * boundary rather than a rule each control has to remember, which
               * matters because the set of portalling components is open ended
               * and the next one added would not know to check.
               *
               * WHERE it sits is the whole design, and two placements are wrong
               * for different reasons. Inside a region clips it: the panel, the
               * canvas and the inspector are each `overflow-auto`, so a dropdown
               * opened near a panel edge would be cut off — a silent visual
               * failure, worse than the interactive one being fixed. Inside the
               * shell ROOT is also wrong, because that root is
               * `overflow-hidden`. Here it is a sibling of the shell root:
               * within the element carrying `hidden`/`inert`, and outside every
               * box that clips.
               *
               * Taken out of flow so it can never affect the layout it sits
               * beside. It stays a DOM descendant of the inert wrapper, which is
               * what `inert` follows, and nothing here creates a containing
               * block, so the fixed-position content each overlay renders is
               * still positioned against the viewport.
               */}
              <div
                ref={setOverlayHost}
                data-slot="builder-overlay-host"
                className="absolute h-0 w-0"
              />
              {/*
               * `null` until the host mounts, which `usePortalContainer` reads
               * as "use the default". That is one commit of the old behaviour
               * rather than a crash, and no overlay can be open that early.
               */}
              <PortalProvider container={overlayHost}>
                {/*
                 * Failures raised by a control that has since been unmounted.
                 *
                 * Held HERE because nothing in the shell is keyed by the
                 * selected node, while the style inspector's class selector is
                 * — so a site-style write that fails after the author clicks
                 * another block resolves into a component that no longer
                 * exists. This one outlives every such key.
                 *
                 * Taken out of flow rather than placed above the regions. The
                 * layout above sizes the editor against the caller's container
                 * and the wrapper between is `display: contents`; a new box in
                 * that flow would change what every region measures, to carry a
                 * surface that is empty almost always.
                 */}
                <BuilderNoticeRegion
                  notices={notices.notices}
                  onDismiss={notices.dismiss}
                />
                {/* Wraps the regions rather than sitting beside them: the
                    inspector and the panels are `ReactNode` props, so they
                    become descendants of this provider by being RENDERED here,
                    wherever the host created them. */}
                <NoticeSinkProvider raise={notices.raise}>
                  <ShellRegions
                    appliedScale={appliedScale}
                    onZoomPick={onZoomPick}
                    {...props}
                    preferences={preferences}
                    update={update}
                    active={shellFits}
                    loadCount={loadCount}
                    /*
                     * The caller's `className` stops here: the measuring wrapper
                     * above carries it. Passing it on would apply the host's grid
                     * area, height or border a second time, on a box nested inside
                     * the one already carrying it.
                     */
                    className={undefined}
                  />
                </NoticeSinkProvider>
              </PortalProvider>
            </ShellActiveContext.Provider>
          </div>
        </div>
      </TooltipProvider>
    </ShortcutProvider>
  );
}

export { DEFAULT_PREFERENCES };
