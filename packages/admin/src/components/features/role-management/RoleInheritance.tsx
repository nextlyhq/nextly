import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import type { UseFormReturn } from "react-hook-form";

import { Check as CheckIcon } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import type { RoleFormValuesType } from "@admin/hooks/useRoleForm";
import { normalizePermissions } from "@admin/lib/permissions/normalize";
import { roleApi } from "@admin/services/roleApi";

/**
 * Constant for "None" selection value in role inheritance
 */
const NONE_VALUE = "__none__" as const;

/**
 * Clear all base roles and reset permissions to user-selected only
 */
function clearAllBaseRoles(
  form: UseFormReturn<RoleFormValuesType>,
  currentPermissions: string[],
  lockedPermissionIds: string[],
  setLockedPermissionIds: (ids: string[]) => void,
  setSelectedBaseRoleIds: (ids: string[]) => void,
  setRolePermissionsMap: (map: Record<string, string[]>) => void
) {
  const userExtras = currentPermissions.filter(
    id => !lockedPermissionIds.includes(id)
  );
  setLockedPermissionIds([]);
  setSelectedBaseRoleIds([]);
  setRolePermissionsMap({});
  form.setValue("permissions", userExtras, { shouldDirty: true });
}

/**
 * Deselect a base role and recompute locked permissions
 *
 * When a base role is deselected, we need to:
 * 1. Remove it from the selected base roles list
 * 2. Recompute locked permissions from remaining base roles
 * 3. Update form permissions to keep user-added + newly locked permissions
 */
function deselectBaseRole(
  roleId: string,
  form: UseFormReturn<RoleFormValuesType>,
  selectedBaseRoleIds: string[],
  rolePermissionsMap: Record<string, string[]>,
  lockedPermissionIds: string[],
  setSelectedBaseRoleIds: (ids: string[]) => void,
  setLockedPermissionIds: (ids: string[]) => void
) {
  const nextIds = selectedBaseRoleIds.filter(id => id !== roleId);

  // Recompute locked permissions as the union of remaining base roles
  const union = new Set<string>();
  nextIds.forEach(id => {
    const perms = rolePermissionsMap[id] || [];
    perms.forEach(p => union.add(p));
  });
  const newLocked = Array.from(union);

  setSelectedBaseRoleIds(nextIds);
  setLockedPermissionIds(newLocked);

  const current = form.getValues("permissions") || [];
  // Get permissions the user manually added (not inherited from any base role)
  // We use the OLD lockedPermissionIds to identify what was inherited before deselection
  const userExtras = current.filter(id => !lockedPermissionIds.includes(id));
  // Combine user-added permissions with the new locked set (from remaining base roles)
  const nextPermissions = Array.from(new Set([...userExtras, ...newLocked]));

  form.setValue("permissions", nextPermissions, { shouldDirty: true });
}

/**
 * Select a new base role and add its permissions to locked set
 */
async function selectBaseRole(
  roleId: string,
  form: UseFormReturn<RoleFormValuesType>,
  selectedBaseRoleIds: string[],
  rolePermissionsMap: Record<string, string[]>,
  lockedPermissionIds: string[],
  setSelectedBaseRoleIds: (ids: string[]) => void,
  setRolePermissionsMap: (map: Record<string, string[]>) => void,
  setLockedPermissionIds: (ids: string[]) => void,
  allRoles: Array<{ id: string; name: string; permissions: string[] }>
): Promise<void> {
  const selected = allRoles.find(r => r.id === roleId);

  try {
    // Fetch fresh permissions for the selected role to ensure we have the latest data
    const r = await roleApi.getRoleById(roleId);
    const permissions = normalizePermissions(r.permissions);

    setRolePermissionsMap({
      ...rolePermissionsMap,
      [roleId]: permissions,
    });

    // Update locked permissions to include newly inherited ones
    const newLocked = Array.from(
      new Set([...lockedPermissionIds, ...permissions])
    );
    setLockedPermissionIds(newLocked);

    // Keep user-added permissions and add new inherited ones
    const current = form.getValues("permissions") || [];
    const userExtras = current.filter(id => !lockedPermissionIds.includes(id));
    const merged = Array.from(new Set([...userExtras, ...newLocked]));

    form.setValue("permissions", merged, { shouldDirty: true });
    setSelectedBaseRoleIds([...selectedBaseRoleIds, roleId]);
  } catch {
    toast.error(
      `Failed to load permissions for role ${selected?.name || roleId}`
    );
  }
}

interface RoleInheritanceProps {
  form: UseFormReturn<RoleFormValuesType>;
  allRoles: Array<{ id: string; name: string; permissions: string[] }>;
  selectedBaseRoleIds: string[];
  setSelectedBaseRoleIds: (ids: string[]) => void;
  rolePermissionsMap: Record<string, string[]>;
  setRolePermissionsMap: (map: Record<string, string[]>) => void;
  lockedPermissionIds: string[];
  setLockedPermissionIds: (ids: string[]) => void;
}

/**
 * RoleInheritance Component
 *
 * Handles base role selection and inherited permissions management.
 * When a role is selected as a base role, its permissions are automatically
 * added to the current role and locked (cannot be removed).
 *
 * Features:
 * - Multi-select base roles
 * - Automatic permission inheritance
 * - Permission locking for inherited permissions
 * - Visual indication of selected roles with checkmarks
 */
export function RoleInheritance({
  form,
  allRoles,
  selectedBaseRoleIds,
  setSelectedBaseRoleIds,
  rolePermissionsMap,
  setRolePermissionsMap,
  lockedPermissionIds,
  setLockedPermissionIds,
}: RoleInheritanceProps) {
  // Only show if there are other roles available
  if (allRoles.length === 0) {
    return null;
  }

  const handleRoleSelection = async (val: string) => {
    const value = val === NONE_VALUE || !val ? undefined : val;

    // Handle deselection (None selected)
    if (!value) {
      const current = form.getValues("permissions") || [];
      clearAllBaseRoles(
        form,
        current,
        lockedPermissionIds,
        setLockedPermissionIds,
        setSelectedBaseRoleIds,
        setRolePermissionsMap
      );
      return;
    }

    // Check if role is already selected (toggle off)
    const alreadySelected = selectedBaseRoleIds.includes(value);

    if (alreadySelected) {
      deselectBaseRole(
        value,
        form,
        selectedBaseRoleIds,
        rolePermissionsMap,
        lockedPermissionIds,
        setSelectedBaseRoleIds,
        setLockedPermissionIds
      );
      return;
    }

    // Add new role to selection
    await selectBaseRole(
      value,
      form,
      selectedBaseRoleIds,
      rolePermissionsMap,
      lockedPermissionIds,
      setSelectedBaseRoleIds,
      setRolePermissionsMap,
      setLockedPermissionIds,
      allRoles
    );
  };

  return (
    <FormField
      control={form.control}
      name="baseRoleId"
      render={() => (
        <FormItem className={allRoles.length === 0 ? "hidden" : ""}>
          <FormLabel>Base Role</FormLabel>
          <Select
            value=""
            disabled={allRoles.length === 0}
            onValueChange={(value) => { void handleRoleSelection(value); }}
          >
            <SelectTrigger>
              {selectedBaseRoleIds.length > 0 ? (
                <span>
                  {selectedBaseRoleIds
                    .map(id => allRoles.find(r => r.id === id)?.name)
                    .filter(Boolean)
                    .join(", ")}
                </span>
              ) : (
                <SelectValue placeholder="Select base role (optional)" />
              )}
              {selectedBaseRoleIds.length > 0 && (
                <span className="ml-1 text-sm text-gray-500">
                  ({selectedBaseRoleIds.length}{" "}
                  {selectedBaseRoleIds.length === 1 ? "role" : "roles"})
                </span>
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>None</SelectItem>
              {allRoles.map(roleOpt => (
                <SelectItem
                  key={roleOpt.id}
                  value={roleOpt.id}
                  className="relative pr-2"
                >
                  {selectedBaseRoleIds.includes(roleOpt.id) && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2">
                      <CheckIcon className="h-4 w-4" />
                    </span>
                  )}
                  <span>{roleOpt.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormDescription>
            {allRoles.length === 0
              ? "No other roles available to inherit from yet. Create this role first."
              : "Inherit permissions from existing role(s). Inherited permissions are locked."}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
