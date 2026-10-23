/**
 * What the canvas draws with, and the readings the inspector and the spacing
 * handles take from the same inputs: the site's style, the render context,
 * the box's width and zoom, the interaction state shown, and the cascade.
 *
 * Every reading here is derived from one context the canvas is compiled
 * under, never assembled a second time beside it.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/use-render-inputs
 */
import {
  previewContainerFor,
  registryNestingSource,
  getBlock,
  type BlockDocument,
  type BreakpointId,
  type StyleState,
  type StyleCompileContext,
  type RemotePattern,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import type { PageStyleCascade } from "@nextlyhq/blocks-react";
import {
  DEFAULT_PREFERENCES,
  registrySlotSource,
  type SlotSource,
} from "@nextlyhq/builder";
import {
  breakpointsAtWidth,
  editedBreakpointAtWidth,
  pageStyleTrace,
  selectionIsInspectable,
  useCanvasDrag,
  widthForBreakpoint,
  type CanvasDrag,
  type CanvasPreview,
  type CanvasZoom,
  type SpacingScrubContext,
} from "@nextlyhq/builder/shell";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
  type RefObject,
  type Dispatch,
} from "react";

import { classUsageOf, type ClassUsage } from "../../class-usage";
import {
  hostFetchPolicy,
  readRemotePatterns,
  type HostFetchPolicy,
} from "../../host-policy";
import { siteSheet, type SiteStyleData } from "../../site-style";
import { readSiteStyleRecord } from "../../site-style-record";
import { pageRenderInputs, type PageRenderInputs } from "../page-render-inputs";
import { useSiteStyle } from "../site-style-client";

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
  const configSiteStyle = useMemo(
    () => readSiteStyleRecord(clientConfig?.siteStyle),
    [clientConfig]
  );
  const {
    siteStyle: canvasSiteStyle,
    stored: storedSiteStyle,
    unreadableFonts: unreadableStoredFonts,
    pending: siteStylePending,
    error: siteStyleError,
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

  return {
    configSiteStyle,
    canvasSiteStyle,
    storedSiteStyle,
    unreadableStoredFonts,
    siteStylePending,
    siteStyleError,
    classes,
    remotePatterns,
    stylePolicy,
    saveBreakpoints,
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
  classes: ClassSurface;
  remotePatterns: readonly RemotePattern[] | undefined;
  stylePolicy: HostFetchPolicy;
  saveBreakpoints: (next: BreakpointSet) => Promise<string | undefined>;
};

/** The canvas's render context, as `useCanvasRender` returns it. */
type CanvasRender = {
  canvasRender: PageRenderInputs;
  canvasPreviewContainer: string | undefined;
  classSummaryContext: StyleCompileContext;
};

/** The render context the canvas is compiled under, and what is read off it. */
function useCanvasRender({
  clientConfig,
  documentLimits,
  componentLibrary,
  canvasSiteStyle,
  stylePolicy,
}: Pick<EditorMount, "clientConfig" | "documentLimits" | "componentLibrary"> &
  Pick<SiteStyleInputs, "canvasSiteStyle" | "stylePolicy">): CanvasRender {
  /*
   * The name the canvas box establishes as a query container.
   *
   * The editor canvas is not an iframe — the renderer emits its sheet into the
   * admin document — so `@media` asks the browser WINDOW and resizing the box
   * cannot change which tier applies. Compiled against a container name, the
   * viewport tiers become `@container` rules about THIS box, and the box's own
   * width decides them.
   *
   * Minted from `useId` rather than spelled here, because the name identifies
   * one mounted surface: two editors on a page sharing a literal would each
   * answer the other's queries. `previewContainerFor` is what turns the seed
   * into a name the compiler will accept, and it is the only supported way to
   * make one.
   */
  const canvasBoxId = useId();
  /*
   * The name this canvas would establish, and whether it establishes one AT
   * ALL.
   *
   * Previewing is not free: a preview compile rewrites every CONTAINER-axis
   * rule to `@container nx-not-previewable (width < 0px)`, which matches
   * nothing. That is the engine refusing to answer a question it cannot — a
   * container query resolves against an element's own query container, which a
   * preview box is not — and it is the right refusal when there are viewport
   * tiers to gain in exchange.
   *
   * With NO emitted viewport tier there is nothing to gain and the same price
   * is paid: a site whose only breakpoints are container ones would have every
   * one of them silently stop matching on the canvas while they keep working on
   * the published page. So a canvas with nothing to simulate stays published,
   * which is also what it looked like before any of this existed.
   *
   * `offeredTiers` rather than a second reading of the set, because it is
   * already the answer to "which tiers can this canvas be sized to" — and if
   * none can, there is no width to simulate.
   */
  const previewContainer = useMemo(
    () => previewContainerFor(canvasBoxId),
    [canvasBoxId]
  );

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

  const canvasRender = useMemo(
    () =>
      pageRenderInputs({
        siteStyle: canvasSiteStyle,
        clientConfig,
        previewContainer,
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
      previewContainer,
      documentLimits,
      componentLibrary.definitions,
    ]
  );

  /*
   * What the canvas is previewing under, read back from the ONE context that
   * decided it rather than recomputed. The box and the inspector must be told
   * the same thing the sheet was compiled with, and a second derivation here
   * would be a second chance to answer differently.
   */
  const canvasPreviewContainer = canvasRender.styleContext.previewContainer;

  /*
   * What the classes manager compiles each class's summary with, so the summary
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

  return { canvasRender, canvasPreviewContainer, classSummaryContext };
}

/** What `useCanvasViewport` returns. */
type CanvasViewport = {
  setRequestedTier: Dispatch<SetStateAction<string | undefined>>;
  zoom: CanvasZoom;
  setZoom: Dispatch<SetStateAction<CanvasZoom>>;
  appliedScale: number;
  setAppliedScale: Dispatch<SetStateAction<number>>;
  measuredWidth: number | undefined;
  editedBreakpoint: string;
  requestedWidth: number | undefined;
  canvasPreview: CanvasPreview | undefined;
  liveBreakpoints: string[];
};

/** The width the box is asked for and the width it got, and the zoom. */
function useCanvasViewport({
  canvasRender,
  canvasPreviewContainer,
}: Pick<
  CanvasRender,
  "canvasRender" | "canvasPreviewContainer"
>): CanvasViewport {
  /*
   * The two widths, which are two facts and not one.
   *
   * `requestedWidth` is what the author asked the switcher for — a ceiling, and
   * `undefined` for the full region. `measuredWidth` is what the box actually
   * got, reported by the canvas: the editor region may be narrower than the
   * tier requested, and what the container queries resolve against is the width
   * the box has, not the width it was offered.
   *
   * Only the MEASURED one decides which tier is edited. Deriving that from the
   * request would tell an author they are editing the tier they picked while
   * the box is in a narrower one, which is the disagreement between what you
   * see and what you edit that this control exists to remove.
   */
  const [requestedTier, setRequestedTier] = useState<BreakpointId | undefined>(
    undefined
  );
  /*
   * The zoom, and the scale it produces, held apart.
   *
   * The first is what the author ASKED for and the shell persists it. The
   * second is what the canvas is painting at, which while fitting is derived
   * from a region only the canvas measures — so it is reported back rather
   * than computed here, where a second derivation would disagree with the
   * screen for exactly the frame after a panel opens.
   */
  /*
   * The zoom the SHELL owns, mirrored here only to draw the canvas with it.
   *
   * Nothing writes it from this side. The shell persists the choice and reports
   * it, including the value restored on load; this holds the last report so the
   * canvas can be scaled by it. Holding it as a second source of truth and
   * syncing BACK is what produced an oscillating write of `fit, 2, fit, 2` on
   * every open — two owners, each correcting the other.
   *
   * Seeded with the same default the shell starts from, so there is no absent
   * state for the canvas to interpret. That is safe only because this direction
   * is one-way: with nothing sending a zoom back, a default held here can never
   * reach the store to overwrite what the author chose.
   */
  const [zoom, setZoom] = useState<CanvasZoom>(DEFAULT_PREFERENCES.zoom);
  const [appliedScale, setAppliedScale] = useState(1);
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(
    undefined
  );

  /*
   * Which tier an edit lands in, and which tiers the box is applying.
   *
   * Both derived from the MEASURED width and from the one breakpoint set above,
   * so the inspector cannot disagree with the canvas about either. Memoised
   * because `breakpointsAtWidth` builds a fresh array: passed inline it would be
   * a new identity every render, and the panel re-derives on it.
   */
  const editedBreakpoint = editedBreakpointAtWidth(
    canvasRender.styleContext.breakpoints,
    measuredWidth
  );

  /*
   * Release a requested width the site no longer offers.
   *
   * The switcher renders nothing once a site defines no viewport tiers, and it
   * cannot clear state it does not own — so an author who selects a tier and
   * then deletes it, or deletes the last one, is left with a canvas pinned to a
   * bound the stylesheet no longer has and no control on screen to release it.
   * The only way out would be to close the editor and reopen it.
   *
   * Compared against `selectableTiers`, which is the same list the switcher
   * builds its options from, so "a width this control could have set" has one
   * definition rather than two that can disagree.
   *
   * It has to be that list and not the bounded tiers alone. The unconditional
   * tier is offered at the width it applies FROM, which is not any tier's
   * bound — checked against the bounds this cleared it on the render after it
   * was chosen, so the canvas returned to filling the region and the one option
   * that reaches the base tier silently did nothing.
   */
  const requestedWidth =
    requestedTier === undefined
      ? undefined
      : widthForBreakpoint(
          canvasRender.styleContext.breakpoints,
          requestedTier
        );

  /*
   * The box's own inputs, as one object.
   *
   * Memoised because the canvas takes them as a group: rebuilt inline it would
   * be a fresh object every render, and the measurement effect behind it
   * re-subscribes on the reporter's identity.
   */
  const canvasPreview = useMemo(
    () =>
      canvasPreviewContainer === undefined
        ? undefined
        : {
            container: canvasPreviewContainer,
            ...(requestedWidth === undefined ? {} : { width: requestedWidth }),
            onMeasured: setMeasuredWidth,
          },
    [canvasPreviewContainer, requestedWidth]
  );

  const liveBreakpoints = useMemo(
    () =>
      breakpointsAtWidth(canvasRender.styleContext.breakpoints, measuredWidth),
    [canvasRender, measuredWidth]
  );

  return {
    setRequestedTier,
    zoom,
    setZoom,
    appliedScale,
    setAppliedScale,
    measuredWidth,
    editedBreakpoint,
    requestedWidth,
    canvasPreview,
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
  const slots = useMemo(registrySlotSource, []);
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
  documentClasses: ClassUsage;
};

/** What the spacing handles, the inspector and the classes manager read. */
function useStyleReadings({
  editor,
  documentLimits,
  canvasSiteStyle,
  siteStylePending,
  siteStyleError,
  remotePatterns,
  stylePolicy,
  canvasRender,
  canvasPreviewContainer,
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
  Pick<CanvasRender, "canvasRender" | "canvasPreviewContainer"> & {
    editedBreakpoint: ReturnType<typeof editedBreakpointAtWidth>;
    shownStyleState: StyleState;
  }): StyleReadings {
  /*
   * What a spacing drag handle writes, and what its live preview compiles with.
   *
   * Every field is read back from the SAME context the canvas sheet was
   * compiled under, never derived again here. A preview compiled against a
   * different breakpoint set, container name, token prefix or scope than the
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
      ...(canvasPreviewContainer === undefined
        ? {}
        : { previewContainer: canvasPreviewContainer }),
      ...(canvasRender.styleContext.tokenPrefix === undefined
        ? {}
        : { tokenPrefix: canvasRender.styleContext.tokenPrefix }),
      ...(canvasRender.styleContext.scope === undefined
        ? {}
        : { scope: canvasRender.styleContext.scope }),
      ...(stylePolicy === undefined ? {} : { policy: stylePolicy }),
    }),
    [
      canvasPreviewContainer,
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
   * Which classes the OPEN document renders, for the manager's on-this-page
   * filter.
   *
   * `classUsageOf` rather than a walk written here: it is the same traversal
   * the style compiler and the usage index already share, and two walks with
   * equal limits reached by different routes select different nodes — a class
   * on a node one walk reaches and the other does not would be reported as
   * absent from a page that renders it.
   * Composed through the SAME map the canvas draws with, because the stored
   * document holds one instance node where the canvas draws a definition: a
   * class applied inside that definition is on the page as rendered, and a
   * walk over the stored nodes alone would leave it out of the filter. The
   * usage record asks a different question of the same walk — what this
   * document itself references — and passes no map.
   *
   *
   * `complete` is deliberately unread. It says whether the walk hit the
   * document's node ceiling, which bounds what this could CLAIM about usage —
   * and this claims nothing about usage. It answers one question, "does the
   * open page apply this class", and a truncated walk answers that for fewer
   * nodes rather than answering it wrongly.
   */
  const documentClasses = useMemo(
    // The HOST's limits, not the engine's defaults. A site that raised or
    // lowered them renders under those, and a walk here under different bounds
    // selects different nodes — which would report a class as absent from a
    // page that renders it, or present on one that does not.
    () =>
      classUsageOf(editor.document, documentLimits, canvasRender.definitions),
    [editor.document, documentLimits, canvasRender.definitions]
  );

  return { spacingScrub, styleCascade, documentClasses };
}

/**
 * The canvas's inputs, in one call.
 *
 * Each part reads the ones before it, so they are asked in this order and
 * handed on whole rather than re-derived: the context, the widths sized from
 * it, the state shown, the element and the drag, and the readings off all of
 * them.
 */
export function useCanvasInputs(
  mount: EditorMount,
  style: SiteStyleInputs
): CanvasInputs {
  const render = useCanvasRender({ ...mount, ...style });
  const viewport = useCanvasViewport(render);
  const styleState = useStyleState(mount.editor);
  const wiring = useCanvasWiring(mount);
  const readings = useStyleReadings({
    ...mount,
    ...style,
    ...render,
    ...viewport,
    ...styleState,
  });
  return { ...render, ...viewport, ...styleState, ...wiring, ...readings };
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
  StyleReadings;
