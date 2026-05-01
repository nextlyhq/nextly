"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Checkbox,
  Label,
} from "@revnixhq/ui";
import { useMemo } from "react";

import type { ContentTypePermissions, Permission } from "@admin/types/ui/form";

/**
 * Props for PermissionCheckboxRow component
 */
interface PermissionCheckboxRowProps {
  /** Permission object (can be null or undefined if not available) */
  permission: Permission | null | undefined;
  /** Display label for the permission (e.g., "Create", "Read") */
  label: string;
  /** Action key for the permission (e.g., "create", "view") */
  actionKey: string;
  /** Content type ID for generating unique HTML IDs */
  contentTypeId: string;
  /** Content type name for ARIA labels */
  contentTypeName: string;
  /** Currently selected permission IDs */
  value: string[];
  /** IDs of permissions that cannot be toggled */
  lockedIds: string[];
  /** Whether the entire matrix is disabled */
  disabled: boolean;
  /** Callback to toggle a single permission */
  onToggle: (id: string | undefined, checked: boolean) => void;
}

/**
 * PermissionCheckboxRow Component
 *
 * Internal component for rendering a single permission checkbox row in mobile view.
 * Extracted to avoid DRY violation (was repeated 5 times in PermissionMatrixMobile).
 *
 * Features:
 * - Large 44×44px touch target (WCAG 2.2 AA compliant)
 * - Hover state for better feedback
 * - Proper ARIA labels for accessibility
 * - Disabled state for locked permissions
 *
 * @example
 * ```tsx
 * <PermissionCheckboxRow
 *   permission={contentType.permissions.create}
 *   label="Create"
 *   actionKey="create"
 *   contentTypeId={contentType.id}
 *   contentTypeName={contentType.name}
 *   value={value}
 *   lockedIds={lockedIds}
 *   disabled={disabled}
 *   onToggle={onTogglePermission}
 * />
 * ```
 */
function PermissionCheckboxRow({
  permission,
  label,
  actionKey,
  contentTypeId,
  contentTypeName,
  value,
  lockedIds,
  disabled,
  onToggle,
}: PermissionCheckboxRowProps) {
  // Don't render if permission doesn't exist
  if (!permission) return null;

  const htmlId = `${contentTypeId}-${actionKey}`;
  const isChecked = value.includes(permission.id);
  const isDisabled = disabled || lockedIds.includes(permission.id);

  return (
    <div className="flex items-center justify-between py-3 px-3 rounded-md hover:bg-accent/50 min-h-[44px]">
      <Label
        htmlFor={htmlId}
        className="text-sm font-normal cursor-pointer flex-1"
      >
        {label}
      </Label>
      <Checkbox
        id={htmlId}
        checked={isChecked}
        onCheckedChange={checked => onToggle(permission.id, !!checked)}
        disabled={isDisabled}
        aria-label={`${label} permission for ${contentTypeName}`}
      />
    </div>
  );
}

/**
 * Props for PermissionMatrixMobile component
 */
export interface PermissionMatrixMobileProps {
  /** Content types to display in mobile view */
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
  /** Check if all permissions for a content type are selected */
  isAllSelected: (contentType: ContentTypePermissions) => boolean;
  /** Check if some permissions for a content type are selected */
  isPartiallySelected: (contentType: ContentTypePermissions) => boolean;
}

/**
 * Get count of selected permissions for a content type
 */
function getSelectedCount(
  contentType: ContentTypePermissions,
  value: string[]
): number {
  return Object.values(contentType.permissions)
    .filter((p): p is Permission => p !== null)
    .filter(p => value.includes(p.id)).length;
}

/**
 * Get total count of permissions for a content type
 */
function getTotalCount(contentType: ContentTypePermissions): number {
  return Object.values(contentType.permissions).filter(
    (p): p is Permission => p !== null
  ).length;
}

/**
 * PermissionMatrixMobile Component
 *
 * Mobile-optimized accordion layout for the permission matrix (< 768px).
 * Replaces the horizontal table with a vertical accordion structure.
 *
 * Features:
 * - Accordion per content type (expand to see permissions)
 * - "Select all" checkbox in accordion trigger
 * - Badge showing selected count (e.g., "2/5")
 * - Large touch targets (44×44px minimum)
 * - Vertical scrolling (no horizontal scroll)
 * - WCAG 2.2 AA compliant
 *
 * Layout:
 * - AccordionTrigger: Content type name + checkbox + badge
 * - AccordionContent: List of permission checkboxes (Create, Read, Update, Delete, Publish)
 *
 * Extracted from PermissionMatrixTable for mobile responsiveness.
 */
export function PermissionMatrixMobile({
  contentTypes,
  value,
  lockedIds,
  disabled,
  searchTerm,
  onClearSearch,
  onTogglePermission,
  onToggleAllForContentType,
  isAllSelected,
  isPartiallySelected,
}: PermissionMatrixMobileProps) {
  // Memoize count calculations for performance optimization
  const contentTypeCounts = useMemo(
    () =>
      contentTypes.map(ct => ({
        id: ct.id,
        selected: getSelectedCount(ct, value),
        total: getTotalCount(ct),
      })),
    [contentTypes, value]
  );

  // Empty state
  if (contentTypes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground mb-3">
          {searchTerm
            ? `No content types match "${searchTerm}"`
            : "No content types available"}
        </p>
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
    );
  }

  return (
    <Accordion
      type="multiple"
      defaultValue={contentTypes[0] ? [contentTypes[0].id] : []}
      className="space-y-2"
    >
      {contentTypes.map((contentType, index) => {
        const { selected: selectedCount, total: totalCount } =
          contentTypeCounts[index];
        const hasLockedPermissions = Object.values(
          contentType.permissions
        ).some(permission => permission && lockedIds.includes(permission.id));

        return (
          <AccordionItem
            key={contentType.id}
            value={contentType.id}
            className="border rounded-md"
          >
            <div className="flex items-center px-4 py-4 hover:bg-accent/50">
              {/* Checkbox - separate from accordion trigger to avoid nested buttons */}
              <div
                className="flex items-center gap-3 flex-1"
                onClick={e => e.stopPropagation()}
              >
                <Checkbox
                  checked={isAllSelected(contentType)}
                  indeterminate={isPartiallySelected(contentType)}
                  onCheckedChange={checked =>
                    onToggleAllForContentType(contentType, !!checked)
                  }
                  disabled={disabled || hasLockedPermissions}
                  aria-label={`Toggle all permissions for ${contentType.name}`}
                />
                <span className="font-medium capitalize text-left truncate">
                  {contentType.name}
                </span>
              </div>

              {/* Badge and Accordion Trigger */}
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-xs shrink-0"
                  aria-label={`${selectedCount} of ${totalCount} permissions selected`}
                >
                  {selectedCount}/{totalCount}
                </Badge>
                <AccordionTrigger className="hover:no-underline [&>svg]:ml-0" />
              </div>
            </div>

            <AccordionContent className="px-4">
              <div className="space-y-2">
                <PermissionCheckboxRow
                  permission={contentType.permissions.create}
                  label="Create"
                  actionKey="create"
                  contentTypeId={contentType.id}
                  contentTypeName={contentType.name}
                  value={value}
                  lockedIds={lockedIds}
                  disabled={disabled}
                  onToggle={onTogglePermission}
                />

                <PermissionCheckboxRow
                  permission={contentType.permissions.view}
                  label="Read"
                  actionKey="view"
                  contentTypeId={contentType.id}
                  contentTypeName={contentType.name}
                  value={value}
                  lockedIds={lockedIds}
                  disabled={disabled}
                  onToggle={onTogglePermission}
                />

                <PermissionCheckboxRow
                  permission={contentType.permissions.edit}
                  label="Update"
                  actionKey="edit"
                  contentTypeId={contentType.id}
                  contentTypeName={contentType.name}
                  value={value}
                  lockedIds={lockedIds}
                  disabled={disabled}
                  onToggle={onTogglePermission}
                />

                <PermissionCheckboxRow
                  permission={contentType.permissions.delete}
                  label="Delete"
                  actionKey="delete"
                  contentTypeId={contentType.id}
                  contentTypeName={contentType.name}
                  value={value}
                  lockedIds={lockedIds}
                  disabled={disabled}
                  onToggle={onTogglePermission}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
