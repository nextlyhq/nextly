import { TableParams, FilterInfo } from "@revnixhq/ui";

export interface RoleFilterParams {
  id?: {
    $in?: string[];
  };
}

export interface RoleFilters extends FilterInfo {
  filters?: RoleFilterParams;
  populate?: string[];
}

export interface FetchRolesParams extends TableParams {
  filters?: RoleFilters;
  populate?: string[];
}
// API shapes used by role services
export interface ApiPermission {
  id: string;
  name?: string | null;
  action: string;
  resource: string;
  description?: string | null;
}

export interface ApiChildRole {
  id: string;
  name?: string;
  // Backend may return either permission IDs or full permission objects
  permissions?: Array<string | ApiPermission>;
  childRoleId?: string;
}

export interface ApiRoleBase {
  id: string;
  name: string;
  level: number;
  isSystem: boolean;
  description?: string | null;
  slug?: string;
}

export interface ApiRoleWithRelations extends ApiRoleBase {
  // Optional array of permission IDs in some endpoints
  permissionIds?: string[];
  // Optional child roles payload for inheritance
  childRoles?: ApiChildRole[];
  // Some endpoints may nest payload in a `data` object
  data?: {
    childRoles?: ApiChildRole[];
  };
}

export interface RoleApiDetailsResponse {
  role: {
    id: string;
    roleName: string;
    subtitle: string;
    description: string;
    type: "System" | "Custom";
    permissions: string[];
    status: string;
    created: string;
    name: string;
  };
  childRoleIds: string[];
  childRolePermissionsMap?: Record<string, string[]>;
}

export interface RoleFilter {
  search?: string;
  filters?: Record<string, string | number | boolean>;
  populate?: string[] | string;
}

export interface RoleDeleteDialogProps {
  open: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  role: {
    id: string;
    name: string;
    isSystemRole?: boolean;
  } | null;
  isLoading?: boolean;
}
