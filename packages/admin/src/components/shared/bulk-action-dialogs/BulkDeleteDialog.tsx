import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@revnixhq/ui";

import { AlertTriangle } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { MAX_VISIBLE_USERS, MAX_USER_LIST_HEIGHT } from "./constants";

/**
 * Item to be deleted
 */
export interface DeleteItem {
  id: string;
  name: string;
  /** Secondary text (e.g., email for users, slug for singles) */
  secondary?: string;
}

/**
 * BulkDeleteDialog Component Props
 */
export interface BulkDeleteDialogProps {
  /**
   * Whether dialog is open
   */
  open: boolean;

  /**
   * Callback when dialog should close
   * @param open - New open state (always false for close)
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Items to delete (generic format)
   */
  items?: DeleteItem[];

  /**
   * Selected users to delete
   * @deprecated Use `items` instead. Kept for backward compatibility.
   */
  users?: Array<{
    id: string;
    name: string;
    email: string;
  }>;

  /**
   * Callback when confirmed
   */
  onConfirm: () => void;

  /**
   * Whether operation is in progress
   * @default false
   */
  isLoading?: boolean;

  /**
   * Error message to display (when operation fails)
   */
  error?: string;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Entity type label (singular form, e.g., "User", "Single", "Entry")
   * @default "User"
   */
  entityType?: string;

  /**
   * Entity type label (plural form, e.g., "Users", "Singles", "Entries")
   * @default "Users"
   */
  entityTypePlural?: string;

  /**
   * Custom description text for the dialog
   * If not provided, a default description will be used based on entityType
   */
  description?: string;
}

/**
 * BulkDeleteDialog Component
 *
 * Generic confirmation dialog for bulk deletion (destructive action).
 * Can be used for deleting users, singles, entries, or any other entity type.
 *
 * ## Features
 * - Red/destructive styling (danger)
 * - Warning icon and message
 * - Alert box: "This is a destructive action and cannot be reversed"
 * - Lists items to be deleted (name + optional secondary text, max 5)
 * - Cannot be undone warning
 * - Loading state during operation
 * - Customizable entity type labels
 *
 * ## Design System
 * - Dialog: Medium size (512px)
 * - Title: Red color (destructive)
 * - Alert: Red background (destructive variant)
 * - Button: Red (destructive variant)
 *
 * ## Accessibility
 * - ARIA describedby for description
 * - Focus trapped in dialog
 * - Keyboard: Escape closes, Tab navigates, Enter confirms
 * - Clear warning about destructive nature
 * - Disabled state prevents double-submission
 *
 * ## States
 * - Open: Dialog visible with warning
 * - Loading: Buttons disabled, spinner shown
 * - Closed: Dialog hidden
 *
 * @example
 * ```tsx
 * // For users (default)
 * <BulkDeleteDialog
 *   open={showDialog}
 *   onOpenChange={setShowDialog}
 *   items={selectedUsers.map(u => ({ id: u.id, name: u.name, secondary: u.email }))}
 *   onConfirm={handleConfirm}
 *   isLoading={isDeleting}
 * />
 *
 * // For singles
 * <BulkDeleteDialog
 *   open={showDialog}
 *   onOpenChange={setShowDialog}
 *   items={[{ id: single.id, name: single.label, secondary: single.slug }]}
 *   entityType="Single"
 *   entityTypePlural="Singles"
 *   onConfirm={handleConfirm}
 *   isLoading={isDeleting}
 * />
 * ```
 */
export function BulkDeleteDialog({
  open,
  onOpenChange,
  items,
  users,
  onConfirm,
  isLoading = false,
  error,
  className,
  entityType = "User",
  entityTypePlural = "Users",
  description,
}: BulkDeleteDialogProps) {
  // Support both new `items` prop and deprecated `users` prop for backward compatibility
  const normalizedItems: DeleteItem[] =
    items ??
    users?.map(u => ({ id: u.id, name: u.name, secondary: u.email })) ??
    [];

  const visibleItems = normalizedItems.slice(0, MAX_VISIBLE_USERS);
  const remainingCount = normalizedItems.length - MAX_VISIBLE_USERS;
  const count = normalizedItems.length;
  const entityLabel = count === 1 ? entityType : entityTypePlural;
  const entityLabelLower = entityLabel.toLowerCase();

  const defaultDescription = `Are you sure you want to delete the selected ${entityLabelLower}? This action cannot be undone.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="bulk-delete-description"
        className={cn("sm:max-w-[512px]", className)}
      >
        <DialogHeader>
          <DialogTitle
            id="bulk-delete-title"
            className="flex items-center gap-2 text-destructive"
          >
            <AlertTriangle className="h-5 w-5" />
            Delete {count} {entityLabel}?
          </DialogTitle>
          <DialogDescription id="bulk-delete-description">
            {description ?? defaultDescription}
          </DialogDescription>
        </DialogHeader>

        {/* Warning alert */}
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This is a destructive action and cannot be reversed.
          </AlertDescription>
        </Alert>

        {/* Error alert */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Item list (max 5 shown) */}
        <div
          role="list"
          aria-label={`${entityTypePlural} to be deleted`}
          className="space-y-2 overflow-y-auto"
          style={{ maxHeight: `${MAX_USER_LIST_HEIGHT}px` }}
          tabIndex={0}
        >
          <p className="text-sm font-medium">
            {entityTypePlural} to be deleted:
          </p>
          {visibleItems.map(item => (
            <div key={item.id} role="listitem" className="text-sm">
              • <span className="font-medium">{item.name}</span>
              {item.secondary && ` (${item.secondary})`}
            </div>
          ))}
          {remainingCount > 0 && (
            <p className="text-sm text-muted-foreground">
              ...and {remainingCount} more
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading && <Spinner size="md" className="mr-2" />}
            Delete {count} {entityLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
