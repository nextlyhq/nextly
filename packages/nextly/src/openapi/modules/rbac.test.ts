import { describe, expect, it } from "vitest";

import { rbacModule } from "./rbac";

describe("rbacModule", () => {
  it("is named 'rbac'", () => {
    expect(rbacModule.name).toBe("rbac");
  });

  it("declares all 18 role + permission operations", () => {
    const summary = rbacModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "DELETE /api/permissions/{permissionId}",
      "DELETE /api/roles/{roleId}",
      "DELETE /api/roles/{roleId}/children/{childRoleId}",
      "DELETE /api/roles/{roleId}/permissions/{permissionId}",
      "GET /api/permissions",
      "GET /api/permissions/{permissionId}",
      "GET /api/roles",
      "GET /api/roles/{roleId}",
      "GET /api/roles/{roleId}/children",
      "GET /api/roles/{roleId}/parents",
      "GET /api/roles/{roleId}/permissions",
      "PATCH /api/permissions/{permissionId}",
      "PATCH /api/roles/{roleId}",
      "PATCH /api/roles/{roleId}/permissions",
      "POST /api/permissions",
      "POST /api/roles",
      "POST /api/roles/{roleId}/children",
      "POST /api/roles/{roleId}/permissions",
    ]);
  });

  it("every operation requires authentication", () => {
    for (const op of rbacModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  it("PATCH /api/roles/{roleId}/permissions is the bulk-set endpoint", () => {
    const op = rbacModule.operations.find(
      o => o.method === "PATCH" && o.path === "/api/roles/{roleId}/permissions"
    )!;
    expect(op.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/SetRolePermissionsRequest",
    });
  });

  it("inheritance-edge endpoints share RoleEdgeActionResponse", () => {
    const edgeOps = [
      "POST /api/roles/{roleId}/children",
      "DELETE /api/roles/{roleId}/children/{childRoleId}",
      "POST /api/roles/{roleId}/permissions",
      "PATCH /api/roles/{roleId}/permissions",
      "DELETE /api/roles/{roleId}/permissions/{permissionId}",
    ];
    for (const sig of edgeOps) {
      const op = rbacModule.operations.find(
        o => `${o.method} ${o.path}` === sig
      )!;
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/RoleEdgeActionResponse",
      });
    }
  });

  it("registers the documented schemas", () => {
    const names = Object.keys(rbacModule.schemas ?? {}).sort();
    expect(names).toEqual([
      "AddChildRoleRequest",
      "AddPermissionToRoleRequest",
      "CreatePermissionRequest",
      "CreateRoleRequest",
      "ListPermissionsResponse",
      "ListRoleEdgesResponse",
      "ListRolePermissionsResponse",
      "ListRolesResponse",
      "MutationResponsePermission",
      "MutationResponseRole",
      "Permission",
      "Role",
      "RoleEdgeActionResponse",
      "SetRolePermissionsRequest",
      "UpdatePermissionRequest",
      "UpdateRoleRequest",
    ]);
  });
});
