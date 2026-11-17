"use client";

/**
 * The editor's canvas region: the page drawn in its frame with the marks and
 * controls over it, or what stands in its place while a read the canvas needs
 * is still coming or has failed.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-canvas-region
 */
import { blockNameOf } from "@nextlyhq/builder";
import {
  BlockContextMenu,
  BlockToolbar,
  Canvas,
  CanvasFrame,
  CanvasMarks,
  DropIndicator,
  DropRefusal,
  elementAnchor,
  EmptyContainerAppenders,
  PageInserters,
  RepairNotice,
  SpacingOverlay,
  VisitorUnreadableBadges,
} from "@nextlyhq/builder/shell";
import { Button } from "@nextlyhq/ui";

import { siteSheet } from "../../site-style";
import type { LibraryReadState } from "../pattern-library-client";

import { CanvasFirstAddChoosers } from "./canvas-first-add-choosers";
import { CanvasImageStates } from "./canvas-image-states";
import { previewedCanvas } from "./canvas-preview-mode";
import { DoubleHeaderNotice } from "./double-header-notice";
import type { EditorView } from "./editor-view";
import { SiteLayoutNote } from "./site-canvas";

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

/** The canvas, or what stands in its place while a read it needs is out. */
export function editorCanvasRegion(view: EditorView): React.JSX.Element {
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
    insertPicker,
    locale,
    canvasSource,
    canvasFallback,
    onCanvasFallback,
    canvasDir,
    siteChrome,
    onSiteChrome,
    siteHeaderFooter,
    visitorUnreadable,
    readMedia,
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
      {/*
        Visitors may see two headers: the site's own layout draws around the
        page and a header & footer set draws inside it. Said once a session.
      */}
      <DoubleHeaderNotice
        siteChrome={siteChrome}
        setDrawn={(view.canvasRegions ?? []).length > 0}
        siteHeaderFooter={siteHeaderFooter}
      />
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
            // Where the site's own layout draws around the page, for the
            // notice that visitors may see two headers.
            onSiteChrome={onSiteChrome}
            // The site mode the author picked, on the frame's document and
            // the frame element only; nothing picked draws the page's own.
            theme={previewed.theme}
            // One row: the variant previewed and the mode picked. Pinned to
            // the frame's viewport, so it stays in view while the page
            // scrolls rather than leaving with the page's top.
            pinned={previewed.tags}
            overlay={
              <>
                {/* An Image with no picture: "Add an image" with Upload,
                    Media library and Link, and a file dropped on it, through
                    the admin's media library. First, so the marks, the drop
                    line and the toolbar are drawn over it. */}
                <CanvasImageStates
                  editor={editor}
                  {...(canvasRender.hostPolicy?.remotePatterns === undefined
                    ? {}
                    : {
                        remotePatterns: canvasRender.hostPolicy.remotePatterns,
                      })}
                  dragging={dragging}
                />
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
                  // A fallback chosen from the library is named in the
                  // tooltip by its file, read as the inspector reads it.
                  readMedia={readMedia}
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
                  their placeholder outline, so the "+" over it always has one.
                  Pressed, it opens the in-place picker beside it, aimed INSIDE
                  the container for every block, with nothing selected on the
                  way.
                */}
                <EmptyContainerAppenders
                  document={editor.document}
                  slots={slots}
                  blocks={blocks}
                  hidden={dragging}
                  onAppend={(nodeId, control) =>
                    insertPicker.open(
                      { kind: "place", place: { inside: nodeId } },
                      elementAnchor(control)
                    )
                  }
                />
                {/*
                  The empty page's start card and the "+" in each gap. A gap's
                  "+" opens the in-place picker beside it, aimed at exactly
                  that gap, after the block before it, with nothing selected
                  on the way. The start card opens Add on a page with nothing
                  to select. Hidden mid-drag, when the drag's own line says
                  where a block lands.
                */}
                <PageInserters
                  document={editor.document}
                  selectedId={editor.selectedId}
                  componentTitle={componentLibrary.titleOf}
                  hidden={dragging}
                  onStart={() => view.openInsertPanel()}
                  onAddAfter={(nodeId, control) =>
                    insertPicker.open(
                      { kind: "place", place: { after: nodeId } },
                      elementAnchor(control)
                    )
                  }
                />
                {/* A block just added that asks for a choice (Columns: its
                    layout) draws its chooser in place of its body until the
                    author picks or skips. Last, so it covers the "+" of the
                    block's own empty columns; hidden mid-drag. A store
                    of the page ends it. */}
                <CanvasFirstAddChoosers editor={editor} hidden={dragging} />
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
