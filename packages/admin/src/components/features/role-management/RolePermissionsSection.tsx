import { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import { RoleFormValuesType } from "@admin/hooks/useRoleForm";
import { Permission } from "@admin/types/ui/form";

import { PermissionMatrix } from "./PermissionMatrix";

interface RolePermissionsSectionProps {
  form: UseFormReturn<RoleFormValuesType>;
  allPermissions: Permission[];
  lockedPermissionIds: string[];
  isLoading: boolean;
}

export function RolePermissionsSection({
  form,
  allPermissions,
  lockedPermissionIds,
  isLoading,
}: RolePermissionsSectionProps) {
  return (
    <FormField
      control={form.control}
      name="permissions"
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <PermissionMatrix
              permissions={allPermissions}
              value={field.value || []}
              onChange={field.onChange}
              disabled={isLoading}
              lockedIds={lockedPermissionIds}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
