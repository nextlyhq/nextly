export interface RoleFormProps {
  roleId?: string;
  initialData?: {
    id?: string;
    name?: string;
    slug?: string;
    description?: string;
    isSystemRole?: boolean;
    permissions?: string[];
  };
  onSubmit?: (data: Record<string, unknown>) => void;
  isLoading?: boolean;
  error?: string;
  isCreateMode?: boolean;
}

export type RoleFormValues = {
  name: string;
  slug: string;
  description?: string;
  status: "active" | "inactive" | "deprecated";
  isSystemRole?: boolean;
  permissions: string[];
  baseRoleId?: string;
};

export interface EntityBase {
  id: string;
}

export interface PermissionBase extends EntityBase {
  name: string;
  description?: string;
  resource: string;
  action: string;
}

export interface Permission extends PermissionBase {
  slug?: string;
  category?: string;
  /** Package that declared this permission; absent for the built-in seeds. */
  owner?: string;
  isInUse?: boolean;
  roleCount?: number;
  isSystemPermission?: boolean;
}

export interface RoleWithPermissions extends EntityBase {
  name: string;
  slug?: string;
  description?: string;
  status?: "active" | "inactive" | "deprecated";
  priority?: number;
  isSystemRole?: boolean;
  permissions?: { id: string }[];
  users?: { id: string; name?: string }[];
}

export interface PermissionMatrixProps {
  permissions: Permission[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  lockedIds?: string[];
}

export interface ContentTypePermissions {
  id: string;
  name: string;
  apiId?: string;
  category: string;
  /**
   * The resource's permissions, keyed by the action the database recorded.
   *
   * A map rather than a fixed set of slots because the actions are data: the
   * permissions table is `(resource, action)`, and plugins declare their own
   * verbs. A key is present only when the resource has that permission, so
   * absence means "no such permission", not "not granted".
   */
  permissions: Record<string, Permission>;
}

export type RoleUsersSectionProps = {
  users: { id: string; name?: string }[];
  roleName: string;
  disabled?: boolean;
};
