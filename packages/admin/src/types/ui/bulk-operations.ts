/**
 * Bulk Operations TypeScript Interfaces
 *
 * All TypeScript interfaces for bulk operations components.
 * Exported from main index.ts for library consumers.
 */

/**
 * BulkActionBar Component Props
 */
export type BulkActionBarProps = {
  selectedCount: number;
  onAssignRole: (roleId: string) => void;
  onDelete: () => void;
  onToggleStatus: (status: "active" | "inactive") => void;
  onClear: () => void;
  roles: Array<{ id: string; name: string; icon?: string }>;
  isAssigningRole?: boolean;
  isDeleting?: boolean;
  isTogglingStatus?: boolean;
  canDelete?: boolean;
  deleteDisabledReason?: string;
  className?: string;
};

/**
 * BulkDeleteDialog Component Props
 */
export type BulkDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: Array<{
    id: string;
    name: string;
    email: string;
  }>;
  onConfirm: () => void;
  isLoading?: boolean;
  error?: string;
  className?: string;
};
