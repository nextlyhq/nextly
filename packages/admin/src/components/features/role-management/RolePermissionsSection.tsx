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
import { offeredSwitches } from "@admin/lib/roles/role-screen-mode";
import type { Permission } from "@admin/types/ui/form";

import { VisitorWriteWarning } from "./PermissionLevelRow";
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
  /** Shown but not changed: a built-in role changed by copying it. */
  readOnly?: boolean;
  /** The Public role's rows: see `PermissionLevelRow`'s `visitors`. */
  visitors?: boolean;
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
  readOnly = false,
  visitors = false,
}: RolePermissionsSectionProps): JSX.Element {
  return (
    <FormField
      control={form.control}
      name="permissions"
      render={({ field }) => {
        // The Public role's table offers what its rows offer: a visitor
        // never publishes.
        const offered = offeredSwitches(otherPermissions, visitors);
        return (
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
                  readOnly={readOnly}
                  visitors={visitors}
                />
                <div className="flex flex-col gap-4">
                  <h3 className="px-6 text-base font-semibold text-foreground">
                    Other permissions
                  </h3>
                  {/* A write held here is warned of as a row's is: what
                      the role and any base role give, together. */}
                  {visitors && (
                    <VisitorWriteWarning
                      className="px-6"
                      permissions={offered}
                      held={
                        new Set([
                          ...(field.value || []),
                          ...lockedPermissionIds,
                        ])
                      }
                    />
                  )}
                  <PermissionMatrix
                    permissions={[...offered]}
                    value={field.value || []}
                    onChange={field.onChange}
                    disabled={isLoading}
                    readOnly={readOnly}
                    lockedIds={lockedPermissionIds}
                  />
                </div>
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
