"use client";

/**
 * The editor's left panels: which are offered, what fills each, the requests
 * that open one from elsewhere on the surface, and the library the Add panel
 * may offer.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-panels
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  CORE_CATEGORIES,
  CORE_PALETTE_ORDER,
} from "@nextlyhq/blocks-react/blocks";
import type {
  LeftPanel,
  PreferenceStore,
  SavedPattern,
} from "@nextlyhq/builder";
import {
  type UseBuilderChecklistResult,
  ComponentsPanel,
  InsertPanel,
  InsertPicker,
  LayersPanel,
  useInsertPicker,
  useBuilderChecklist,
  type BuilderShell,
  type CanvasRegion,
  type InsertPickerState,
  type InsertPickerTarget,
  type InsertPlace,
  type LayersRegionRow,
  type LibraryTierState,
  type MiniatureSession,
  useMiniatureSession,
  blockStyleFoldId,
} from "@nextlyhq/builder/shell";
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Control, FieldValues } from "react-hook-form";

import type { ComponentLibraryRead } from "../component-library-client";
import { lazyPart } from "../lazy-part";
import { usePageLayoutSettings, type RegionCardFacts } from "../page-layout";
import {
  usePatternLibrary,
  type LibraryReadState,
} from "../pattern-library-client";

import { usePictureContext } from "./canvas-page-context";
import {
  useCanvasPreviewMode,
  type CanvasPreviewMode,
} from "./canvas-preview-mode";
import {
  DesignFonts,
  DesignPanel,
  DesignReveal,
  FONTS_SCREEN_VIEW,
  ReportStylesMatches,
  type DesignRevealRequest,
  type DesignView,
} from "./design-panel";
import {
  checklistStoreFor,
  designFoldsStoreFor,
} from "./editor-preference-stores";
import { useLookEditing, type LookEditingState } from "./look-editing";
import {
  withoutSelf,
  withoutSelfPatterns,
  type ComponentGraph,
} from "./offered-library";
import { usePagesPanel, type PagesPanelMount } from "./pages-panel";
import {
  useSectionPictures,
  type SectionPictureInputs,
} from "./section-pictures";
import { usePageRegions, type SelectedRegion } from "./selected-region";
import type { FontRolesTab as FontRolesTabPart } from "./site-font-roles-tab";
import type { SiteFontsScreen as SiteFontsScreenPart } from "./site-style-fonts";
import {
  offerableFaces,
  ColoursTab,
  offerableTokens,
  renderedTokens,
  SharedStylesStudio,
  TokensStudio,
  VariablesTab,
} from "./site-style-studios";
import type { ComponentView } from "./use-component-view";
import type { EditorMount } from "./use-editor-mount";
import type { CanvasInputs, SiteStyleInputs } from "./use-render-inputs";

/**
 * The Fonts screen, fetched when it first opens over the Design panel rather
 * than with the editor: the upload and the font catalogue are of no use to an
 * author who never opens it.
 */
const SiteFontsScreen: typeof SiteFontsScreenPart = lazyPart(() =>
  import("./site-style-fonts").then(m => m.SiteFontsScreen)
);

/**
 * The Type tab's Body and Headings fonts, fetched with the fonts panel: they
 * read the font catalogue for "Add Bold".
 */
const FontRolesTab: typeof FontRolesTabPart = lazyPart(() =>
  import("./site-font-roles-tab").then(m => m.FontRolesTab)
);

/** A key for the document the editor has open, from its identity. */
function identityKey(
  identity: ReturnType<typeof useDocumentIdentity>
): string | undefined {
  if (identity === null) return undefined;
  return identity.kind === "collection"
    ? `collection:${identity.slug}:${identity.documentId ?? "new"}`
    : `${identity.kind}:${identity.slug}`;
}

/**
 * Every left panel the editor can fill today: Add, Layers, Pages, the site's
 * Components, and Design with the site's variables, shared styles and fonts.
 *
 * The shell offers only what is listed, so the rail never holds an item that
 * opens a region with nothing in it. Listing a panel here that renders nothing
 * would reserve space and shrink the canvas to show it, which is why this
 * grows one entry at a time rather than being declared ahead of the panels.
 */
const AVAILABLE_PANELS = [
  "add",
  "layers",
  "pages",
  "components",
  "design",
] as const;

/**
 * The insert panel, with this site's saved patterns.
 *
 * A component of its own so the library is read WHEN THE PANEL OPENS. The shell
 * calls `renderPanel` only for the panel that is open and keys it by which one,
 * so this mounts on the way in and unmounts on the way out — where reading in
 * the editor's own body fetched every saved pattern on every editor mount, for
 * authors who never visit Insert.
 *
 * It also settles the freshness question at the right moment. Patterns are
 * created and published through the ordinary collection screens, which know
 * nothing about this route, so there is nothing to invalidate this cache on a
 * write; opening the panel is exactly when an author expects to see what they
 * just saved.
 *
 * The panel itself stays a pure surface over what it is given. It takes a
 * registry and a list, and asking for its own data would make every host that
 * renders it depend on this plugin's route.
 */
function InsertPanelWithLibrary({
  components,
  offerablePatterns,
  pictures,
  ...props
}: {
  editor: React.ComponentProps<typeof InsertPanel>["editor"];
  categoryOrder: React.ComponentProps<typeof InsertPanel>["categoryOrder"];
  blockOrder: React.ComponentProps<typeof InsertPanel>["blockOrder"];
  beginInsertDrag: React.ComponentProps<typeof InsertPanel>["beginInsertDrag"];
  /** The container to add inside, when its "+" asked for it. */
  inside?: string;
  /** The block to add right after, when the "+" in the gap below it asked. */
  after?: string;
  /** Any other place chosen by position, carried from the in-place picker. */
  at?: React.ComponentProps<typeof InsertPanel>["at"];
  /** A canvas press still to answer, and where to say it was answered. */
  summoned: React.ComponentProps<typeof InsertPanel>["summoned"];
  onSummoned: React.ComponentProps<typeof InsertPanel>["onSummoned"];
  /**
   * The component tier, read by the EDITOR rather than here.
   *
   * The canvas needs the same definitions to draw an instance, and it needs
   * them whether or not this panel is ever opened — so the editor makes that
   * read once and hands it down WHOLE: the list the tiles are built from, the
   * lookup the canvas resolves against — so a tile's roots are the roots the
   * canvas will draw — and where the read stands, which the panel says.
   */
  components: ComponentLibraryRead;
  /**
   * The patterns this edit may offer, out of the rows read HERE.
   *
   * A pattern can place a component, so editing a component has to leave out
   * the patterns that reach it — the same question the component tier is
   * filtered by, and it needs the same graph. That graph and the facts it is
   * asked against belong to the editor above, and the rows belong here, so
   * the rule comes down and is applied where the rows are.
   */
  offerablePatterns: (
    patterns: readonly SavedPattern[]
  ) => readonly SavedPattern[];
  /**
   * What a saved section's picture is drawn with, beside the component
   * definitions above: the site's style as the canvas draws with it, the mode
   * the canvas is previewed in, and the editor's picture session.
   */
  pictures: Omit<SectionPictureInputs, "definitions">;
}): React.JSX.Element {
  const library = usePatternLibrary();
  const renderPicture = useSectionPictures({
    ...pictures,
    definitions: components.definitions,
  });
  const patterns = useMemo(
    () => offerablePatterns(library.patterns),
    [offerablePatterns, library.patterns]
  );
  return (
    <InsertPanel
      {...props}
      patterns={patterns}
      renderPicture={renderPicture}
      components={components.components}
      componentDefinitions={components.definitions}
      library={{
        patterns: tierStateOf(library),
        components: tierStateOf(components),
        // Both reads asked again: the panel offers one retry, and a tier that
        // was fine is refetched at no cost the author can see.
        retry: () => {
          library.retry();
          components.retry();
        },
      }}
    />
  );
}

/**
 * One tier's state as the panel says it, from the two facts a read carries.
 *
 * `unavailable` first, for the reason both reads name it first; then cut; and
 * a read still in flight is `ready` — an empty tier that will fill in a moment
 * is not one to explain.
 */
function tierStateOf(read: {
  state: LibraryReadState;
  truncated: boolean;
}): LibraryTierState {
  if (read.state === "unavailable") return "unavailable";
  // A failed refresh before a cut: the answer the cut describes is the one
  // the retry replaces, and a library reloaded whole is reported cut again.
  if (read.state === "stale") return "stale";
  return read.truncated ? "cut" : "ready";
}

/** What `useOfferedLibrary` returns. */
type OfferedLibrary = {
  offered: ComponentLibraryRead;
  offerablePatterns: (
    patterns: readonly SavedPattern[]
  ) => readonly SavedPattern[];
};

/** The library the insert panel may offer, for the field being edited. */
function useOfferedLibrary({
  componentLibrary,
  documentLimits,
  initialDocument,
}: Pick<
  EditorMount,
  "componentLibrary" | "documentLimits" | "initialDocument"
>): OfferedLibrary {
  /*
   * The rows the panel may OFFER: the library without the definition this very
   * field is editing, when it is editing one. The MAP stays whole — the
   * canvas still has to resolve every other instance, and an instance of the
   * definition inside itself is the resolver's cycle to draw.
   */
  // Judged on the document the editor OPENED with: a document's kind does not
  // change while it is edited, and the opening document is the one this
  // field's own value described.
  const identity = useDocumentIdentity();
  /*
   * Built once and asked by BOTH tiers: the components filter below and the
   * patterns filter the panel runs on the rows it reads for itself. One
   * object rather than two literals, so the two filters cannot come to walk
   * different graphs — and so the callback handed down keeps its identity
   * across renders the read did not change.
   */
  const componentGraph = useMemo<ComponentGraph>(
    () => ({
      definitions: componentLibrary.definitions,
      limits: documentLimits,
      whole: !componentLibrary.truncated,
    }),
    [componentLibrary.definitions, componentLibrary.truncated, documentLimits]
  );
  const offered = useMemo<ComponentLibraryRead>(() => {
    const components = withoutSelf(
      componentLibrary.components,
      initialDocument,
      identity,
      componentGraph
    );
    return components === componentLibrary.components
      ? componentLibrary
      : { ...componentLibrary, components };
  }, [componentLibrary, initialDocument, identity, componentGraph]);
  /*
   * The pattern tier is read inside the panel — it is mounted only while the
   * panel is open — so the RULE comes down and the rows stay there.
   */
  const offerablePatterns = useCallback(
    (patterns: readonly SavedPattern[]): readonly SavedPattern[] =>
      withoutSelfPatterns(patterns, initialDocument, identity, componentGraph),
    [initialDocument, identity, componentGraph]
  );

  return { offered, offerablePatterns };
}

/** What `usePanelRequests` returns. */
type PanelRequests = {
  openPanelRequest:
    | { panel: LeftPanel; view?: string; count: number; unlessHidden?: boolean }
    | undefined;
  requestPanel: RequestPanel;
  /**
   * Open Add; given a place a "+" chose, add there whatever the block: inside
   * a container (its empty-container "+"), or in the gap right after a block
   * (the "+" between sections). Neither is what selecting the block implies.
   */
  openInsertPanel: (place?: InsertPlaceRequest, tab?: AddTab) => void;
  /** The tab the press Add has yet to answer asks for, if it names one. */
  addSummonTab: AddTab | undefined;
  /**
   * Opens Add as the editor's own request, on an empty page: shown in the
   * left side unless the author hid that side themselves.
   */
  openAddUnlessHidden: () => void;
  /** The container the last "+" chose to add inside, if any. */
  insertInside: string | undefined;
  /** The block the last gap's "+" chose to add right after, if any. */
  insertAfter: string | undefined;
  /** The position the in-place picker carried into Add, if any. */
  insertAt: InsertPosition | undefined;
  /**
   * The count of canvas add presses Add has yet to answer, or `undefined`
   * when it has answered them all: each new one has the panel focus its
   * search, go back to the top and highlight where the block goes, whether
   * it opens for the press or was already open.
   */
  addSummon: number | undefined;
  /** Told by Add each press it has answered. */
  onAddSummoned: (count: number) => void;
  /**
   * Opens Design on its Styles tab with one block type's Block styles opened
   * and brought into view: the block panel's "Edit block styles".
   */
  openBlockStyles: (blockType: string) => void;
  /** The group Design has yet to reveal, or `undefined` once it has. */
  designReveal: DesignRevealRequest | undefined;
  /** Told by Design each reveal request it has answered. */
  onDesignRevealed: (count: number) => void;
};

/**
 * Asks the shell for a panel, and for Design names one of its own tabs, so
 * a request naming a tab Design does not have is refused when compiled
 * rather than opening the first tab.
 */
interface RequestPanel {
  (panel: LeftPanel): void;
  // A tab, or the Fonts screen opened over the panel.
  (panel: "design", view?: DesignView | typeof FONTS_SCREEN_VIEW): void;
  (panel: Exclude<LeftPanel, "design">, view?: string): void;
}

/** A tab of the Add panel a press can ask for. */
type AddTab = "blocks" | "sections";

/** A position in the page, as the in-place picker names one. */
type InsertPosition = Extract<InsertPlace, { at: unknown }>["at"];

/**
 * A place a canvas "+" or the in-place picker chose: inside a container,
 * right after a block, or any other position, with the selection it was
 * chosen under.
 */
type InsertPlaceRequest =
  | { readonly inside: string }
  | { readonly after: string }
  | { readonly at: InsertPosition; readonly selected: string | null };

/**
 * The selection a place request lasts while: the block it is about, or, for
 * a position, the selection it was chosen under. Selecting anything else
 * drops it.
 */
function requestedBlock(place: InsertPlaceRequest): string | null {
  if ("inside" in place) return place.inside;
  return "after" in place ? place.after : place.selected;
}

/** The place a held request names, as the Add panel is handed it. */
function heldPlaces(
  held: InsertPlaceRequest | undefined
): Pick<PanelRequests, "insertInside" | "insertAfter" | "insertAt"> {
  return {
    insertInside:
      held !== undefined && "inside" in held ? held.inside : undefined,
    insertAfter: held !== undefined && "after" in held ? held.after : undefined,
    insertAt: held !== undefined && "at" in held ? held.at : undefined,
  };
}

/** Requests to open a panel from the canvas. */
function usePanelRequests(selectedId: string | null): PanelRequests {
  /*
   * Opens the insert panel from the canvas itself, for the empty-container
   * appender: pressing its "+" must select the container AND show the panel
   * that fills it as one gesture, never two.
   *
   * A counter bumped on every press, not a boolean: `BuilderShell` reads this
   * as "open it AGAIN", including when the author has since closed the panel
   * by hand, and a value that repeated itself would look unchanged and do
   * nothing the second time. Starts `undefined` rather than `0` so mounting
   * the editor is not itself a press.
   */
  /*
   * A request to open one panel, carrying its own count so the shell can tell a
   * second press from the first. One piece of state for every panel that asks:
   * the appender opens Add, and the fonts tab sends an author to Design's
   * variables to fix a typeface the site does not provide.
   */
  const [openPanelRequest, setOpenPanelRequest] = useState<
    | { panel: LeftPanel; view?: string; count: number; unlessHidden?: boolean }
    | undefined
  >(undefined);
  const requestPanel = useCallback((panel: LeftPanel, view?: string): void => {
    setOpenPanelRequest(current => ({
      panel,
      ...(view === undefined ? {} : { view }),
      count: (current?.count ?? 0) + 1,
    }));
  }, []);
  const [placeRequest, setPlaceRequest] = useState<
    InsertPlaceRequest | undefined
  >(undefined);
  /*
   * Canvas presses for Add, counted apart from the panel request: opening a
   * panel that is already open changes nothing the shell can show, so the
   * panel answers each press itself, and says when it has, so a later open
   * from the rail replays no press.
   */
  const [addPresses, setAddPresses] = useState(0);
  const [answeredPress, setAnsweredPress] = useState(0);
  const [pressTab, setPressTab] = useState<AddTab | undefined>(undefined);
  const reveals = useDesignReveals(requestPanel);
  const openInsertPanel = useCallback(
    (place?: InsertPlaceRequest, tab?: AddTab): void => {
      setPlaceRequest(place);
      setPressTab(tab);
      setAddPresses(count => count + 1);
      requestPanel("add");
    },
    [requestPanel]
  );
  const openAddUnlessHidden = useCallback((): void => {
    setOpenPanelRequest(current => ({
      panel: "add",
      count: (current?.count ?? 0) + 1,
      unlessHidden: true,
    }));
  }, []);
  /*
   * A "+"'s choice lasts while its block stays selected. Selecting anything
   * else, the block just added included, ends it, so selecting the block
   * again later places as any selection does.
   */
  const held =
    placeRequest !== undefined && requestedBlock(placeRequest) === selectedId
      ? placeRequest
      : undefined;
  if (placeRequest !== undefined && held === undefined) {
    setPlaceRequest(undefined);
  }

  return {
    openPanelRequest,
    requestPanel,
    openInsertPanel,
    ...heldPlaces(held),
    addSummon: addPresses > answeredPress ? addPresses : undefined,
    addSummonTab: addPresses > answeredPress ? pressTab : undefined,
    onAddSummoned: setAnsweredPress,
    openAddUnlessHidden,
    ...reveals,
  };
}

/**
 * "Edit block styles": Design asked for its Styles tab, and the type's group
 * asked to be revealed there. Counted, as Add's presses are, and answered by
 * the panel once its tab is open, so the panel opened later from the rail
 * replays nothing.
 */
function useDesignReveals(
  requestPanel: RequestPanel
): Pick<
  PanelRequests,
  "openBlockStyles" | "designReveal" | "onDesignRevealed"
> {
  const [asked, setAsked] = useState<DesignRevealRequest | undefined>(
    undefined
  );
  const [answered, setAnswered] = useState(0);
  const openBlockStyles = useCallback(
    (blockType: string): void => {
      setAsked(current => ({
        view: "styles",
        group: blockStyleFoldId(blockType),
        count: (current?.count ?? 0) + 1,
      }));
      requestPanel("design", "styles");
    },
    [requestPanel]
  );
  return {
    openBlockStyles,
    designReveal:
      asked !== undefined && asked.count > answered ? asked : undefined,
    onDesignRevealed: setAnswered,
  };
}

/**
 * What the canvas and the pictures are drawn in, held above the panels so
 * both outlast them: the site mode the canvas is previewed in (picked on the
 * top bar's switch, which the site's variables decide is offered; kept for
 * the session only) and the editor's picture session (what pictures' async
 * blocks drew, and which sections were already seen).
 */
function useDrawnLook(siteTokens: SiteTokenSet | undefined): {
  readonly previewMode: CanvasPreviewMode;
  readonly pictureSession: MiniatureSession;
} {
  return {
    previewMode: useCanvasPreviewMode(siteTokens),
    pictureSession: useMiniatureSession(usePictureContext()),
  };
}

/**
 * The panels' side of the editor: what the rail offers, the entry's own
 * fields, the getting-started card, the offered library and the requests.
 */
export function useEditorPanels<TFieldValues extends FieldValues>(
  mount: EditorMount,
  /**
   * The entry's form, and the canvas the Layout's regions are scrolled to.
   * The page's Layout regions are rows in Layers, drawn on the canvas beside
   * them; its section is handed to the Settings dialog. And the site's
   * variables as the canvas draws with them, or `undefined` while they are
   * read, which decide whether the light and dark preview is offered.
   */
  page: {
    control: Control<TFieldValues>;
    canvasRoot: HTMLElement | null;
    siteTokens: SiteTokenSet | undefined;
  }
): EditorPanels {
  const { editor, clientConfig } = mount;
  // The page's header & footer section, or null for a form that is not a
  // page's: Page settings draws its menu on General where it is not null.
  const pageLayout = usePageLayoutSettings(page.control);
  // From the form's unsaved values, so a change of Layout redraws at once,
  // with the header or footer selected on the canvas or in Layers.
  const layoutRegions = usePageRegions(
    page.control,
    page.canvasRoot,
    editor,
    useLookEditing(editor)
  );

  /*
   * The getting-started card, and the host's switch for it.
   *
   * `checklist === false` is the only value that turns it off: an absent
   * config and a malformed one both leave it on, because the default is the
   * behaviour a site that configured nothing asked for.
   */
  const checklistStore = useMemo(
    () => checklistStoreFor(mount.userId),
    [mount.userId]
  );
  // The author's folded Design groups, kept under their own key.
  const designFolds = useMemo(
    () => designFoldsStoreFor(mount.userId),
    [mount.userId]
  );
  const identity = useDocumentIdentity();
  const checklist = useBuilderChecklist({
    document: editor.document,
    documentKey: identityKey(identity),
    // Not until the author is known: their own dismissal is the one to read,
    // and a card drawn before it arrives would flash for an author who
    // dismissed it.
    enabled: clientConfig?.checklist !== false && checklistStore !== undefined,
    ...(checklistStore === undefined ? {} : { store: checklistStore }),
  });

  const library = useOfferedLibrary(mount);
  const requests = useEditorRequests(editor);
  // Whether the editor's search is open: ⌘K opens it, and so does the top
  // bar's button, so the state sits above both.
  const [searchOpen, setSearchOpen] = useState(false);
  // The Pages panel, and the request its rows send to open Settings.
  const pages = usePagesPanel(mount.initialDocument.kind === "page");
  // Which look the inspector edits on its own: chosen in the Design panel,
  // left by selecting a block or a header or footer, by the bar's Back, or
  // by Esc. Choosing one leaves a selected header or footer.
  const { lookEditing } = layoutRegions;
  const { previewMode, pictureSession } = useDrawnLook(page.siteTokens);
  return {
    lookEditing,
    previewMode,
    pictureSession,
    search: { open: searchOpen, setOpen: setSearchOpen },
    pages,
    checklist,
    designFolds,
    // Settings is a dialog, not a panel: the entry's fields are drawn in Page
    // settings' General and Fields tabs.
    availablePanels: AVAILABLE_PANELS,
    pageLayout,
    canvasRegions: layoutRegions.canvas,
    siteTokens: page.siteTokens,
    layersRegions: layoutRegions.selectedRegion.layers,
    selectedRegion: layoutRegions.selectedRegion,
    regionCards: layoutRegions.cards,
    ...library,
    ...requests,
  };
}

/**
 * The requests that open a panel from the canvas, and the in-place picker,
 * opened by "/" and by the canvas's add controls, with its way on to Add.
 */
function useEditorRequests(
  editor: EditorMount["editor"]
): PanelRequests & Pick<EditorPanels, "insertPicker" | "browseAll"> {
  const requests = usePanelRequests(editor.selectedId);
  const picker = usePickerPanel(editor, requests.openInsertPanel);
  useAddOnEmptyOpen(
    editor.document.nodes.length === 0,
    requests.openAddUnlessHidden
  );
  return { ...requests, ...picker };
}

/**
 * An editor that opens on a document holding no blocks opens Add, which is
 * what an empty page needs first, unless the author hid the left side; asked
 * once, when the editor opens, and never again as blocks come and go.
 */
function useAddOnEmptyOpen(empty: boolean, openAdd: () => void): void {
  const openedEmpty = useRef(empty);
  useEffect(() => {
    if (openedEmpty.current) openAdd();
  }, [openAdd]);
}

/** The in-place picker's state, and "Browse all" carrying its target on. */
function usePickerPanel(
  editor: EditorMount["editor"],
  openInsertPanel: PanelRequests["openInsertPanel"]
): Pick<EditorPanels, "insertPicker" | "browseAll"> {
  const insertPicker = useInsertPicker();
  const browseAll = useBrowseAll(editor, openInsertPanel);
  return { insertPicker, browseAll };
}

/**
 * "Browse all blocks and sections →": the Add panel opened with the picker's
 * target, so a block clicked there lands where it would have in the picker.
 *
 * - By the rule ("/"), nothing is carried: the panel places each block from
 *   the selection, as the picker did.
 * - A container's inside, or the gap after a block: that block is selected
 *   and the place carried, as the canvas's "+" does, so the place holds
 *   until another block is selected or a block is added.
 * - Any other position: carried while the selection stays as it is.
 */
function useBrowseAll(
  editor: EditorMount["editor"],
  openInsertPanel: PanelRequests["openInsertPanel"]
): (target: InsertPickerTarget) => void {
  return useCallback(
    (target: InsertPickerTarget): void => {
      if (target.kind === "rule") {
        openInsertPanel();
        return;
      }
      const { place } = target;
      if ("at" in place) {
        openInsertPanel({ at: place.at, selected: editor.selectedId });
        return;
      }
      editor.select("inside" in place ? place.inside : place.after);
      openInsertPanel(place);
    },
    [editor, openInsertPanel]
  );
}

/** No saved sections, while the library is not being read. */
const NO_PATTERNS: readonly SavedPattern[] = [];

/**
 * The in-place picker, with the Add panel's own sources: the registry's
 * blocks, the offered components, and the saved sections, which are read
 * only while the picker is open, as the Add panel reads them only while it
 * is.
 */
export function EditorInsertPicker({
  panels,
  editor,
  onEditText,
}: {
  panels: Pick<
    EditorPanels,
    "insertPicker" | "browseAll" | "offered" | "offerablePatterns"
  >;
  editor: EditorMount["editor"];
  /** Opens a new block's text for typing, as Enter does. */
  onEditText: ((nodeId: string) => boolean) | undefined;
}): React.JSX.Element {
  const [patterns, setPatterns] =
    useState<readonly SavedPattern[]>(NO_PATTERNS);
  const { request, close } = panels.insertPicker;
  return (
    <>
      {request === null ? null : (
        <PickerPatternRead
          offerablePatterns={panels.offerablePatterns}
          onRead={setPatterns}
        />
      )}
      <InsertPicker
        request={request}
        onClose={close}
        editor={editor}
        categoryOrder={CORE_CATEGORIES}
        blockOrder={CORE_PALETTE_ORDER}
        patterns={patterns}
        components={panels.offered.components}
        componentDefinitions={panels.offered.definitions}
        onBrowseAll={panels.browseAll}
        {...(onEditText === undefined ? {} : { onEditText })}
      />
    </>
  );
}

/**
 * The saved sections the picker may offer, read while it is mounted and
 * handed up: the picker itself stays mounted after it closes, so the sentence
 * announcing an insert outlives it.
 */
function PickerPatternRead({
  offerablePatterns,
  onRead,
}: {
  offerablePatterns: OfferedLibrary["offerablePatterns"];
  onRead: (patterns: readonly SavedPattern[]) => void;
}): null {
  const library = usePatternLibrary();
  const patterns = useMemo(
    () => offerablePatterns(library.patterns),
    [offerablePatterns, library.patterns]
  );
  useEffect(() => onRead(patterns), [onRead, patterns]);
  return null;
}

/**
 * The panels' side of the editor, as `useEditorPanels` reads it: the offered
 * library's and the panel requests' own results, so a value either adds
 * reaches this type without being listed again, beside the members this hook
 * computes itself.
 */
export type EditorPanels = OfferedLibrary &
  PanelRequests & {
    checklist: UseBuilderChecklistResult;
    /** Where the author's folded Design groups are kept, once they are known. */
    designFolds: PreferenceStore | undefined;
    /** The page's Layout section for Settings, or null for another form. */
    pageLayout: ReactNode | null;
    /** The regions of the page's Layout, drawn locked around the page. */
    canvasRegions: readonly CanvasRegion[];
    /** The site's variables as the panels offer them, once they are read. */
    siteTokens: SiteTokenSet | undefined;
    /** The same regions, as rows in Layers that select them. */
    layersRegions: readonly LayersRegionRow[];
    /** The header or footer selected, and what reads it. */
    selectedRegion: SelectedRegion;
    /** What each region drawn around the page is, and the set it is from. */
    regionCards: readonly RegionCardFacts[];
    availablePanels: typeof AVAILABLE_PANELS;
    search: { open: boolean; setOpen: (open: boolean) => void };
    pages: PagesPanelMount;
    /** The look edited on its own from the Design panel, with no block. */
    lookEditing: LookEditingState;
    /** The in-place picker's state, opened by "/" and the canvas's controls. */
    insertPicker: InsertPickerState;
    /** "Browse all" from the picker: Add, with the picker's target carried. */
    browseAll: (target: InsertPickerTarget) => void;
    /**
     * The site mode the canvas is previewed in, for this session only: the
     * top bar's switch picks it, and the frame, its pictures and the Design
     * panel's swatches are drawn in it.
     */
    previewMode: CanvasPreviewMode;
    /** What the editor's pictures share for as long as it is open. */
    pictureSession: MiniatureSession;
  };

/**
 * What the shell renders into the open panel.
 *
 * A function of the editor's readings rather than a component, so the shell
 * is handed the same renderer it always was and the tree under each panel is
 * unchanged.
 */
export function editorPanelRenderer({
  editor,
  documentLimits,
  componentLibrary,
  componentVerbs,
  componentView,
  layersRegions,
  canvasRegions,
  drag,
  offered,
  offerablePatterns,
  canvasSiteStyle,
  siteStylePending,
  siteStyleError,
  configSiteStyle,
  storedSiteStyle,
  unreadableStoredFonts,
  classes,
  pageClassBlocks,
  classSummaryContext,
  insertInside,
  insertAfter,
  insertAt,
  addSummon,
  addSummonTab,
  onAddSummoned,
  pages,
  canvasRender,
  editedBreakpoint,
  canvasElement,
  layerVerbs,
  documentDirty,
  lookEditing,
  previewMode,
  designFolds,
  designReveal,
  onDesignRevealed,
  pictureSession,
}: Pick<
  EditorMount,
  "editor" | "componentLibrary" | "componentVerbs" | "documentLimits"
> & {
  /** The look edited on its own, which the Design panel's Block looks choose. */
  lookEditing?: LookEditingState;
  /**
   * The site mode the canvas is previewed in, which the Design panel's
   * swatches and the section pictures show too. Absent, they show the mode
   * the canvas draws by itself.
   */
  previewMode?: CanvasPreviewMode;
  /** Whether the editor holds work not yet saved, for the Pages panel's copy note. */
  documentDirty: boolean;
  /** The regions of the page's Layout, as read-only rows in Layers. */
  layersRegions?: readonly LayersRegionRow[];
  /**
   * The block verbs the verbs provider shares, for the Layers row menu: drawn
   * in the shell's panel region, outside the provider, so they are handed
   * across as the inspector's card menu has them.
   */
  layerVerbs?: React.ComponentProps<typeof LayersPanel>["verbs"];
  /** "Edit component", which the Components panel offers on each row. */
  componentView: Pick<ComponentView, "onEditComponent">;
} & Pick<
    SiteStyleInputs,
    | "canvasSiteStyle"
    | "siteStylePending"
    | "siteStyleError"
    | "configSiteStyle"
    | "storedSiteStyle"
    | "unreadableStoredFonts"
    | "classes"
  > &
  Pick<
    CanvasInputs,
    | "drag"
    | "pageClassBlocks"
    | "classSummaryContext"
    | "canvasRender"
    | "editedBreakpoint"
    | "canvasElement"
  > &
  Pick<
    EditorPanels,
    | "offered"
    | "offerablePatterns"
    | "insertInside"
    | "insertAfter"
    | "insertAt"
    | "addSummon"
    | "addSummonTab"
    | "onAddSummoned"
    | "pages"
    | "designFolds"
    | "pictureSession"
    | "canvasRegions"
  > &
  Partial<
    Pick<EditorPanels, "designReveal" | "onDesignRevealed">
  >): React.ComponentProps<typeof BuilderShell>["renderPanel"] {
  return (panel, view) => {
    /*
            A lookup rather than a chain of comparisons, so the arrow answers
            in one step and adding a panel is one entry rather than one more
            branch. It also states the pairing the shell needs: every key here
            is a panel this file can fill, and `AVAILABLE_PANELS` is what the
            rail offers — a test holds the two to each other, so a panel that
            is offered and renders nothing cannot ship.
          */
    const panels: Partial<Record<LeftPanel, () => React.ReactNode>> = {
      add: () => (
        <InsertPanelWithLibrary
          editor={editor}
          categoryOrder={CORE_CATEGORIES}
          blockOrder={CORE_PALETTE_ORDER}
          beginInsertDrag={drag.beginInsertDrag}
          components={offered}
          offerablePatterns={offerablePatterns}
          // Inside the container a "+" chose, while it is the selection.
          {...(insertInside === undefined ? {} : { inside: insertInside })}
          // In the gap a "+" chose, while the block above it is selected.
          {...(insertAfter === undefined ? {} : { after: insertAfter })}
          // At the position the in-place picker carried, while it holds.
          {...(insertAt === undefined ? {} : { at: insertAt })}
          // A canvas press still to answer, whether Add opened for it or
          // was already open.
          summoned={addSummon}
          {...(addSummonTab === undefined ? {} : { summonedTab: addSummonTab })}
          onSummoned={onAddSummoned}
          pictures={{
            siteStyle: canvasSiteStyle,
            mode: previewMode?.mode,
            session: pictureSession,
          }}
        />
      ),
      /*
              The site's components, from the SAME offered read Add's
              "Your components" group and the editor's search are handed, so
              a component this author may not read is offered nowhere, and
              placed through Add's own path, so the two panels cannot place
              differently. The rows the read holds and the panel does not
              offer are the ones this document cannot contain: the
              component being edited, and those that place it.
            */
      components: () => (
        <ComponentsPanel
          editor={editor}
          components={offered.components}
          componentDefinitions={offered.definitions}
          loading={offered.state === "pending"}
          library={{
            components: tierStateOf(offered),
            retry: offered.retry,
          }}
          withheld={
            componentLibrary.components.length - offered.components.length
          }
          beginInsertDrag={drag.beginInsertDrag}
          {...(insertInside === undefined ? {} : { inside: insertInside })}
          {...(insertAfter === undefined ? {} : { after: insertAfter })}
          {...(insertAt === undefined ? {} : { at: insertAt })}
          // From the panel there is no placement, so Back returns to the
          // editor as the author left it.
          {...(componentView.onEditComponent === undefined
            ? {}
            : { onEditComponent: componentView.onEditComponent })}
          mayCreate={componentVerbs.mayCreate}
        />
      ),
      /*
              The panel cannot work this out for itself. It is drawn here, in
              the shell's panel region, while `BlockKeyboardActions` below wraps
              the shell's CHILDREN — sibling subtrees, so nothing the panel can
              read from where it sits reports what this file knows by writing
              both. Passed as a fact rather than inferred.

              The component definitions go with it so a dragged instance is
              judged by what it draws, as its drop on the canvas is.
            */
      layers: () => (
        <LayersPanel
          editor={editor}
          moveHints
          definitions={offered.definitions}
          regions={layersRegions}
          // Its titles come with the read, so a placement of a component
          // the panel does not offer (the one being edited) is still named.
          componentTitle={offered.titleOf}
          // The device the eye hides on: the one being edited, against the
          // breakpoints the canvas is compiled with. Withheld until the
          // site's stored breakpoints have been read: until then the set in
          // hand is the config's defaults, and a hide written against it
          // could resolve differently against the site's own.
          {...(siteStylePending || siteStyleError !== null
            ? {}
            : {
                device: {
                  breakpoints: canvasRender.styleContext.breakpoints,
                  id: editedBreakpoint,
                },
              })}
          // Inside the shell's shortcut provider, so the row keys register
          // with it and Help lists them.
          shortcuts
          // A row chosen there scrolls its block into view here.
          canvasRoot={canvasElement}
          {...(layerVerbs === undefined ? {} : { verbs: layerVerbs })}
        />
      ),
      // Read when the panel is drawn, as every other entry reads its inputs,
      // so drawing another panel never needs the Pages panel's mount.
      pages: () => pages.renderPagesPanel({ unsavedWork: documentDirty }),
      design: () => (
        <DesignPanel
          view={view}
          {...(designFolds === undefined ? {} : { foldStore: designFolds })}
          // A block type's styles asked for by "Edit block styles", shown
          // once the Styles tab is open.
          {...(designReveal === undefined
            ? {}
            : { revealRequest: designReveal })}
          {...(onDesignRevealed === undefined
            ? {}
            : { onRevealed: onDesignRevealed })}
          // The studio surrounds every tab, so the header it draws stays the
          // same whichever is open.
          frame={designTabs => (
            <>
              {/* The Styles tab's matches, counted whichever tab is open. */}
              <ReportStylesMatches
                library={classes.library}
                suppliedClassIds={configSiteStyle?.classes?.map(
                  entry => entry.id
                )}
                styleContext={classSummaryContext}
              />
              <DesignFonts
                faces={offerableFaces(
                  canvasSiteStyle,
                  siteStylePending,
                  siteStyleError
                )}
                fromCode={configSiteStyle?.fonts ?? []}
                // Every Font control's "Manage fonts…" opens the Fonts screen.
                onManageFonts={() => view.choose(FONTS_SCREEN_VIEW)}
              >
                <TokensStudio
                  merged={offerableTokens(
                    canvasSiteStyle,
                    siteStylePending,
                    siteStyleError
                  )}
                  supplied={configSiteStyle?.tokens}
                  pending={siteStylePending}
                  // The class surface's library, the one the Shared styles tab
                  // lists, so a style using a variable says what it sets.
                  {...(classes.library === undefined
                    ? {}
                    : { classes: classes.library })}
                  // A shared style using a variable opens in its own tab; a
                  // block look, which that tab does not list, in the inspector.
                  opens={{
                    sharedStyles: () => view.choose("styles"),
                    ...(lookEditing === undefined
                      ? {}
                      : { look: lookEditing.edit }),
                  }}
                  // The mode the canvas is previewed in, picked in the top
                  // bar, so the swatches show what the canvas shows.
                  {...(previewMode === undefined
                    ? {}
                    : { mode: previewMode.mode })}
                >
                  {designTabs}
                </TokensStudio>
              </DesignFonts>
            </>
          )}
          // The one Fonts screen, over the panel: the site's fonts with the
          // same writers the admin's Fonts page has.
          fonts={close => (
            <DesignReveal>
              {reveal => (
                <SiteFontsScreen
                  faces={offerableFaces(
                    canvasSiteStyle,
                    siteStylePending,
                    siteStyleError
                  )}
                  codeFaces={configSiteStyle?.fonts}
                  tokens={renderedTokens(
                    canvasSiteStyle,
                    siteStylePending,
                    siteStyleError
                  )}
                  absence={siteStyleError !== null ? "failed" : "pending"}
                  onClose={close}
                  // A font variable is changed in the Type tab's variables:
                  // the screen closes onto it, its group opened and in view.
                  onOpenTokens={() => {
                    view.choose("type");
                    reveal("fonts");
                  }}
                  storedFaces={storedSiteStyle?.fonts}
                  storedPending={siteStylePending}
                  unreadableFonts={unreadableStoredFonts}
                />
              )}
            </DesignReveal>
          )}
          tabs={{
            colours: () => (
              <ColoursTab
                document={editor.document}
                components={componentLibrary.definitions}
                regions={canvasRegions}
                limits={documentLimits}
              />
            ),
            // Type: the Body and Headings fonts, the way to the Fonts screen,
            // then the type sizes and the font and weight variables.
            type: () => (
              <>
                <FontRolesTab />
                <button
                  type="button"
                  className="nx-vars__link nx-fonts-manage"
                  onClick={() => view.choose(FONTS_SCREEN_VIEW)}
                  // Where focus returns when the screen closes.
                  data-fonts-manage=""
                >
                  Manage fonts…
                </button>
                <VariablesTab tab="type" />
              </>
            ),
            spacing: () => <VariablesTab tab="spacing" />,
            styles: () => (
              <SharedStylesStudio
                {...(lookEditing === undefined
                  ? {}
                  : {
                      looks: {
                        onEdit: lookEditing.edit,
                        editing: lookEditing.look,
                      },
                    })}
                classes={classes}
                pageBlocks={pageClassBlocks}
                styleContext={classSummaryContext}
                suppliedClassIds={configSiteStyle?.classes?.map(
                  entry => entry.id
                )}
                // The same variables the Fonts tab reads, as the canvas draws.
                tokens={renderedTokens(
                  canvasSiteStyle,
                  siteStylePending,
                  siteStyleError
                )}
              />
            ),
          }}
        />
      ),
    };
    return panels[panel]?.() ?? null;
  };
}
