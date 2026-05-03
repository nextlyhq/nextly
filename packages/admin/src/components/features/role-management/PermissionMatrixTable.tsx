import { Button } from "@revnixhq/ui";

import type { ContentTypePermissions } from "@admin/types/ui/form";

import { PermissionMatrixHeader } from "./PermissionMatrixHeader";
import { PermissionMatrixMobile } from "./PermissionMatrixMobile";
import { PermissionMatrixRow } from "./PermissionMatrixRow";

/**
 * Props for PermissionMatrixTable component
 */
export interface PermissionMatrixTableProps {
  /** Content types to display in this table */
  contentTypes: ContentTypePermissions[];
  /** Currently selected permission IDs */
  value: string[];
  /** IDs of permissions that cannot be toggled */
  lockedIds: string[];
  /** Whether the entire matrix is disabled */
  disabled: boolean;
  /** Current search term (for empty state) */
  searchTerm: string;
  /** Callback to clear search */
  onClearSearch: () => void;
  /** Callback to toggle a single permission */
  onTogglePermission: (id: string | undefined, checked: boolean) => void;
  /** Callback to toggle all permissions for a content type */
  onToggleAllForContentType: (
    contentType: ContentTypePermissions,
    checked: boolean
  ) => void;
  /** Callback to toggle all permissions for an action */
  onToggleAllForAction: (
    contentTypes: ContentTypePermissions[],
    action: keyof ContentTypePermissions["permissions"],
    checked: boolean
  ) => void;
  /** Check if all permissions for a content type are selected */
  isAllSelected: (contentType: ContentTypePermissions) => boolean;
  /** Check if some permissions for a content type are selected */
  isPartiallySelected: (contentType: ContentTypePermissions) => boolean;
  /** Check if all permissions for an action are selected */
  isAllSelectedForAction: (
    contentTypes: ContentTypePermissions[],
    action: keyof ContentTypePermissions["permissions"]
  ) => boolean;
  /** Check if some permissions for an action are selected */
  isPartiallySelectedForAction: (
    contentTypes: ContentTypePermissions[],
    action: keyof ContentTypePermissions["permissions"]
  ) => boolean;
}

/**
 * PermissionMatrixTable Component
 *
 * Responsive permission matrix with desktop table and mobile accordion layouts.
 * Replaces the large `renderMatrixTab` function from the original component.
 *
 * Features:
 * - Desktop (≥ 768px): Table layout with column/row "select all" checkboxes
 * - Mobile (< 768px): Accordion layout with vertical stacking
 * - Empty state when no content types match filters
 * - Responsive breakpoint at md: (768px)
 * - WCAG 2.2 AA compliant (44×44px touch targets on mobile)
 *
 * Extracted from PermissionMatrix for better component composition.
 */
export function PermissionMatrixTable({
  contentTypes,
  value,
  lockedIds,
  disabled,
  searchTerm,
  onClearSearch,
  onTogglePermission,
  onToggleAllForContentType,
  onToggleAllForAction,
  isAllSelected,
  isPartiallySelected,
  isAllSelectedForAction,
  isPartiallySelectedForAction,
}: PermissionMatrixTableProps) {
  // Empty state
  if (contentTypes.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-center">
        <div>
          <p className="text-muted-foreground mb-2">No content types found</p>
          {searchTerm && (
            <Button
              variant="outline"
              size="sm"
              onClick={onClearSearch}
              className="mx-auto"
            >
              Clear search
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop Table View (≥ 1024px) */}
      <div className="hidden lg:block w-full max-h-[600px] overflow-y-auto overflow-x-auto  border-t border-primary/5 relative">
        <table className="w-full border-collapse">
          <PermissionMatrixHeader
            contentTypes={contentTypes}
            disabled={disabled}
            lockedIds={lockedIds}
            onToggleAction={onToggleAllForAction}
            isAllSelectedForAction={isAllSelectedForAction}
            isPartiallySelectedForAction={isPartiallySelectedForAction}
          />
          <tbody>
            {contentTypes.map(contentType => (
              <PermissionMatrixRow
                key={contentType.id}
                contentType={contentType}
                value={value}
                lockedIds={lockedIds}
                disabled={disabled}
                onToggle={onTogglePermission}
                onToggleAll={onToggleAllForContentType}
                isAllSelected={isAllSelected(contentType)}
                isPartiallySelected={isPartiallySelected(contentType)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Accordion View (< 1024px) */}
      <div className="lg:hidden">
        <PermissionMatrixMobile
          contentTypes={contentTypes}
          value={value}
          lockedIds={lockedIds}
          disabled={disabled}
          searchTerm={searchTerm}
          onClearSearch={onClearSearch}
          onTogglePermission={onTogglePermission}
          onToggleAllForContentType={onToggleAllForContentType}
          isAllSelected={isAllSelected}
          isPartiallySelected={isPartiallySelected}
        />
      </div>
    </>
  );
}
