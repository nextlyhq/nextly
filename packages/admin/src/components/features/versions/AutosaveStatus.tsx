/**
 * Autosave Status
 *
 * The quiet line beside the Save button reporting whether the author's recovery
 * point is current.
 *
 * Deliberately not a toast: autosave runs on a timer, so a notification per
 * save would be noise on every pause. Equally deliberately not failure-only --
 * silence cannot be told apart from "not running", and not knowing whether the
 * work is safe is the doubt autosave exists to remove. A failure stays on
 * screen rather than fading, because it is the one state the author has to act
 * on.
 *
 * @module components/features/versions/AutosaveStatus
 */

import type { AutosaveStatus as Status } from "@admin/hooks/useAutosave";
import { cn } from "@admin/lib/utils";

export interface AutosaveStatusProps {
  status: Status;
  /** When the last successful save landed. */
  lastSavedAt: Date | null;
  className?: string;
}

/**
 * Clock time rather than "2 minutes ago": a relative label is only truthful if
 * it is re-rendered on a timer, and this sits beside an editor where a stray
 * re-render costs more than the phrasing is worth.
 */
function formatSavedAt(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AutosaveStatus({
  status,
  lastSavedAt,
  className,
}: AutosaveStatusProps) {
  // Nothing to report before the first save; an idle editor stays uncluttered.
  if (status === "idle" && !lastSavedAt) {
    return null;
  }

  const isError = status === "error";
  const label =
    status === "saving"
      ? "Saving..."
      : isError
        ? "Draft not saved"
        : // Edits are waiting for the debounce, so the stored point is already
          // behind the form. Saying "Saved" here would assert the current work
          // is safe during the very window in which it is not.
          status === "pending"
          ? "Unsaved changes"
          : lastSavedAt
            ? `Saved ${formatSavedAt(lastSavedAt)}`
            : null;

  if (label === null) {
    return null;
  }

  return (
    <span
      // `aria-live` so the state reaches a screen reader without moving focus
      // away from the field being edited. Assertive only for the failure, which
      // is the one state worth interrupting for.
      aria-live={isError ? "assertive" : "polite"}
      className={cn(
        "text-sm",
        // Both tokens are defined for light and dark, so the line stays legible
        // in either mode without a variant here.
        isError ? "text-destructive" : "text-muted-foreground",
        className
      )}
    >
      {label}
    </span>
  );
}
