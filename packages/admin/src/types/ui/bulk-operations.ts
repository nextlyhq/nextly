/**
 * Bulk Operations TypeScript Interfaces
 *
 * All TypeScript interfaces for bulk operations components.
 * Exported from main index.ts for library consumers.
 */

/**
 * BulkSelectCheckbox Component Props
 */
export type BulkSelectCheckboxProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  rowId: string;
  rowLabel: string;
  disabled?: boolean;
  className?: string;
};

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
 * RoleAssignDialog Component Props
 */
export type RoleAssignDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: Array<{
    id: string;
    name: string;
    currentRole?: string;
  }>;
  role: {
    id: string;
    name: string;
    icon?: string;
  };
  onConfirm: () => void;
  isLoading?: boolean;
  error?: string;
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
