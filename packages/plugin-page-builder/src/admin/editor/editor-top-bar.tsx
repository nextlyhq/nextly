"use client";

/**
 * The editor's top bar: the page's title and state with its history at the
 * start, the devices and the light and dark preview in the centre, and
 * search, Preview, the document's actions and its ⋯ menu at the end.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-top-bar
 */
import type { PageCheck, PageFacts } from "@nextlyhq/builder";
import {
  BreakpointSwitcher,
  PageChecksChip,
  useDocumentView,
  useLatestCallback,
  useLatestOptionalCallback,
  type EditorDocumentView,
} from "@nextlyhq/builder/shell";
import { DocumentSaveAndPublish } from "@nextlyhq/plugin-sdk/admin";
import * as React from "react";

import { BindingsToFixChip } from "../bindings-report/BindingsToFixChip";
import { DocumentStatusPill } from "../DocumentStatusPill";
import { OwnDesignsChip } from "../TemplateOwnDesigns";

import { CanvasModeSwitch } from "./canvas-preview-mode";
import { EditorMoreMenu } from "./editor-more-menu";
import { SearchButton } from "./editor-search";
import type { EditorView } from "./editor-view";
import { HistoryButtons } from "./history-buttons";
import { PageReadMeter, type PageDataCount } from "./page-read-meter";
import { PageTitleSwitcher } from "./page-title-switcher";
import { PreviewButton, type VisitorPreview } from "./preview-button";
import { RegionSaveAndPublish } from "./region-done-dialog";
import { siteStyleStatus } from "./site-style-studios";

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

/**
 * The page's facts the bar shows beside the view: its title as the form has
 * it now, the field being edited by its address, where that field sits in
 * words when below the top level, and the canvas, which a binding's Select
 * brings its block into view in, and "Preview as visitor", which Preview's
 * menu holds, and the page's data count, which the bar shows only near the
 * limit, and the way to the document's form, which the ⋯ menu offers.
 */
export interface TopBarPage {
  title: string | undefined;
  field: string;
  location?: string | undefined;
  canvas: HTMLElement | null;
  visitor: VisitorPreview;
  pageData: PageDataCount | null;
  openAsForm: (() => void) | undefined;
  /** The checks the Page checks count runs: the builder's and plugins'. */
  pageChecks: readonly PageCheck[];
  /** What those checks read of the page beyond its document. */
  pageFacts: PageFacts;
  /** Opens Page settings at a tab, for a plugin's fix found there. */
  openSettingsTab: (tab: string) => void;
}

/** What the editor puts in the shell's top bar, by column. */
export interface EditorTopBar {
  topBar: React.JSX.Element;
  topBarCenter: React.JSX.Element;
  topBarEnd: React.JSX.Element;
}

/**
 * What the editor puts in the shell's top bar, by column: the document's
 * history and state at the start, the devices in the centre, and Preview and
 * the document's actions at the end. On a header & footer set's own screen,
 * the set's (`SetBarStart`, `SetBarEnd`).
 *
 * Nothing in the bar shows the selected block, so a selection draws none of
 * it again. The bar reads the editor through its view without the selection
 * (`useDocumentView`), which keeps its identity while only the selection
 * moves, and its handlers are read when pressed (`useLatestCallback`), so
 * each column is handed the same values and is the same element across a
 * selection. Each column is memoised as well, and the shell's own bar is, so
 * an element made afresh with the same values draws nothing either. An edit,
 * an undo or a rename changes what a column is handed, and it draws again.
 */
export function useEditorTopBar(
  view: EditorView,
  page: TopBarPage
): EditorTopBar {
  const edited = useDocumentView(view.editor);
  const pageEditor = useDocumentView(view.page);
  const { requestPanel, search, chooseDevice, setPreviewWidth } = view;
  // Read when pressed, so the newest of each is called while the bar is
  // handed the same function across renders.
  const onAllPages = useLatestCallback(() => requestPanel("pages"));
  const onSearch = useLatestCallback(() => search.setOpen(true));
  const chooseDeviceNow = useLatestCallback(chooseDevice);
  const setPreviewWidthNow = useLatestCallback(setPreviewWidth);
  const openSettingsTab = useLatestCallback(page.openSettingsTab);
  // Offered exactly where the editor has a way to the form.
  const openAsForm = useLatestOptionalCallback(page.openAsForm);

  const isSet = view.set !== undefined;
  const { title, field, location, canvas, pageData, visitor } = page;
  const { pageChecks, pageFacts } = page;
  const { userId, documentDirty, previewMode } = view;
  // The open inline edit as Undo and Redo read it: the canvas's inline
  // editing is a new object on every render, its commit among it, while
  // what the buttons show changes only as an edit opens or closes.
  const { editing, editingRich, inspecting } = view.inline;
  const commitInline = useLatestCallback(view.inline.commit);
  const inline = React.useMemo(
    () => ({ commit: commitInline, editing, editingRich, inspecting }),
    [commitInline, editing, editingRich, inspecting]
  );
  const { canvasRender, siteTokens, canvasRegions } = view;
  const breakpoints = canvasRender.styleContext.breakpoints;
  const { namedClasses } = canvasRender.styleContext;
  const { definitions } = canvasRender;
  // What the checks read of how the page is drawn, a new value only when
  // one of them is.
  const drawnWith = React.useMemo(
    () => checksDrawnWith(definitions, siteTokens, namedClasses),
    [definitions, siteTokens, namedClasses]
  );
  const regionBar = view.regionEditing.topBar;
  const status = siteStyleStatus(view.siteStylePending, view.siteStyleError);
  const { editedBreakpoint, previewWidth } = view;
  const currentPage = view.pages.currentPage;
  // The page being edited, as the switcher remembers it: a new value only
  // when the page, its field or its title does.
  const current = React.useMemo(
    () =>
      currentPage === null
        ? null
        : { ...currentPage, field, title: title ?? "" },
    [currentPage, field, title]
  );

  const topBar = React.useMemo(
    () =>
      isSet ? (
        <SetBarStart title={title} history={edited} inline={inline} />
      ) : (
        <PageBarStart
          title={title ?? ""}
          current={current}
          userId={userId}
          unsavedWork={documentDirty}
          onAllPages={onAllPages}
          location={location}
          pageEditor={pageEditor}
          field={field}
          canvas={canvas}
          // Kept by the panels as one function.
          requestPanel={requestPanel}
          history={edited}
          inline={inline}
          pageData={pageData}
        />
      ),
    [
      isSet,
      title,
      edited,
      inline,
      current,
      userId,
      documentDirty,
      onAllPages,
      location,
      pageEditor,
      field,
      canvas,
      requestPanel,
      pageData,
    ]
  );
  const topBarCenter = React.useMemo(
    () => (
      <BarCentre
        breakpoints={breakpoints}
        selected={editedBreakpoint}
        onSelect={chooseDeviceNow}
        status={status}
        previewWidth={previewWidth}
        onPreviewWidth={setPreviewWidthNow}
        preview={previewMode}
      />
    ),
    [
      breakpoints,
      editedBreakpoint,
      chooseDeviceNow,
      status,
      previewWidth,
      setPreviewWidthNow,
      previewMode,
    ]
  );
  const topBarEnd = React.useMemo(
    () =>
      isSet ? (
        <SetBarEnd regionBar={regionBar} openAsForm={openAsForm} />
      ) : (
        <PageBarEnd
          onSearch={onSearch}
          visitor={visitor}
          editor={edited}
          canvas={canvas}
          checks={pageChecks}
          facts={pageFacts}
          onOpenSettingsTab={openSettingsTab}
          regions={canvasRegions}
          drawnWith={drawnWith}
          regionBar={regionBar}
          openAsForm={openAsForm}
        />
      ),
    [
      isSet,
      regionBar,
      openAsForm,
      onSearch,
      visitor,
      edited,
      canvas,
      pageChecks,
      pageFacts,
      openSettingsTab,
      canvasRegions,
      drawnWith,
    ]
  );
  return { topBar, topBarCenter, topBarEnd };
}

type HistoryProps = React.ComponentProps<typeof HistoryButtons>;
type ChecksProps = React.ComponentProps<typeof PageChecksChip>;

/** What the checks read of how the page is drawn, each only where known. */
type ChecksDrawnWith = Pick<
  ChecksProps,
  "definitions" | "tokens" | "namedClasses"
>;

/**
 * The components the canvas draws the page's placements with; the site's
 * variables, light and dark, for the contrast check; and the site's shared
 * styles, its edits to block types' looks among them, which a block's
 * colours are drawn with. Each left out where it is not known.
 */
function checksDrawnWith(
  definitions: ChecksProps["definitions"],
  tokens: ChecksProps["tokens"],
  namedClasses: ChecksProps["namedClasses"]
): ChecksDrawnWith {
  return {
    ...(definitions === undefined ? {} : { definitions }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(namedClasses === undefined ? {} : { namedClasses }),
  };
}
type SwitcherProps = React.ComponentProps<typeof BreakpointSwitcher>;

/**
 * The start of a page's bar, as the agreed bar has it: the title as a
 * switcher, the status, then undo and redo.
 */
const PageBarStart = React.memo(function PageBarStart({
  title,
  current,
  userId,
  unsavedWork,
  onAllPages,
  location,
  pageEditor,
  field,
  canvas,
  requestPanel,
  history,
  inline,
  pageData,
}: {
  title: string;
  current: React.ComponentProps<typeof PageTitleSwitcher>["current"];
  userId: string | null;
  unsavedWork: boolean;
  onAllPages: () => void;
  location: string | undefined;
  pageEditor: EditorDocumentView;
  field: string;
  canvas: HTMLElement | null;
  requestPanel: React.ComponentProps<typeof BindingsToFixChip>["requestPanel"];
  history: HistoryProps["editor"];
  inline: HistoryProps["inline"];
  pageData: PageDataCount | null;
}): React.JSX.Element {
  return (
    <>
      <PageTitleSwitcher
        title={title}
        current={current}
        userId={userId}
        // "+ New page…" asks about it before leaving the page.
        unsavedWork={unsavedWork}
        onAllPages={onAllPages}
      />
      {location === undefined ? null : <FieldLocation location={location} />}
      <DocumentStatusPill />
      {/* The page's bindings that no longer fit, beside its status: shown
          only when it has one. */}
      <BindingsToFixChip
        editor={pageEditor}
        field={field}
        canvas={canvas}
        requestPanel={requestPanel}
      />
      {/* On a collection's template, how many of its entries have their
          own design, opening the list; nothing on any other document. */}
      <OwnDesignsChip />
      <HistoryButtons editor={history} inline={inline} />
      {/* The page's data against its limit, after undo and redo, in the
          column that shortens first: shown only once the page nears its
          limit, and only on a page, since a component is read as part of
          each page placing it. */}
      <PageReadMeter count={pageData} />
    </>
  );
});

/**
 * The centre of the bar, a page's or a set's.
 *
 * Beside the manager, and gated on the same read for the same reason it is:
 * until the stored style has answered, the set in hand is the host's config
 * defaults, so a device chosen against it could name a breakpoint the site
 * never had.
 *
 * The device chosen is the breakpoint being edited. The choice goes to the
 * shell, which stores it with the author's preferences and reports it back,
 * so this shows the device the edits go to.
 */
const BarCentre = React.memo(function BarCentre({
  breakpoints,
  selected,
  onSelect,
  status,
  previewWidth,
  onPreviewWidth,
  preview,
}: {
  breakpoints: SwitcherProps["breakpoints"];
  selected: SwitcherProps["selected"];
  onSelect: SwitcherProps["onSelect"];
  status: SwitcherProps["status"];
  previewWidth: SwitcherProps["previewWidth"];
  onPreviewWidth: SwitcherProps["onPreviewWidth"];
  preview: React.ComponentProps<typeof CanvasModeSwitch>["preview"];
}): React.JSX.Element {
  return (
    <>
      <BreakpointSwitcher
        breakpoints={breakpoints}
        selected={selected}
        onSelect={onSelect}
        status={status}
        // A width previewed in place of the device's own: shown, typed and
        // reset here, dragged at the canvas frame's edges.
        previewWidth={previewWidth}
        onPreviewWidth={onPreviewWidth}
      />
      {/* Beside the devices: the whole site in its dark values, offered
          while some variable has one. */}
      <CanvasModeSwitch preview={preview} />
    </>
  );
});

/**
 * Save and Publish, which say themselves whether the work is saved and
 * whether the live page is behind; while a header or footer is edited in
 * place, they act on it: "Save header" and "Publish header".
 */
function SaveAndPublish({
  regionBar,
}: {
  regionBar: EditorView["regionEditing"]["topBar"];
}): React.JSX.Element {
  return regionBar === undefined ? (
    <DocumentSaveAndPublish />
  ) : (
    <RegionSaveAndPublish bar={regionBar} />
  );
}

/** The end of a page's bar: search, Preview, the checks, Save and Publish and ⋯. */
const PageBarEnd = React.memo(function PageBarEnd({
  onSearch,
  visitor,
  editor,
  canvas,
  checks,
  facts,
  onOpenSettingsTab,
  regions,
  drawnWith,
  regionBar,
  openAsForm,
}: {
  onSearch: () => void;
  visitor: VisitorPreview;
  editor: EditorDocumentView;
  canvas: HTMLElement | null;
  checks: readonly PageCheck[];
  facts: PageFacts;
  onOpenSettingsTab: (tab: string) => void;
  regions: ChecksProps["regions"];
  drawnWith: ChecksDrawnWith;
  regionBar: EditorView["regionEditing"]["topBar"];
  openAsForm: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <>
      {/* First in the group, as the agreed bar has it: one search for
          blocks, the page, other pages and commands, also on ⌘K. */}
      <SearchButton onOpen={onSearch} />
      <PreviewButton visitor={visitor} />
      {/* Beside Publish, on a page: how many of the draft's checks need
          attention, opening the list. Never a reason to hold Save or
          Publish back, which read nothing of it. */}
      {editor.document.kind === "page" ? (
        <PageChecksChip
          editor={editor}
          canvas={canvas}
          // The builder's checks and other plugins', in their own groups.
          checks={checks}
          facts={facts}
          onOpenSettingsTab={onOpenSettingsTab}
          // The site's header and footer, read with the page, so their
          // headings count in the page's order.
          regions={regions}
          {...drawnWith}
        />
      ) : null}
      {/* Last, at the bar's far end where the header kept them. Publish's
          arrow keeps the other ways to publish, which the builder's taking
          the window would otherwise leave reachable only from the
          keyboard. */}
      <SaveAndPublish regionBar={regionBar} />
      {/* After them, as the entry page's own ⋯ follows its Publish: the
          form and the pin, which a page that opens here would otherwise
          leave out of reach. */}
      <EditorMoreMenu onOpenAsForm={openAsForm} />
    </>
  );
});

/**
 * The start of a header & footer set's own bar: the set's name and state
 * with its history. Nothing of a page's: no page switcher, checks, data
 * meter or preview, since the set has no page of its own.
 */
const SetBarStart = React.memo(function SetBarStart({
  title,
  history,
  inline,
}: {
  title: string | undefined;
  history: HistoryProps["editor"];
  inline: HistoryProps["inline"];
}): React.JSX.Element {
  const shown = title === undefined || title === "" ? "Untitled set" : title;
  return (
    <>
      <span
        title={shown}
        className="min-w-0 max-w-[20rem] shrink truncate text-sm font-medium"
        data-testid="builder-set-title"
      >
        {shown}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        Header & footer set
      </span>
      <DocumentStatusPill />
      <HistoryButtons editor={history} inline={inline} />
    </>
  );
});

/**
 * The end of a set's own bar: Save and Publish, which store the set (or,
 * while its header or footer is edited in place, that), and ⋯.
 */
const SetBarEnd = React.memo(function SetBarEnd({
  regionBar,
  openAsForm,
}: {
  regionBar: EditorView["regionEditing"]["topBar"];
  openAsForm: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <>
      <SaveAndPublish regionBar={regionBar} />
      <EditorMoreMenu onOpenAsForm={openAsForm} />
    </>
  );
});
