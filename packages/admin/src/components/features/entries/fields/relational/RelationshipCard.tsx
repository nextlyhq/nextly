/**
 * Relationship Card Component
 *
 * Displays a selected relationship with title, collection badge, and remove action.
 * Used within RelationshipInput to show selected related documents.
 *
 * @module components/entries/fields/relational/RelationshipCard
 * @since 1.0.0
 */

import { Badge, Button } from "@revnixhq/ui";

import { X, Pencil } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

/**
 * Represents a selected related document.
 * Can be either a simple object with id or a polymorphic reference.
 */
export interface RelatedItem {
  /** Document ID */
  id: string;
  /** Display title (extracted from title/name/label/email fields) */
  title?: string;
  name?: string;
  label?: string;
  email?: string;
  /** For polymorphic relationships - which collection this belongs to */
  relationTo?: string;
  /** Any additional fields from the document */
  [key: string]: unknown;
}

export interface RelationshipCardProps {
  /**
   * The related item to display.
   */
  item: RelatedItem;

  /**
   * Callback when remove button is clicked.
   */
  onRemove: () => void;

  /**
   * Whether the card is disabled (no remove action).
   * @default false
   */
  disabled?: boolean;

  /**
   * Optional callback for edit action.
   * If provided, shows an edit/view button.
   */
  onEdit?: () => void;

  /**
   * Collection slug for display (for polymorphic relationships).
   */
  collectionSlug?: string;

  /**
   * Additional CSS classes.
   */
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Extracts a display label from a related item.
 * Tries common field names in order of preference.
 */
function getItemLabel(item: RelatedItem): string {
  return item.title || item.name || item.label || item.email || item.id;
}

// ============================================================
// Component
// ============================================================

/**
 * RelationshipCard displays a selected related document.
 *
 * Features:
 * - Displays document title/name with fallback to ID
 * - Shows collection badge for polymorphic relationships
 * - Remove button (can be disabled)
 * - Optional edit/view action
 *
 * @example
 * ```tsx
 * <RelationshipCard
 *   item={{ id: "123", title: "John Doe" }}
 *   onRemove={() => handleRemove("123")}
 * />
 * ```
 *
 * @example With polymorphic collection badge
 * ```tsx
 * <RelationshipCard
 *   item={{ id: "123", name: "Admin User", relationTo: "users" }}
 *   collectionSlug="users"
 *   onRemove={() => handleRemove("123")}
 * />
 * ```
 */
export function RelationshipCard({
  item,
  onRemove,
  disabled = false,
  onEdit,
  collectionSlug,
  className,
}: RelationshipCardProps) {
  const label = getItemLabel(item);
  const collection = collectionSlug || item.relationTo;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border bg-card p-2 text-card-foreground",
        disabled && "opacity-60",
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* Collection badge for polymorphic relationships */}
        {collection && (
          <Badge variant="outline" className="shrink-0 text-xs">
            {collection}
          </Badge>
        )}

        {/* Item label */}
        <span className="truncate text-sm font-medium">{label}</span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {/* Edit button (optional) */}
        {onEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onEdit}
            disabled={disabled}
            className="h-7 w-7"
            aria-label={`Edit ${label}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* Remove button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${label}`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
