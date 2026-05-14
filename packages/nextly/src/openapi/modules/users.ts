/**
 * Built-in module: `/api/users/*`.
 *
 * Mirrors the user dispatcher in
 * `packages/nextly/src/dispatcher/handlers/user-dispatcher.ts` and the
 * routing in `packages/nextly/src/route-handler/route-parser.ts`:
 *
 *   GET    /api/users                                              — list
 *   POST   /api/users                                              — create
 *   GET    /api/users/{userId}                                     — read one
 *   PATCH  /api/users/{userId}                                     — update
 *   DELETE /api/users/{userId}                                     — delete
 *   PATCH  /api/users/{userId}/password                            — password
 *   GET    /api/users/{userId}/accounts                            — linked OAuth
 *   DELETE /api/users/{userId}/accounts/{provider}/{providerAccountId}
 *   POST   /api/users/{userId}/roles                               — assign role
 *   GET    /api/users/{userId}/roles                               — list roles
 *   DELETE /api/users/{userId}/roles/{roleId}                      — unassign
 *
 * Every operation is authenticated (bearer / cookie / apiKey — the
 * standard envelope used by collection CRUD). The route handler runs
 * `requirePermission` on top of that and the super-admin role guards in
 * `routeHandler.ts` enforce the additional checks documented in
 * `guardSuperAdminRoleAssignment` and `guardLastSuperAdminRemoval`.
 *
 * Response shapes match what the dispatcher actually emits:
 *   list      → respondList(items, meta)
 *   findById  → respondDoc(user)         (bare doc, no envelope)
 *   create    → respondMutation("User created.", user, 201)
 *   update    → respondMutation("User updated.", user)
 *   delete    → respondMutation("User deleted.", user)
 *                  (the full deleted user is echoed back — different
 *                   from auto-generated collection DELETE which returns
 *                   only `{ id }`)
 *   password  → respondAction("Password hash updated.")
 *   accounts  → respondData({ accounts })   (non-paginated)
 *   unlink    → respondAction("Account unlinked.", { provider, providerAccountId })
 *   roles     → respondAction("Role assigned to user.", { userId, roleId })
 *
 * The `passwordHash` is *never* surfaced in any read response by
 * `UserService.mapToUser` — the `User` schema below mirrors that
 * exclusion.
 *
 * @module nextly/openapi/modules/users
 */

import { defineModule } from "../generator/define-module";
import type { OperationIR } from "../ir/types";
import type { OpenAPISchema } from "../types";

import {
  NOT_FOUND_RESPONSE,
  STANDARD_ERROR_RESPONSES,
  STANDARD_SECURITY,
} from "./_shared";

const PATH_USER_ID = {
  name: "userId",
  in: "path" as const,
  required: true,
  description: "Target user id.",
  schema: { type: "string" } satisfies OpenAPISchema,
};

const PATH_PROVIDER = {
  name: "provider",
  in: "path" as const,
  required: true,
  description: "OAuth provider key (e.g. `github`, `google`).",
  schema: { type: "string" } satisfies OpenAPISchema,
};

const PATH_PROVIDER_ACCOUNT_ID = {
  name: "providerAccountId",
  in: "path" as const,
  required: true,
  description: "Provider-side account identifier.",
  schema: { type: "string" } satisfies OpenAPISchema,
};

const PATH_ROLE_ID = {
  name: "roleId",
  in: "path" as const,
  required: true,
  description: "Target role id.",
  schema: { type: "string" } satisfies OpenAPISchema,
};

const LIST_QUERY_PARAMS = [
  {
    name: "page",
    in: "query" as const,
    required: false,
    description: "1-based page number. Defaults to 1.",
    schema: { type: "integer", minimum: 1 } satisfies OpenAPISchema,
  },
  {
    name: "limit",
    in: "query" as const,
    required: false,
    description: "Items per page. Defaults to 10.",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: 100,
    } satisfies OpenAPISchema,
  },
  {
    name: "search",
    in: "query" as const,
    required: false,
    description: "Substring match against email or name.",
    schema: { type: "string" } satisfies OpenAPISchema,
  },
  {
    name: "emailVerified",
    in: "query" as const,
    required: false,
    description: "Filter to users whose email is verified (or not).",
    schema: { type: "boolean" } satisfies OpenAPISchema,
  },
  {
    name: "hasPassword",
    in: "query" as const,
    required: false,
    description:
      "Filter to users that have / do not have a local password set " +
      "(useful for distinguishing OAuth-only users).",
    schema: { type: "boolean" } satisfies OpenAPISchema,
  },
  {
    name: "createdAtFrom",
    in: "query" as const,
    required: false,
    description: "Inclusive lower bound on `createdAt` (ISO 8601).",
    schema: { type: "string", format: "date-time" } satisfies OpenAPISchema,
  },
  {
    name: "createdAtTo",
    in: "query" as const,
    required: false,
    description: "Inclusive upper bound on `createdAt` (ISO 8601).",
    schema: { type: "string", format: "date-time" } satisfies OpenAPISchema,
  },
  {
    name: "sortBy",
    in: "query" as const,
    required: false,
    description: "Sort key.",
    schema: {
      type: "string",
      enum: ["createdAt", "name", "email"],
    } satisfies OpenAPISchema,
  },
  {
    name: "sortOrder",
    in: "query" as const,
    required: false,
    description: "Sort direction.",
    schema: { type: "string", enum: ["asc", "desc"] } satisfies OpenAPISchema,
  },
] as const;

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const User: OpenAPISchema = {
  type: "object",
  required: ["id", "email"],
  properties: {
    id: { type: "string", description: "Stable user identifier." },
    email: { type: "string", format: "email" },
    name: { type: ["string", "null"] },
    image: {
      type: ["string", "null"],
      format: "uri",
      description: "Avatar URL; null when the user has no avatar set.",
    },
    emailVerified: {
      type: ["string", "null"],
      format: "date-time",
      description: "Timestamp the email was verified; null when unverified.",
    },
    isActive: { type: "boolean" },
    roles: {
      type: "array",
      items: { type: "string" },
      description:
        "Role IDs currently granted to the user. The full role records are " +
        "fetched via `GET /api/users/{userId}/roles`.",
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  description:
    "Wire shape of a user record. `passwordHash` is always stripped by " +
    "the service layer and never surfaces in any read response.",
};

const CreateUserRequest: OpenAPISchema = {
  type: "object",
  required: ["email", "name"],
  properties: {
    email: { type: "string", format: "email" },
    name: { type: "string", minLength: 1, maxLength: 255 },
    password: {
      type: "string",
      minLength: 8,
      description:
        "Optional plaintext password; omit for OAuth-only / SSO-bootstrapped " +
        "users. When set, the service hashes it before persisting.",
    },
    image: { type: ["string", "null"], format: "uri" },
    roles: {
      type: "array",
      items: { type: "string" },
      description:
        "Role IDs to assign at creation. Assigning the super_admin role " +
        "requires the requesting user to themselves hold super_admin.",
    },
    isActive: { type: "boolean" },
  },
  additionalProperties: true,
  description:
    "Create-user payload. Extra properties are accepted to support " +
    "user-extension custom fields (user_ext).",
};

const UpdateUserRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    email: { type: "string", format: "email" },
    name: { type: "string", minLength: 1, maxLength: 255 },
    image: { type: ["string", "null"], format: "uri" },
    emailVerified: { type: ["string", "null"], format: "date-time" },
    isActive: { type: "boolean" },
    roles: {
      type: "array",
      items: { type: "string" },
      description:
        "When provided, replaces the user's role assignments wholesale. " +
        "Removing super_admin from the last super-admin is blocked.",
    },
  },
  additionalProperties: true,
  description: "Partial-update payload. Unspecified fields are left unchanged.",
};

const UpdatePasswordRequest: OpenAPISchema = {
  type: "object",
  required: ["passwordHash"],
  properties: {
    passwordHash: {
      type: "string",
      description:
        "Pre-hashed password value. This endpoint accepts an already-hashed " +
        "value and stores it verbatim — intended for admin-side password " +
        "operations only. End-user password changes flow through the auth " +
        "module's `/api/auth/change-password` endpoint, which hashes the " +
        "plaintext server-side.",
    },
  },
};

const AccountLink: OpenAPISchema = {
  type: "object",
  required: ["id", "userId", "provider", "providerAccountId", "type"],
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    provider: {
      type: "string",
      description: "OAuth provider key (`github`, `google`, …).",
    },
    providerAccountId: {
      type: "string",
      description: "Provider-side account identifier.",
    },
    type: {
      type: "string",
      description: "Account kind (`oauth`, `email`, `credentials`, …).",
    },
  },
  description: "An OAuth / external account linked to a Nextly user.",
};

const RoleRef: OpenAPISchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" },
    slug: { type: "string" },
    name: { type: "string" },
  },
  additionalProperties: true,
  description:
    "Lean role reference returned by user-role listing endpoints. The " +
    "full role schema lives in the rbac module.",
};

const ListResponseUser: OpenAPISchema = {
  type: "object",
  required: ["items", "meta"],
  properties: {
    items: {
      type: "array",
      items: { $ref: "#/components/schemas/User" },
    },
    meta: { $ref: "#/components/schemas/PaginationMeta" },
  },
};

const MutationResponseUser: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/User" },
  },
};

const ListAccountsResponse: OpenAPISchema = {
  type: "object",
  required: ["accounts"],
  properties: {
    accounts: {
      type: "array",
      items: { $ref: "#/components/schemas/AccountLink" },
    },
  },
};

const UnlinkAccountResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "provider", "providerAccountId"],
  properties: {
    message: { type: "string", example: "Account unlinked." },
    provider: { type: "string" },
    providerAccountId: { type: "string" },
  },
};

const AssignRoleRequest: OpenAPISchema = {
  type: "object",
  required: ["roleId"],
  properties: {
    roleId: { type: "string", description: "Role to grant to the user." },
  },
};

const AssignRoleResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "userId", "roleId"],
  properties: {
    message: { type: "string", example: "Role assigned to user." },
    userId: { type: "string" },
    roleId: { type: "string" },
  },
};

const UnassignRoleResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "userId", "roleId"],
  properties: {
    message: { type: "string", example: "Role unassigned from user." },
    userId: { type: "string" },
    roleId: { type: "string" },
  },
};

const ListUserRolesResponse: OpenAPISchema = {
  type: "object",
  required: ["roles"],
  properties: {
    roles: {
      type: "array",
      items: { $ref: "#/components/schemas/RoleRef" },
    },
  },
};

const ActionMessageResponse: OpenAPISchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string" },
  },
  description: "Generic `respondAction` envelope — body is just `{ message }`.",
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

const listUsersOp: OperationIR = {
  path: "/api/users",
  method: "GET",
  versions: ["1.0"],
  operationId: "users.list",
  tags: ["Users"],
  summary: "List users",
  description:
    "Paginated user listing. Supports substring search, verified / " +
    "password-presence filters, a created-at range, and configurable sort.",
  parameters: [...LIST_QUERY_PARAMS],
  responses: {
    "200": {
      description: "Paginated users page.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListResponseUser" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const createUserOp: OperationIR = {
  path: "/api/users",
  method: "POST",
  versions: ["1.0"],
  operationId: "users.create",
  tags: ["Users"],
  summary: "Create a user",
  description:
    "Admin-side user creation. Skips the silent-success / anti-enumeration " +
    "envelope used by the public `/api/auth/register` endpoint and surfaces " +
    "DB conflicts directly.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CreateUserRequest" },
      },
    },
  },
  responses: {
    "201": {
      description: "User created.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseUser" },
        },
      },
    },
    "409": { $ref: "#/components/responses/Conflict" },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const findUserByIdOp: OperationIR = {
  path: "/api/users/{userId}",
  method: "GET",
  versions: ["1.0"],
  operationId: "users.findById",
  tags: ["Users"],
  summary: "Get a user by id",
  parameters: [PATH_USER_ID],
  responses: {
    "200": {
      description: "User document.",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/User" } },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updateUserOp: OperationIR = {
  path: "/api/users/{userId}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "users.update",
  tags: ["Users"],
  summary: "Update a user",
  parameters: [PATH_USER_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateUserRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "User updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseUser" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    "409": { $ref: "#/components/responses/Conflict" },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const deleteUserOp: OperationIR = {
  path: "/api/users/{userId}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "users.delete",
  tags: ["Users"],
  summary: "Delete a user",
  description:
    "Removes the user. The response echoes the deleted record (not just " +
    "`{ id }` like auto-generated collection deletes) so clients can " +
    "render a fully-resolved confirmation without a separate fetch.",
  parameters: [PATH_USER_ID],
  responses: {
    "200": {
      description: "User deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseUser" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updatePasswordOp: OperationIR = {
  path: "/api/users/{userId}/password",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "users.updatePassword",
  tags: ["Users"],
  summary: "Set a user's password hash",
  description:
    "Admin-only operation. Persists a pre-hashed password verbatim. " +
    "End-user password changes (which hash plaintext server-side) flow " +
    "through the auth module instead.",
  parameters: [PATH_USER_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdatePasswordRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Password hash updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ActionMessageResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const listAccountsOp: OperationIR = {
  path: "/api/users/{userId}/accounts",
  method: "GET",
  versions: ["1.0"],
  operationId: "users.listAccounts",
  tags: ["Users"],
  summary: "List linked OAuth accounts",
  description:
    "Returns every external account currently linked to the user. " +
    "Empty array is a normal state (e.g. password-only users), not an " +
    "error.",
  parameters: [PATH_USER_ID],
  responses: {
    "200": {
      description: "Linked accounts.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListAccountsResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const unlinkAccountOp: OperationIR = {
  path: "/api/users/{userId}/accounts/{provider}/{providerAccountId}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "users.unlinkAccount",
  tags: ["Users"],
  summary: "Unlink an OAuth account",
  parameters: [PATH_USER_ID, PATH_PROVIDER, PATH_PROVIDER_ACCOUNT_ID],
  responses: {
    "200": {
      description: "Account unlinked.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/UnlinkAccountResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const assignRoleOp: OperationIR = {
  path: "/api/users/{userId}/roles",
  method: "POST",
  versions: ["1.0"],
  operationId: "users.assignRole",
  tags: ["Users"],
  summary: "Grant a role to a user",
  description:
    "Grants the named role. Assigning the super_admin role is blocked " +
    "unless the requesting user is themselves a super_admin.",
  parameters: [PATH_USER_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/AssignRoleRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Role assigned.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AssignRoleResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const listRolesOp: OperationIR = {
  path: "/api/users/{userId}/roles",
  method: "GET",
  versions: ["1.0"],
  operationId: "users.listRoles",
  tags: ["Users"],
  summary: "List a user's roles",
  parameters: [PATH_USER_ID],
  responses: {
    "200": {
      description: "Roles granted to the user.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListUserRolesResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const unassignRoleOp: OperationIR = {
  path: "/api/users/{userId}/roles/{roleId}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "users.unassignRole",
  tags: ["Users"],
  summary: "Revoke a role from a user",
  description:
    "Removing the super_admin role from the *last* super-admin is " +
    "blocked at the route layer.",
  parameters: [PATH_USER_ID, PATH_ROLE_ID],
  responses: {
    "200": {
      description: "Role unassigned.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/UnassignRoleResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

export const usersModule = defineModule({
  name: "users",
  tag: {
    name: "Users",
    description:
      "User CRUD, password management, linked OAuth accounts, and role assignment.",
  },
  operations: [
    listUsersOp,
    createUserOp,
    findUserByIdOp,
    updateUserOp,
    deleteUserOp,
    updatePasswordOp,
    listAccountsOp,
    unlinkAccountOp,
    assignRoleOp,
    listRolesOp,
    unassignRoleOp,
  ],
  schemas: {
    User,
    CreateUserRequest,
    UpdateUserRequest,
    UpdatePasswordRequest,
    AccountLink,
    RoleRef,
    ListResponseUser,
    MutationResponseUser,
    ListAccountsResponse,
    UnlinkAccountResponse,
    AssignRoleRequest,
    AssignRoleResponse,
    UnassignRoleResponse,
    ListUserRolesResponse,
    ActionMessageResponse,
  },
});
