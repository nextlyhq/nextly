"use client";

/**
 * The editor's left panels: which are offered, what fills each, the requests
 * that open one from elsewhere on the surface, and the library the Add panel
 * may offer.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-panels
 */
import { spacingModeOf } from "@nextlyhq/blocks-engine";
import {
  CORE_CATEGORIES,
  CORE_PALETTE_ORDER,
} from "@nextlyhq/blocks-react/blocks";
import {
  browserStore,
  type LeftPanel,
  type PreferenceStore,
  type SavedPattern,
} from "@nextlyhq/builder";
import {
  type UseBuilderChecklistResult,
  CHECKLIST_STORAGE_KEY,
  ComponentsPanel,
  InsertPanel,
  LayersPanel,
  useBuilderChecklist,
  type BuilderShell,
  type CanvasRegion,
  type LayersRegionRow,
  type LibraryTierState,
  type VariablesPreview,
} from "@nextlyhq/builder/shell";
import {
  useDocumentIdentity,
  useEntryFieldsPanel,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";

import type { ComponentLibraryRead } from "../component-library-client";
import { usePageLayoutRegions, usePageLayoutSettings } from "../page-layout";
import {
  usePatternLibrary,
  type LibraryReadState,
} from "../pattern-library-client";

import {
  useCanvasPreviewMode,
  type CanvasPreviewMode,
} from "./canvas-preview-mode";
import { DesignPanel } from "./design-panel";
import { useLookEditing, type LookEditingState } from "./look-editing";
import {
  withoutSelf,
  withoutSelfPatterns,
  type ComponentGraph,
} from "./offered-library";
import { usePagesPanel, type PagesPanelMount } from "./pages-panel";
import {
  FontsPanelWithUpload,
  offerableFaces,
  offerableTokens,
  renderedTokens,
  SharedStylesStudio,
  TokensStudio,
  VariablesTab,
} from "./site-style-studios";
import type { ComponentView } from "./use-component-view";
import type { EditorMount } from "./use-editor-mount";
import type { CanvasInputs, SiteStyleInputs } from "./use-render-inputs";

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
 * Where the getting-started card's dismissal is kept: under the author's own
 * key, so dismissing it is one author's choice in a browser two people share.
 * With no author known, the card's own browser-wide default.
 */
function checklistStoreFor(userId: string | null): PreferenceStore | undefined {
  return userId === null
    ? undefined
    : browserStore(`${CHECKLIST_STORAGE_KEY}:${userId}`);
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
  ...props
}: {
  editor: React.ComponentProps<typeof InsertPanel>["editor"];
  categoryOrder: React.ComponentProps<typeof InsertPanel>["categoryOrder"];
  blockOrder: React.ComponentProps<typeof InsertPanel>["blockOrder"];
  beginInsertDrag: React.ComponentProps<typeof InsertPanel>["beginInsertDrag"];
  /** The container to add inside, when its "+" asked for it. */
  inside?: string;
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
}): React.JSX.Element {
  const library = usePatternLibrary();
  const patterns = useMemo(
    () => offerablePatterns(library.patterns),
    [offerablePatterns, library.patterns]
  );
  return (
    <InsertPanel
      {...props}
      patterns={patterns}
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
    | { panel: LeftPanel; view?: string; count: number }
    | undefined;
  requestPanel: (panel: LeftPanel, view?: string) => void;
  /**
   * Open Add; given a container, add inside it (its empty-container "+"),
   * which is never implied by selecting it.
   */
  openInsertPanel: (inside?: string) => void;
  /** The container the last "+" chose to add inside, if any. */
  insertInside: string | undefined;
};

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
    { panel: LeftPanel; view?: string; count: number } | undefined
  >(undefined);
  const requestPanel = useCallback((panel: LeftPanel, view?: string): void => {
    setOpenPanelRequest(current => ({
      panel,
      ...(view === undefined ? {} : { view }),
      count: (current?.count ?? 0) + 1,
    }));
  }, []);
  const [insideRequest, setInsideRequest] = useState<string | undefined>(
    undefined
  );
  const openInsertPanel = useCallback(
    (inside?: string): void => {
      setInsideRequest(inside);
      requestPanel("add");
    },
    [requestPanel]
  );
  /*
   * A "+"'s choice lasts while its container stays selected. Selecting
   * anything else, the block just added included, ends it, so selecting the
   * container again later adds after it, as any selection does.
   */
  if (insideRequest !== undefined && selectedId !== insideRequest) {
    setInsideRequest(undefined);
  }
  const insertInside = insideRequest === selectedId ? insideRequest : undefined;

  return {
    openPanelRequest,
    requestPanel,
    openInsertPanel,
    insertInside,
  };
}

/**
 * The panels' side of the editor: what the rail offers, the entry's own
 * fields, the getting-started card, the offered library and the requests.
 */
export function useEditorPanels<TFieldValues extends FieldValues>(
  mount: EditorMount,
  name: string,
  /**
   * The entry's form, and the canvas the Layout's regions are scrolled to.
   * The page's Layout regions are rows in Layers, drawn on the canvas beside
   * them; its section is handed to the Settings dialog.
   */
  page: {
    control: Control<TFieldValues>;
    canvasRoot: HTMLElement | null;
  }
): EditorPanels {
  const { editor, clientConfig } = mount;
  // The Layout section for the Settings dialog's "This page" tab, or null for
  // a form that is not a page's.
  const pageLayout = usePageLayoutSettings(page.control);
  // From the form's unsaved values, so a change of Layout redraws at once.
  const layoutRegions = usePageLayoutRegions(page.control, page.canvasRoot);
  /*
   * The entry's other fields, ALREADY DRAWN, or null when there are none.
   *
   * One value feeds both the rail's availability and the panel's body below,
   * so the two cannot disagree about whether there is anything to show. Asking
   * separately is what put an empty Settings panel on the rail: every entry
   * form has a renderer, so a gate on the renderer's existence is true even for
   * a collection whose only fields are its title, its slug and this one.
   */
  // Flat, for the Settings dialog that frames them: no section cards, the
  // slug read as the page's address.
  const entryFields = useEntryFieldsPanel(name, { presentation: "dialog" });

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
  const requests = usePanelRequests(editor.selectedId);
  // Whether the editor's search is open: ⌘K opens it, and so does the top
  // bar's button, so the state sits above both.
  const [searchOpen, setSearchOpen] = useState(false);
  // The Pages panel, and the request its rows send to open Settings.
  const pages = usePagesPanel(mount.initialDocument.kind === "page");
  // Which look the inspector edits on its own: chosen in the Design panel,
  // left by selecting a block, by the bar's Back, or by Esc.
  const lookEditing = useLookEditing(editor);
  // The site mode the canvas is previewed in: picked in the Design panel and
  // held here, above it, so it outlasts the panel; plain state, never stored,
  // so a reload draws the page's own mode again.
  const previewMode = useCanvasPreviewMode();
  return {
    entryFields,
    lookEditing,
    previewMode,
    search: { open: searchOpen, setOpen: setSearchOpen },
    pages,
    checklist,
    // Settings is a dialog, not a panel: the entry's fields are drawn in its
    // "This page" tab.
    availablePanels: AVAILABLE_PANELS,
    pageLayout,
    canvasRegions: layoutRegions.canvas,
    layersRegions: layoutRegions.layers,
    ...library,
    ...requests,
  };
}

/**
 * The panels' side of the editor, as `useEditorPanels` reads it: the offered
 * library's and the panel requests' own results, so a value either adds
 * reaches this type without being listed again, beside the members this hook
 * computes itself.
 */
export type EditorPanels = OfferedLibrary &
  PanelRequests & {
    entryFields: ReactNode;
    checklist: UseBuilderChecklistResult;
    /** The page's Layout section for Settings, or null for another form. */
    pageLayout: ReactNode | null;
    /** The regions of the page's Layout, drawn locked around the page. */
    canvasRegions: readonly CanvasRegion[];
    /** The same regions, as read-only rows in Layers. */
    layersRegions: readonly LayersRegionRow[];
    availablePanels: typeof AVAILABLE_PANELS;
    search: { open: boolean; setOpen: (open: boolean) => void };
    pages: PagesPanelMount;
    /** The look edited on its own from the Design panel, with no block. */
    lookEditing: LookEditingState;
    /**
     * The site mode the author picked to preview the canvas in, for this
     * editing session only: the Design panel's switch picks it, the frame is
     * drawn in it, and the tag over the canvas clears it.
     */
    previewMode: CanvasPreviewMode;
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
  componentLibrary,
  componentVerbs,
  componentView,
  layersRegions,
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
  requestPanel,
  insertInside,
  pages,
  canvasRender,
  editedBreakpoint,
  canvasElement,
  layerVerbs,
  documentDirty,
  lookEditing,
  previewMode,
}: Pick<EditorMount, "editor" | "componentLibrary" | "componentVerbs"> & {
  /** The look edited on its own, which the Design panel's Block looks choose. */
  lookEditing?: LookEditingState;
  /**
   * The site mode the canvas is previewed in, which the Design panel's
   * preview switch picks. Absent, the switch previews the swatches alone.
   */
  previewMode?: VariablesPreview;
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
    "offered" | "offerablePatterns" | "requestPanel" | "insertInside" | "pages"
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
          // The studio surrounds every tab, so the header it draws stays the
          // same whichever is open.
          frame={designTabs => (
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
                sharedStyles: () => view.choose("classes"),
                ...(lookEditing === undefined
                  ? {}
                  : { look: lookEditing.edit }),
              }}
              // The switch in the panel's header picks the mode the canvas is
              // drawn in, held by the editor so it outlasts the panel.
              preview={previewMode}
              // Offered once the stored style is read, so the choice shows
              // the model the canvas is compiled under and nothing earlier.
              {...(siteStylePending || siteStyleError !== null
                ? {}
                : {
                    spacingMode: spacingModeOf(canvasSiteStyle?.spacingMode),
                  })}
            >
              {designTabs}
            </TokensStudio>
          )}
          tabs={{
            variables: () => <VariablesTab />,
            classes: () => (
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
            fonts: () => (
              <FontsPanelWithUpload
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
                /*
                      The fix for a token naming a family this site does not provide
                      is to edit that token, and editing belongs to the studio. This
                      shell offers one, so the jump is wired: without the callback
                      the panel suppresses the action and an author is left to find
                      the right panel and the right row themselves.
                    */
                onOpenTokens={() => requestPanel("design", "variables")}
                storedFaces={storedSiteStyle?.fonts}
                storedPending={siteStylePending}
                unreadableFonts={unreadableStoredFonts}
              />
            ),
          }}
        />
      ),
    };
    return panels[panel]?.() ?? null;
  };
}
