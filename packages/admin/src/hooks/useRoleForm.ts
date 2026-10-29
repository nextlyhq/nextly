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
import {
  levelRows,
  pluginGroups,
  screenEntitiesFrom,
  systemLevelRows,
  type LevelRow,
  type PluginGroup,
  type ScreenEntity,
} from "@admin/lib/permissions/level-rows";
import { normalizePermissions } from "@admin/lib/permissions/normalize";
import { assignableRoles } from "@admin/lib/roles/assignable";

import { PAGINATION } from "../constants/pagination";
import { SYSTEM_RESOURCE_SET } from "../constants/permissions";
import { ROUTES } from "../constants/routes";
import { apiErrorMessage } from "../lib/api/parseApiError";
import { protectedApi } from "../lib/api/protectedApi";
import { roleApi } from "../services/roleApi";
import type { FetchRolesParams } from "../types/role";
import type { Permission, RoleWithPermissions } from "../types/ui/form";

import { invalidateCurrentUserAccess } from "./current-user-access";

/**
 * Loading state for async data fetching
 */
interface LoadingState {
  /**
   * `failed` marks a load that ended in an error: the form shows the error
   * and does not ask again on its own, since nothing about a failed request
   * changes by asking it again at once.
   */
  permissions: { loaded: boolean; loading: boolean; failed?: boolean };
  role: { loaded: boolean; loading: boolean };
  allRoles: { loaded: boolean; loading: boolean };
}

// System resources that belong in the "Settings" tab of the permission matrix.
// Keep this list in sync with SYSTEM_RESOURCES in packages/nextly/src/schemas/rbac.ts
/** The one role nothing may be built on; see the base-role filter below. */
const SUPER_ADMIN_SLUG = "super-admin";

/**
 * Built-in resources, derived from the single admin definition.
 *
 * Was a hand-kept copy; see `constants/permissions` for why there is now one.
 */
export const SYSTEM_RESOURCE_SLUGS: ReadonlySet<string> = SYSTEM_RESOURCE_SET;

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

/** The grammar a slug the form sets is held to. */
const newSlugSchema: z.ZodString = z
  .string()
  .min(3, { message: "Slug must be at least 3 characters." })
  .max(50, { message: "Slug must not exceed 50 characters." })
  .regex(/^[a-z0-9_-]+$/, {
    message:
      "Slug must contain only lowercase letters, numbers, underscores, and hyphens.",
  });

const roleFormSchema: z.ZodObject<{
  name: z.ZodString;
  slug: z.ZodString;
  description: z.ZodOptional<z.ZodString>;
  permissions: z.ZodArray<z.ZodString>;
  baseRoleId: z.ZodOptional<z.ZodString>;
}> = z.object({
  name: z
    .string()
    .min(3, { message: "Role name must be at least 3 characters." })
    .max(50, { message: "Role name must not exceed 50 characters." })
    .refine(val => /^[a-zA-Z0-9\s_-]+$/.test(val), {
      message:
        "Role name can only contain letters, numbers, spaces, underscores and hyphens.",
    }),
  slug: newSlugSchema,
  description: z.string().optional(),
  permissions: z.array(z.string()),
  baseRoleId: z.string().optional(),
});

/**
 * The form for an existing role. Its stored slug is accepted as it is: a role
 * an app or plugin declared may hold one outside the grammar a new slug is
 * held to. A slug changed in the form is held to that grammar.
 */
function roleEditFormSchema(storedSlug: () => string | undefined) {
  return roleFormSchema.extend({
    slug: z.string().superRefine((slug, ctx) => {
      if (slug === storedSlug()) return;
      const checked = newSlugSchema.safeParse(slug);
      if (checked.success) return;
      for (const issue of checked.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message });
      }
    }),
  });
}

export type RoleFormValuesType = z.infer<typeof roleFormSchema>;

export interface UseRoleFormReturn {
  form: UseFormReturn<RoleFormValuesType>;
  role: RoleWithPermissions | null;
  allPermissions: Permission[];
  /** One row per collection and Single of the app's own, set by level. */
  levelRows: LevelRow[];
  /** Each plugin's collections and own permissions, folded under its name. */
  pluginGroups: PluginGroup[];
  /** The permissions no row or plugin takes, set one by one in the grid. */
  otherPermissions: Permission[];
  /**
   * Each base role the role is built on, with the permissions it gives, so a
   * row can name the bases that give it something.
   */
  baseGrants: { name: string; ids: string[] }[];
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
  formRef: React.RefObject<HTMLFormElement | null>;
  ignoreFormChanges: boolean;
  setIgnoreFormChanges: (value: boolean) => void;
}

/** One permission as `GET /permissions` lists it. */
interface ListedPermission {
  id: string | number;
  name: string | null;
  action: string;
  resource: string;
  description: string | null;
  owner: string | null;
  danger?: boolean;
}

/**
 * The most pages of permissions read: past it, a server still saying there
 * is more is answered with an error rather than read for ever.
 */
const MAX_PERMISSION_PAGES = 50;

/**
 * Every permission, read page by page in the canonical paginated
 * `{ items, meta }` shape (spec §5.1) until `meta.hasNext` is false. A row is
 * built from its entity's permissions, so one left on an unread page would
 * read as No access; a list that cannot be read whole is an error instead.
 */
async function fetchEveryPermission(): Promise<ListedPermission[]> {
  const items: ListedPermission[] = [];
  for (let page = 1; page <= MAX_PERMISSION_PAGES; page++) {
    const response = await protectedApi.get<{
      items?: ListedPermission[];
      meta?: { hasNext?: boolean };
    }>(
      `/permissions?page=${page}&limit=${PAGINATION.MAX_PAGE_SIZE}&sortBy=resource&sortOrder=asc`
    );
    items.push(...(response?.items ?? []));
    if (response?.meta?.hasNext !== true) return items;
  }
  throw new Error("Unable to load every permission");
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
  // The slug the edited role is stored with, once it has loaded.
  const storedSlug = useRef<string | undefined>(undefined);
  const [schema] = useState(() =>
    roleId ? roleEditFormSchema(() => storedSlug.current) : roleFormSchema
  );
  const form = useForm<RoleFormValuesType>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      permissions: [],
      baseRoleId: undefined,
    },
  });

  // Component state
  const [isLoading, setIsLoading] = useState(false);
  const [role, setRole] = useState<RoleWithPermissions | null>(null);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [screenEntities, setScreenEntities] = useState<ScreenEntity[]>([]);
  // Every permission whose resource is a collection or Single goes to that
  // entity's row, a built-in resource's (media, settings, the Email hub) to
  // its row, a plugin's rows and its own permissions to its group, and the
  // rest stay in the grid. Derived together, so each permission is shown in
  // exactly one place.
  const { appRows, groups, rest } = useMemo(() => {
    const built = levelRows(screenEntities, allPermissions);
    const system = systemLevelRows(built.rest);
    const sorted = pluginGroups(built.rows, system.rest);
    return { ...sorted, appRows: [...sorted.appRows, ...system.rows] };
  }, [screenEntities, allPermissions]);
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

  // Each base's own grants, by its name. A role made through the API may have
  // several bases, and a row is credited to the ones that give it something,
  // never to the first base for every grant.
  const baseGrants = useMemo(
    () =>
      selectedBaseRoleIds.map(id => ({
        name:
          allRoles.find(candidate => candidate.id === id)?.name ??
          "a base role",
        ids: rolePermissionsMap[id] ?? [],
      })),
    [selectedBaseRoleIds, allRoles, rolePermissionsMap]
  );

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
      // The value is the role's own permissions alone; the base roles' are
      // shown locked beside them but kept apart, since the save replaces the
      // role's own assignments and one sent here would be copied onto it.
      const currentIds = (role?.permissions || []).map(p => p.id);
      const roleData = {
        roleName: values.name,
        description: values.description || "",
        permissions: values.permissions,
        slug: values.slug,
        childRoleIds: selectedBaseRoleIds,
      };

      if (isEditMode && roleId) {
        debugLog("useRoleForm", "Updating role...");
        // No `type`: this form has no control for it, and `updateRole` turns
        // one into `isSystem`, so naming it here would answer a question
        // nobody asked — and answering "Custom" would demote a seeded role to
        // a custom one on any save, including a description-only edit.
        await roleApi.updateRole(roleId, roleData);
        try {
          await roleApi.updateRolePermissions(
            roleId,
            currentIds,
            values.permissions
          );
        } finally {
          // The signed-in user may hold this role, so what they may do is
          // asked again, as every other role, permission and assignment change
          // does. Asked once the role itself is saved, whether or not its
          // permissions follow: that save alone can change what it inherits.
          invalidateCurrentUserAccess(queryClient);
        }
        await queryClient.invalidateQueries({ queryKey: ["roles"] });
        toast.success("Role updated successfully");
      } else {
        debugLog("useRoleForm", "Creating role...");
        // A role on one base with nothing of its own is that base under
        // another name, which the server refuses; said here, before anything
        // is sent, rather than satisfied by copying the base's permissions.
        if (
          selectedBaseRoleIds.length === 1 &&
          values.permissions.length === 0
        ) {
          const message =
            "A role built on one base needs at least one permission of its own.";
          setError(message);
          toast.error(message);
          return;
        }
        // A role someone creates here is theirs, not the framework's. Being a
        // system role locks the name and slug, and the seeder is the only
        // thing that should hand that out.
        await roleApi.createRole({ ...roleData, type: "Custom" });
        await queryClient.invalidateQueries({ queryKey: ["roles"] });
        toast.success("Role created successfully");
      }

      debugLog("useRoleForm", "Navigating to roles list");
      navigateTo(ROUTES.SECURITY_ROLES);
    } catch (err) {
      debugError("useRoleForm", "Error:", err);
      // The reasons live per-field, not in the top-level message, which for a
      // validation failure only ever says "Validation failed."
      const errorMessage = apiErrorMessage(err);
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
    if (
      loadingState.permissions.loaded ||
      loadingState.permissions.loading ||
      loadingState.permissions.failed
    )
      return;

    const loadPermissions = async () => {
      try {
        setLoadingState(prev => ({
          ...prev,
          permissions: { loaded: false, loading: true },
        }));

        // Fetch every permission and the roles screen's list of collections
        // and Singles in parallel: the list gives each permission its row,
        // and says which resources are Singles; the list is parsed at the
        // boundary.
        const [permissionItems, screenResponse] = await Promise.all([
          fetchEveryPermission(),
          protectedApi.get<unknown>(`/roles/screen`),
        ]);

        const entities = screenEntitiesFrom(screenResponse);
        const singleSlugs = new Set(
          entities
            .filter(entity => entity.kind === "single")
            .map(entity => entity.slug)
        );

        const mapped: Permission[] = permissionItems.map(p => {
          const resource = String(p.resource);
          const action = String(p.action);
          const slug = `${resource}.${action}`;
          const owner = p.owner ? String(p.owner) : undefined;

          let category: string;
          if (owner) {
            // Provenance, not the resource name. A plugin names its own
            // resource, so it matches no collection or single and would
            // otherwise fall through to collection-types and render as a
            // content type nobody created.
            category = "plugins";
          } else if (SYSTEM_RESOURCE_SLUGS.has(resource)) {
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
            owner,
            danger: p.danger === true,
          };
        });

        setAllPermissions(mapped);
        setScreenEntities(entities);
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
          permissions: { loaded: false, loading: false, failed: true },
        }));
      }
    };

    void loadPermissions();
    // Dependencies ensure effect only runs once per load cycle
    // The early return guard prevents infinite loops even though we depend on state we modify
  }, [
    loadingState.permissions.loaded,
    loadingState.permissions.loading,
    loadingState.permissions.failed,
  ]);

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
          // The slug as stored: one rebuilt from the name differs wherever the
          // two were set apart, and a save would send it as a slug change.
          slug:
            roleData.slug ??
            roleData.roleName.toLowerCase().replace(/\s+/g, "-"),
          description: roleData.description,
          isSystemRole: roleData.type === "System",
          permissions: normalizedRolePermissionIds.map(id => ({ id })),
          users: [],
        };

        storedSlug.current = roleWithPermissions.slug;
        setRole(roleWithPermissions);
        setLoadingState(prev => ({
          ...prev,
          role: { loaded: true, loading: false },
        }));
        form.reset({
          name: roleWithPermissions.name,
          slug: roleWithPermissions.slug,
          description: roleWithPermissions.description || "",
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
            // Locked and shown beside the role's own, never merged into them.
            setLockedPermissionIds(allPermissions);
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
        });

        // Only roles another role may build on: never the Public role.
        const rolesWithPermissions = assignableRoles(res?.items || []).map(
          r => ({
            id: r.id,
            name: r.roleName,
            slug: r.slug,
            permissions: normalizePermissions(r.permissions),
            description: r.description,
            isSystem: r.type === "System",
          })
        );

        const filteredRoles = rolesWithPermissions.filter(r => {
          // A role cannot be built on itself.
          if (r.id === roleId) return false;
          // Building on Super Admin would grant everything, including the
          // permission to grant. The presets are system roles too, and are
          // the thing most worth building on — so the line is drawn at the
          // one role that hands out everything, not at the class.
          if (r.slug === SUPER_ADMIN_SLUG) return false;
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

  return {
    form,
    role,
    allPermissions,
    levelRows: appRows,
    pluginGroups: groups,
    otherPermissions: rest,
    baseGrants,
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
    formRef,
    ignoreFormChanges,
    setIgnoreFormChanges,
  };
}
