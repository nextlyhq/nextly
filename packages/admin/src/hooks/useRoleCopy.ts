/**
 * Copying a role into a new one, to change.
 *
 * @module hooks/useRoleCopy
 */

import { useCallback, useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";

import { toast } from "@admin/components/ui";
import { navigateTo } from "@admin/lib/navigation";
import { normalizePermissions } from "@admin/lib/permissions/normalize";

import { ROUTES } from "../constants/routes";
import { roleApi } from "../services/roleApi";

import type { RoleFormValuesType } from "./useRoleForm";

/**
 * Copying a role into a new one, to change: on an existing role's form, the
 * returned action opens a new role as a copy of it (`?copyFrom=<id>`, a
 * preset's "Copy to change"); on a new role's form opened that way, the form
 * starts with that role's own permissions and description, to name and
 * change as its own. Read once per form.
 */
export function useRoleCopy(
  roleId: string | undefined,
  form: UseFormReturn<RoleFormValuesType>
): () => void {
  const copied = useRef(false);
  useEffect(() => {
    if (roleId || copied.current) return;
    const from = new URLSearchParams(window.location.search).get("copyFrom");
    if (!from) return;
    copied.current = true;
    void roleApi
      .getRoleDetails(from)
      .then(({ role: source }) => {
        form.reset({
          ...form.getValues(),
          description: source.description || "",
          permissions: normalizePermissions(source.permissions),
        });
      })
      .catch(() => {
        toast.error(
          "The role to copy could not be loaded. Choose this role's permissions here."
        );
      });
  }, [roleId, form]);

  return useCallback(() => {
    if (!roleId) return;
    navigateTo(
      `${ROUTES.SECURITY_ROLES_CREATE}?copyFrom=${encodeURIComponent(roleId)}`
    );
  }, [roleId]);
}
