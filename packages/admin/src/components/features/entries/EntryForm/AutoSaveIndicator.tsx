/**
 * Auto-Save Indicator Component
 *
 * Shows the current auto-save status with visual feedback.
 * Displays saving animation, last saved time, and unsaved changes state.
 *
 * @module components/entries/EntryForm/AutoSaveIndicator
 * @since 1.0.0
 */

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/ui";

import { Cloud, CloudOff, Check, Loader2 } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface AutoSaveIndicatorProps {
  /** Timestamp of last successful save */
  lastSavedAt: Date | null;
  /** Whether a save is currently in progress */
  isSaving: boolean;
  /** Whether the form has unsaved changes */
  isDirty: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Formats a date as a relative time string for the tooltip.
 */
function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return "just now";
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
}

// ============================================================================
// Component
// ============================================================================

/**
 * AutoSaveIndicator - Shows auto-save status
 *
 * Displays different states:
 * - **Saving:** Spinner with "Saving..." text
 * - **Saved (clean):** Checkmark with "Saved" text
 * - **Saved (dirty):** Cloud with "Unsaved changes" text
 * - **Not saved:** CloudOff when form is dirty but nothing saved yet
 *
 * @example
 * ```tsx
 * <AutoSaveIndicator
 *   lastSavedAt={autoSave.lastSavedAt}
 *   isSaving={autoSave.isSaving}
 *   isDirty={form.formState.isDirty}
 * />
 * ```
 */
export function AutoSaveIndicator({
  lastSavedAt,
  isSaving,
  isDirty,
  className,
}: AutoSaveIndicatorProps) {
  // Determine state and content
  let icon: React.ReactNode;
  let label: string;
  let tooltipContent: string;

  if (isSaving) {
    icon = <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    label = "Saving...";
    tooltipContent = "Storing a recovery point";
  } else if (lastSavedAt) {
    const timeAgo = formatTimeAgo(lastSavedAt);
    if (isDirty) {
      icon = <Cloud className="h-4 w-4 text-muted-foreground" />;
      label = "Unsaved changes";
      tooltipContent = `Recovery point stored ${timeAgo}. Newer changes not in it yet.`;
    } else {
      // No dark variant: `success` is tuned to read in both modes, and
      // `success-500` aliases it, so the override said nothing.
      icon = <Check className="h-4 w-4 text-success" />;
      label = "Saved";
      tooltipContent = `Recovery point stored ${timeAgo}`;
    }
  } else if (isDirty) {
    icon = <CloudOff className="h-4 w-4 text-muted-foreground" />;
    label = "Not saved";
    tooltipContent = "A recovery point will be stored shortly";
  } else {
    // No changes, no saves - don't show anything
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-1.5 text-sm text-muted-foreground",
              className
            )}
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <p>{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
