import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@revnixhq/ui";

import {
  Shield,
  Trash2,
  ToggleLeft,
  X,
  MoreVertical,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

/**
 * BulkActionBar Component Props
 */
export interface BulkActionBarProps {
  /**
   * Number of items selected
   */
  selectedCount: number;

  /**
   * Callback when "Assign Role" is clicked
   * @param roleId - ID of selected role
   */
  onAssignRole: (roleId: string) => void;

  /**
   * Callback when "Delete" is clicked
   */
  onDelete: () => void;

  /**
   * Callback when "Enable/Disable" is clicked
   * @param status - Target status ('active' | 'inactive')
   */
  onToggleStatus: (status: "active" | "inactive") => void;

  /**
   * Callback when "Clear" is clicked
   */
  onClear: () => void;

  /**
   * Available roles for assignment
   */
  roles: Array<{ id: string; name: string; icon?: string }>;

  /**
   * Whether assign role action is in progress
   * @default false
   */
  isAssigningRole?: boolean;

  /**
   * Whether delete action is in progress
   * @default false
   */
  isDeleting?: boolean;

  /**
   * Whether toggle status action is in progress
   * @default false
   */
  isTogglingStatus?: boolean;

  /**
   * Whether selected items can be deleted
   * @default true
   */
  canDelete?: boolean;

  /**
   * Reason why delete is disabled (shown in tooltip)
   */
  deleteDisabledReason?: string;

  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * BulkActionBar Component
 *
 * Fixed action bar at bottom of screen when items are selected.
 *
 * ## Features
 * - Fixed position (stays visible while scrolling)
 * - Slides up with animation when items selected
 * - Responsive (full buttons on desktop, overflow menu on mobile)
 * - 3 bulk actions: Assign Role, Delete, Status
 * - Loading states during operations
 * - Disabled states with tooltips
 *
 * ## Design System
 * - Height: 72px (enough for buttons + padding)
 * - Padding: 16px horizontal, 12px vertical
 * - Shadow: Elevated (indicates fixed position)
 * - Animation: Slide-up 300ms
 *
 * ## Accessibility
 * - ARIA toolbar role
 * - Descriptive button labels with counts
 * - Disabled state tooltips (explain why)
 * - Keyboard navigation (Tab, Enter, Escape)
 * - Mobile: 44×44px touch targets (WCAG 2.2 AA)
 *
 * ## Responsive
 * - Mobile (< 768px): Primary action + "More" overflow menu
 * - Desktop (≥ 768px): All actions visible
 *
 * @example
 * ```tsx
 * <BulkActionBar
 *   selectedCount={selectedCount}
 *   onAssignRole={handleAssignRole}
 *   onDelete={handleDelete}
 *   onToggleStatus={handleToggleStatus}
 *   onClear={clearSelection}
 *   roles={availableRoles}
 *   isLoading={isAssigning || isDeleting}
 * />
 * ```
 */
export function BulkActionBar({
  selectedCount,
  onAssignRole,
  onDelete,
  onToggleStatus,
  onClear,
  roles,
  isAssigningRole = false,
  isDeleting = false,
  isTogglingStatus = false,
  canDelete = true,
  deleteDisabledReason,
  className,
}: BulkActionBarProps) {
  // Computed disabled states (extracted for clarity)
  const isAnyActionLoading = isAssigningRole || isDeleting || isTogglingStatus;
  const isDeleteDisabled = !canDelete || isDeleting || isAnyActionLoading;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      aria-live="polite"
      className={cn(
        "fixed bottom-0 right-0 z-40 transition-[left,width] duration-200 ease-linear",
        "left-0 md:left-[var(--sidebar-width,20.5rem)]",
        "border-t border-border bg-background shadow-lg",
        "animate-in slide-in-from-bottom duration-300",
        className
      )}
    >
      <div className="container mx-auto flex items-center gap-4 px-4 py-3">
        {/* Selection count badge */}
        <Badge variant="outline" className="text-sm font-medium">
          {selectedCount} selected
        </Badge>

        {/* Desktop: All buttons visible */}
        <div className="hidden items-center gap-2 md:flex">
          {/* Assign Role */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                size="sm"
                disabled={isAssigningRole || isAnyActionLoading}
              >
                <Shield className="mr-2 h-4 w-4" />
                Assign Role
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {roles.map(role => (
                <DropdownMenuItem
                  key={role.id}
                  onClick={() => onAssignRole(role.id)}
                  aria-label={`Assign ${role.name} role to ${selectedCount} selected item${selectedCount === 1 ? "" : "s"}`}
                >
                  {role.icon && <span className="mr-2">{role.icon}</span>}
                  {role.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Delete */}
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={isDeleteDisabled}
            title={!canDelete ? deleteDisabledReason : undefined}
            aria-label={`Delete ${selectedCount} selected item${selectedCount === 1 ? "" : "s"}`}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>

          {/* Status Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isTogglingStatus || isAnyActionLoading}
              >
                <ToggleLeft className="mr-2 h-4 w-4" />
                Status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => onToggleStatus("active")}
                aria-label={`Enable ${selectedCount} selected account${selectedCount === 1 ? "" : "s"}`}
              >
                Enable Accounts
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onToggleStatus("inactive")}
                aria-label={`Disable ${selectedCount} selected account${selectedCount === 1 ? "" : "s"}`}
              >
                Disable Accounts
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile: Primary action + More menu */}
        <div className="flex items-center gap-2 md:hidden">
          {/* Primary action: Assign Role */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                size="lg"
                disabled={isAssigningRole || isAnyActionLoading}
                className="min-h-[44px] min-w-[44px]"
              >
                <Shield className="mr-2 h-4 w-4" />
                Assign Role
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {roles.map(role => (
                <DropdownMenuItem
                  key={role.id}
                  onClick={() => onAssignRole(role.id)}
                  aria-label={`Assign ${role.name} role to ${selectedCount} selected item${selectedCount === 1 ? "" : "s"}`}
                >
                  {role.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Overflow menu: More actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="lg"
                disabled={isAnyActionLoading}
                className="min-h-[44px] min-w-[44px]"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuItem
                onClick={onDelete}
                disabled={isDeleteDisabled}
                className="text-destructive"
                aria-label={`Delete ${selectedCount} selected item${selectedCount === 1 ? "" : "s"}`}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onToggleStatus("active")}
                disabled={isTogglingStatus}
                aria-label={`Enable ${selectedCount} selected account${selectedCount === 1 ? "" : "s"}`}
              >
                <ToggleLeft className="mr-2 h-4 w-4" />
                Enable Accounts
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onToggleStatus("inactive")}
                disabled={isTogglingStatus}
                aria-label={`Disable ${selectedCount} selected account${selectedCount === 1 ? "" : "s"}`}
              >
                <X className="mr-2 h-4 w-4" />
                Disable Accounts
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Clear button (right-aligned) */}
        <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
          <X className="mr-2 h-4 w-4" />
          Clear
        </Button>
      </div>
    </div>
  );
}
