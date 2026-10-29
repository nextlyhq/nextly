"use client";

/**
 * The editor's left panels: which are offered, what fills each, the requests
 * that open one from elsewhere on the surface, and the library the insert
 * panel may offer.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-panels
 */
import { CORE_CATEGORIES } from "@nextlyhq/blocks-react/blocks";
import {
  DEFAULT_PREFERENCES,
  type LeftPanel,
  type SavedPattern,
} from "@nextlyhq/builder";
import {
  type UseBuilderChecklistResult,
  ClassManagerPanel,
  InsertPanel,
  LayersPanel,
  useBuilderChecklist,
  type BuilderShell,
  type LibraryTierState,
} from "@nextlyhq/builder/shell";
import {
  useDocumentIdentity,
  useEntryFieldsPanel,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useCallback,
  useMemo,
  useState,
  type SetStateAction,
  type ReactNode,
  type Dispatch,
} from "react";

import type { ComponentLibraryRead } from "../component-library-client";
import {
  usePatternLibrary,
  type LibraryReadState,
} from "../pattern-library-client";

import {
  withoutSelf,
  withoutSelfPatterns,
  type ComponentGraph,
} from "./offered-library";
import {
  FontsPanelWithUpload,
  offerableFaces,
  offerableTokens,
  renderedTokens,
  TokensStudio,
} from "./site-style-studios";
import type { EditorMount } from "./use-editor-mount";
import type { CanvasInputs, SiteStyleInputs } from "./use-render-inputs";

/**
 * Every left panel the editor can fill today.
 *
 * The inserter, the layers tree and the tokens studio; the rest are not built.
 * The shell draws all seven regardless and disables the ones nothing fills, so
 * the rail describes the editor's shape while never opening a region with
 * nothing in it. Listing a panel here that renders nothing would reserve space
 * and shrink the canvas to show it, which is why this grows one entry at a time
 * rather than being declared ahead of the panels.
 */
const AVAILABLE_PANELS = [
  "insert",
  "layers",
  "tokens",
  "fonts",
  "classes",
] as const;

/**
 * With an entry-fields panel to fill, `settings` joins them.
 *
 * Derived rather than declared twice: the shell draws a panel outside
 * `availablePanels` as disabled and "coming soon", and warns against OPENING
 * one nothing renders into — reserving width to display nothing reads as a
 * broken control rather than an absent feature. So the list and the renderer
 * move together by construction, and the rail cannot disagree with the body.
 */
const AVAILABLE_PANELS_WITH_SETTINGS: readonly [
  ...typeof AVAILABLE_PANELS,
  "settings",
] = [...AVAILABLE_PANELS, "settings"] as const;

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
  beginInsertDrag: React.ComponentProps<typeof InsertPanel>["beginInsertDrag"];
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
  openPanelRequest: { panel: LeftPanel; count: number } | undefined;
  requestPanel: (panel: LeftPanel) => void;
  openInsertPanel: () => void;
  showEmptyElements: boolean;
  setShowEmptyElements: Dispatch<SetStateAction<boolean>>;
};

/** Requests to open a panel from the canvas, and the empty-chrome switch. */
function usePanelRequests(): PanelRequests {
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
   * the appender opens `insert`, and the fonts panel sends an author to
   * `tokens` to fix a typeface the site does not provide.
   */
  const [openPanelRequest, setOpenPanelRequest] = useState<
    { panel: LeftPanel; count: number } | undefined
  >(undefined);
  const requestPanel = useCallback((panel: LeftPanel): void => {
    setOpenPanelRequest(current => ({
      panel,
      count: (current?.count ?? 0) + 1,
    }));
  }, []);
  const openInsertPanel = useCallback((): void => {
    requestPanel("insert");
  }, [requestPanel]);

  /*
   * Whether the author wants empty-container chrome showing at all, mirrored
   * from the shell so the appender mounted below can answer the same question
   * the dashed placeholder box's own CSS rule already answers.
   *
   * Starts at the preference's own default rather than an assumed `true`: the
   * shell reports the real value once it has read it, but that report lands
   * one render after this component's first — an assumed value would be a
   * SECOND declaration of the default that goes stale the day the shell's own
   * changes and this one does not.
   */
  const [showEmptyElements, setShowEmptyElements] = useState(
    DEFAULT_PREFERENCES.showEmptyElements
  );

  return {
    openPanelRequest,
    requestPanel,
    openInsertPanel,
    showEmptyElements,
    setShowEmptyElements,
  };
}

/**
 * The panels' side of the editor: what the rail offers, the entry's own
 * fields, the getting-started card, the offered library and the requests.
 */
export function useEditorPanels(
  mount: EditorMount,
  name: string
): EditorPanels {
  const { editor, clientConfig } = mount;
  /*
   * The entry's other fields, ALREADY DRAWN, or null when there are none.
   *
   * One value feeds both the rail's availability and the panel's body below,
   * so the two cannot disagree about whether there is anything to show. Asking
   * separately is what put an empty Settings panel on the rail: every entry
   * form has a renderer, so a gate on the renderer's existence is true even for
   * a collection whose only fields are its title, its slug and this one.
   */
  const entryFields = useEntryFieldsPanel(name);

  /*
   * The getting-started card, and the host's switch for it.
   *
   * `checklist === false` is the only value that turns it off: an absent
   * config and a malformed one both leave it on, because the default is the
   * behaviour a site that configured nothing asked for.
   */
  const checklist = useBuilderChecklist({
    document: editor.document,
    enabled: clientConfig?.checklist !== false,
  });

  const library = useOfferedLibrary(mount);
  const requests = usePanelRequests();
  return {
    entryFields,
    checklist,
    // The rail and the body read the same value, so a Settings panel is never
    // offered that renders nothing.
    availablePanels:
      entryFields === null ? AVAILABLE_PANELS : AVAILABLE_PANELS_WITH_SETTINGS,
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
    availablePanels:
      | typeof AVAILABLE_PANELS
      | typeof AVAILABLE_PANELS_WITH_SETTINGS;
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
  documentClasses,
  classSummaryContext,
  requestPanel,
  entryFields,
}: Pick<EditorMount, "editor"> &
  Pick<
    SiteStyleInputs,
    | "canvasSiteStyle"
    | "siteStylePending"
    | "siteStyleError"
    | "configSiteStyle"
    | "storedSiteStyle"
    | "unreadableStoredFonts"
    | "classes"
  > &
  Pick<CanvasInputs, "drag" | "documentClasses" | "classSummaryContext"> &
  Pick<
    EditorPanels,
    "offered" | "offerablePatterns" | "requestPanel" | "entryFields"
  >): React.ComponentProps<typeof BuilderShell>["renderPanel"] {
  return panel => {
    /*
            A lookup rather than a chain of comparisons, so the arrow answers
            in one step and adding a panel is one entry rather than one more
            branch. It also states the pairing the shell needs: every key here
            is a panel this file can fill, and `AVAILABLE_PANELS` is what the
            rail offers — reading them side by side is how a panel that is
            offered and renders nothing gets noticed.
          */
    const panels: Partial<Record<string, () => React.ReactNode>> = {
      insert: () => (
        <InsertPanelWithLibrary
          editor={editor}
          categoryOrder={CORE_CATEGORIES}
          beginInsertDrag={drag.beginInsertDrag}
          components={offered}
          offerablePatterns={offerablePatterns}
        />
      ),
      /*
              The panel cannot work this out for itself. It is drawn here, in
              the shell's panel region, while `BlockKeyboardActions` below wraps
              the shell's CHILDREN — sibling subtrees, so nothing the panel can
              read from where it sits reports what this file knows by writing
              both. Passed as a fact rather than inferred.
            */
      layers: () => <LayersPanel editor={editor} moveHints />,
      tokens: () => (
        <TokensStudio
          merged={offerableTokens(
            canvasSiteStyle,
            siteStylePending,
            siteStyleError
          )}
          supplied={configSiteStyle?.tokens}
          pending={siteStylePending}
        />
      ),
      classes: () => (
        <ClassManagerPanel
          absence={classes.absence}
          pendingSlugs={classes.pendingSlugs}
          documentClassIds={documentClasses.ids}
          /*
                  Whether that walk reached the whole document. It stops at the
                  node ceiling, and a class applied past it is missing from the
                  list — which the panel must not read as "not on this page".
                */
          documentScan={documentClasses.complete ? "complete" : "partial"}
          library={classes.library}
          styleContext={classSummaryContext}
          onRename={classes.rename}
          currentRenameAttempt={classes.currentRenameAttempt}
          /*
                  No `usage`, and no `onDelete`. The usage index is a
                  collection and this surface has no read for one, so the panel
                  reports that nothing was read rather than reporting an empty
                  index — which would say every class is unused. Deleting needs
                  that same reach plus a write stripping the class from every
                  document holding it, so it is withheld entirely rather than
                  offered as a control that cannot keep its promise.
                */
          suppliedClassIds={configSiteStyle?.classes?.map(entry => entry.id)}
        />
      ),
      fonts: () => (
        <FontsPanelWithUpload
          faces={offerableFaces(
            canvasSiteStyle,
            siteStylePending,
            siteStyleError
          )}
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
          onOpenTokens={() => requestPanel("tokens")}
          storedFaces={storedSiteStyle?.fonts}
          storedPending={siteStylePending}
          unreadableFonts={unreadableStoredFonts}
        />
      ),
      /*
              The document's title and slug, and the entry's own fields — SEO,
              relations, whatever this collection declares — which this editor
              covered when it took the window. Drawn by the ADMIN, not
              reconstructed here: how a field is drawn is the entry form's
              contract, and a second renderer would drift from it.

              The same value the rail was derived from, so a panel is never
              offered that this returns nothing for.
            */
      settings: () => entryFields,
    };
    return panels[panel]?.() ?? null;
  };
}
