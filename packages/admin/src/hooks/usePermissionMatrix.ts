"use client";

import {
  useState,
  useMemo,
  useCallback,
  type SetStateAction,
  type Dispatch,
} from "react";

import {
  organizePermissions,
  filterContentTypes,
  isAllSelected,
  isPartiallySelected,
  isAllSelectedForAction,
  isPartiallySelectedForAction,
  permissionIdsForAction,
  permissionIdsForContentType,
} from "@admin/lib/permissions/calculations";

import { PERMISSION_CATEGORIES } from "../constants/permissions";
import type {
  PermissionMatrixProps,
  ContentTypePermissions,
} from "../types/ui/form";

/** What {@link usePermissionMatrix} returns. */
type PermissionMatrixState = {
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  activeTab: string;
  setActiveTab: Dispatch<SetStateAction<string>>;
  organizedPermissions: Record<string, ContentTypePermissions[]>;
  filteredContentTypes: Record<string, ContentTypePermissions[]>;
  togglePermission: (
    permissionId: string | undefined,
    checked: boolean
  ) => void;
  toggleAllForContentType: (
    contentType: ContentTypePermissions,
    checked: boolean
  ) => void;
  toggleAllForAction: (
    contentTypes: ContentTypePermissions[],
    action: string,
    checked: boolean
  ) => void;
  isAllSelected: (contentType: ContentTypePermissions) => boolean;
  isPartiallySelected: (contentType: ContentTypePermissions) => boolean;
  isAllSelectedForAction: (
    contentTypes: ContentTypePermissions[],
    action: string
  ) => boolean;
  isPartiallySelectedForAction: (
    contentTypes: ContentTypePermissions[],
    action: string
  ) => boolean;
};

/**
 * Custom hook for PermissionMatrix component
 * Extracts all state management and complex logic for better testability
 */
export function usePermissionMatrix({
  permissions,
  value = [],
  onChange,
  lockedIds = [],
}: PermissionMatrixProps): PermissionMatrixState {
  // State for filtering and UI
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<string>(PERMISSION_CATEGORIES[0]);

  // Organize permissions by content type and action
  const organizedPermissions = useMemo(
    () => organizePermissions(permissions),
    [permissions]
  );

  // Filter content types based on search term
  const filteredContentTypes = useMemo(
    () => filterContentTypes(organizedPermissions, searchTerm),
    [organizedPermissions, searchTerm]
  );

  // Function to toggle a single permission
  const togglePermission = useCallback(
    (permissionId: string | undefined, checked: boolean): void => {
      if (!permissionId) return;
      if (lockedIds.includes(permissionId)) return;

      let newValue = [...value];

      if (checked) {
        if (!newValue.includes(permissionId)) {
          newValue.push(permissionId);
        }
      } else {
        newValue = newValue.filter(id => id !== permissionId);
      }

      onChange(newValue);
    },
    [value, onChange, lockedIds]
  );

  // Function to toggle all permissions in a row (for a content type)
  const toggleAllForContentType = useCallback(
    (contentType: ContentTypePermissions, checked: boolean): void => {
      const permissionIds = permissionIdsForContentType(contentType);

      let newValue = [...value];

      if (checked) {
        // Add all permissions for this content type
        permissionIds.forEach(id => {
          if (!newValue.includes(id)) {
            newValue.push(id);
          }
        });
      } else {
        // Remove all permissions for this content type
        newValue = newValue.filter(
          id => !permissionIds.includes(id) || lockedIds.includes(id)
        );
      }

      onChange(newValue);
    },
    [value, onChange, lockedIds]
  );

  // Function to toggle permissions for all content types for a specific action (column)
  const toggleAllForAction = useCallback(
    (
      contentTypes: ContentTypePermissions[],
      action: string,
      checked: boolean
    ): void => {
      const permissionIds = permissionIdsForAction(contentTypes, action);

      let newValue = [...value];

      if (checked) {
        // Add all permissions for this action
        permissionIds.forEach(id => {
          if (!newValue.includes(id)) {
            newValue.push(id);
          }
        });
      } else {
        // Remove all permissions for this action
        newValue = newValue.filter(
          id => !permissionIds.includes(id) || lockedIds.includes(id)
        );
      }

      onChange(newValue);
    },
    [value, onChange, lockedIds]
  );

  // Helper functions with value baked in
  const checkIsAllSelected = useCallback(
    (contentType: ContentTypePermissions): boolean =>
      isAllSelected(contentType, value),
    [value]
  );

  const checkIsPartiallySelected = useCallback(
    (contentType: ContentTypePermissions): boolean =>
      isPartiallySelected(contentType, value),
    [value]
  );

  const checkIsAllSelectedForAction = useCallback(
    (contentTypes: ContentTypePermissions[], action: string): boolean =>
      isAllSelectedForAction(contentTypes, action, value),
    [value]
  );

  const checkIsPartiallySelectedForAction = useCallback(
    (contentTypes: ContentTypePermissions[], action: string): boolean =>
      isPartiallySelectedForAction(contentTypes, action, value),
    [value]
  );

  return {
    // State
    searchTerm,
    setSearchTerm,
    activeTab,
    setActiveTab,

    // Processed data
    organizedPermissions,
    filteredContentTypes,

    // Toggle functions
    togglePermission,
    toggleAllForContentType,
    toggleAllForAction,

    // Check functions
    isAllSelected: checkIsAllSelected,
    isPartiallySelected: checkIsPartiallySelected,
    isAllSelectedForAction: checkIsAllSelectedForAction,
    isPartiallySelectedForAction: checkIsPartiallySelectedForAction,
  };
}
