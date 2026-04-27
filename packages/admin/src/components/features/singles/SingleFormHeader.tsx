/**
 * Single Form Header Component
 *
 * Displays the header for the Single edit form with title,
 * description, and last updated timestamp.
 *
 * Unlike EntryFormHeader, this component:
 * - Has no actions dropdown (Singles can't be deleted/duplicated)
 * - Shows last updated timestamp prominently
 * - Displays the Single's description if available
 *
 * @module components/singles/SingleFormHeader
 * @since 1.0.0
 */

import type React from "react";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Formats a date as a relative time string (e.g., "5 minutes ago").
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
// Types
// ============================================================================

export interface SingleFormHeaderProps {
  /** Display label for the Single */
  label: string;
  /** Optional description */
  description?: string;
  /** Last time the document was updated */
  updatedAt?: string;
  /** Whether form has unsaved changes */
  isDirty?: boolean;
  /** Custom action buttons to display next to the title */
  actions?: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * SingleFormHeader - Header for Single edit form
 *
 * Displays:
 * - Title (Single label)
 * - Description (if provided)
 * - Actions (Save/Cancel)
 * - Last updated timestamp
 *
 * @example
 * ```tsx
 * <SingleFormHeader
 *   label="Site Settings"
 *   slug="site-settings"
 *   description="Configure global site settings"
 *   updatedAt="2024-01-15T10:30:00Z"
 *   actions={<SingleFormActions />}
 * />
 * ```
 */
export function SingleFormHeader({
  label,
  description,
  updatedAt,
  _isDirty,
  actions,
}: SingleFormHeaderProps) {
  const lastUpdatedText = updatedAt ? formatTimeAgo(new Date(updatedAt)) : null;

  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{label}</h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        {/* Right side: actions */}
        <div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>

      {/* Last updated info */}
      {lastUpdatedText && (
        <p className="text-xs text-muted-foreground mt-2">
          Last updated {lastUpdatedText}
        </p>
      )}
    </div>
  );
}
