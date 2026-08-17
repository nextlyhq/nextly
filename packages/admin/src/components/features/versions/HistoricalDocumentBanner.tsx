/**
 * Says, above the document itself, that what is on screen is the past.
 *
 * The fields below this are the editor's own, rendered read-only — which is
 * legible but not self-explanatory: a tinted, uneditable form could equally be
 * a document someone lacks permission to change. So the banner states which
 * version is showing, that it is not live, and offers the way back.
 *
 * @module components/features/versions/HistoricalDocumentBanner
 */

import { Badge, Button } from "@admin/components/ui";

export interface HistoricalDocumentBannerProps {
  versionNo: number;
  /** The locale this version was captured in, when the document is localized. */
  locale?: string | null;
  /** Returns the document area to the live document. */
  onReturnToCurrent: () => void;
  /** Offered only to a caller who may write the document. */
  onRestore?: () => void;
  restoreDisabled?: boolean;
}

export function HistoricalDocumentBanner({
  versionNo,
  locale = null,
  onReturnToCurrent,
  onRestore,
  restoreDisabled = false,
}: HistoricalDocumentBannerProps) {
  return (
    // `status`, not `alert`: this is a state the reader moved into deliberately,
    // so it belongs in the polite queue rather than interrupting.
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-border bg-primary/5 px-6 py-3"
    >
      <Badge variant="default">Version {versionNo}</Badge>
      <p className="text-sm text-foreground">
        You are reading a past version of this document
        {/* A localized document captures a version per locale, so the banner
            names which translation is on screen. */}
        {locale ? ` (${locale})` : ""}. It is not what is live, and it cannot be
        edited here.
      </p>
      {/* Beside the sentence rather than pushed to the right edge. The history
          panel is an overlay on that edge, so anything right-aligned here sits
          underneath it — unreachable by pointer while the panel that led the
          reader here is still open. */}
      <div className="flex items-center gap-2">
        {onRestore ? (
          <Button size="sm" onClick={onRestore} disabled={restoreDisabled}>
            Restore this version
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onReturnToCurrent}>
          Back to current
        </Button>
      </div>
    </div>
  );
}
