/**
 * Built-in module: RBAC — `/api/roles/*` + `/api/permissions/*`.
 *
 * Mirrors the routes parsed by
 * `src/route-handler/route-parser.ts:parseRoleRoutes` and the dispatcher
 * handlers in `src/dispatcher/handlers/auth-dispatcher.ts`. 13 role ops +
 * 5 permission ops = 18 endpoints.
 *
 *   GET    /api/roles
 *   POST   /api/roles
 *   GET    /api/roles/{roleId}
 *   PATCH  /api/roles/{roleId}
 *   DELETE /api/roles/{roleId}
 *   GET    /api/roles/{roleId}/children
 *   POST   /api/roles/{roleId}/children
 *   DELETE /api/roles/{roleId}/children/{childRoleId}
 *   GET    /api/roles/{roleId}/parents
 *   GET    /api/roles/{roleId}/permissions
 *   POST   /api/roles/{roleId}/permissions
 *   PATCH  /api/roles/{roleId}/permissions   bulk set
 *   DELETE /api/roles/{roleId}/permissions/{permissionId}
 *
 *   GET    /api/permissions
 *   POST   /api/permissions
 *   GET    /api/permissions/{permissionId}
 *   PATCH  /api/permissions/{permissionId}
 *   DELETE /api/permissions/{permissionId}
 *
 * Role inheritance: every role can declare zero or more *child* roles,
 * which transitively inherit the parent's permissions. `parents` is the
 * reverse-direction list used by the admin UI.
 *
 * @module nextly/openapi/modules/rbac
 */

import { defineModule } from "../generator/define-module";
import type { OperationIR } from "../ir/types";
import type { OpenAPISchema } from "../types";

import {
  CONFLICT_RESPONSE,
  NOT_FOUND_RESPONSE,
  STANDARD_ERROR_RESPONSES,
  STANDARD_SECURITY,
} from "./_shared";

const PATH_ROLE_ID = {
  name: "roleId",
  in: "path" as const,
  required: true,
  description: "Role id.",
  schema: { type: "string" } satisfies OpenAPISchema,
};

const PATH_CHILD_ROLE_ID = {
  name: "childRoleId",
  in: "path" as const,
  required: true,
  description: "Child role id (target of the inheritance edge).",
  schema: { type: "string" } satisfies OpenAPISchema,
};

const PATH_PERMISSION_ID = {
  name: "permissionId",
  in: "path" as const,
  required: true,
  description: "Permission id.",
  schema: { type: "string" } satisfies OpenAPISchema,
};

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const Role: OpenAPISchema = {
  type: "object",
  required: ["id", "slug", "name"],
  properties: {
    id: { type: "string" },
    slug: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    isSystem: {
      type: "boolean",
      description:
        "True for the built-in `super_admin` role; system roles cannot " +
        "be deleted.",
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: true,
};

const Permission: OpenAPISchema = {
  type: "object",
  required: ["id", "slug", "resource", "action"],
  properties: {
    id: { type: "string" },
    slug: {
      type: "string",
      description:
        "Canonical permission slug, formatted `{action}-{resource}` " +
        "(e.g. `read-users`, `manage-permissions`).",
    },
    resource: { type: "string" },
    action: { type: "string" },
    description: { type: ["string", "null"] },
    isSystem: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: true,
};

const CreateRoleRequest: OpenAPISchema = {
  type: "object",
  required: ["slug", "name"],
  properties: {
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    name: { type: "string", minLength: 1 },
    description: { type: ["string", "null"] },
  },
};

const UpdateRoleRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string" },
    description: { type: ["string", "null"] },
  },
  description: "Partial update. `slug` is immutable.",
};

const CreatePermissionRequest: OpenAPISchema = {
  type: "object",
  required: ["resource", "action"],
  properties: {
    resource: { type: "string", minLength: 1 },
    action: { type: "string", minLength: 1 },
    description: { type: ["string", "null"] },
  },
};

const UpdatePermissionRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    description: { type: ["string", "null"] },
  },
  description:
    "Only the description is mutable; resource/action identity is fixed.",
};

const AddChildRoleRequest: OpenAPISchema = {
  type: "object",
  required: ["childRoleId"],
  properties: {
    childRoleId: { type: "string" },
  },
};

const AddPermissionToRoleRequest: OpenAPISchema = {
  type: "object",
  required: ["permissionId"],
  properties: {
    permissionId: { type: "string" },
  },
};

const SetRolePermissionsRequest: OpenAPISchema = {
  type: "object",
  required: ["permissionIds"],
  properties: {
    permissionIds: {
      type: "array",
      items: { type: "string" },
      description:
        "Complete desired set; the server replaces the role's permissions " +
        "with exactly this list.",
    },
  },
};

const ListRolesResponse: OpenAPISchema = {
  type: "object",
  required: ["roles"],
  properties: {
    roles: { type: "array", items: { $ref: "#/components/schemas/Role" } },
  },
};

const ListPermissionsResponse: OpenAPISchema = {
  type: "object",
  required: ["permissions"],
  properties: {
    permissions: {
      type: "array",
      items: { $ref: "#/components/schemas/Permission" },
    },
  },
};

const ListRolePermissionsResponse: OpenAPISchema = {
  type: "object",
  required: ["permissions"],
  properties: {
    permissions: {
      type: "array",
      items: { $ref: "#/components/schemas/Permission" },
    },
  },
};

const ListRoleEdgesResponse: OpenAPISchema = {
  type: "object",
  required: ["roles"],
  properties: {
    roles: { type: "array", items: { $ref: "#/components/schemas/Role" } },
  },
  description: "Used for both children and parents endpoints.",
};

const MutationResponseRole: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/Role" },
  },
};

const MutationResponsePermission: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/Permission" },
  },
};

const RoleEdgeActionResponse: OpenAPISchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string" },
    roleId: { type: "string" },
    childRoleId: { type: "string" },
    permissionId: { type: "string" },
  },
  additionalProperties: true,
  description:
    "Generic `respondAction` envelope for role-edge mutations (add " +
    "child / remove child / add permission / remove permission / bulk " +
    "set). The body echoes the touched ids.",
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

const listRolesOp: OperationIR = {
  path: "/api/roles",
  method: "GET",
  versions: ["1.0"],
  operationId: "rbac.listRoles",
  tags: ["RBAC"],
  summary: "List roles",
  parameters: [],
  responses: {
    "200": {
      description: "Role list.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListRolesResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const createRoleOp: OperationIR = {
  path: "/api/roles",
  method: "POST",
  versions: ["1.0"],
  operationId: "rbac.createRole",
  tags: ["RBAC"],
  summary: "Create a role",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CreateRoleRequest" },
      },
    },
  },
  responses: {
    "201": {
      description: "Role created.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseRole" },
        },
      },
    },
    ...CONFLICT_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const getRoleOp: OperationIR = {
  path: "/api/roles/{roleId}",
  method: "GET",
  versions: ["1.0"],
  operationId: "rbac.findRoleById",
  tags: ["RBAC"],
  summary: "Get a role",
  parameters: [PATH_ROLE_ID],
  responses: {
    "200": {
      description: "Role document.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Role" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updateRoleOp: OperationIR = {
  path: "/api/roles/{roleId}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "rbac.updateRole",
  tags: ["RBAC"],
  summary: "Update a role",
  parameters: [PATH_ROLE_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateRoleRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Role updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseRole" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const deleteRoleOp: OperationIR = {
  path: "/api/roles/{roleId}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "rbac.deleteRole",
  tags: ["RBAC"],
  summary: "Delete a role",
  description: "System roles (e.g. `super_admin`) cannot be deleted.",
  parameters: [PATH_ROLE_ID],
  responses: {
    "200": {
      description: "Role deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseRole" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const listChildrenOp: OperationIR = {
  path: "/api/roles/{roleId}/children",
  method: "GET",
  versions: ["1.0"],
  operationId: "rbac.listChildRoles",
  tags: ["RBAC"],
  summary: "List descendant roles",
  description:
    "Transitive — returns every role that inherits from this one " +
    "directly or via intermediate edges.",
  parameters: [PATH_ROLE_ID],
  responses: {
    "200": {
      description: "Descendant role list.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListRoleEdgesResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const addChildOp: OperationIR = {
  path: "/api/roles/{roleId}/children",
  method: "POST",
  versions: ["1.0"],
  operationId: "rbac.addChildRole",
  tags: ["RBAC"],
  summary: "Add a child role (inheritance edge)",
  parameters: [PATH_ROLE_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/AddChildRoleRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Edge added.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RoleEdgeActionResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...CONFLICT_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const removeChildOp: OperationIR = {
  path: "/api/roles/{roleId}/children/{childRoleId}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "rbac.removeChildRole",
  tags: ["RBAC"],
  summary: "Remove a child role (inheritance edge)",
  parameters: [PATH_ROLE_ID, PATH_CHILD_ROLE_ID],
  responses: {
    "200": {
      description: "Edge removed.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RoleEdgeActionResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const listParentsOp: OperationIR = {
  path: "/api/roles/{roleId}/parents",
  method: "GET",
  versions: ["1.0"],
  operationId: "rbac.listParentRoles",
  tags: ["RBAC"],
  summary: "List ancestor roles",
  description: "Transitive list of roles this one inherits from.",
  parameters: [PATH_ROLE_ID],
  responses: {
    "200": {
      description: "Ancestor role list.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListRoleEdgesResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const listRolePermissionsOp: OperationIR = {
  path: "/api/roles/{roleId}/permissions",
  method: "GET",
  versions: ["1.0"],
  operationId: "rbac.listRolePermissions",
  tags: ["RBAC"],
  summary: "List permissions granted to a role",
  parameters: [PATH_ROLE_ID],
  responses: {
    "200": {
      description: "Permission list.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListRolePermissionsResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const addPermissionToRoleOp: OperationIR = {
  path: "/api/roles/{roleId}/permissions",
  method: "POST",
  versions: ["1.0"],
  operationId: "rbac.addPermissionToRole",
  tags: ["RBAC"],
  summary: "Grant a permission to a role",
  parameters: [PATH_ROLE_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/AddPermissionToRoleRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Permission granted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RoleEdgeActionResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const setRolePermissionsOp: OperationIR = {
  path: "/api/roles/{roleId}/permissions",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "rbac.setRolePermissions",
  tags: ["RBAC"],
  summary: "Bulk-set a role's permissions",
  description:
    "Replaces the entire permission set. Pass an empty array to revoke " +
    "all permissions from the role.",
  parameters: [PATH_ROLE_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/SetRolePermissionsRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Permission set updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RoleEdgeActionResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const removePermissionFromRoleOp: OperationIR = {
  path: "/api/roles/{roleId}/permissions/{permissionId}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "rbac.removePermissionFromRole",
  tags: ["RBAC"],
  summary: "Revoke a permission from a role",
  parameters: [PATH_ROLE_ID, PATH_PERMISSION_ID],
  responses: {
    "200": {
      description: "Permission revoked.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RoleEdgeActionResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const listPermissionsOp: OperationIR = {
  path: "/api/permissions",
  method: "GET",
  versions: ["1.0"],
  operationId: "rbac.listPermissions",
  tags: ["RBAC"],
  summary: "List permissions",
  parameters: [],
  responses: {
    "200": {
      description: "Permission list.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListPermissionsResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const createPermissionOp: OperationIR = {
  path: "/api/permissions",
  method: "POST",
  versions: ["1.0"],
  operationId: "rbac.createPermission",
  tags: ["RBAC"],
  summary: "Create a permission",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CreatePermissionRequest" },
      },
    },
  },
  responses: {
    "201": {
      description: "Permission created.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponsePermission",
          },
        },
      },
    },
    ...CONFLICT_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const getPermissionOp: OperationIR = {
  path: "/api/permissions/{permissionId}",
  method: "GET",
  versions: ["1.0"],
  operationId: "rbac.findPermissionById",
  tags: ["RBAC"],
  summary: "Get a permission",
  parameters: [PATH_PERMISSION_ID],
  responses: {
    "200": {
      description: "Permission document.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Permission" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updatePermissionOp: OperationIR = {
  path: "/api/permissions/{permissionId}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "rbac.updatePermission",
  tags: ["RBAC"],
  summary: "Update a permission",
  parameters: [PATH_PERMISSION_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdatePermissionRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Permission updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponsePermission" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const deletePermissionOp: OperationIR = {
  path: "/api/permissions/{permissionId}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "rbac.deletePermission",
  tags: ["RBAC"],
  summary: "Delete a permission",
  description:
    "System permissions are seeded for the built-in resources (users, " +
    "roles, permissions, …); deleting them is blocked.",
  parameters: [PATH_PERMISSION_ID],
  responses: {
    "200": {
      description: "Permission deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponsePermission" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

export const rbacModule = defineModule({
  name: "rbac",
  tag: {
    name: "RBAC",
    description:
      "Roles, permissions, and the inheritance edges that drive access control.",
  },
  operations: [
    listRolesOp,
    createRoleOp,
    getRoleOp,
    updateRoleOp,
    deleteRoleOp,
    listChildrenOp,
    addChildOp,
    removeChildOp,
    listParentsOp,
    listRolePermissionsOp,
    addPermissionToRoleOp,
    setRolePermissionsOp,
    removePermissionFromRoleOp,
    listPermissionsOp,
    createPermissionOp,
    getPermissionOp,
    updatePermissionOp,
    deletePermissionOp,
  ],
  schemas: {
    Role,
    Permission,
    CreateRoleRequest,
    UpdateRoleRequest,
    CreatePermissionRequest,
    UpdatePermissionRequest,
    AddChildRoleRequest,
    AddPermissionToRoleRequest,
    SetRolePermissionsRequest,
    ListRolesResponse,
    ListPermissionsResponse,
    ListRolePermissionsResponse,
    ListRoleEdgesResponse,
    MutationResponseRole,
    MutationResponsePermission,
    RoleEdgeActionResponse,
  },
});
