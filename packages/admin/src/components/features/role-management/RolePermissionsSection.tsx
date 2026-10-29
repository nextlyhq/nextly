import type { JSX } from "react";
import type { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import type { RoleFormValuesType } from "@admin/hooks/useRoleForm";
import type { LevelRow, PluginGroup } from "@admin/lib/permissions/level-rows";
import type { Permission } from "@admin/types/ui/form";

import { PermissionLevelRows } from "./PermissionLevelRows";
import { PermissionMatrix } from "./PermissionMatrix";

interface RolePermissionsSectionProps {
  form: UseFormReturn<RoleFormValuesType>;
  /** One row per collection and Single of the app's own. */
  levelRows: LevelRow[];
  /** Each plugin's collections and own permissions. */
  pluginGroups: PluginGroup[];
  /** What each plugin is called, by its package name. */
  pluginNames: ReadonlyMap<string, string>;
  /** The permissions no row takes, shown in the grid below the rows. */
  otherPermissions: Permission[];
  lockedPermissionIds: string[];
  /** The base roles and the permissions each gives. */
  bases: { name: string; ids: string[] }[];
  isLoading: boolean;
}

/**
 * What the role can do: a level for each collection and Single, then the
 * grid for every other permission. Both edit the one permission list.
 */
export function RolePermissionsSection({
  form,
  levelRows,
  pluginGroups,
  pluginNames,
  otherPermissions,
  lockedPermissionIds,
  bases,
  isLoading,
}: RolePermissionsSectionProps): JSX.Element {
  return (
    <FormField
      control={form.control}
      name="permissions"
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <div className="flex flex-col gap-8">
              <PermissionLevelRows
                rows={levelRows}
                groups={pluginGroups}
                pluginNames={pluginNames}
                value={field.value || []}
                onChange={field.onChange}
                lockedIds={lockedPermissionIds}
                bases={bases}
                disabled={isLoading}
              />
              <div className="flex flex-col gap-4">
                <h3 className="px-6 text-base font-semibold text-foreground">
                  Other permissions
                </h3>
                <PermissionMatrix
                  permissions={otherPermissions}
                  value={field.value || []}
                  onChange={field.onChange}
                  disabled={isLoading}
                  lockedIds={lockedPermissionIds}
                />
              </div>
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
