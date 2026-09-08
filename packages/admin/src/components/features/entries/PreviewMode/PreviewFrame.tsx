"use client";

/**
 * The site, rendered inside the admin, showing the draft as last saved.
 *
 * An IFRAME rather than a rendered-in-place copy, and that is the load-bearing
 * decision rather than a convenience. The frame is a real browsing context with
 * a real viewport, so the page's own `@media` rules resolve exactly as they do
 * for a visitor — and its document is the SITE's, so nothing the admin styles
 * leaks in and nothing the site styles leaks out. Rendering the page inside the
 * admin document would answer a different question than the one an author is
 * asking, which is "what will this look like".
 *
 * `sandbox` is deliberately NOT set. The site is first-party content the editor
 * is authorised to read, and a sandbox without `allow-same-origin` would break
 * the site's own cookies — including the preview cookie the token was exchanged
 * for, which is what makes the draft visible at all.
 *
 * When the pane cannot carry a preview session it renders the reason and NO
 * iframe. That is the whole point of the state: both blocking conditions end in
 * the site serving the published page, which looks like a working preview of
 * unsaved-looking content. An empty pane with a sentence beats a frame that is
 * confidently wrong, and the tab remains one click away in every such state.
 *
 * @module components/features/entries/PreviewMode/PreviewFrame
 */

import { Button } from "@nextlyhq/ui";
import { useRef } from "react";

import { ExternalLink, Loader2, RefreshCw, X } from "@admin/components/icons";
import {
  previewFrameFit,
  previewFrameStyle,
  type PreviewFit,
} from "@admin/components/shared/preview/previewFrameFit";
import { useMeasuredWidth } from "@admin/components/shared/preview/useMeasuredWidth";
import {
  previewMessage,
  type PreviewDocumentNoun,
} from "@admin/hooks/useEntryPreview";

import { PreviewViewportControl } from "./PreviewViewportControl";
import {
  PREVIEW_PANE_BLOCK_MESSAGES,
  type UsePreviewFrameResult,
} from "./usePreviewFrame";

export interface PreviewFrameProps extends UsePreviewFrameResult {
  /** Close the pane and return the editor to its ordinary measure. */
  onClose: () => void;
  /** The label the collection chose for its preview, for the frame's title. */
  label: string;
  /**
   * Which kind of document this frame is showing.
   *
   * Carried so a refusal is worded for the document in hand: the entry advice
   * names a slug, which a Single always has and cannot be the problem with.
   */
  noun: PreviewDocumentNoun;
  /**
   * The viewport width the author asked for, or `null` to fill the pane.
   *
   * Held by the pane rather than here because choosing a width also WIDENS the
   * split — the pane takes as much room as it is allowed before anything is
   * scaled down — and the split is the pane's to move, not the frame's.
   */
  requestedWidth: number | null;
  onRequestWidth: (width: number | null) => void;
}

export function PreviewFrame({
  url,
  reloadKey,
  isLoading,
  reason,
  block,
  refresh,
  onClose,
  label,
  noun,
  requestedWidth,
  onRequestWidth,
  viewports,
}: PreviewFrameProps) {
  /*
   * The area the frame is drawn into, measured rather than assumed. Its width
   * is what decides whether a requested viewport fits, and it changes when the
   * SPLIT moves — an event the window never reports, which is why this is a
   * `ResizeObserver` on the box itself.
   */
  const viewport = useRef<HTMLDivElement>(null);
  const available = useMeasuredWidth(viewport);
  const fit = previewFrameFit(requestedWidth, available);

  // A frame is on screen only in the last branch below. Offering a viewport
  // control over a refusal message would be a control for something that is
  // not there.
  const showsFrame = reason === null && block === null && url !== null;

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-muted/40">
      {/* Wraps rather than overflows. The pane is a share of a split, so at a
          1024px window it is a few hundred pixels wide — and this row holds a
          viewport select, a width box, a scaling note and three actions. Fixed
          on one line they ran past the edge into `overflow-hidden` below, which
          put refresh, open-in-tab and close off-screen with no way to scroll to
          them. Wrapping costs a second row and reaches everything. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-background px-3 py-2">
        <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {/* States what the frame IS showing rather than what an author might
            hope it shows. The pane cannot reflect unsaved edits — the site
            renders the saved draft on its own server — and an author who is not
            told that reads a stale-looking page as the preview being broken.
            Withdrawn while blocked, where no draft is on screen to describe. */}
        {block === null && (
          <span className="truncate text-xs text-muted-foreground">
            · last saved draft
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {showsFrame && (
            <PreviewViewportControl
              requestedWidth={requestedWidth}
              onRequestWidth={onRequestWidth}
              fit={fit}
              viewports={viewports}
            />
          )}
          {/* The three actions are ONE flex item, so the row above breaks
              between the viewport control and them rather than through the
              middle of them. Wrapped individually they scattered across rows —
              refresh above, close below — which reads as three unrelated
              controls instead of this pane's toolbar. */}
          <div className="flex shrink-0 items-center gap-2">
            {isLoading && (
              <Loader2
                className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={refresh}
              /*
               * Disabled only while a mint is IN FLIGHT, never because there is
               * nothing to show. A failed mint leaves `url` null and sets a
               * reason, and the message beside it asks the editor to try again —
               * so keying the control on `url` disabled the one affordance that
               * message points at, and the only way to retry was to close the
               * pane and reopen it. A superseded pane needs it for the same
               * reason: refreshing is how the session comes back.
               */
              disabled={isLoading}
              title="Refresh the preview"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Refresh the preview</span>
            </Button>
            {url !== null && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                title="Open in a new tab"
              >
                {/* `rel` carries noopener as well as noreferrer: a preview URL is
                  a bearer credential, and a referrer header would hand it to
                  whatever the opened page links to next. */}
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Open the preview in a new tab</span>
                </a>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              title="Close the preview"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Close the preview</span>
            </Button>
          </div>
        </div>
      </div>

      {/* `overflow-hidden` because a frame wider than this box is drawn inside
          it and scaled down: without clipping, the untransformed corners of a
          scaled frame paint over the divider. Harmless while responsive, since
          the frame is then exactly this size. */}
      <div ref={viewport} className="min-h-0 flex-1 overflow-hidden">
        <PreviewFrameBody
          reason={reason}
          block={block}
          url={url}
          reloadKey={reloadKey}
          label={label}
          noun={noun}
          fit={fit}
        />
      </div>
    </div>
  );
}

/**
 * What the frame's content area shows: one of three refusals, or the site.
 *
 * Split from the toolbar because they answer different questions and grow at
 * different rates — the toolbar gained a viewport control, and carrying both in
 * one component put it over the complexity gate. The ORDER of the branches is
 * the load-bearing part and is preserved exactly, so this is a move rather than
 * a rewrite.
 */
function PreviewFrameBody({
  reason,
  block,
  url,
  reloadKey,
  label,
  noun,
  fit,
}: {
  reason: UsePreviewFrameResult["reason"];
  block: UsePreviewFrameResult["block"];
  url: string | null;
  reloadKey: number;
  label: string;
  noun: PreviewDocumentNoun;
  fit: PreviewFit;
}) {
  /* The reason, not a generic failure. Each of these names something the reader
     can act on, and the pane is the only place they will see it — unlike the
     Preview button, which can raise a toast. */
  if (reason !== null) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {previewMessage(reason, noun)}
      </p>
    );
  }

  /* Ahead of the `url === null` branch on purpose: a blocked pane HAS a url —
     that is what makes the tab button beside this message the remedy — so
     testing for a missing url first would render "Preparing the preview…"
     forever over a pane that is not preparing anything. */
  if (block !== null) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {PREVIEW_PANE_BLOCK_MESSAGES[block]}
      </p>
    );
  }

  if (url === null) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Preparing the preview…
      </p>
    );
  }

  return (
    <iframe
      // Remounted rather than navigated: see `usePreviewFrame` on why a key
      // beats appending a cache-buster the SITE would have to read.
      key={reloadKey}
      src={url}
      title={`${label} preview`}
      /*
       * `h-full w-full` remains the base, and the derived style overrides it
       * when a width was asked for. A responsive frame therefore needs no
       * special case, and an unmeasured one fills the pane rather than flashing
       * at a width nobody has confirmed.
       */
      className="h-full w-full border-0 bg-background"
      style={previewFrameStyle(fit)}
    />
  );
}
