"use client";

/**
 * The page builder editor, mounted over the entry form while it is open.
 *
 * Composed from four parts, each in a module of its own: mounting the editor
 * (`use-editor-mount`), the canvas's render inputs (`use-render-inputs`), the
 * panels (`editor-panels`) and the commit to the form (`use-host-commit`).
 * This module puts them into the shell.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/BlocksEditor
 */
import type { BlockDocument, DocumentKind } from "@nextlyhq/blocks-engine";
import {
  prepareDocumentForRead,
  registeredBlocks,
} from "@nextlyhq/blocks-react";
import { blockNameOf } from "@nextlyhq/builder";
import {
  BlockContextMenu,
  BlockKeyboardActions,
  BlockToolbar,
  BreakpointSwitcher,
  BuilderShell,
  Canvas,
  useAppliedConditions,
  useConditionsUnchecked,
  CanvasFrame,
  CanvasFrameProvider,
  CanvasMarks,
  DropIndicator,
  DropRefusal,
  EmptyContainerAppenders,
  PageInserters,
  InspectorPanel,
  RepairNotice,
  OnboardingChecklist,
  SelectionBreadcrumb,
  SpacingOverlay,
  VisitorUnreadableBadges,
  VisitorUnreadableProvider,
  type AppliedConditions,
  type AppliedConditionsOptions,
  type ComponentFieldsHost,
  type ComponentVariantsHost,
  type OpenPassages,
  type SharedStylesHost,
  type VariantPreviewState,
} from "@nextlyhq/builder/shell";
import {
  DocumentPrimaryAction,
  DocumentSaveIndicator,
  loadInlineRichTextEditor,
  MediaPickerDialog,
  useDocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import { Button } from "@nextlyhq/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type JSX,
} from "react";
import {
  useFormState,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { siteSheet } from "../../site-style";
import { BindingsToFixChip } from "../bindings-report/BindingsToFixChip";
import { ComponentActionPrompt } from "../ComponentActionPrompt";
import { ComponentFromSelectionPrompt } from "../ComponentFromSelectionPrompt";
import { contributedInspector } from "../contributed-blocks";
import { DocumentStatusPill } from "../DocumentStatusPill";
import { findEntries } from "../entries-client";
import { findLinkTargets, findLinkTargetsIn } from "../link-targets-client";
import { canvasListReadsIn } from "../list-entries-client";
import { listLoopCollections } from "../loop-collections-client";
import { canvasNamedQueriesIn } from "../named-queries-client";
import type { LibraryReadState } from "../pattern-library-client";
import { SavePatternPrompt } from "../SavePatternPrompt";
import {
  SiteStyleHistoryContext,
  SiteStylePreviewContext,
} from "../site-style-client";
import { valueAtPath } from "../snapshot-merge";
import { OwnDesignsChip } from "../TemplateOwnDesigns";

import type { OpenAt } from "./builder-address";
import { useCanvasEntryIdentity } from "./canvas-entry";
import { listEntryCollectionOf } from "./canvas-page-context";
import { previewedCanvas } from "./canvas-preview-mode";
import { useConditionedPage, type ConditionedPage } from "./conditioned-page";
import {
  PageConditionsStrip,
  PlacedConditionsStrip,
  type TemplateConditions,
} from "./conditions-strip";
import {
  editorPanelRenderer,
  useEditorPanels,
  type EditorPanels,
} from "./editor-panels";
import { EditorSearch, SearchButton } from "./editor-search";
import { HistoryButtons } from "./history-buttons";
import {
  useMediaSummaryReader,
  type ReadMediaSummary,
} from "./media-summary-reader";
import {
  usePageConditionsRead,
  type PageConditionsSource,
} from "./page-conditions-read";
import { PageReadMeter } from "./page-read-meter";
import { PageTitleSwitcher } from "./page-title-switcher";
import { PreviewButton } from "./preview-button";
import { recentIconsStore } from "./recent-icons-store";
import { useReveal, type Reveal } from "./reveal-hidden";
import {
  settingsAddressOf,
  useSavedRevision,
  type SettingsAddress,
} from "./settings-address";
import { SettingsDialog } from "./settings-dialog";
import {
  sharePreview,
  type SharePreview,
  type ShareSeoFields,
} from "./share-preview";
import { SiteLayoutNote } from "./site-canvas";
import {
  ConnectStyleHistoryContext,
  RemountOnStyleReplay,
  StyleRevisionContext,
  useSiteStyleHistory,
} from "./site-style-history";
import {
  offerableFaces,
  offerableTokens,
  siteStyleStatus,
} from "./site-style-studios";
import { documentFrom } from "./stored-document";
import {
  TemplatePreviewScope,
  TemplatePreviewStrip,
  useDrawnTemplate,
  useTemplatePreviewState,
} from "./template-preview-strip";
import { useComponentView, type ComponentView } from "./use-component-view";
import { useEditorMount, type EditorMount } from "./use-editor-mount";
import {
  hasUnsavedWork,
  useDocumentDirty,
  useHostCommit,
  useSavePoint,
} from "./use-host-commit";
import { useOpenAtSection } from "./use-open-at-section";
import {
  useBoundCanvasRender,
  useCanvasInputs,
  useSiteStyleInputs,
  type CanvasInputs,
  type SiteStyleInputs,
} from "./use-render-inputs";

/** Everything the shell's slots are filled from. */
type EditorView = EditorMount &
  SiteStyleInputs &
  CanvasInputs &
  EditorPanels & {
    /**
     * The bound props on the page a visitor will not see filled, by node id,
     * for the canvas's badges and the inspector's note.
     */
    visitorUnreadable: ReturnType<
      typeof useBoundCanvasRender
    >["visitorUnreadable"];
    documentDirty: boolean;
    pageTitle: string | undefined;
    /** "Edit component", and the banner over a component's own view. */
    componentView: ComponentView;
    /** The block verbs shared for the surfaces drawn outside the provider. */
    layerVerbs: CardVerbs;
    /** What the canvas draws: the document, with selected hidden blocks shown. */
    reveal: Reveal;
    /** The conditioned blocks the page can't check, which the canvas badges red. */
    conditionsUnchecked: ReadonlySet<string>;
    /**
     * The page with its conditions applied for the previewed entry, while
     * the author's switch is on; the canvas then draws a hidden block as a
     * marker and badges a shown one so.
     */
    conditionsApplied: AppliedConditions | undefined;
    /**
     * The page as the canvas draws it, a template's previewed entry's own
     * blocks composed in: the one composition the canvas draws.
     */
    composedDocument: BlockDocument;
    /** What a block shown for the previewed entry is badged with. */
    conditionsShownLabel: string;
    /** A stored media id's name, picture and alt text, for the image fields. */
    readMedia: ReadMediaSummary;
    /** The variant open in a component's view, which the canvas previews. */
    preview: ComponentView["preview"];
    /**
     * The collection the document is an entry of, so a list on it can show
     * the entry's related entries; `null` on a Single, which has none.
     */
    entryCollection: string | null | undefined;
  };

/**
 * What stands where the canvas will be, while a read it cannot draw without is
 * still coming or has failed.
 *
 * The site's style gates the canvas in both states: without the sheet the page
 * draws a plausible design the site does not have, and a failed read is fixed
 * by reloading. The component read gates it only while PENDING — long enough
 * to keep every instance from flashing as could-not-be-loaded and re-laying
 * out when the read lands. A FAILED component read must not gate it: the
 * route refuses a role that may edit pages but not read components, and a
 * least-privilege page editor would otherwise lose the canvas for every page,
 * block-only pages included. That state, and a read that failed to refresh
 * what it had, are said beside the canvas instead — see
 * {@link ComponentsUnavailableNote}.
 *
 * Only the canvas waits: the shell, the rail and the inspector are about the
 * DOCUMENT, which is already in hand.
 */
function CanvasGate({
  styleError,
}: {
  styleError: Error | null;
}): React.JSX.Element {
  if (styleError !== null) {
    return (
      <p className="nx-inspector__note" data-canvas-state="failed">
        This site’s styles could not be loaded, so the canvas would not match
        the published page. Reload to try again.
      </p>
    );
  }
  return (
    <p className="nx-inspector__note" data-canvas-state="loading">
      Loading this site’s styles and components…
    </p>
  );
}

/**
 * That the component definitions could not be read, said ABOVE a canvas that
 * still draws.
 *
 * The canvas is drawn without them — every instance on the page as the
 * could-not-be-loaded marker — because refusing to draw at all would take the
 * editor away from an author whose role simply cannot read components. What
 * this adds is the sentence that tells the marker apart from a deleted
 * component, and the one remedy reachable from here.
 */
function ComponentsUnavailableNote({
  state,
  retry,
}: {
  state: LibraryReadState;
  retry: () => void;
}): React.JSX.Element | null {
  const sentence = COMPONENT_READ_NOTES[state];
  if (sentence === undefined) return null;
  return (
    <p
      className="nx-inspector__note"
      role="status"
      data-canvas-state={`components-${state}`}
    >
      {sentence}{" "}
      <Button type="button" variant="ghost" size="sm" onClick={retry}>
        Try again
      </Button>
    </p>
  );
}

/**
 * What is said beside the canvas of a component read that failed, by how it
 * failed. Nothing for a read in flight or one that answered: the canvas
 * waits on the first and draws from the second.
 *
 * The two sentences differ in what is true of the instances on the page. A
 * read that never answered leaves them drawn as missing. One that answered
 * once and could not answer again leaves them drawn from that answer, which
 * an edit elsewhere may since have overtaken — so not missing, but possibly
 * out of date.
 */
const COMPONENT_READ_NOTES: Readonly<
  Partial<Record<LibraryReadState, string>>
> = {
  unavailable:
    "This site’s components could not be loaded, so any placed on this page draw as missing.",
  stale:
    "This site’s components could not be reloaded, so any placed on this page may draw out of date.",
};

/**
 * The top bar's items: the document's state, and the breakpoints.
 *
 * Called as a function rather than rendered as a component, here and for the
 * inspector and the canvas region below, so the tree the shell receives is
 * the one it always received.
 */
/**
 * What the editor puts in the shell's top bar, by column: the document's
 * history and state at the start, the devices in the centre, and Preview and
 * the document's actions at the end.
 */
/**
 * Which field of the page the editor is open on, beside the page's title, for
 * a field below the top level: `Sections · Hero banner · Body`. Inside a
 * repeater the row is named by its title, as the form's row header names it,
 * so the author can tell which row's layout this is; the way back to the
 * entry is the exit at the start of the bar.
 */
function FieldLocation({ location }: { location: string }): React.JSX.Element {
  return (
    <span
      // The whole of it on hover, where the bar's width cuts it short.
      title={location}
      className="min-w-0 max-w-[20rem] shrink truncate text-sm text-muted-foreground"
      data-testid="builder-field-location"
    >
      {location}
    </span>
  );
}

function editorTopBar(
  view: EditorView,
  /**
   * The page's title as the form has it now, the field being edited by its
   * address, where that field sits in words when below the top level, and
   * the canvas, which a binding's Select brings its block into view in.
   */
  page: {
    title: string | undefined;
    field: string;
    location?: string | undefined;
    canvas: HTMLElement | null;
  }
): {
  topBar: React.JSX.Element;
  topBarCenter: React.JSX.Element;
  topBarEnd: React.JSX.Element;
} {
  const {
    documentDirty,
    canvasRender,
    siteStylePending,
    siteStyleError,
    editedBreakpoint,
    chooseDevice,
    editor,
    inline,
  } = view;
  return {
    topBar: (
      <>
        {/* As the agreed bar has it: the title as a switcher, the status,
            then undo and redo. */}
        <PageTitleSwitcher
          title={page.title ?? ""}
          current={
            view.pages.currentPage === null
              ? null
              : {
                  ...view.pages.currentPage,
                  field: page.field,
                  title: page.title ?? "",
                }
          }
          userId={view.userId}
          onAllPages={() => view.requestPanel("pages")}
        />
        {page.location === undefined ? null : (
          <FieldLocation location={page.location} />
        )}
        <DocumentStatusPill isDirty={documentDirty} />
        {/* The page's bindings that no longer fit, beside its status: shown
            only when it has one. */}
        <BindingsToFixChip
          editor={editor}
          field={page.field}
          canvas={page.canvas}
          requestPanel={view.requestPanel}
        />
        {/* On a collection's template, how many of its entries have their
            own design, opening the list; nothing on any other document. */}
        <OwnDesignsChip />
        <HistoryButtons editor={editor} inline={inline} />
        {/* What the page costs to read, against its allowance: a page's
            alone, since a component is read as part of each page placing it. */}
        {view.initialDocument.kind === "page" ? (
          <PageReadMeter
            editor={editor}
            drawnWith={view.canvasRender}
            regions={view.canvasRegions}
            componentTitle={view.componentLibrary.titleOf}
          />
        ) : null}
      </>
    ),
    topBarCenter: (
      <>
        {/*
         * Beside the manager, and gated on the same read for the same
         * reason it is: until the stored style has answered, the set in
         * hand is the host's config defaults, so a device chosen against it
         * could name a breakpoint the site never had.
         *
         * The device chosen is the breakpoint being edited. The choice goes
         * to the shell, which stores it with the author's preferences and
         * reports it back, so this shows the device the edits go to.
         */}
        <BreakpointSwitcher
          breakpoints={canvasRender.styleContext.breakpoints}
          selected={editedBreakpoint}
          onSelect={chooseDevice}
          status={siteStyleStatus(siteStylePending, siteStyleError)}
        />
      </>
    ),
    topBarEnd: (
      <>
        {/* Whether the work is stored, beside the verbs that store it: the
          header's own chip, which reads the field's held work too. Its text
          sits against Preview, so the width it reserves for its longest
          state opens towards the panel buttons rather than between it and
          what it describes. Reserved only where the bar has the room: below
          1400px it takes what it shows, as the device labels give way there,
          so the end column never runs into the zoom. Set in the bar's own
          text size, as Preview beside it is. */}
        {/* First in the group, as the agreed bar has it: one search for
          blocks, the page, other pages and commands, also on ⌘K. */}
        <SearchButton onOpen={() => view.search.setOpen(true)} />
        <DocumentSaveIndicator className="min-w-[9rem] shrink-0 justify-end text-sm @max-[1400px]/topbar:min-w-0" />
        <PreviewButton />
        {/* Last, at the bar's far end where the header kept them: the
          document's leading action with its other ways to publish on its
          arrow, which the builder's taking the window would otherwise leave
          reachable only from the keyboard. */}
        <DocumentPrimaryAction />
      </>
    ),
  };
}

type ContentServices = NonNullable<
  ComponentProps<typeof InspectorPanel>["contentServices"]
>;

let contentServices: ContentServices | undefined;

/** Each person's read of the loop collections, one function per language. */
const loopCollectionReads = new Map<
  string,
  NonNullable<ContentServices["listLoopCollections"]>
>();

/**
 * The read of the collections a list or condition may name, in a language:
 * the same function for every caller, so the inspector and the canvas's
 * condition badges share one read and one answer (`useLoopCollections`
 * shares a read by the function's identity).
 */
function loopCollectionsIn(
  locale: string | undefined,
  userId: string | null
): NonNullable<ContentServices["listLoopCollections"]> {
  // Per person too: the answer is read with their access, and a read still in
  // flight when one person signs out must never be handed to the next.
  const key = JSON.stringify([locale ?? "", userId]);
  let read = loopCollectionReads.get(key);
  if (read === undefined) {
    read = () => listLoopCollections(locale);
    loopCollectionReads.set(key, read);
  }
  return read;
}

/**
 * What the inspector's Content tab borrows from the admin: the media library,
 * to choose an image, the shared rich-text editor, and the page builder's
 * entries route, to find an entry a `relation` prop points at with the
 * author's own access, the pages search, to find a page a link points at
 * the same way, and the loop collections route, to offer a collection loop
 * the collections that author may read. Built on first use and
 * kept for the module's life, so the panel never sees a new object on a
 * render, and loading this module reads nothing from the admin's surface
 * until an editor is drawn.
 */
function borrowedServices(): ContentServices {
  contentServices ??= {
    MediaPicker: MediaPickerDialog,
    loadRichTextEditor: loadInlineRichTextEditor,
    findEntries,
    findLinkTargets,
    listLoopCollections,
  };
  return contentServices;
}

/**
 * The borrowed services with this editor's open-passage registry, its
 * language, the collection its document is an entry of and the author's
 * recent icons, one object per registry, language, collection and author so
 * the panel sees the same one on every render. A relation search and a link's search read titles in
 * the language being edited.
 */
const servicesByPassages = new WeakMap<
  OpenPassages,
  Map<string, ContentServices>
>();

function servicesFor(
  passages: OpenPassages,
  locale: string | undefined,
  readMedia: ReadMediaSummary,
  entryCollection: string | null | undefined,
  userId: string | null
): ContentServices {
  let byLocale = servicesByPassages.get(passages);
  if (byLocale === undefined) {
    byLocale = new Map();
    servicesByPassages.set(passages, byLocale);
  }
  // All three in the key, as JSON so no language, collection and person can
  // collide: the list count below reads as the person signed in, and the
  // recent icons are theirs.
  const key = JSON.stringify([locale ?? "", entryCollection ?? null, userId]);
  const recentIcons = recentIconsStore(userId);
  let services = byLocale.get(key);
  if (services === undefined) {
    services = {
      ...borrowedServices(),
      openPassages: passages,
      readMedia,
      findEntries: query =>
        findEntries(locale === undefined ? query : { ...query, locale }),
      // The same language for a link's search, so a page is found and named
      // as the author reads it.
      findLinkTargets: findLinkTargetsIn(locale),
      // The fields a list may name, as a save in this language judges them.
      listLoopCollections: loopCollectionsIn(locale, userId),
      // The site's named queries, a list's custom sources, as judged in
      // this language: one read the canvas shares.
      listCustomSources: canvasNamedQueriesIn(locale, userId).sources,
      // The selected list's "N entries match, so M show", taken from the
      // canvas's own read of the list in this language, or its named
      // query's run where that is its source.
      countListEntries: props =>
        props.namedQuery === undefined || props.namedQuery === null
          ? canvasListReadsIn(locale, userId).count(props)
          : canvasNamedQueriesIn(locale, userId).count(props),
      ...(entryCollection === undefined ? {} : { entryCollection }),
      // The icons this author chose last, for the Icon control's Recent row.
      ...(recentIcons === undefined ? {} : { recentIcons }),
    };
    byLocale.set(key, services);
  }
  return services;
}

/** The block verbs the inspector's card offers, as the verbs provider shares them. */
type CardVerbs = ComponentProps<typeof InspectorPanel>["verbs"];

/**
 * The onboarding checklist, rendered only while it has somewhere to go:
 * passing an element the shell would position and then hide leaves an empty
 * positioner over the canvas.
 */
function editorChecklist({
  checklist,
}: EditorView): React.JSX.Element | undefined {
  return checklist.visible ? (
    <OnboardingChecklist
      steps={checklist.steps}
      onDismiss={checklist.dismiss}
    />
  ) : undefined;
}

/** The inspector, given the same readings the canvas draws with. */
function editorInspector(
  view: EditorView,
  verbs: CardVerbs,
  sharedStyles: SharedStylesHost
): React.JSX.Element {
  const {
    editor,
    canvasElement,
    componentLibrary,
    styleStateBinding,
    classes,
    stylePolicy,
    styleCascade,
    canvasRender,
    chooseDevice,
    editedBreakpoint,
    liveBreakpoints,
    canvasSiteStyle,
    configSiteStyle,
    siteStylePending,
    siteStyleError,
    requestPanel,
    componentFacts,
    componentVariants,
  } = view;
  return (
    <InspectorPanel
      editor={editor}
      // The SAME ref the canvas publishes its root through, so the style
      // tab reads the element a node is actually drawn as rather than
      // inferring one from the document. Two refs would let the panel
      // read a canvas that is not the one on screen.
      canvasRoot={canvasElement}
      // The SAME read the canvas resolves against, for the reason the
      // ref is the same ref: a selected instance's rows are read from the
      // very document the page is drawn from, and titled from the row
      // the same read returned.
      componentLibrary={componentLibrary}
      // A contributed block's own inspector, loaded by the app's generated
      // component map; a block whose inspector did not load keeps its
      // generated controls.
      inspectors={contributedInspector}
      // The verbs provider's own verbs and verdicts for Duplicate and Delete,
      // handed out of it because the inspector is drawn beside the canvas
      // rather than under it.
      verbs={verbs}
      contentServices={servicesFor(
        view.passages,
        view.locale,
        view.readMedia,
        view.entryCollection,
        view.userId
      )}
      // A placement's exposed passage the canvas is editing in place: its
      // field in the placement panel is held meanwhile, as one editor serves
      // both.
      canvasPassage={view.inline.editingRich?.exposure ?? null}
      styleState={styleStateBinding}
      classLibrary={classes.library}
      classLibraryAbsence={classes.absence}
      // The author's right, the style write and the reach reads, so a
      // shared style the block wears can become the Style tab's target.
      sharedStyles={sharedStyles}
      {...(view.lookEditing.look === null
        ? {}
        : {
            lookEditing: {
              look: view.lookEditing.look,
              onExit: view.lookEditing.exit,
            },
          })}
      policy={stylePolicy}
      cascade={styleCascade}
      breakpoints={canvasRender.styleContext.breakpoints}
      // The set above is the config's defaults until the stored one is read,
      // so a per-device hide waits for it.
      breakpointsStatus={siteStyleStatus(siteStylePending, siteStyleError)}
      // Which tier the Style tab writes to, and which tiers are live: the
      // canvas's answer rather than the panel's, as the frame's width is
      // what the page's media queries answer for.
      /*
       * Going to a tier is CHOOSING ITS DEVICE, never setting a second
       * piece of state saying which tier is being edited, so the device the
       * frame shows and the tier edits go to cannot disagree.
       */
      // Already a TIER, so it is stored directly rather than converted
      // to a width and back.
      onJumpToBreakpoint={chooseDevice}
      breakpoint={editedBreakpoint}
      liveBreakpoints={liveBreakpoints}
      tokens={offerableTokens(
        canvasSiteStyle,
        siteStylePending,
        siteStyleError
      )}
      // The Font control lists only what the site can draw: the faces the
      // canvas loads, of which those from the site's code cannot be removed,
      // and a way to Design's fonts to add one.
      fonts={{
        faces: offerableFaces(
          canvasSiteStyle,
          siteStylePending,
          siteStyleError
        ),
        fromCode: configSiteStyle.fonts ?? [],
        onManageFonts: () => requestPanel("design", "fonts"),
      }}
      // In a component's own view: the ids its live definition holds, which a
      // new field must never reuse, how far a removal reaches, and its name
      // for the card heading the view, which is the open document's title.
      componentFields={namedFacts(componentFacts, view.pageTitle)}
      // And how many placements chose a variant, for its delete dialog, and
      // the open variant, which the canvas previews.
      componentVariants={previewingHost(componentVariants, view.preview)}
    />
  );
}

/** The variants host, holding the open variant for the canvas to preview. */
function previewingHost(
  host: ComponentVariantsHost | undefined,
  preview: VariantPreviewState
): ComponentVariantsHost {
  return { ...host, preview: preview.binding };
}

/** The component facts with the component's name, or nothing for a page. */
function namedFacts(
  facts: ComponentFieldsHost | undefined,
  title: string | undefined
): ComponentFieldsHost | undefined {
  if (facts === undefined || title === undefined || title === "") return facts;
  return { ...facts, name: title };
}

/** The canvas, or what stands in its place while a read it needs is out. */
function editorCanvasRegion(view: EditorView): React.JSX.Element {
  const {
    componentLibrary,
    siteStylePending,
    siteStyleError,
    editor,
    zoom,
    setAppliedScale,
    frameWidth,
    pageTitle,
    canvasRoot,
    setCanvasElement,
    shownStyleState,
    canvasSiteStyle,
    canvasRender,
    drag,
    dragging,
    spacingScrub,
    slots,
    blocks,
    openInsertPanel,
    locale,
    canvasSource,
    canvasFallback,
    onCanvasFallback,
    canvasDir,
    visitorUnreadable,
  } = view;
  // The theme the frame draws the page in and the tags saying so, from one
  // answer, so the tag never names a mode the canvas is not drawn in.
  const previewed = previewedCanvas(view.previewMode, view.preview.previewing);
  return (
    <>
      {/*
            Held back until the stored style has arrived.

            `useSiteStyle` answers with the host's defaults while the read is in
            flight, and those defaults are a legitimate design rather than a
            placeholder — so a canvas mounted on them looks finished and is
            wrong at exactly the properties an admin overrode. The author would
            see the page re-lay-out under them, and could start dragging against
            a design the site does not have.

            A FAILED read is held back for the same reason, and it is not the
            same state. When the request exhausts its retry — a network fault,
            or a 403 for an editor without `read-site-style` — `pending` goes
            false while the merged value falls back to the config defaults. So
            "not pending" alone would mount a finished-looking canvas over a
            stored tier nobody has read, which is the exact problem the wait was
            added to prevent, arrived at down the failure path instead. Absent
            is not the same as unknown, and the author is told which.

            Only the canvas waits. The shell, the rail and the inspector are all
            about the DOCUMENT, which is already in hand, and blanking them
            would make the editor feel slower than it is. After the first open
            the read is cached, so this is one brief state per session rather
            than one per opening.
          */}
      <ComponentsUnavailableNote
        state={componentLibrary.state}
        retry={componentLibrary.retry}
      />
      {/*
        Beside the other notes about the page as a whole: a locked area that
        holds what its lock doesn't allow, and the repair the author can review
        and confirm.
      */}
      <RepairNotice editor={editor} />
      {/*
        Whether the page is drawn inside the site's own layout, and why not
        when it is not: without the site's stylesheets the canvas can differ
        from the published page.
      */}
      <SiteLayoutNote fallback={canvasFallback} />
      {siteStylePending ||
      siteStyleError !== null ||
      componentLibrary.state === "pending" ? (
        <CanvasGate styleError={siteStyleError} />
      ) : (
        /*
              Wrapped rather than passed in, because the menu opens over the
              WHOLE canvas and reads which block from the selection the canvas
              has already moved. The wrapper generates no box, so the canvas
              lays out exactly as it did.
            */
        <BlockContextMenu editor={editor}>
          {/*
            The page is drawn in a frame of its own at the device's width and
            height, so its media queries, `vw` and `vh` answer for the device
            and nothing of the admin's theme reaches it. The editor's chrome
            is the frame's overlay, drawn in this document over the frame.
          */}
          <CanvasFrame
            width={frameWidth}
            zoom={zoom}
            onScale={setAppliedScale}
            title={pageTitle}
            // The language being edited, for a screen reader in the frame, and
            // the way it is written.
            lang={locale}
            dir={canvasDir}
            // The site's canvas route, where the site serves one, so the page
            // is drawn inside the site's own layout and stylesheets.
            source={canvasSource}
            onSourceFallback={onCanvasFallback}
            // The site mode the author picked, on the frame's document and
            // the frame element only; nothing picked draws the page's own.
            theme={previewed.theme}
            overlay={
              <>
                {/* One row: the variant previewed and the mode picked. */}
                {previewed.tags}
                {/* A selected block the page hides on this device is drawn
                    anyway, and its ring says so. */}
                <CanvasMarks
                  revealed={view.reveal.ids}
                  device={{
                    breakpoints: canvasRender.styleContext.breakpoints,
                    id: view.editedBreakpoint,
                  }}
                  // A selected placement's frame is tagged with the name its
                  // Layers row reads.
                  nameOf={address =>
                    blockNameOf(
                      editor.document,
                      address,
                      componentLibrary.titleOf
                    )
                  }
                  shownLabel={view.conditionsShownLabel}
                />
                {/* A block whose bound value a visitor will not see says
                    so above its corner; pressing the badge selects it, and
                    the inspector says it in full. Hidden mid-drag, as the
                    other controls over the canvas are. */}
                <VisitorUnreadableBadges
                  marked={visitorUnreadable}
                  onSelect={editor.select}
                  hidden={dragging}
                />
                <DropIndicator target={drag.target} />
                <DropRefusal drag={drag} document={editor.document} />
                {/*
                  Suppressed for the duration of a drag. The bar would otherwise
                  sit over the canvas the author is aiming at, naming a block
                  that is in the middle of moving.
                */}
                <BlockToolbar editor={editor} hidden={dragging} />
                {/*
                  Suppressed for the same reason and by the same signal. The
                  bands report a layout that is mid-change during a drag, so
                  every value on them is about to be wrong.
                */}
                <SpacingOverlay
                  editor={editor}
                  hidden={dragging}
                  /*
                   * The tier a spacing handle writes to, and what the canvas
                   * compiled this page under, read from the ONE context that
                   * compiled the sheet rather than derived a second time.
                   */
                  scrub={spacingScrub}
                />
                {/*
                  Suppressed during a drag for the same reason the toolbar and
                  the bands are. Shown otherwise: empty containers always draw
                  their placeholder box, so the "+" over it always has one.
                */}
                <EmptyContainerAppenders
                  document={editor.document}
                  slots={slots}
                  blocks={blocks}
                  hidden={dragging}
                  onAppend={nodeId => {
                    // Select the container and open Add to add INSIDE it,
                    // said explicitly: selecting a container never implies
                    // inside, so a click on a selected block adds after it.
                    editor.select(nodeId);
                    openInsertPanel(nodeId);
                  }}
                />
                {/*
                  The empty page's start card and the "+" between sections.
                  The "+" selects the section above its gap and opens Add,
                  which adds after the selected block and names the place;
                  the start card opens Add on a page with nothing to select.
                  Hidden mid-drag, when the drag's own line says where a block
                  lands.
                */}
                <PageInserters
                  document={editor.document}
                  componentTitle={componentLibrary.titleOf}
                  hidden={dragging}
                  onStart={() => openInsertPanel()}
                  onAddAfter={nodeId => {
                    editor.select(nodeId);
                    openInsertPanel();
                  }}
                />
              </>
            }
          >
            <Canvas
              // The document as the open variant draws it, in a component's
              // view, with a selected block it hides on this device drawn
              // while selected; the document itself otherwise.
              document={view.reveal.document}
              rootRef={canvasRoot}
              onRoot={setCanvasElement}
              forcedState={shownStyleState}
              siteStyles={siteSheet(canvasSiteStyle)}
              selectedId={editor.selectedId}
              selectedIds={editor.selection.ids}
              onSelect={editor.select}
              // A list note's "Choose a field": the list selected and the
              // author taken to its first sort row.
              onListSortField={editor.askSortField}
              // The style context and the host policy, derived above so both
              // are one object with one identity rather than rebuilt per
              // render.
              render={canvasRender}
              dragHandlers={drag.handlers}
              // The regions of the page's Layout, drawn locked around it from
              // the published Layout, as a visitor gets them.
              regions={view.canvasRegions}
              // The conditioned blocks visitors never see, because the page
              // can't check their conditions: badged in red on the canvas.
              conditionsUnchecked={view.conditionsUnchecked}
              // While the author applies the conditions for the previewed
              // entry: a hidden block drawn as its marker, a shown one badged.
              {...(view.conditionsApplied === undefined
                ? {}
                : { conditionsApplied: view.conditionsApplied })}
              // The page as drawn, the previewed entry's blocks composed in
              // once, here, with the conditions judged on it.
              composed={view.composedDocument}
              // The same object those handlers came from, forwarded whole.
              // The canvas draws what the pointer currently means — which
              // block is in flight, which container is receiving it — and
              // decides none of it.
              drag={drag}
              // The pointer route into typing a block's text. Its keyboard
              // counterpart is the Enter binding, registered in the same
              // place so a surface cannot gain one without the other.
              onDoubleClick={view.preview.onDoubleClick}
            />
          </CanvasFrame>
        </BlockContextMenu>
      )}
    </>
  );
}

/** What the editor reads of the page's own fields as the author has them now. */
interface PageFacts {
  /** The form's `title` while it is text, for the top bar and the preview. */
  title: string | undefined;
  /** The SEO plugin's fields, where the document has them. */
  seo: ShareSeoFields | undefined;
  /**
   * The page whose saved address Settings reads, and whether its slug has
   * changed since the save, or null for a document never saved.
   */
  address: Omit<SettingsAddress, "locale"> | null;
}

/** The field a page's address is made from, where the collection has one. */
const SLUG_FIELD = "slug";

function usePageFacts<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>
): PageFacts {
  const [title, seo, slug]: unknown[] = useWatch({
    control,
    name: ["title", "seo", SLUG_FIELD] as Path<TFieldValues>[],
  });
  // The form's defaults are what the last load or save stored, so the slug
  // there is the saved one, the slug the server's address is read for.
  const { defaultValues } = useFormState({
    control,
    name: SLUG_FIELD as Path<TFieldValues>,
  });
  const saved: unknown = (
    defaultValues as Record<string, unknown> | undefined
  )?.[SLUG_FIELD];
  return {
    title: typeof title === "string" ? title : undefined,
    seo: seo !== null && typeof seo === "object" ? seo : undefined,
    address: settingsAddressOf(
      useDocumentIdentity(),
      slug,
      saved,
      useSavedRevision(defaultValues)
    ),
  };
}

/**
 * How a shared link to the page would look, from the page as the published
 * route reads it: prepared with the canvas's own inputs (the same resolver,
 * limits and component definitions), so a component's heading speaks for the
 * page as it does once published.
 */
function pagePreview(view: EditorView, page: PageFacts): SharePreview {
  const { editor, canvasRender } = view;
  const resolver = registeredBlocks();
  const prepared = prepareDocumentForRead(editor.document, {
    resolver,
    styleContext: canvasRender.styleContext,
    definitions: canvasRender.definitions,
    ...(canvasRender.limits === undefined
      ? {}
      : { limits: canvasRender.limits }),
  });
  return sharePreview({
    seo: page.seo,
    document: prepared,
    pageTitle: page.title ?? "",
    definitions: type => resolver.get(type),
  });
}

/**
 * Settings, as the shell's rail opens it: the entry's own fields and a share
 * preview built from the page as it is now, and the site's breakpoints, read
 * from the same answer the canvas and the device buttons are.
 */
function editorSettings(
  view: EditorView,
  page: PageFacts
): NonNullable<React.ComponentProps<typeof BuilderShell>["renderSettings"]> {
  const {
    entryFields,
    pageLayout,
    canvasRender,
    saveBreakpoints,
    refreshSiteStyle,
    siteStylePending,
    siteStyleError,
  } = view;
  // Remounted when a style change is undone or redone, as every surface
  // showing the site's style is, so its breakpoints show the set replayed.
  return dialog => (
    <RemountOnStyleReplay>
      <SettingsDialog
        {...dialog}
        pageFields={entryFields}
        // The page's Layout, in its own section after the page's fields.
        pageLayout={pageLayout}
        // Built only while the dialog is drawn, from the page on screen.
        share={
          // Prepared only while Settings is open: the shell asks for the
          // dialog on every pass, open or not.
          dialog.open ? pagePreview(view, page) : { title: page.title ?? "" }
        }
        // The SEO plugin's group, where the page has one: its fields are then
        // among the page's own, and the preview is not all there is.
        seoFields={page.seo !== undefined}
        // Read in the language being edited, as a localized slug is.
        address={
          page.address === null
            ? null
            : {
                ...page.address,
                ...(view.locale === undefined ? {} : { locale: view.locale }),
              }
        }
        breakpoints={{
          value: canvasRender.styleContext.breakpoints,
          onSave: saveBreakpoints,
          status: siteStyleStatus(siteStylePending, siteStyleError),
          refresh: refreshSiteStyle,
        }}
      />
    </RemountOnStyleReplay>
  );
}

/**
 * The editor itself, mounted only while open.
 *
 * Separate component so the hooks below — editor state, and the chrome request
 * — run only when there is an editor. Calling them from the control above would
 * ask the admin to hide its navigation for every entry form holding a blocks
 * field, open or not.
 */
interface BlocksEditorProps<TFieldValues extends FieldValues> {
  initialValue: unknown;
  /** The kinds the field accepts, so a seeded document is one it will take. */
  kinds: readonly DocumentKind[] | undefined;
  onCommit: (value: BlockDocument) => void;
  onClose: () => void;
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
  /**
   * The section or block to open at, as the address names it; none opens at
   * the top.
   */
  openAt?: OpenAt | undefined;
  /**
   * The field's address from the document's root, where it differs from
   * `name`: inside a repeater's row, which the address names by its saved id
   * and the form by its position. What the editor records the page under, so
   * opening it again finds the same row. `name` where absent.
   */
  address?: string | undefined;
  /**
   * Where the field sits, in words, for a field below the top level
   * (`Sections · Hero banner · Body`): said in the top bar and at the root of
   * the bottom bar, so the author knows which row's layout this is.
   */
  location?: string | undefined;
  /**
   * For a field in a repeater's row: where it sits in another copy of the
   * document's values, found by the row's id. The editor reads the field's
   * stored copy through it, since the row may stand elsewhere in the values
   * last stored than in the form.
   */
  pathIn?:
    | ((values: Record<string, unknown>) => string | undefined)
    | undefined;
}

export function BlocksEditor<TFieldValues extends FieldValues = FieldValues>(
  props: BlocksEditorProps<TFieldValues>
): JSX.Element {
  /*
   * A change to the site's shared styles is a step of the editor's undo
   * history. Provided from here, above the editor's own hooks, because some
   * of the style writers run in the editor component itself.
   */
  const style = useSiteStyleHistory();
  // Read once, from the document the editor opens with, as the editor reads
  // it: its kind does not change while the editor is open.
  const [isTemplate] = useState(
    () => documentFrom(props.initialValue, props.kinds).kind === "template"
  );
  return (
    <SiteStyleHistoryContext.Provider value={style.history}>
      {/* Held style edits, drawn before they are stored. */}
      <SiteStylePreviewContext.Provider value={style.preview}>
        <StyleRevisionContext.Provider value={style.replay}>
          <ConnectStyleHistoryContext.Provider value={style.connect}>
            {/*
            The canvas's frame, provided above the whole editor: the canvas
            registers it here, and the inspector, the toolbar, inline editing
            and the keys outside the canvas all ask it which document and
            window the page is drawn in.
          */}
            <CanvasFrameProvider>
              {/*
                A template is drawn with an entry of the collection it names,
                chosen in the strip above its canvas: read around the editor,
                so the canvas, the inspector and the strip all read the one
                answer. Any other document is drawn as itself.
              */}
              {isTemplate ? (
                <TemplatePreviewScope control={props.control}>
                  <EditorBody {...props} place={fieldPlace(props)} />
                </TemplatePreviewScope>
              ) : (
                <EditorBody {...props} place={fieldPlace(props)} />
              )}
            </CanvasFrameProvider>
          </ConnectStyleHistoryContext.Provider>
        </StyleRevisionContext.Provider>
      </SiteStylePreviewContext.Provider>
    </SiteStyleHistoryContext.Provider>
  );
}

/**
 * The canvas's render inputs with the sources its bindings read, asked of
 * `document` as the canvas draws it: a template's with the previewed entry's
 * own blocks composed in, so a binding inside them reads its source here as
 * the published page, which composes first, reads it. Composed from the
 * entry's own read, not the seam's, which waits on this read's answer. Only
 * `document`'s own blocks are marked: the entry's are edited on the entry.
 */
function useDrawnCanvasRender(
  render: Parameters<typeof useBoundCanvasRender>[0],
  document: BlockDocument,
  regions: Parameters<typeof useBoundCanvasRender>[1]["regions"],
  locale: string | undefined,
  component: boolean
): ReturnType<typeof useBoundCanvasRender> {
  const drawn = useDrawnTemplate(document, render.limits);
  return useBoundCanvasRender(
    render,
    { document: drawn, stored: document, regions },
    locale,
    component
  );
}

/**
 * What the editor's search adds from: the Add panel's own sources, and the
 * container whose "+" opened Add, so a search row adds where the panel would.
 */
function searchInsertSources(
  panels: EditorPanels
): NonNullable<React.ComponentProps<typeof EditorSearch>["insert"]> {
  return {
    components: panels.offered.components,
    componentDefinitions: panels.offered.definitions,
    ...(panels.insertInside === undefined
      ? {}
      : { inside: panels.insertInside }),
  };
}

/**
 * The field's value as last loaded or saved: the form resets its defaults to
 * what a save stored, so the editor holds an edit to the locks against the
 * same stored copy the next save is judged against. Inside a repeater's row
 * the row is found in that copy by its id (`pathIn`), since the form may hold
 * the rows in another order; a row not stored yet has no stored copy. A hook
 * of its own so the editor's body reads one answer rather than the steps.
 */
function useStoredFieldValue<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>,
  name: Path<TFieldValues>,
  pathIn: FieldPlace["pathIn"]
): unknown {
  const { defaultValues } = useFormState({ control, name });
  const storedPath = pathIn === undefined ? name : pathIn(defaultValues ?? {});
  return storedPath === undefined
    ? undefined
    : valueAtPath(defaultValues, storedPath);
}

/**
 * The bottom bar's trail, for the shell to draw. For a field below the top
 * level it starts at where the field sits, so the author reads which row's
 * layout this is; for a top-level field it starts at the page, as it always
 * has. Built here so the editor's body passes one finished element.
 */
function editorBreadcrumb(
  editor: React.ComponentProps<typeof SelectionBreadcrumb>["editor"],
  componentTitle: React.ComponentProps<
    typeof SelectionBreadcrumb
  >["componentTitle"],
  location: string | undefined
): React.JSX.Element {
  return (
    <SelectionBreadcrumb
      editor={editor}
      {...(location === undefined ? {} : { rootLabel: location })}
      hints={{ editText: true, goUp: true, commandPalette: true }}
      {...(componentTitle === undefined ? {} : { componentTitle })}
    />
  );
}

/**
 * Where the field the editor is open on sits, in one value: its address, which
 * the editor records the page under; where it sits in words, for the top bar
 * and the bottom bar; and, inside a repeater's row, how to find the row in
 * another copy of the values. Gathered so the editor's body takes one fact
 * about the field's place rather than three.
 */
interface FieldPlace {
  address: string;
  location: string | undefined;
  pathIn: ((values: Record<string, unknown>) => string | undefined) | undefined;
}

/**
 * The field's place from the editor's props: a field outside repeaters is
 * addressed by its form path, so `name` stands in for an address not given.
 */
function fieldPlace<TFieldValues extends FieldValues>(
  props: BlocksEditorProps<TFieldValues>
): FieldPlace {
  return {
    address: props.address ?? props.name,
    location: props.location,
    pathIn: props.pathIn,
  };
}

function EditorBody<TFieldValues extends FieldValues>({
  initialValue,
  kinds,
  onCommit,
  onClose,
  name,
  control,
  openAt,
  place,
}: BlocksEditorProps<TFieldValues> & { place: FieldPlace }): JSX.Element {
  const mount = useEditorMount(
    initialValue,
    kinds,
    useStoredFieldValue(control, name, place.pathIn)
  );
  const { editor, inline } = mount;

  /*
   * `hasUnsavedWork` rather than `undoDepth` alone, so an inline edit that is
   * OPEN counts. Until it commits, the typed value lives in the DOM and neither
   * the editor's history nor the form's dirty fields have moved — so a reading
   * built on those two says "nothing outstanding" while an author is midway
   * through a paragraph.
   *
   * The same answer the navigation guard reports, asked once here. The guard
   * keeps reporting only the EDITOR's half, because it tells the form about
   * work the form's own values do not contain; this composes that half with the
   * form's own dirtiness, which is what a reading of the whole document needs.
   */
  const savePoint = useSavePoint(editor);
  const documentDirty = useDocumentDirty(
    control,
    hasUnsavedWork(editor, inline, savePoint.savedAt)
  );

  const style = useSiteStyleInputs(mount.clientConfig);
  const canvas = useCanvasInputs(mount, style);
  const panels = useEditorPanels(mount, name, {
    control,
    canvasRoot: canvas.canvasElement,
  });
  const { done, publishOffer, removalHold } = useHostCommit({
    name,
    address: place.address,
    control,
    editor,
    inline,
    onCommit,
    onClose,
    savePoint,
    // The count the removal dialog says now; the hold keeps it as it stood
    // when each field was removed.
    removalReach: () => mount.componentFacts?.reach,
  });

  const page = usePageFacts(control);
  // A component's own view, and the way into one from a placement: its
  // banner, which says how far a change reaches, and "Edit component".
  const componentView = useComponentView({
    initialDocument: mount.initialDocument,
    editor,
    componentLibrary: mount.componentLibrary,
    fieldName: name,
    componentFacts: mount.componentFacts,
    // Said by the banner's Back in the view a placement here opens.
    here: page.title,
    inline,
  });
  // The canvas's render inputs with the sources its bindings read, asked of
  // the tree the canvas draws (in a component's view, the open variant's)
  // and of the Layout regions drawn around it, together.
  const { canvasRender, visitorUnreadable } = useDrawnCanvasRender(
    canvas.canvasRender,
    componentView.preview.document,
    panels.canvasRegions,
    mount.locale,
    mount.initialDocument.kind === "component"
  );
  // The "Part of" toast offers the same Edit component the panel does.
  useOfferedEditComponent(
    mount.offerEditComponent,
    componentView.onEditComponent
  );
  // What the verbs provider shares for the card's menu; `undefined` until it
  // mounts, when the menu offers Rename and Lock alone.
  const [cardVerbs, setCardVerbs] = useState<CardVerbs>(undefined);

  // Shared styles on a block: the Style tab's target and "Save as shared
  // style…", from the same class surface the canvas compiles from.
  const { sharedStyle } = canvas;
  // The page's title, for the canvas frame's accessible name.
  const pageTitle = page.title;
  // Over the document the canvas draws: in a component's view, the open
  // variant's.
  const reveal = useReveal(
    componentView.preview.document,
    mount.editor.selection.ids,
    canvas.canvasRender.styleContext.breakpoints,
    canvas.editedBreakpoint
  );
  // A stored image's name and picture in the inspector, read as the canvas
  // reads it.
  const readMedia = useMediaSummaryReader();
  // The entry the canvas is drawn as: the document's own, or the entry a
  // template is previewed with, whose collection the inspector judges by.
  const identity = useCanvasEntryIdentity();
  const entryCollection = listEntryCollectionOf(
    identity,
    mount.initialDocument
  );
  // The Previewing strip, for a template only.
  const templatePreview = useTemplatePreviewState();
  // The conditioned blocks the page can't check, badged in red on the canvas,
  // judged with the collections the inspector lists, in this language.
  const conditionServices = useConditionServices(
    mount.locale,
    mount.userId,
    entryCollection
  );
  // The page as the canvas draws it, the previewed entry's blocks composed
  // in once: what its conditions are badged on, judged on and applied to.
  const conditioned = useConditionedPage(
    reveal.document,
    templatePreview,
    canvas.canvasRender.limits
  );
  const conditionsUnchecked = useConditionsUnchecked(
    conditioned.composed,
    conditionServices,
    // The limits the canvas draws and the save surveys under.
    canvas.canvasRender.limits,
    // The placed components' definitions, whose own conditions are judged
    // in the tree the canvas composes.
    canvas.canvasRender.definitions
  );
  // The switch that applies the conditions for the entry a template is
  // previewed with: the author's own, for this session, never saved.
  const conditions = useAppliedConditionsSwitch(
    conditioned,
    templatePreview,
    pageConditionsSourceOf(
      templatePreview,
      mount.initialDocument.kind,
      identity,
      mount.locale
    ),
    {
      services: conditionServices,
      componentTitle: mount.componentLibrary.titleOf,
      // Every block the canvas draws, under the limits it draws with.
      limits: canvas.canvasRender.limits,
      // The placed components, whose own conditioned blocks go unchecked.
      definitions: canvas.canvasRender.definitions,
      // The regions of the page's Layout, whose conditioned blocks go
      // unchecked too.
      regions: panels.canvasRegions,
      // The site's zone, as the canvas's bindings read it, for a date a
      // condition compares by day.
      timeZone: canvasRender.bindings.timeZone,
    }
  );
  const view: EditorView = {
    ...mount,
    ...style,
    ...canvas,
    ...panels,
    canvasRender,
    visitorUnreadable,
    documentDirty,
    pageTitle,
    componentView,
    layerVerbs: cardVerbs,
    reveal,
    readMedia,
    preview: componentView.preview,
    // The stored document's kind too: a component's lists relate to the
    // entries of the pages placing it, as its save judges them.
    entryCollection,
    conditionsUnchecked,
    conditionsApplied: conditions.applied,
    composedDocument: conditions.composed,
    conditionsShownLabel: `Shown for this ${conditions.noun}`,
  };
  useOpenAtSection({
    sectionId: openAt?.sectionId,
    blockId: openAt?.blockId,
    editor,
    canvas: canvas.canvasElement,
    requestPanel: panels.requestPanel,
  });
  const {
    notices,
    componentLibrary,
    savePattern,
    mayCreatePattern,
    makeComponent,
    componentVerbs,
    availablePanels,
    openPanelRequest,
    setZoom,
    appliedScale,
    deviceRequest,
    setChosenDevice,
  } = view;

  return (
    // Fills the view's area, under the admin's lock and recovery notices for
    // this document, rather than covering the window over them. A component's
    // own view carries its banner above the editor.
    <EditorFrame banner={componentView.banner}>
      {/* The bound props a visitor will not see, for the inspector's note
          under each; the canvas's badges are handed the same answer. */}
      <VisitorUnreadableProvider value={view.visitorUnreadable}>
        <BuilderShell
          notices={notices}
          onExit={shellExit(componentView, done)}
          // The signed-in author's own preferences, not the browser's.
          store={mount.preferenceStore}
          availablePanels={availablePanels}
          // Forces the insert panel open from the empty-container appender,
          // which lives on the canvas below rather than beside the rail that
          // normally opens a panel.
          openPanelRequest={openPanelRequest}
          onZoomChange={setZoom}
          // The device being edited: chosen here, held and stored by the shell,
          // and reported back so the canvas and the inspector follow it.
          editingBreakpointRequest={deviceRequest}
          onEditingBreakpointChange={setChosenDevice}
          appliedScale={appliedScale}
          // Whether the page is live, which the admin's own chrome would have
          // shown had this editor not asked for it to be hidden. `undoDepth` is
          // the editor's OWN dirty signal: the form's is false for as long as the
          // editor is open, because the document is committed on the way out.
          // The title is the top bar's switcher, so the shell draws none.
          {...editorTopBar(view, {
            title: page.title,
            // Recorded by its address, so the recent page opens the same row
            // after the rows are reordered.
            field: place.address,
            location: place.location,
            canvas: canvas.canvasElement,
          })}
          // Pinned above a template's canvas: the entry it is drawn with.
          canvasStrip={editorStrip(
            templatePreview,
            conditions,
            mount.initialDocument.kind,
            page.title
          )}
          openSettingsRequest={view.pages.settingsRequest}
          renderSettings={editorSettings(view, page)}
          // The shell owns the region; this fills it. Rendered unconditionally
          // rather than only when something is selected, because the panel states
          // "select a block to edit it" — a region that appears and disappears
          // with the selection makes the canvas resize on every click.
          // The policy travels with the panel because the Style tab judges a
          // written value at the keystroke and has to reach the same verdict the
          // published compiler will.
          //
          // The tokens travel with it for the same reason one step further: a
          // colour control offers the site's tokens and resolves a stored
          // reference to the name an author currently reads, and `policy.tokens`
          // cannot serve either — a `TokenLookup` answers ABOUT a name the caller
          // already holds and cannot enumerate one. This is the MERGED set the
          // canvas compiles with, so the picker offers exactly the tokens the
          // page will resolve.
          inspector={editorInspector(view, cardVerbs, sharedStyle.host)}
          // Switched on the panel id rather than rendering the inserter for
          // whatever the rail reports open. The shell asks for the panel it
          // opened, and a renderer ignoring that argument would draw the inserter
          // under every heading the moment a second panel is listed above.
          // The trail sits in the bottom bar, which the shell owns. Passed as a
          // slot rather than rendered beside the canvas so it cannot overlap the
          // page an author is editing.
          // The hint names Enter, Escape and the palette's key because this
          // editor binds all three: inline editing and the block keyboard
          // actions below, and the palette it mounts.
          breadcrumb={editorBreadcrumb(
            editor,
            componentLibrary.titleOf,
            place.location
          )}
          checklist={editorChecklist(view)}
          renderPanel={editorPanelRenderer(view)}
        >
          {/*
          Inside the shell, which is what provides the shortcut context — a
          caller rendering the shell is outside it and cannot register bindings.
          It draws the live region and publishes the structural verbs to what it
          wraps, which is how the toolbar presses exactly what the keys press.
        */}
          <BlockKeyboardActions
            editor={editor}
            // Esc with no block selected leaves a look edited on its own.
            onEscapeWithoutSelection={panels.lookEditing.exit}
            onEditText={componentView.preview.onEditText}
            onSaveAsPattern={savePattern.open}
            /*
            The same map the canvas draws with, so a keyboard move of an
            instance is judged by the roots it draws — as its drop is — rather
            than by the instance node's own type, which the nesting rule
            restricts nowhere.
          */
            definitions={componentLibrary.definitions}
            /*
            Whether the author holds the grant the save is judged by, asked of
            the server because only it knows the RESOLVED collection: a site may
            rename it, and the browser knows the declared name alone. Passed
            here rather than read inside the builder for the same reason
            `onSaveAsPattern` is passed — the collection a pattern goes in is
            this plugin's business, not the canvas's.
          */
            mayCreatePattern={mayCreatePattern}
            components={componentVerbs}
            // "Save as shared style…", offered by every block menu.
            sharedStyles={sharedStyle.verb}
            // Opening a placed component in its own view: the host's, since it
            // knows the view's address and whether this author may update
            // components. Absent, no surface offers it.
            onEditComponent={componentView.onEditComponent}
            onShareVerbs={setCardVerbs}
          >
            {/*
            Inside the verbs provider, which is what lets the palette run
            exactly what the keystrokes and the toolbar run.

            `onExit` is the SAME handler the shell's exit button gets, so
            leaving through the palette commits the document exactly as leaving
            through the button does. Passing a different one — or omitting it
            while the button exists — would give the editor two ways out that
            behave differently.
          */}
            <EditorSearch
              editor={editor}
              onExit={done}
              canvas={canvas.canvasElement}
              // The Add panel's own sources, so search offers what it offers.
              insert={searchInsertSources(panels)}
              componentTitle={componentLibrary.titleOf}
              open={panels.search.open}
              onOpenChange={panels.search.setOpen}
            />
            {editorCanvasRegion(view)}
            {/*
            Rendered inside the verbs provider so the form and the button that
            opens it are one feature rather than two that have to be kept in
            step. The dialog is CONTROLLED from here because the verb that opens
            it belongs to the same chain as every other block verb — a form that
            owned its own trigger would be reachable from one surface and not
            from the palette, the context menu or a keystroke.
          */}
            <SavePatternPrompt
              document={savePattern.document}
              selectedIds={editor.selection.ids}
              onClose={savePattern.close}
              returnFocusTo={savePattern.returnFocusTo}
            />
            <ComponentFromSelectionPrompt
              request={makeComponent.request}
              editor={editor}
              library={componentLibrary}
              onClose={makeComponent.close}
              returnFocusTo={makeComponent.returnFocusTo}
            />
            <ComponentActionPrompt
              request={makeComponent.request}
              editor={editor}
              library={componentLibrary}
              onClose={makeComponent.close}
              returnFocusTo={makeComponent.returnFocusTo}
            />
            {publishOffer}
            {removalHold}
            {sharedStyle.dialog}
          </BlockKeyboardActions>
        </BuilderShell>
      </VisitorUnreadableProvider>
    </EditorFrame>
  );
}

/**
 * What the canvas's condition badges judge with: the inspector's own read of
 * the collections (so both share one read of the list), and the collection
 * the document's entry is of, where it has one. One object per language,
 * person and collection.
 */
function useConditionServices(
  locale: string | undefined,
  userId: string | null,
  entryCollection: string | null | undefined
): {
  listLoopCollections: NonNullable<ContentServices["listLoopCollections"]>;
  entryCollection?: string | null;
} {
  return useMemo(
    () => ({
      listLoopCollections: loopCollectionsIn(locale, userId),
      ...(entryCollection === undefined ? {} : { entryCollection }),
    }),
    [locale, userId, entryCollection]
  );
}

/**
 * The strip above the canvas: a template's Previewing strip, with the switch
 * that applies its conditions while it holds a block whose conditions read
 * the entry; a page's own strip, with the switch and no entry to name, while
 * it holds a block whose conditions read the page; a component's or a
 * Layout's own strip, with the switch disabled, while it holds a conditioned
 * block; none otherwise.
 */
function editorStrip(
  preview: ReturnType<typeof useTemplatePreviewState>,
  conditions: AppliedConditionsSwitch,
  kind: DocumentKind,
  title: string | undefined
): React.JSX.Element | undefined {
  if (conditions.page !== undefined) {
    return <PageConditionsStrip conditions={conditions.page} />;
  }
  if (preview !== undefined) {
    return conditions.template === undefined ? (
      <TemplatePreviewStrip preview={preview} />
    ) : (
      <TemplatePreviewStrip
        preview={preview}
        conditions={conditions.template}
      />
    );
  }
  if (!conditions.held || (kind !== "component" && kind !== "region")) {
    return undefined;
  }
  return (
    <PlacedConditionsStrip
      kind={kind === "component" ? "Component" : "Layout"}
      name={title ?? (kind === "component" ? "Component" : "Layout")}
    />
  );
}

/**
 * The page whose own conditions read it, on a page that is not a template:
 * the entry of a collection being edited, read as a visitor reads it. None on
 * a template, whose conditions read the entry it is previewed with, on a
 * component or a Layout, which has no entry, or on a Single, which is not an
 * entry of a collection. The editor opens only a saved entry, so one with no
 * id is never asked about.
 */
function pageConditionsSourceOf(
  preview: ReturnType<typeof useTemplatePreviewState>,
  kind: DocumentKind,
  identity: ReturnType<typeof useCanvasEntryIdentity>,
  locale: string | undefined
): PageConditionsSource | undefined {
  if (preview !== undefined || kind !== "page") return undefined;
  if (identity?.kind !== "collection" || identity.documentId === undefined) {
    return undefined;
  }
  return { collection: identity.slug, id: identity.documentId, locale };
}

/** The switch that applies a document's conditions, and what it did. */
interface AppliedConditionsSwitch {
  /** The switch's state in a template's strip; absent outside a template. */
  readonly template: TemplateConditions | undefined;
  /** The switch's state in a page's strip; absent outside a page. */
  readonly page: TemplateConditions | undefined;
  /** The page with its conditions applied, while they are. */
  readonly applied: AppliedConditions | undefined;
  /** Whether the document holds a conditioned block at all. */
  readonly held: boolean;
  /** What the previewed entry is called in words, lower case: "post". */
  readonly noun: string;
  /**
   * The document as the canvas draws it: a template's with the previewed
   * entry's own blocks composed into its Entry content, which the conditions
   * are judged on and the canvas draws, composing nothing of its own.
   */
  readonly composed: BlockDocument;
}

/**
 * The author's switch that applies the conditions for the entry a template
 * is previewed with, and the page as they leave it. Applied only to the
 * blocks that read the entry; checked against the entry as a visitor reads
 * it, so the canvas hides what the published page would.
 */
function useAppliedConditionsSwitch(
  { composed, held }: ConditionedPage,
  preview: ReturnType<typeof useTemplatePreviewState>,
  pageSource: PageConditionsSource | undefined,
  options: Omit<AppliedConditionsOptions, "noun">
): AppliedConditionsSwitch {
  const [on, setOn] = useState(false);
  // Each time the conditions are applied, counted, so a failed read of the
  // page is asked again rather than kept.
  const [attempt, setAttempt] = useState(0);
  const toggle = useCallback(() => {
    if (!on) setAttempt(count => count + 1);
    setOn(!on);
  }, [on]);
  // A page is read as a visitor reads it, and only once the author applies
  // its conditions.
  const pageRead = usePageConditionsRead(
    pageSource,
    on && held.readingEntry && pageSource !== undefined,
    attempt
  );
  const noun =
    preview !== undefined
      ? preview.labels.singular.toLowerCase()
      : pageSource !== undefined
        ? pageRead.noun
        : "entry";
  const previewed =
    preview !== undefined ? preview.previewed : pageRead.previewed;
  // The entry is handed over only while the switch is on: the canvas then
  // draws the page as a visitor reading that entry would get it.
  const applied = useAppliedConditions(
    composed,
    on && held.readingEntry ? previewed : undefined,
    { ...options, noun }
  );
  const template = useMemo<TemplateConditions | undefined>(
    () =>
      preview === undefined || !held.readingEntry
        ? undefined
        : {
            on,
            toggle,
            available: previewed?.kind === "entry",
            applied,
            noun,
          },
    [preview, held.readingEntry, on, toggle, previewed, applied, noun]
  );
  const page = useMemo<TemplateConditions | undefined>(
    () =>
      pageSource === undefined || !held.readingEntry
        ? undefined
        : // The editor opens only a saved page, so there is always one to read.
          {
            on,
            toggle,
            available: true,
            applied,
            noun,
            failed: pageRead.failed,
          },
    [pageSource, held.readingEntry, on, toggle, applied, noun, pageRead.failed]
  );
  return { template, page, applied, held: held.any, noun, composed };
}

/**
 * The shell's exit arrow: withheld while the component banner offers its
 * Back, so the view has one way back rather than two arrows going to two
 * places. Leaving through search still commits, as the exit always did.
 */
function shellExit(
  view: Pick<ComponentView, "offersBack">,
  done: () => void
): (() => void) | undefined {
  return view.offersBack ? undefined : done;
}

/**
 * The editor's area: the whole of it for a page, and under the banner for a
 * component's own view, so the banner takes its height and the shell the rest.
 */
function EditorFrame({
  banner,
  children,
}: {
  banner: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  if (banner === null) {
    return <div className="h-full bg-background">{children}</div>;
  }
  return (
    <div className="flex h-full flex-col bg-background">
      {banner}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Hand the "Part of" toast the component opener the view built, so its Edit
 * component action opens what the panel's button does.
 */
function useOfferedEditComponent(
  offer: EditorMount["offerEditComponent"],
  open: ComponentView["onEditComponent"]
): void {
  useEffect(() => {
    offer(open);
  }, [offer, open]);
}
