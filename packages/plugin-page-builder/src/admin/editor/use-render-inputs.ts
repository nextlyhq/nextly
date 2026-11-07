/**
 * What the canvas draws with, and the readings the inspector and the spacing
 * handles take from the same inputs: the site's style, the render context,
 * the frame's width and zoom, the interaction state shown, and the cascade.
 *
 * Every reading here is derived from one context the canvas is compiled
 * under, never assembled a second time beside it.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/use-render-inputs
 */
import {
  allBlocks,
  BASE_BREAKPOINT,
  registryNestingSource,
  getBlock,
  paginatedList,
  visitorUnreadableBindings,
  type BlockDocument,
  type BreakpointId,
  type StyleState,
  type StyleCompileContext,
  type RemotePattern,
  type BreakpointSet,
  type BindingSchemaRef,
  type DefinitionsById,
  type VisitorUnreadableBinding,
} from "@nextlyhq/blocks-engine";
import {
  noPublicFields,
  prepareDocumentForRead,
  registeredBlocks,
  type BlocksFieldShapes,
  type PageBindings,
  type PageStyleCascade,
} from "@nextlyhq/blocks-react";
import {
  DEFAULT_PREFERENCES,
  fallbackBreakpoint,
  registrySlotSource,
  slotsShowingEmpty,
  type SlotSource,
} from "@nextlyhq/builder";
import {
  breakpointsAtWidth,
  DESKTOP_PREVIEW_WIDTH,
  editingBreakpointOf,
  pageStyleTrace,
  previewWidth,
  selectionIsInspectable,
  useCanvasDrag,
  type CanvasDrag,
  type CanvasZoom,
  type PageClassBlocks,
  type SpacingScrubContext,
} from "@nextlyhq/builder/shell";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
  type RefObject,
  type Dispatch,
} from "react";

import { classUsageOf } from "../../class-usage";
import { withBlockLooks } from "../../core-looks";
import {
  hostFetchPolicy,
  readRemotePatterns,
  type HostFetchPolicy,
} from "../../host-policy";
import { siteSheet, type SiteStyleData } from "../../site-style";
import { readSiteStyleRecord } from "../../site-style-record";
import { useCanvasBindings } from "../canvas-bindings-client";
import { pageRenderInputs, type PageRenderInputs } from "../page-render-inputs";
import { useSiteStyle } from "../site-style-client";
import { useStoredSiteStyle } from "../site-style-read";

import { useCanvasPageContext } from "./canvas-page-context";
import { useSharedStyleVerb, type SharedStyleVerb } from "./shared-style-verb";
import { useSiteCanvas, type SiteCanvas } from "./site-canvas";
import {
  useBreakpointWriter,
  useClassSurface,
  type ClassSurface,
} from "./site-style-studios";
import type { EditorMount } from "./use-editor-mount";

/**
 * The interaction state to SHOW, given the state being edited and how many
 * blocks are selected.
 *
 * Suppressed rather than reset whenever the switcher is not on screen. The
 * inspector replaces its whole tab strip — for a multi-selection, and for a
 * selection it cannot inspect at all — so the state control goes with it, and
 * the panel's own tab handler cannot catch either case because the stored tab
 * value is still `style` and no tab change happens. A forced state outliving
 * its control is a canvas drawn mid-hover with nothing on screen explaining
 * why.
 *
 * Decides WHETHER THE CONTROL IS THERE rather than taking a selection count,
 * because a count cannot see the second case: an unregistered block type reads
 * as one ordinary selection while the panel shows no tabs for it. The
 * inspectability half is asked of the same predicate the panel's own early
 * return uses, so the two cannot disagree about what is inspectable.
 *
 * Derived rather than written back, so the author's choice SURVIVES: they
 * shift-click a second block, the canvas returns to the normal appearance, and
 * clicking back to one block restores the state they were editing. Writing
 * `base` into the state instead would silently discard it.
 */
function shownStyleStateFor(
  editing: StyleState,
  document: BlockDocument,
  selectedIds: readonly string[],
  selectedId: string | null
): StyleState {
  const switcherIsOnScreen =
    selectedIds.length <= 1 && selectionIsInspectable(document, selectedId);
  return switcherIsOnScreen ? editing : "base";
}

/**
 * The site's style as the editor reads it: the host's config defaults, the
 * stored tier merged over them, the class surface over that, the hosts media
 * may come from, and the writer for the breakpoints.
 */
export function useSiteStyleInputs(
  clientConfig: EditorMount["clientConfig"]
): SiteStyleInputs {
  /*
   * The site style the canvas draws with: the host's config DEFAULTS, already
   * resolved by the plugin factory and delivered as plain data. Narrowed with
   * the same checks the server writes by, so a malformed value degrades to
   * the empty style (block defaults and the engine's guaranteed tokens)
   * rather than crashing the editor.
   *
   * BOTH tiers, which is what makes the canvas a preview of the published page
   * rather than of the repository. The defaults are the host's code-stated
   * design, delivered as plain data; the stored tier is what an admin saved,
   * read through the same client every style studio uses and merged by
   * `resolveSiteStyle` — the one place those two meet, on the server and here
   * alike. Drawing from the defaults alone showed an author a page that
   * differed from the live one at exactly the properties someone had
   * deliberately overridden.
   *
   * A save re-renders this without anything being told to: the studios and this
   * canvas read one query, so the cache update IS the propagation. There is no
   * preview channel to keep in step because there are not two sources to keep
   * in step.
   */
  // With every registered block's looks, other plugins' among them: the
  // published config is a copy taken before those blocks registered, so the
  // editor reads them from its own registry, by the same rule the server does.
  const configSiteStyle = useMemo(
    () =>
      withBlockLooks(readSiteStyleRecord(clientConfig?.siteStyle), allBlocks()),
    [clientConfig]
  );
  const {
    siteStyle: canvasSiteStyle,
    stored: storedSiteStyle,
    unreadableFonts: unreadableStoredFonts,
    pending: siteStylePending,
    error: siteStyleError,
    current: siteStyleCurrent,
  } = useSiteStyle(configSiteStyle);

  // The site-style half of the class surface. The node half stays with the
  // inspector, which already writes nodes — see `useClassSurface`.
  const classes = useClassSurface(
    canvasSiteStyle,
    siteStylePending,
    siteStyleError,
    configSiteStyle
  );

  /*
   * The hosts this site loads media from, read back from the same client
   * config the plugin published them on.
   *
   * ONE read for TWO surfaces below, because the canvas and the inspector
   * enforce the same rule at different moments — the canvas when it draws a
   * block's image, the inspector when it judges a style value at the
   * keystroke — and a second read here would be a second chance to disagree
   * about what this site allows.
   *
   * `undefined` survives as `undefined` all the way to both consumers, which
   * is what leaves a site that configured nothing exactly as permissive as it
   * is today. `readRemotePatterns` is what keeps that distinction from
   * collapsing into an empty allowlist that would refuse every remote image.
   */
  const remotePatterns = useMemo(
    () => readRemotePatterns(clientConfig?.remotePatterns),
    [clientConfig]
  );

  /*
   * What the inspector judges a written URL by.
   *
   * Without this the Style tab asks the engine to validate a value with no
   * host policy, and absent means UNASKED rather than allowed — so a URL
   * naming a host this site does not load from is accepted at the keystroke,
   * previewed, and stored, then dropped by the published compiler, which does
   * apply the policy. The author sees a value that works while editing and
   * vanishes on the page.
   *
   * Carries only the host half today. The token half of `StylePolicy` arrives
   * with the client path to the stored site-style document; until then a token
   * reference is judged by the engine's own table.
   */
  const stylePolicy = useMemo(
    () => hostFetchPolicy(remotePatterns),
    [remotePatterns]
  );

  /*
   * Writing the site's breakpoints, for the manager in the top bar.
   *
   * Section-scoped, so this sends the breakpoints and nothing else — the other
   * three fields of the record are owned by other studios and are not read here
   * in order to write this one.
   *
   * The result is narrowed to the shape the dialog understands: `undefined` for
   * a save that landed, and the reason otherwise. The reasons are joined rather
   * than picked from, because `issues` is keyed by path and taking the first
   * would silently drop the others — an author told about one refused field
   * while a second is also refused fixes one and is refused again.
   */
  const saveBreakpoints = useBreakpointWriter(configSiteStyle);
  // Read again after a breakpoint removal, which writes the site style
  // through its own route rather than this editor's writes.
  const { refetch: rereadSiteStyle } = useStoredSiteStyle();
  const refreshSiteStyle = useCallback(() => {
    void rereadSiteStyle();
  }, [rereadSiteStyle]);

  return {
    configSiteStyle,
    canvasSiteStyle,
    storedSiteStyle,
    unreadableStoredFonts,
    siteStylePending,
    siteStyleError,
    siteStyleCurrent,
    classes,
    remotePatterns,
    stylePolicy,
    saveBreakpoints,
    refreshSiteStyle,
  };
}

/** The site's style as the editor reads it. */
export type SiteStyleInputs = {
  configSiteStyle: SiteStyleData;
  canvasSiteStyle: SiteStyleData;
  storedSiteStyle: SiteStyleData | undefined;
  unreadableStoredFonts: readonly string[];
  siteStylePending: boolean;
  siteStyleError: Error | null;
  /** Whether the stored style in hand is the site as it is now. */
  siteStyleCurrent: boolean;
  classes: ClassSurface;
  remotePatterns: readonly RemotePattern[] | undefined;
  stylePolicy: HostFetchPolicy;
  saveBreakpoints: (next: BreakpointSet) => Promise<string | undefined>;
  /** Read the stored site style again. */
  refreshSiteStyle: () => void;
};

/** The canvas's render context, as `useCanvasRender` returns it. */
type CanvasRender = {
  canvasRender: PageRenderInputs;
  classSummaryContext: StyleCompileContext;
};

/** Nothing marked: no sources read yet, or none of their shapes known. */
const NONE_UNREADABLE: ReadonlyMap<
  string,
  readonly VisitorUnreadableBinding[]
> = new Map();

/** The render context the canvas is compiled under, and what is read off it. */
function useCanvasRender({
  clientConfig,
  documentLimits,
  componentLibrary,
  canvasSiteStyle,
  stylePolicy,
  editor,
  locale,
  initialDocument,
}: Pick<
  EditorMount,
  | "clientConfig"
  | "documentLimits"
  | "componentLibrary"
  | "editor"
  | "locale"
  | "initialDocument"
> &
  Pick<SiteStyleInputs, "canvasSiteStyle" | "stylePolicy">): CanvasRender {
  /*
   * What the canvas hands `PageRenderer` beyond the document and the sheet.
   *
   * `styleContext` is the per-node style tier, a SEPARATE input from
   * `siteStyles` that was once reaching only the published page. `PageRenderer`
   * compiles a document's own node styles only when it is given a style
   * context; without one `resolvePageStyles` withholds the sheet and — in its
   * own words — "Classes are kept either way, so blocks still carry the names
   * the rest of the system expects". The symptom is therefore silent and
   * specific: every block carries its `nx-pb-<hash>` class and nothing defines
   * it, so an author's margins, spacing and dimensions render on the published
   * page and vanish in the editor. Measured before this existed: the same
   * document rendered zero scoped rules and flush blocks here, six rules and
   * 24px gaps through the public route.
   *
   * The breakpoints come from `siteBreakpoints()` rather than a set spelled
   * here, because `site-style.ts` exists precisely so the field validator and
   * the canvas cannot disagree about what this site's breakpoints are.
   *
   * `hostPolicy` is what makes the canvas enforce the allowlist the published
   * page enforces. Absent, `RenderNode`'s image and embed boundaries test
   * `patterns === undefined || isFetchableUrl(...)` and let everything through
   * — so the editor drew media from hosts the live page drops, which is the
   * preview lying in the one direction an author cannot detect.
   *
   * Memoized as a whole because `Canvas` keys its rendered tree on this
   * object's identity: rebuilt inline it is a fresh object on every render,
   * and the tree behind it is re-rendered on every selection and keystroke.
   */
  /*
   * The canvas's own render inputs, and the ONE place this surface derives a
   * breakpoint set.
   *
   * `styleContext.breakpoints` is read three times over — by the canvas, by the
   * cascade compiled below, and by the inspector — and all three must be the
   * same set or the panel judges which declarations are LIVE against
   * breakpoints the cascade was not compiled with. A second call to
   * `siteBreakpoints` beside this one returns an equal set today and offers no
   * error on the day the render context grows a tier this does not have.
   *
   * Memoised, and that also settles a churn problem: `siteBreakpoints` builds a
   * fresh `{ viewport: [], container: [] }` when no site style is stored, so an
   * inline call handed the inspector a new object every render and the panel
   * re-subscribed a media query per breakpoint on every keystroke.
   */
  /*
   * The renderer inputs, from the ONE derivation the entry screen's miniature
   * also asks.
   *
   * This used to be assembled here, and the resting field assembled a poorer
   * copy of its own — which is how the miniature came to render with no
   * breakpoint container, no host policy and default caps while the canvas had
   * all three. Two surfaces drawing one document must not answer "what does
   * this site render like" separately.
   *
   * `previewStates` is the editor's alone: the canvas needs a class alternative
   * beside each pseudo-class rule so it can show an author the state being
   * edited, and a surface showing the page as published must not have one.
   */

  // The canvas's own page context, one object for the editor's life: see
  // `canvas-page-context.ts`.
  // The lists the author chose to see empty, drawn so on the canvas, and
  // every list read in the language being edited.
  // The list the page splits into pages draws its links on the canvas, as
  // on its first published page, so an author sees and styles them.
  const pagedList = paginatedList(editor.document.nodes)?.id;
  const canvasContext = useCanvasPageContext(
    editor.listsShowingEmpty,
    locale,
    initialDocument,
    pagedList
  );
  const pageInputs = useMemo(
    () =>
      pageRenderInputs({
        siteStyle: canvasSiteStyle,
        clientConfig,
        // None: the canvas is a frame at the previewed device's size, so the
        // sheet is compiled exactly as the published route compiles it.
        previewContainer: undefined,
        previewStates: true,
        limits: documentLimits,
        // The map's identity changes only when the read does, so this memo —
        // and the resolution the canvas runs from it — is not redone per
        // keystroke.
        definitions: componentLibrary.definitions,
      }),
    [
      canvasSiteStyle,
      clientConfig,
      documentLimits,
      componentLibrary.definitions,
    ]
  );
  // The page as the canvas draws it, before the sources its bindings read
  // are known: `useBoundCanvasRender` adds them, once the Layout's regions
  // drawn around the page are known too.
  const canvasRender = useMemo(
    () => ({ ...pageInputs, context: canvasContext }),
    [pageInputs, canvasContext]
  );

  /*
   * What the Shared styles tab compiles each style's summary with, so the summary
   * describes the stylesheet the page gets.
   *
   * The canvas's context supplies the breakpoints: without them only the base
   * context is emitted, and styles a class holds under a site-defined tier go
   * uncounted. It does NOT carry the host policy — the canvas receives that as
   * `hostPolicy`, and the page compile turns the patterns into a predicate — so
   * the inspector's predicate, built from the same patterns, is added here.
   * Without it the summary lists a declaration the page drops for its URL.
   * Added only where the site stated patterns, which leaves a site with none
   * compiling exactly as the canvas does.
   */
  const classSummaryContext = useMemo(
    () =>
      stylePolicy.mayFetchUrl === undefined
        ? canvasRender.styleContext
        : {
            ...canvasRender.styleContext,
            mayFetchUrl: stylePolicy.mayFetchUrl,
          },
    [canvasRender.styleContext, stylePolicy]
  );

  return { canvasRender, classSummaryContext };
}

/** What `useCanvasViewport` returns. */
type CanvasViewport = {
  /** Asks the shell to edit at a breakpoint; the base one is null. */
  chooseDevice: (breakpoint: BreakpointId | null) => void;
  /** The latest of those requests, for the shell to apply. */
  deviceRequest: { breakpoint: string | null; count: number } | undefined;
  /** Where the shell reports the device it holds, restored ones included. */
  setChosenDevice: Dispatch<SetStateAction<string | null>>;
  zoom: CanvasZoom;
  setZoom: Dispatch<SetStateAction<CanvasZoom>>;
  appliedScale: number;
  setAppliedScale: Dispatch<SetStateAction<number>>;
  editedBreakpoint: string;
  /** The width the canvas frame lays the page out at. */
  frameWidth: number;
  liveBreakpoints: string[];
};

/** The device being edited, the width it is shown at, and the zoom. */
function useCanvasViewport({
  canvasRender,
  siteStyleCurrent,
}: Pick<CanvasRender, "canvasRender"> &
  Pick<SiteStyleInputs, "siteStyleCurrent">): CanvasViewport {
  const breakpoints = canvasRender.styleContext.breakpoints;
  /*
   * The device the SHELL holds, mirrored here to draw the canvas with it.
   *
   * The shell owns it because it owns the author's preferences, and it stores
   * it with them, so the device an author left is the one they come back to.
   * Requests travel down with a count, as the panel requests do; the shell
   * reports what it holds back up, including the device it restored on load.
   * Nothing here writes the mirror except that report, so the two cannot
   * disagree about which device is being edited.
   */
  const [chosenDevice, setChosenDevice] = useState<string | null>(
    DEFAULT_PREFERENCES.editingBreakpoint
  );
  const [deviceRequest, setDeviceRequest] = useState<
    { breakpoint: string | null; count: number } | undefined
  >(undefined);
  const chooseDevice = useCallback((breakpoint: BreakpointId | null): void => {
    // The base breakpoint is stored as null, its name for "no breakpoint".
    const stored = breakpoint === BASE_BREAKPOINT ? null : breakpoint;
    setDeviceRequest(current => ({
      breakpoint: stored,
      count: (current?.count ?? 0) + 1,
    }));
  }, []);

  /*
   * The device to move to when the site removes the one being edited: the
   * next wider breakpoint that remains, else the base. Sent to the shell as a
   * choice, so it stores and shows that device as the author's own.
   *
   * Compared against the last set a CURRENT stored answer gave: one read
   * since the editor opened, or still fresh in the shared cache. Before the
   * first, the set in hand is the host's config defaults, or a cached answer
   * older than a removal made while the author was away, so a device restored
   * on load that the site no longer has goes to the base, through
   * `editingBreakpointOf` below, whichever read is the one that answers. A
   * later read that fails keeps the last current set, so a removal a retry
   * then confirms still moves to the next wider breakpoint.
   */
  const previousBreakpoints = useRef<BreakpointSet | undefined>(undefined);
  useEffect(() => {
    if (!siteStyleCurrent) return;
    const before = previousBreakpoints.current;
    previousBreakpoints.current = breakpoints;
    if (before === undefined || before === breakpoints) return;
    // Only a device that WAS being edited and is gone now moves.
    if (editingBreakpointOf(before, chosenDevice) !== chosenDevice) return;
    if (editingBreakpointOf(breakpoints, chosenDevice) === chosenDevice) return;
    chooseDevice(fallbackBreakpoint(before, breakpoints, chosenDevice));
  }, [breakpoints, siteStyleCurrent, chosenDevice, chooseDevice]);

  /*
   * Which breakpoint an edit lands in: the device the author chose, and
   * nothing else — never the room the editor has, which narrows as panels
   * open. A device the site no longer defines resolves to the base
   * breakpoint until the move above arrives, so an edit is never stored under
   * a breakpoint nothing draws.
   */
  const editedBreakpoint = editingBreakpointOf(breakpoints, chosenDevice);
  /*
   * The width the frame lays the page out at: the device's own, or the
   * desktop width on a site that declares no viewport breakpoints, where
   * there is no device to simulate and the page is shown as a laptop would.
   */
  const frameWidth =
    previewWidth(breakpoints, editedBreakpoint) ?? DESKTOP_PREVIEW_WIDTH;

  /*
   * The zoom the SHELL owns, mirrored here only to draw the canvas with it,
   * one-way for the reason the device is: holding it as a second source of
   * truth and syncing BACK produced an oscillating write on every open.
   */
  const [zoom, setZoom] = useState<CanvasZoom>(DEFAULT_PREFERENCES.zoom);
  const [appliedScale, setAppliedScale] = useState(1);

  /*
   * Which breakpoints apply on the canvas: those at the frame's width, which
   * is the width of the frame's viewport and so the width every media query
   * in it answers for.
   */
  const liveBreakpoints = useMemo(
    () => breakpointsAtWidth(breakpoints, frameWidth),
    [breakpoints, frameWidth]
  );

  return {
    chooseDevice,
    deviceRequest,
    setChosenDevice,
    zoom,
    setZoom,
    appliedScale,
    setAppliedScale,
    editedBreakpoint,
    frameWidth,
    liveBreakpoints,
  };
}

/** What `useStyleState` returns. */
type ShownStyleState = {
  shownStyleState: StyleState;
  styleStateBinding: {
    state: StyleState;
    onChange: Dispatch<SetStateAction<StyleState>>;
  };
};

/** The interaction state being edited, and the one shown. */
function useStyleState(editor: EditorMount["editor"]): ShownStyleState {
  /*
   * The interaction state being edited, owned HERE so the panel and the canvas
   * cannot disagree about it.
   *
   * One value handed to both surfaces rather than two defaults that happen to
   * match: the panel states no `liveStates`, so provenance falls back to the
   * edited state plus base — correct exactly while the canvas is simulating
   * that state. Wired from one value that precondition holds by construction.
   *
   * ONE value reaching both surfaces, which is the property that matters: the
   * panel states no `liveStates`, so its provenance falls back to the edited
   * state plus base — correct exactly while the canvas is simulating the state
   * being edited, and wrong the moment it is not. Held here rather than in
   * either consumer so that precondition holds by construction; held in both,
   * a control would report a value the canvas is not showing and nothing would
   * say so.
   *
   * Editor state, not document state. Which state an author is LOOKING at is
   * not a property of the page, so it is neither stored nor undoable, and two
   * people editing one page can be looking at different states.
   */
  const [styleState, setStyleState] = useState<StyleState>("base");
  /*
   * Memoised because it is a PROP OBJECT: rebuilt on every render it would be a new
   * identity every time, and the panel it feeds is the one surface here that
   * holds a draft. `setStyleState` is stable, so this changes exactly when the
   * state does.
   */
  // ONE derivation feeding BOTH consumers, which is what keeps the panel and the
  // canvas showing the same thing. See `shownStyleStateFor`.
  const shownStyleState = shownStyleStateFor(
    styleState,
    editor.document,
    editor.selection.ids,
    editor.selectedId
  );
  const styleStateBinding = useMemo(
    () => ({ state: shownStyleState, onChange: setStyleState }),
    [shownStyleState]
  );

  return { shownStyleState, styleStateBinding };
}

/** What `useCanvasWiring` returns. */
type CanvasWiring = {
  slots: SlotSource;
  canvasRoot: RefObject<HTMLDivElement | null>;
  canvasElement: HTMLDivElement | null;
  setCanvasElement: Dispatch<SetStateAction<HTMLDivElement | null>>;
  blocks: { get: typeof getBlock };
  drag: CanvasDrag;
  dragging: boolean;
};

/** The canvas element, the registry the drag reads, and the drag itself. */
function useCanvasWiring({
  editor,
  componentLibrary,
}: Pick<EditorMount, "editor" | "componentLibrary">): CanvasWiring {
  /*
   * Dragging blocks on the canvas.
   *
   * The registry answers both questions, and it is the SAME registry the
   * inserter reads — so a container the palette will put a block into is a
   * container a drag can aim at. Given separate sources the two would disagree,
   * and a block would behave differently depending on how the author reached
   * it.
   */
  // Inside a list the canvas shows empty, a block goes to its empty state.
  const showingEmpty = editor.listsShowingEmpty;
  const slots = useMemo(
    () => slotsShowingEmpty(registrySlotSource(), showingEmpty),
    [showingEmpty]
  );
  const nesting = useMemo(registryNestingSource, []);
  // The canvas root, published by `Canvas` below and read by the drag when a
  // gesture begins somewhere that is not the canvas — a palette row, whose
  // pointerdown has no `currentTarget` the drag could measure against.
  const canvasRoot = useRef<HTMLDivElement | null>(null);
  /*
   * The same element as STATE, beside the ref rather than instead of it.
   *
   * The drag reads "where is the canvas now" during a gesture, which is what a
   * ref is for. The inspector has to REACT to the canvas appearing: it stays
   * mounted while the canvas mounts only once styles have loaded, and a ref is
   * not reactive — assigning `.current` changes no dependency, so a reader
   * listing the ref would see `null` once and never look again.
   */
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(
    null
  );
  /*
   * The empty-container appender's only read of a block's definition: its
   * accessible label. `{ get: getBlock }` satisfies its `BlockLookup` with no
   * adapter, because `getBlock` already returns `AnyBlockDefinition | undefined`
   * and that type carries the one field the appender reads.
   */
  const blocks = useMemo(() => ({ get: getBlock }), []);

  // The SAME map the canvas draws with, so a moved instance is judged by the
  // roots it draws there rather than by its own, unrestricted type.
  const drag = useCanvasDrag({
    editor,
    slots,
    nesting,
    canvasRoot,
    definitions: componentLibrary.definitions,
  });
  /*
   * Is a drag happening — of EITHER kind.
   *
   * Not `draggingId`, which is the moving node's id and is null for the whole
   * of a drag from the palette: the block has no node until the release makes
   * one. Chrome gated on the id stays up while an author drags a new block in,
   * and the toolbar sits above the drop indicator, covering the position being
   * aimed at.
   *
   * Derived once and shared by the three surfaces below, so they cannot come to
   * disagree about what counts as a drag.
   */
  const dragging = drag.draggingBlockName !== null;

  return {
    slots,
    canvasRoot,
    canvasElement,
    setCanvasElement,
    blocks,
    drag,
    dragging,
  };
}

/** What `useStyleReadings` returns. */
type StyleReadings = {
  spacingScrub: SpacingScrubContext;
  styleCascade: PageStyleCascade | undefined;
  /** The blocks on the page as stored that carry each class, for Shared styles. */
  pageClassBlocks: PageClassBlocks;
};

/** What the spacing handles, the inspector and the Shared styles tab read. */
function useStyleReadings({
  editor,
  documentLimits,
  canvasSiteStyle,
  siteStylePending,
  siteStyleError,
  remotePatterns,
  stylePolicy,
  canvasRender,
  editedBreakpoint,
  shownStyleState,
}: Pick<EditorMount, "editor" | "documentLimits"> &
  Pick<
    SiteStyleInputs,
    | "canvasSiteStyle"
    | "siteStylePending"
    | "siteStyleError"
    | "remotePatterns"
    | "stylePolicy"
  > &
  Pick<CanvasRender, "canvasRender"> & {
    editedBreakpoint: BreakpointId;
    shownStyleState: StyleState;
  }): StyleReadings {
  /*
   * What a spacing drag handle writes, and what its live preview compiles with.
   *
   * Every field is read back from the SAME context the canvas sheet was
   * compiled under, never derived again here. A preview compiled against a
   * different breakpoint set, token prefix or scope than the
   * rule it has to outrank simply does not match — the drag looks frozen and
   * the value jumps into place on release, which reads as the handle being
   * broken rather than as the two answers having diverged.
   *
   * The tier and the state are the inspector's own bindings, so the handle
   * writes exactly where the Style panel's spacing fields write. Those fields
   * are this row's click path, and a handle landing in another tier would make
   * the two disagree about what an author just changed.
   *
   * Memoized because the overlay holds it in a callback dependency: rebuilt
   * inline it is a fresh object on every render, and every gesture the handles
   * are tracking would restart on the next keystroke anywhere in the shell.
   */
  const spacingScrub = useMemo(
    () => ({
      /*
       * The SHOWN state, not the preserved one. `shownStyleStateFor` forces the
       * canvas and the inspector back to `base` whenever the state switcher is
       * off screen — a multi-selection, or a node the inspector cannot edit —
       * while keeping the author's previous choice for when it returns. A handle
       * reading the preserved value would preview the base spacing the canvas is
       * showing and commit under the hidden state, so the change an author just
       * dragged would vanish on release.
       */
      address: { state: shownStyleState, breakpoint: editedBreakpoint },
      breakpoints: canvasRender.styleContext.breakpoints,
      ...(canvasRender.styleContext.tokenPrefix === undefined
        ? {}
        : { tokenPrefix: canvasRender.styleContext.tokenPrefix }),
      ...(canvasRender.styleContext.scope === undefined
        ? {}
        : { scope: canvasRender.styleContext.scope }),
      ...(stylePolicy === undefined ? {} : { policy: stylePolicy }),
    }),
    [
      canvasRender.styleContext.breakpoints,
      canvasRender.styleContext.scope,
      canvasRender.styleContext.tokenPrefix,
      editedBreakpoint,
      shownStyleState,
      stylePolicy,
    ]
  );

  /*
   * The cascade behind the canvas, compiled ONCE per document.
   *
   * The inspector's Style tab uses it to say whether a control's value was set
   * on this block or arrived from a class, the block's defaults or the page.
   * Only this surface can compile it: the panel sits several layers down and
   * holds neither the site's breakpoints nor the document, and compiling nearer
   * the controls would walk the cascade once per control.
   *
   * It is handed the SAME inputs the canvas is: `canvasRender.styleContext`, the
   * site sheet, and the host's remote patterns. Not a narrower context assembled
   * beside them — named classes, block bases, the token prefix and the fetch
   * predicate are each reconciled from two tiers, and a second assembly compiles
   * a cascade the page never had. The shortfall would be silent: no class
   * declaration in the trace, so every value from a named class reads as set by
   * nobody, and a `url(...)` this host refuses reads as active.
   */
  const styleCascade = useMemo(
    () =>
      /*
       * Withheld on exactly the states the CANVAS is withheld on, and for the
       * same reason one level over. While the stored tier is unread
       * `useSiteStyle` answers with the host's config defaults, so a trace
       * compiled from it describes a cascade that is not the page's: a class the
       * site adds is missing, one it overrides is wrong, and the dots say so
       * confidently.
       *
       * A FAILED read is the worse half and is not a passing state. `pending`
       * goes false while the value falls back to defaults, so gating on pending
       * alone would leave the inspector permanently certain about a tier nobody
       * has read. No dots is the honest answer; a fabricated origin is not.
       */
      /*
       * `!== null`, NOT `!== undefined`. `useSiteStyle` types `error` as
       * `Error | null` and normalises a successful read to `null`, so the
       * `undefined` comparison is true on success as well as on failure — and
       * withheld the trace unconditionally, which meant no provenance dot ever
       * appeared. The same test the canvas below uses.
       */
      siteStylePending || siteStyleError !== null
        ? undefined
        : pageStyleTrace(
            editor.document,
            canvasRender.styleContext,
            siteSheet(canvasSiteStyle),
            {
              ...(remotePatterns === undefined ? {} : { remotePatterns }),
              // The SAME map the canvas resolves against, under the SAME
              // caps, so the cascade the inspector reads describes the
              // composed tree on screen: neither one with every instance
              // left unresolved, nor one composed past a cap the canvas
              // stopped at.
              definitions: canvasRender.definitions,
              limits: canvasRender.limits,
            }
          ),
    [
      editor.document,
      canvasRender,
      canvasSiteStyle,
      remotePatterns,
      siteStylePending,
      siteStyleError,
    ]
  );

  /*
   * How many blocks on this page carry each class, for the Shared styles
   * tab's "3 blocks on this page". The same walk, asked of the page as
   * stored: a block inside a component's definition belongs to that
   * component, which the site's index counts as a component of its own.
   */
  const pageClassBlocks = useMemo((): PageClassBlocks => {
    const usage = classUsageOf(editor.document, documentLimits);
    return { counts: usage.blocks, complete: usage.complete };
  }, [editor.document, documentLimits]);

  return { spacingScrub, styleCascade, pageClassBlocks };
}

/**
 * The canvas's inputs, in one call.
 *
 * Each part reads the ones before it, so they are asked in this order and
 * handed on whole rather than re-derived: the context, the widths sized from
 * it, the state shown, the element and the drag, and the readings off all of
 * them. Where the page is drawn — the site's canvas route or the editor's
 * blank page — reads only the plugin's config.
 */
export function useCanvasInputs(
  mount: EditorMount,
  style: SiteStyleInputs
): CanvasInputs {
  const render = useCanvasRender({ ...mount, ...style });
  const viewport = useCanvasViewport({ ...render, ...style });
  const styleState = useStyleState(mount.editor);
  const wiring = useCanvasWiring(mount);
  const readings = useStyleReadings({
    ...mount,
    ...style,
    ...render,
    ...viewport,
    ...styleState,
  });
  const site = useSiteCanvas(mount.clientConfig);
  // Shared styles on the selected block, read off the same class surface and
  // page counts the inspector and the Shared styles tab read.
  const sharedStyle = useSharedStyleVerb({
    editor: mount.editor,
    classes: style.classes,
    pageClassBlocks: readings.pageClassBlocks,
  });
  return {
    ...render,
    ...viewport,
    ...styleState,
    ...wiring,
    ...readings,
    ...site,
    sharedStyle,
  };
}

/**
 * Whether a source is one of which the public may read no field, so the
 * published page reads none of it. The page's entry and a Single count only
 * when the person editing read them (no such source is not a private one); a
 * collection a path's relation leads into counts when its lookup found none.
 */
function sourceHiddenFromVisitors(
  bindings: PageBindings,
  shapes: BlocksFieldShapes,
  ref: BindingSchemaRef
): boolean {
  // A custom source's rows are read as visitors read them and cut to the
  // fields its query declares, so they are never a source visitors can't see.
  if ("query" in ref) return false;
  if ("site" in ref || !noPublicFields(shapes, ref)) return false;
  if ("single" in ref) {
    return (bindings.singles?.get(ref.single) ?? null) !== null;
  }
  const entryRef = bindings.entryRef;
  const isEntry =
    entryRef !== undefined &&
    "collection" in entryRef &&
    entryRef.collection === ref.collection;
  return isEntry ? (bindings.entry ?? null) !== null : true;
}

/** No region: what a page with no Layout draws around it. */
const NO_DEFINITIONS: DefinitionsById = new Map();

/** A drawn tree, prepared by the renderer's own pipeline for the canvas. */
function drawnTree(
  document: BlockDocument,
  definitions: DefinitionsById,
  render: PageRenderInputs
): BlockDocument | null {
  return prepareDocumentForRead(document, {
    resolver: registeredBlocks(),
    styleContext: render.styleContext,
    definitions,
    ...(render.limits === undefined ? {} : { limits: render.limits }),
  });
}

/**
 * The canvas's render inputs with the sources its bindings read, read as the
 * person editing: the entry, its Singles and the site settings, and the
 * public field shapes that judge them.
 *
 * Asked of every tree the canvas draws, prepared by the renderer's own
 * pipeline: the page's, composed with its components' definitions, and each
 * region of its Layout with the definitions it reaches, as the published
 * route reads for the page and its regions together. A list item's bindings
 * fill from the entry the canvas drew it with, as on the published page;
 * until the sources arrive, a bound prop keeps its own value (or its
 * fallback), as it always drew.
 */
export function useBoundCanvasRender(
  canvasRender: PageRenderInputs,
  drawn: {
    readonly document: BlockDocument;
    readonly regions: readonly {
      readonly document: BlockDocument;
      readonly definitions?: DefinitionsById;
    }[];
  },
  locale: string | undefined,
  /** Whether the document is a component's own, which has no entry. */
  component: boolean
): {
  readonly canvasRender: PageRenderInputs;
  /**
   * The bound props on the page a visitor will not see filled, by node id:
   * the published page's own binding check, asked with the field shapes a
   * visitor may read, which the canvas's sources carry.
   */
  readonly visitorUnreadable: ReadonlyMap<
    string,
    readonly VisitorUnreadableBinding[]
  >;
} {
  const { document, regions } = drawn;
  const pageTree = useMemo(
    () => drawnTree(document, canvasRender.definitions, canvasRender),
    [document, canvasRender]
  );
  const trees = useMemo(
    () =>
      [
        pageTree,
        ...regions.map(region =>
          drawnTree(
            region.document,
            region.definitions ?? NO_DEFINITIONS,
            canvasRender
          )
        ),
      ].filter((tree): tree is BlockDocument => tree !== null),
    [pageTree, regions, canvasRender]
  );
  const bindings = useCanvasBindings(trees, locale, component);
  const bound = useMemo(
    () => ({ ...canvasRender, bindings }),
    [canvasRender, bindings]
  );
  // Judged on the page's tree as the canvas draws it (repaired, composed and
  // gated by the renderer's own pipeline), so a mark lands on the block that
  // is drawn; a Layout region's bindings are its own editor's to say.
  const visitorUnreadable = useMemo(() => {
    const shapes = bindings.fieldShapes;
    if (shapes === undefined || pageTree === null) return NONE_UNREADABLE;
    return visitorUnreadableBindings(pageTree, {
      schema: shapes,
      ...(bindings.entryRef === undefined
        ? {}
        : { entryRef: bindings.entryRef }),
      props: { get: getBlock },
      unreadableSource: ref => sourceHiddenFromVisitors(bindings, shapes, ref),
    });
  }, [pageTree, bindings]);
  return { canvasRender: bound, visitorUnreadable };
}

/**
 * The canvas's inputs, as `useCanvasInputs` reads them: each part's own
 * result, so a value one of them adds reaches this type without being listed
 * again.
 */
export type CanvasInputs = CanvasRender &
  CanvasViewport &
  ShownStyleState &
  CanvasWiring &
  StyleReadings &
  SiteCanvas & {
    /** The Style tab's shared-style host, the save verb and its dialog. */
    sharedStyle: SharedStyleVerb;
  };
