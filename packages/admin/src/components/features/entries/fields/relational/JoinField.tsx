/**
 * Join Field Component
 *
 * Displays entries from another collection that reference the current document
 * through a relationship field. This is a read-only, virtual field that
 * queries related entries at render time.
 *
 * @module components/entries/fields/relational/JoinField
 * @since 1.0.0
 */

import type { JoinFieldConfig } from "@revnixhq/nextly/config";
import { Badge, Button, Skeleton } from "@revnixhq/ui";

import { useOptionalEntryFormContext } from "@admin/components/features/entries/EntryForm/EntryFormContext";
import {
  ExternalLink,
  Loader2,
  ChevronRight,
  FileText,
  AlertCircle,
} from "@admin/components/icons";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useEntries } from "@admin/hooks/queries";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { navigateTo } from "@admin/lib/navigation";
import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface JoinFieldProps {
  /**
   * Field configuration from collection schema.
   */
  field: JoinFieldConfig;

  /**
   * Additional CSS classes.
   */
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Extracts a display label from an entry object.
 * Tries common label fields in priority order.
 */
function getEntryLabel(entry: Record<string, unknown>): string {
  return (
    (entry.title as string) ||
    (entry.name as string) ||
    (entry.label as string) ||
    (entry.email as string) ||
    (entry.subject as string) ||
    (entry.id as string) ||
    "Untitled"
  );
}

/**
 * Formats a date for display.
 */
function formatDate(dateString: unknown): string {
  if (!dateString || typeof dateString !== "string") {
    return "";
  }
  try {
    return formatDateWithAdminTimezone(dateString, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// ============================================================
// Component
// ============================================================

/**
 * JoinField displays related entries from another collection.
 *
 * This is a virtual field that queries entries at render time,
 * showing all documents that reference the current entry through
 * the specified relationship field.
 *
 * Features:
 * - Queries entries where `field.on` equals current entry ID
 * - Supports filtering via `field.where`
 * - Supports sorting via `field.defaultSort`
 * - Configurable limit via `field.defaultLimit`
 * - Optional navigation to related entries
 * - Loading and empty states
 *
 * @example Basic usage (within EntryForm context)
 * ```tsx
 * // Show posts that reference this category
 * <JoinField
 *   field={{
 *     name: 'posts',
 *     type: 'join',
 *     collection: 'posts',
 *     on: 'category',
 *   }}
 * />
 * ```
 *
 * @example With filtering and sorting
 * ```tsx
 * <JoinField
 *   field={{
 *     name: 'publishedPosts',
 *     type: 'join',
 *     label: 'Published Posts',
 *     collection: 'posts',
 *     on: 'category',
 *     where: { status: { equals: 'published' } },
 *     defaultSort: '-publishedAt',
 *     defaultLimit: 5,
 *   }}
 * />
 * ```
 */
export function JoinField({ field, className }: JoinFieldProps) {
  // Get entry context (entryId, collectionSlug) from form context
  const entryContext = useOptionalEntryFormContext();
  const entryId = entryContext?.entryId;
  const collectionSlug = entryContext?.collectionSlug || "";
  const isCreateMode = entryContext?.isCreateMode ?? false;

  const allowNavigation = field.admin?.allowNavigation !== false;
  const limit = field.defaultLimit ?? 10;
  const sort = field.defaultSort;

  // Build where clause - safe when entryId is undefined because enabled: !!entryId prevents fetching
  const whereClause = entryId
    ? { [field.on]: { equals: entryId }, ...(field.where || {}) }
    : {};

  // Query entries that reference this document
  const { data, isLoading, error } = useEntries({
    collectionSlug: field.collection,
    params: {
      limit,
      sort,
      where: whereClause,
      depth: field.maxDepth ?? 1,
    },
    enabled: !!entryId,
  });

  // Show placeholder for new entries that haven't been saved yet
  if (isCreateMode || !entryId) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center gap-2 rounded-none  border border-primary/5 border-dashed border-primary/5-foreground/25 bg-primary/5 p-4 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>
            Save this {collectionSlug || "entry"} first to see related{" "}
            {field.collection}
          </span>
        </div>
      </div>
    );
  }

  const entries = data?.docs || [];
  const totalDocs = data?.totalDocs ?? entries.length;

  /**
   * Navigate to an entry's edit page.
   */
  const handleNavigate = (id: string) => {
    const path = buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
      slug: field.collection,
      id,
    });
    navigateTo(path);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading related {field.collection}...</span>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn("text-sm text-destructive", className)}>
        Failed to load related entries: {error.message}
      </div>
    );
  }

  // Empty state
  if (entries.length === 0) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span className="italic">
            No {field.collection} reference this {collectionSlug}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header with count */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {totalDocs} related {field.collection}
          {totalDocs > limit && ` (showing ${limit})`}
        </span>
        {allowNavigation && totalDocs > limit && (
          <Button
            type="button"
            variant="link"
            size="md"
            className="h-auto p-0 text-xs"
            onClick={() => {
              // Navigate to the collection list with a filter
              const path = buildRoute(ROUTES.COLLECTION_ENTRIES, {
                slug: field.collection,
              });
              // Note: Could add query params for filtering, but keeping simple for MVP
              navigateTo(path);
            }}
          >
            View all
            <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Entries list */}
      <ul className="space-y-1 rounded-none  border border-primary/5 bg-primary/5">
        {entries.map(entry => {
          const entryData = entry as Record<string, unknown>;
          const id = entryData.id as string;
          const label = getEntryLabel(entryData);
          const createdAt = formatDate(entryData.createdAt);
          const status = entryData.status as string | undefined;

          return (
            <li
              key={id}
              className={cn(
                "flex items-center justify-between gap-2 px-3 py-2",
                "border-b last:border-b-0",
                allowNavigation && "hover-unified cursor-pointer",
                "transition-colors"
              )}
              onClick={allowNavigation ? () => handleNavigate(id) : undefined}
              onKeyDown={
                allowNavigation
                  ? e => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleNavigate(id);
                      }
                    }
                  : undefined
              }
              tabIndex={allowNavigation ? 0 : undefined}
              role={allowNavigation ? "button" : undefined}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate text-sm">{label}</span>
                {status && (
                  <Badge
                    variant={
                      status === "published"
                        ? "success"
                        : status === "draft"
                          ? "warning"
                          : "outline"
                    }
                    className="text-xs"
                  >
                    {status}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {createdAt && (
                  <span className="text-xs text-muted-foreground">
                    {createdAt}
                  </span>
                )}
                {allowNavigation && (
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
