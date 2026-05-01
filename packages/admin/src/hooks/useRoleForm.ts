"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { toast } from "@admin/components/ui";
import { debugError, debugLog } from "@admin/lib/debug";
import { navigateTo } from "@admin/lib/navigation";
import { normalizePermissions } from "@admin/lib/permissions/normalize";

import { PAGINATION } from "../constants/pagination";
import { ROUTES } from "../constants/routes";
import { protectedApi } from "../lib/api/protectedApi";
import { roleApi } from "../services/roleApi";
import type { FetchRolesParams } from "../types/role";
import type { Permission, RoleWithPermissions } from "../types/ui/form";

/**
 * Loading state for async data fetching
 */
interface LoadingState {
  permissions: { loaded: boolean; loading: boolean };
  role: { loaded: boolean; loading: boolean };
  allRoles: { loaded: boolean; loading: boolean };
}

// System resources that belong in the "Settings" tab of the permission matrix.
// Keep this list in sync with SYSTEM_RESOURCES in packages/nextly/src/schemas/rbac.ts
const SYSTEM_RESOURCE_SLUGS = new Set([
  "users",
  "roles",
  "permissions",
  "media",
  "settings",
  "email-providers",
  "email-templates",
  "api-keys",
]);

// Helper function to fetch and process inherited permissions (robust per-id fetch)
const fetchInheritedPermissions = async (childIds: string[]) => {
  if (!Array.isArray(childIds) || childIds.length === 0) {
    return { nextMap: {}, allPermissions: [] as string[] };
  }

  const nextMap: Record<string, string[]> = {};
  const allPermissions = new Set<string>();

  try {
    const roles = await Promise.all(
      childIds.map(async id => {
        try {
          return await roleApi.getRoleById(id);
        } catch (_e) {
          toast.error(
            `Failed to load base role permissions. Some inherited permissions may not be available.`
          );
          return null;
        }
      })
    );

    for (const r of roles) {
      if (!r) continue;
      const perms = normalizePermissions(r.permissions);
      if (r.id) {
        nextMap[r.id] = perms;
      }
      perms.forEach(p => allPermissions.add(p));
    }
  } catch (_e) {
    toast.error(
      "Failed to load inherited permissions from base roles. Some permissions may not be available."
    );
  }

  return { nextMap, allPermissions: Array.from(allPermissions) };
};

const roleFormSchema = z.object({
  name: z
    .string()
    .min(3, { message: "Role name must be at least 3 characters." })
    .max(50, { message: "Role name must not exceed 50 characters." })
    .refine(val => /^[a-zA-Z0-9\s_-]+$/.test(val), {
      message:
        "Role name can only contain letters, numbers, spaces, underscores and hyphens.",
    }),
  slug: z
    .string()
    .min(3, { message: "Slug must be at least 3 characters." })
    .max(50, { message: "Slug must not exceed 50 characters." })
    .regex(/^[a-z0-9_-]+$/, {
      message:
        "Slug must contain only lowercase letters, numbers, underscores, and hyphens.",
    }),
  description: z.string().optional(),
  status: z.enum(["active", "inactive", "deprecated"]),
  permissions: z.array(z.string()),
  baseRoleId: z.string().optional(),
});

export type RoleFormValuesType = z.infer<typeof roleFormSchema>;

export interface UseRoleFormReturn {
  form: UseFormReturn<RoleFormValuesType>;
  role: RoleWithPermissions | null;
  allPermissions: Permission[];
  allRoles: Array<{ id: string; name: string; permissions: string[] }>;
  isLoading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  isEditMode: boolean;
  isSystemRole: boolean;
  selectedBaseRoleIds: string[];
  setSelectedBaseRoleIds: (ids: string[]) => void;
  lockedPermissionIds: string[];
  setLockedPermissionIds: (ids: string[]) => void;
  rolePermissionsMap: Record<string, string[]>;
  setRolePermissionsMap: (map: Record<string, string[]>) => void;
  onSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
  handleNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleCancel: () => void;
  statusOptions: Array<{ id: string; name: string; description: string }>;
  formRef: React.RefObject<HTMLFormElement | null>;
  ignoreFormChanges: boolean;
  setIgnoreFormChanges: (value: boolean) => void;
}

/**
 * Custom hook for RoleForm data loading and form state management
 *
 * This hook encapsulates all the complex state management, data loading,
 * and business logic for the RoleForm component, making the component
 * itself much simpler and more focused on presentation.
 *
 * @param roleId - Optional role ID for edit mode
 * @returns Object containing form state, data, handlers, and derived values
 */
export function useRoleForm(roleId?: string): UseRoleFormReturn {
  const queryClient = useQueryClient();
  const form = useForm<RoleFormValuesType>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      status: "active",
      permissions: [],
      baseRoleId: undefined,
    },
  });

  // Component state
  const [isLoading, setIsLoading] = useState(false);
  const [role, setRole] = useState<RoleWithPermissions | null>(null);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ignoreFormChanges, setIgnoreFormChanges] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Replace ref-based loading state with proper React state
  const [loadingState, setLoadingState] = useState<LoadingState>({
    permissions: { loaded: false, loading: false },
    role: { loaded: false, loading: false },
    allRoles: { loaded: false, loading: false },
  });

  const [lockedPermissionIds, setLockedPermissionIds] = useState<string[]>([]);
  const [allRoles, setAllRoles] = useState<
    Array<{ id: string; name: string; permissions: string[] }>
  >([]);
  const [selectedBaseRoleIds, setSelectedBaseRoleIds] = useState<string[]>([]);
  const [rolePermissionsMap, setRolePermissionsMap] = useState<
    Record<string, string[]>
  >({});

  // Derived state
  const isEditMode = !!roleId;
  const isSystemRole = role?.isSystemRole ?? false;

  const onSubmitHandler = async (values: RoleFormValuesType) => {
    debugLog(
      "useRoleForm",
      "onSubmitHandler called - ROLE FORM SUBMISSION TRIGGERED",
      { values, isEditMode }
    );
    setError(null);
    setIsLoading(true);

    try {
      const roleType: "Custom" | "System" =
        values.status === "active" ? "Custom" : "System";

      const roleData = {
        roleName: values.name,
        description: values.description || "",
        type: roleType,
        permissions: values.permissions,
        slug: values.slug,
        childRoleIds: selectedBaseRoleIds,
      };

      if (isEditMode && roleId) {
        debugLog("useRoleForm", "Updating role...");
        await roleApi.updateRole(roleId, roleData);
        const currentIds = (role?.permissions || []).map(p => p.id);
        const nextIds = values.permissions;
        await roleApi.updateRolePermissions(roleId, currentIds, nextIds);
        await queryClient.invalidateQueries({ queryKey: ["roles"] });
        toast.success("Role updated successfully");
      } else {
        debugLog("useRoleForm", "Creating role...");
        await roleApi.createRole(roleData);
        await queryClient.invalidateQueries({ queryKey: ["roles"] });
        toast.success("Role created successfully");
      }

      debugLog("useRoleForm", "Navigating to roles list");
      navigateTo(ROUTES.SECURITY_ROLES);
    } catch (err) {
      debugError("useRoleForm", "Error:", err);
      const errorMessage =
        err instanceof Error ? err.message : "An error occurred";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setError(null);
  };

  // Load permissions from server
  useEffect(() => {
    if (loadingState.permissions.loaded || loadingState.permissions.loading)
      return;

    const loadPermissions = async () => {
      try {
        setLoadingState(prev => ({
          ...prev,
          permissions: { loaded: false, loading: true },
        }));

        const query = `?page=1&pageSize=${PAGINATION.MAX_PAGE_SIZE}&sortBy=resource&sortOrder=asc`;

        // Fetch permissions and single slugs in parallel so we can correctly
        // categorize each permission as collection-types, single-types, or settings
        const [response, singlesResponse] = await Promise.all([
          protectedApi.get<
            Array<{
              id: string | number;
              name: string | null;
              action: string;
              resource: string;
              description: string | null;
            }>
          >(`/permissions${query}`),
          protectedApi
            .get<Array<{ slug: string }>>(`/singles?page=1&pageSize=500`)
            .catch(() => [] as Array<{ slug: string }>),
        ]);

        const singleSlugs = new Set(
          (singlesResponse || []).map(s => String(s.slug))
        );

        const mapped: Permission[] = (response || []).map(p => {
          const resource = String(p.resource);
          const action = String(p.action);
          const slug = `${resource}.${action}`;

          let category: string;
          if (SYSTEM_RESOURCE_SLUGS.has(resource)) {
            category = "settings";
          } else if (singleSlugs.has(resource)) {
            category = "single-types";
          } else {
            category = "collection-types";
          }

          return {
            id: String(p.id),
            name: p.name || `${resource} ${action}`,
            description: p.description ?? undefined,
            resource,
            action,
            slug,
            category,
          };
        });

        setAllPermissions(mapped);
        setLoadingState(prev => ({
          ...prev,
          permissions: { loaded: true, loading: false },
        }));
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unable to load permissions";
        setError(errorMessage);
        toast.error(
          "Failed to load permissions. Please refresh the page and try again."
        );
        setLoadingState(prev => ({
          ...prev,
          permissions: { loaded: false, loading: false },
        }));
      }
    };

    void loadPermissions();
    // Dependencies ensure effect only runs once per load cycle
    // The early return guard prevents infinite loops even though we depend on state we modify
  }, [loadingState.permissions.loaded, loadingState.permissions.loading]);

  // Load role data in edit mode from API
  useEffect(() => {
    if (!roleId) return;
    if (loadingState.role.loaded || loadingState.role.loading) return;

    const loadRole = async () => {
      try {
        setLoadingState(prev => ({
          ...prev,
          role: { loaded: false, loading: true },
        }));
        setIsLoading(true);
        const {
          role: roleData,
          childRoleIds: initialChildRoleIds,
          childRolePermissionsMap,
        } = await roleApi.getRoleDetails(roleId);

        const normalizedRolePermissionIds = normalizePermissions(
          roleData.permissions
        );

        const roleWithPermissions: RoleWithPermissions = {
          id: roleData.id,
          name: roleData.roleName,
          slug: roleData.roleName.toLowerCase().replace(/\s+/g, "-"),
          description: roleData.description,
          status: roleData.status.toLowerCase() as
            | "active"
            | "inactive"
            | "deprecated",
          isSystemRole: roleData.type === "System",
          permissions: normalizedRolePermissionIds.map(id => ({ id })),
          users: [],
        };

        setRole(roleWithPermissions);
        setLoadingState(prev => ({
          ...prev,
          role: { loaded: true, loading: false },
        }));
        form.reset({
          name: roleWithPermissions.name,
          slug: roleWithPermissions.slug,
          description: roleWithPermissions.description || "",
          status: roleWithPermissions.status,
          permissions: normalizedRolePermissionIds,
        });

        // Use child roles from same API result to avoid duplicate GET
        try {
          const childIds = initialChildRoleIds;
          const directBaseIds = (childIds || []).filter(id => id !== roleId);

          if (directBaseIds.length > 0) {
            setSelectedBaseRoleIds(directBaseIds);

            let nextMap: Record<string, string[]> =
              childRolePermissionsMap || {};
            let allPermissions: string[] = [];
            if (
              !childRolePermissionsMap ||
              Object.keys(childRolePermissionsMap).length === 0
            ) {
              const res = await fetchInheritedPermissions(childIds);
              nextMap = res.nextMap;
              allPermissions = res.allPermissions;
            } else {
              const union = new Set<string>();
              Object.values(childRolePermissionsMap).forEach(arr =>
                arr.forEach(id => union.add(id))
              );
              allPermissions = Array.from(union);
            }
            setRolePermissionsMap(nextMap);
            setLockedPermissionIds(allPermissions);

            const current = form.getValues("permissions") || [];
            const merged = Array.from(new Set([...current, ...allPermissions]));
            form.setValue("permissions", merged, { shouldDirty: false });
          }
        } catch (_err) {
          toast.error(
            "Failed to process role inheritance. Some permissions may not be loaded correctly."
          );
        }
      } catch (error) {
        const errorMessage = `Failed to load role: ${error instanceof Error ? error.message : "Unknown error"}`;
        setError(errorMessage);
        toast.error(
          "Failed to load role data. Please refresh the page and try again."
        );
      } finally {
        setIsLoading(false);
        setLoadingState(prev => ({
          ...prev,
          role: { ...prev.role, loading: false },
        }));
      }
    };

    void loadRole();
    // Dependencies ensure effect only runs once per load cycle per roleId
    // The early return guard prevents infinite loops even though we depend on state we modify
  }, [roleId, form, loadingState.role.loaded, loadingState.role.loading]);

  // Load real roles to populate Base Role dropdown
  useEffect(() => {
    if (loadingState.allRoles.loaded || loadingState.allRoles.loading) return;

    const loadRoles = async () => {
      try {
        setLoadingState(prev => ({
          ...prev,
          allRoles: { loaded: false, loading: true },
        }));

        // Fetch all roles first
        const res = await roleApi.fetchRoles({
          pagination: { page: 0, pageSize: PAGINATION.MAX_PAGE_SIZE },
          populate: ["permissions"],
        } as FetchRolesParams);

        const rolesWithPermissions = (res?.data || []).map(r => ({
          id: r.id,
          name: r.roleName,
          permissions: normalizePermissions(r.permissions),
          description: r.description,
          isSystem: r.type === "System",
        }));

        const filteredRoles = rolesWithPermissions.filter(r => {
          if (r.id === roleId) return false;
          if (r.isSystem) return false;
          return true;
        });

        setAllRoles(filteredRoles);
        setLoadingState(prev => ({
          ...prev,
          allRoles: { loaded: true, loading: false },
        }));
      } catch (_e) {
        setAllRoles([]);
        toast.error(
          "Failed to load available roles. Please refresh the page and try again."
        );
        setLoadingState(prev => ({
          ...prev,
          allRoles: { loaded: false, loading: false },
        }));
      }
    };
    void loadRoles();
    // Dependencies ensure effect only runs once per load cycle per roleId
    // The early return guard prevents infinite loops even though we depend on state we modify
  }, [roleId, loadingState.allRoles.loaded, loadingState.allRoles.loading]);

  // Handle beforeunload warning for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (form.formState.isDirty && !ignoreFormChanges) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [form.formState.isDirty, ignoreFormChanges]);

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isEditMode) {
        const value = e.target.value;
        const slugValue = value
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_-]/g, "");

        form.setValue("slug", slugValue, { shouldDirty: true });
      }
    },
    [form, isEditMode]
  );

  const statusOptions = useMemo(
    () => [
      {
        id: "active",
        name: "Active",
        description: "Role is active and can be assigned to users",
      },
      {
        id: "inactive",
        name: "Inactive",
        description: "Role is inactive and cannot be assigned to new users",
      },
      {
        id: "deprecated",
        name: "Deprecated",
        description: "Role is deprecated and will be removed in the future",
      },
    ],
    []
  );

  return {
    form,
    role,
    allPermissions,
    allRoles,
    isLoading,
    error,
    setError,
    isEditMode,
    isSystemRole,
    selectedBaseRoleIds,
    setSelectedBaseRoleIds,
    lockedPermissionIds,
    setLockedPermissionIds,
    rolePermissionsMap,
    setRolePermissionsMap,
    onSubmit: form.handleSubmit(onSubmitHandler),
    handleNameChange,
    handleCancel,
    statusOptions,
    formRef,
    ignoreFormChanges,
    setIgnoreFormChanges,
  };
}
