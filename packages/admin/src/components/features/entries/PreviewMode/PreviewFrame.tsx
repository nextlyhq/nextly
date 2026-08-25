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

import { ExternalLink, Loader2, RefreshCw, X } from "@admin/components/icons";
import { PREVIEW_MESSAGES } from "@admin/hooks/useEntryPreview";

import {
  PREVIEW_PANE_BLOCK_MESSAGES,
  type UsePreviewFrameResult,
} from "./usePreviewFrame";

export interface PreviewFrameProps extends UsePreviewFrameResult {
  /** Close the pane and return the editor to its ordinary measure. */
  onClose: () => void;
  /** The label the collection chose for its preview, for the frame's title. */
  label: string;
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
}: PreviewFrameProps) {
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-muted/40">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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

        <div className="ml-auto flex items-center gap-1">
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
            <Button asChild variant="ghost" size="sm" title="Open in a new tab">
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

      <div className="min-h-0 flex-1">
        {reason !== null ? (
          /* The reason, not a generic failure. Each of these names something
             the reader can act on, and the pane is the only place they will
             see it — unlike the Preview button, which can raise a toast. */
          <p className="p-6 text-sm text-muted-foreground">
            {PREVIEW_MESSAGES[reason]}
          </p>
        ) : block !== null ? (
          /* Ahead of the `url === null` branch on purpose: a blocked pane HAS a
             url — that is what makes the tab button beside this message the
             remedy — so testing for a missing url first would render "Preparing
             the preview…" forever over a pane that is not preparing anything. */
          <p className="p-6 text-sm text-muted-foreground">
            {PREVIEW_PANE_BLOCK_MESSAGES[block]}
          </p>
        ) : url === null ? (
          <p className="p-6 text-sm text-muted-foreground">
            Preparing the preview…
          </p>
        ) : (
          <iframe
            // Remounted rather than navigated: see `usePreviewFrame` on why a
            // key beats appending a cache-buster the SITE would have to read.
            key={reloadKey}
            src={url}
            title={`${label} preview`}
            className="h-full w-full border-0 bg-background"
          />
        )}
      </div>
    </div>
  );
}
