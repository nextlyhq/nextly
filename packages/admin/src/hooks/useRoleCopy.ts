/**
 * Copying a role into a new one, to change.
 *
 * @module hooks/useRoleCopy
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * `copying` holds the new role's form while the role it copies loads: an
 * edit or a save made before it arrives would be overwritten by it, or would
 * create the role without what it was copied for.
 */
export function useRoleCopy(
  roleId: string | undefined,
  form: UseFormReturn<RoleFormValuesType>
): { copyRole: () => void; copying: boolean } {
  const copied = useRef(false);
  // Known from the first render, so no frame shows the form open to edits.
  const [copying, setCopying] = useState(
    () => !roleId && copyFromOf(window.location.search) !== null
  );
  useEffect(() => {
    if (roleId || copied.current) return;
    const from = copyFromOf(window.location.search);
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
      })
      .finally(() => setCopying(false));
  }, [roleId, form]);

  const copyRole = useCallback(() => {
    if (!roleId) return;
    navigateTo(
      `${ROUTES.SECURITY_ROLES_CREATE}?copyFrom=${encodeURIComponent(roleId)}`
    );
  }, [roleId]);
  return { copyRole, copying };
}

/** The role a new role's address names to copy, or null. */
function copyFromOf(search: string): string | null {
  return new URLSearchParams(search).get("copyFrom");
}
