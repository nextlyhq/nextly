/**
 * Autosave Recovery Notice
 *
 * Offers back the recovery point autosave stored, when one exists that is newer
 * than the saved document.
 *
 * An inline notice rather than a modal on open: the author did not ask a
 * question, and a dialog in front of the editor would make every return to a
 * document they abandoned mid-edit into something to dismiss before working.
 * Restoring is also the destructive-feeling choice here (it replaces what is on
 * screen), so it is offered rather than defaulted to.
 *
 * @module components/features/versions/AutosaveRecoveryNotice
 */

import { Button } from "@nextlyhq/ui";

import { cn } from "@admin/lib/utils";

export interface AutosaveRecoveryNoticeProps {
  /** When the offered snapshot was stored. Absent means nothing to offer. */
  savedAt: Date | null;
  onRestore: () => void;
  onDismiss: () => void;
  className?: string;
}

function formatSavedAt(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AutosaveRecoveryNotice({
  savedAt,
  onRestore,
  onDismiss,
  className,
}: AutosaveRecoveryNoticeProps) {
  if (!savedAt) {
    return null;
  }

  return (
    <div
      // `status` rather than `alert`: this is worth reading but nothing has
      // gone wrong, and it must not interrupt a screen reader mid-field.
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-md border",
        "border-warning/40 bg-warning/10 px-4 py-3 text-sm",
        className
      )}
    >
      <p className="text-foreground">
        {/* Says the changes are AVAILABLE, not that they were applied: this
            renders before the author chooses, and the form still holds the
            saved document until they do. Names the time so they can tell an
            abandoned edit from one they already dealt with, which is the
            judgement only they can make. */}
        Unsaved changes from {formatSavedAt(savedAt)} are available to restore.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          Ignore
        </Button>
        <Button type="button" size="sm" onClick={onRestore}>
          Restore them
        </Button>
      </div>
    </div>
  );
}
