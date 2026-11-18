"use client";

/**
 * The editor's top bar: the page's title and state with its history at the
 * start, the devices and the light and dark preview in the centre, and
 * search, Preview, the document's actions and its ⋯ menu at the end.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-top-bar
 */
import type { PageCheck, PageFacts } from "@nextlyhq/builder";
import { BreakpointSwitcher, PageChecksChip } from "@nextlyhq/builder/shell";
import { DocumentSaveAndPublish } from "@nextlyhq/plugin-sdk/admin";

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
import { siteStyleStatus } from "./site-style-studios";

/**
 * The top bar's items: the document's state, and the breakpoints.
 *
 * Called as a function rather than rendered as a component, here and for the
 * inspector and the canvas region in their own modules, so the tree the shell
 * receives is the one it always received.
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

export function editorTopBar(
  view: EditorView,
  /**
   * The page's title as the form has it now, the field being edited by its
   * address, where that field sits in words when below the top level, and
   * the canvas, which a binding's Select brings its block into view in,
   * and "Preview as visitor", which Preview's menu holds, and the page's
   * data count, which the bar shows only near the limit, and the way to the
   * document's form, which the ⋯ menu offers.
   */
  page: {
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
): {
  topBar: React.JSX.Element;
  topBarCenter: React.JSX.Element;
  topBarEnd: React.JSX.Element;
} {
  const {
    canvasRender,
    siteStylePending,
    siteStyleError,
    editedBreakpoint,
    chooseDevice,
    previewWidth,
    setPreviewWidth,
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
        <DocumentStatusPill />
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
        {/* The page's data against its limit, after undo and redo, in the
            column that shortens first: shown only once the page nears its
            limit, and only on a page, since a component is read as part of
            each page placing it. */}
        <PageReadMeter count={page.pageData} />
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
          // A width previewed in place of the device's own: shown, typed
          // and reset here, dragged at the canvas frame's edges.
          previewWidth={previewWidth}
          onPreviewWidth={setPreviewWidth}
        />
        {/* Beside the devices: the whole site in its dark values, offered
            while some variable has one. */}
        <CanvasModeSwitch preview={view.previewMode} />
      </>
    ),
    topBarEnd: (
      <>
        {/* First in the group, as the agreed bar has it: one search for
          blocks, the page, other pages and commands, also on ⌘K. */}
        <SearchButton onOpen={() => view.search.setOpen(true)} />
        <PreviewButton visitor={page.visitor} />
        {/* Beside Publish, on a page: how many of the draft's checks need
          attention, opening the list. Never a reason to hold Save or
          Publish back, which read nothing of it. */}
        {editor.document.kind === "page" ? (
          <PageChecksChip
            editor={editor}
            canvas={page.canvas}
            // The builder's checks and other plugins', in their own groups.
            checks={page.pageChecks}
            facts={page.pageFacts}
            onOpenSettingsTab={page.openSettingsTab}
            // The site's header and footer, read with the page, so their
            // headings count in the page's order.
            regions={view.canvasRegions}
            // The components the canvas draws the page's placements with.
            {...(canvasRender.definitions === undefined
              ? {}
              : { definitions: canvasRender.definitions })}
            // The site's variables, light and dark, for the contrast check.
            {...(view.siteTokens === undefined
              ? {}
              : { tokens: view.siteTokens })}
            // The site's shared styles, its edits to block types' looks
            // among them, which a block's colours are drawn with.
            {...(canvasRender.styleContext.namedClasses === undefined
              ? {}
              : { namedClasses: canvasRender.styleContext.namedClasses })}
          />
        ) : null}
        {/* Last, at the bar's far end where the header kept them: Save and
          Publish, which say themselves whether the work is saved and
          whether the live page is behind, so nothing else in the bar says
          it again. Publish's arrow keeps the other ways to publish, which
          the builder's taking the window would otherwise leave reachable
          only from the keyboard. */}
        <DocumentSaveAndPublish />
        {/* After them, as the entry page's own ⋯ follows its Publish: the
          form and the pin, which a page that opens here would otherwise
          leave out of reach. */}
        <EditorMoreMenu onOpenAsForm={page.openAsForm} />
      </>
    ),
  };
}
