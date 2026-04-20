import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@revnixhq/ui";

import { Shield } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { MAX_VISIBLE_USERS, MAX_USER_LIST_HEIGHT } from "./constants";

/**
 * RoleAssignDialog Component Props
 */
export interface RoleAssignDialogProps {
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
   * Selected users to assign role to
   */
  users: Array<{
    id: string;
    name: string;
    currentRole?: string;
  }>;

  /**
   * Role to assign
   */
  role: {
    id: string;
    name: string;
    icon?: string;
  };

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
}

/**
 * RoleAssignDialog Component
 *
 * Confirmation dialog for bulk role assignment.
 *
 * ## Features
 * - Shows role icon and name
 * - Lists users with current roles (max 5, then "...and X more")
 * - Shows count of users to be updated
 * - Loading state during operation
 * - Cancel and Confirm actions
 *
 * ## Design System
 * - Dialog: Medium size (512px)
 * - Border radius: 12px
 * - Icon: 20×20px (h-5 w-5)
 * - User list: Max 5 visible
 *
 * ## Accessibility
 * - ARIA describedby for description
 * - Focus trapped in dialog
 * - Keyboard: Escape closes, Tab navigates, Enter confirms
 * - Disabled state prevents double-submission
 *
 * ## States
 * - Open: Dialog visible with backdrop
 * - Loading: Buttons disabled, spinner shown
 * - Closed: Dialog hidden
 *
 * @example
 * ```tsx
 * <RoleAssignDialog
 *   open={showDialog}
 *   onOpenChange={setShowDialog}
 *   users={selectedUsers}
 *   role={{ id: '123', name: 'Editor', icon: '✏️' }}
 *   onConfirm={handleConfirm}
 *   isLoading={isAssigning}
 * />
 * ```
 */
export function RoleAssignDialog({
  open,
  onOpenChange,
  users,
  role,
  onConfirm,
  isLoading = false,
  error,
  className,
}: RoleAssignDialogProps) {
  // Validate required data
  if (!role || !role.name) {
    console.error("RoleAssignDialog: role or role.name is missing");
    return null;
  }

  if (!users || users.length === 0) {
    console.error("RoleAssignDialog: users array is empty or missing");
    return null;
  }

  const visibleUsers = users.slice(0, MAX_VISIBLE_USERS);
  const remainingCount = users.length - MAX_VISIBLE_USERS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="role-assign-description"
        className={cn("sm:max-w-[512px]", className)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Assign {role.name} Role?
          </DialogTitle>
          <DialogDescription id="role-assign-description">
            This will assign the "{role.name}" role to {users.length} user
            {users.length === 1 ? "" : "s"}:
          </DialogDescription>
        </DialogHeader>

        {/* Error alert */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* User list (max 5 shown) */}
        <div
          className="space-y-2 overflow-y-auto"
          style={{ maxHeight: `${MAX_USER_LIST_HEIGHT}px` }}
        >
          {visibleUsers.map(user => (
            <div
              key={user.id}
              className="flex items-center justify-between text-sm"
            >
              <span className="font-medium">{user.name}</span>
              {user.currentRole && (
                <Badge variant="outline" className="text-xs">
                  Currently: {user.currentRole}
                </Badge>
              )}
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
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading && <Spinner size="sm" className="mr-2" />}
            Assign Role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
