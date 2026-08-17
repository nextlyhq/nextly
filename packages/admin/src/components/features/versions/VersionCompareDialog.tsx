/**
 * A comparison of two versions, in a surface wide enough to be one.
 *
 * A diff is a two-column reading by nature, and the history panel is 480px —
 * too narrow to hold two columns of field values, which is why the comparison
 * used to stack. Giving it a dialog of its own separates the two jobs: the
 * panel lists and previews, this compares, and neither is squeezed by the
 * other's constraints.
 *
 * A modal rather than a route, deliberately. Comparing is a step taken while
 * reading history, and the editor returns to the panel underneath afterwards;
 * a route would unmount the document being worked on to show a diff of it.
 *
 * @module components/features/versions/VersionCompareDialog
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@admin/components/ui";
import type { VersionScope } from "@admin/services/versionApi";

import { VersionDiffView } from "./diff/VersionDiffView";

export interface VersionCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: VersionScope;
  /** Older version being compared. */
  from: number;
  /** Newer version being compared. */
  to: number;
}

export function VersionCompareDialog({
  open,
  onOpenChange,
  scope,
  from,
  to,
}: VersionCompareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No `size` variant: every one of them sets an unprefixed `max-w-*`
          except `full`, which also sets a `sm:` one — and a responsive variant
          is a different utility group, so it would survive this className and
          win back the width above the `sm` breakpoint. Stating the cap here
          alone keeps one rule deciding it.

          The cap is the width two comfortable columns of field values need,
          bounded by the viewport so an ultrawide screen does not stretch a
          reading measure across the whole display. Height is fixed rather than
          content-driven: the body scrolls, so a hundred-field document and a
          two-field one open the same shape and the column headings stay put. */}
      <DialogContent
        className="flex h-[85vh] max-h-[85vh] w-full max-w-[min(72rem,calc(100vw-4rem))] flex-col gap-0 overflow-hidden p-0"
        // The panel that opened this stays mounted behind it, so a pointer
        // press landing outside must not also reach that panel's dismiss
        // handling and close both at once.
        onPointerDownOutside={event => event.preventDefault()}
      >
        {/* Right padding clears the primitive's absolutely positioned close
            button, which would otherwise sit over a long title. */}
        <DialogHeader className="border-b border-border px-4 py-3 pr-12">
          <DialogTitle>
            Compare version {from} with version {to}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Field-by-field differences between two stored versions of this
            document, oldest on the left.
          </DialogDescription>
        </DialogHeader>

        {/* Keyed by the pair so a different comparison always mounts fresh, and
            a cached response for one pair can never paint under another's
            heading while the new diff loads. */}
        <VersionDiffView
          key={`${from}-${to}`}
          scope={scope}
          from={from}
          to={to}
        />
      </DialogContent>
    </Dialog>
  );
}
