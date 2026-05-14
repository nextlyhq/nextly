import { describe, expect, it } from "vitest";

import { usersModule } from "./users";

describe("usersModule", () => {
  it("is named 'users'", () => {
    expect(usersModule.name).toBe("users");
  });

  it("emits a Users tag", () => {
    expect(usersModule.tag).toEqual({
      name: "Users",
      description:
        "User CRUD, password management, linked OAuth accounts, and role assignment.",
    });
  });

  it("declares the eleven /api/users/* operations the route parser exposes", () => {
    const summary = usersModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "DELETE /api/users/{userId}",
      "DELETE /api/users/{userId}/accounts/{provider}/{providerAccountId}",
      "DELETE /api/users/{userId}/roles/{roleId}",
      "GET /api/users",
      "GET /api/users/{userId}",
      "GET /api/users/{userId}/accounts",
      "GET /api/users/{userId}/roles",
      "PATCH /api/users/{userId}",
      "PATCH /api/users/{userId}/password",
      "POST /api/users",
      "POST /api/users/{userId}/roles",
    ]);
  });

  it("operationIds follow the users.<verb> / users.<resource><Verb> pattern", () => {
    const ids = usersModule.operations.map(o => o.operationId).sort();
    expect(ids).toEqual([
      "users.assignRole",
      "users.create",
      "users.delete",
      "users.findById",
      "users.list",
      "users.listAccounts",
      "users.listRoles",
      "users.unassignRole",
      "users.unlinkAccount",
      "users.update",
      "users.updatePassword",
    ]);
  });

  it("every operation requires authentication (all three schemes)", () => {
    for (const op of usersModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  describe("GET /api/users", () => {
    const op = usersModule.operations.find(
      o => o.method === "GET" && o.path === "/api/users"
    )!;

    it("exposes the documented query parameters", () => {
      const names = op.parameters.map(p => p.name).sort();
      expect(names).toEqual([
        "createdAtFrom",
        "createdAtTo",
        "emailVerified",
        "hasPassword",
        "limit",
        "page",
        "search",
        "sortBy",
        "sortOrder",
      ]);
    });

    it("page + limit are integer query params", () => {
      const page = op.parameters.find(p => p.name === "page")!;
      const limit = op.parameters.find(p => p.name === "limit")!;
      expect(page.in).toBe("query");
      expect((page.schema as { type?: string }).type).toBe("integer");
      expect((limit.schema as { type?: string }).type).toBe("integer");
    });

    it("200 references ListResponseUser", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ListResponseUser",
      });
    });
  });

  describe("POST /api/users", () => {
    const op = usersModule.operations.find(
      o => o.method === "POST" && o.path === "/api/users"
    )!;

    it("requires a CreateUserRequest body", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/CreateUserRequest",
      });
    });

    it("201 references MutationResponseUser", () => {
      expect(op.responses["201"]).toBeDefined();
      const schema = (
        op.responses["201"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/MutationResponseUser",
      });
    });
  });

  describe("GET /api/users/{userId}", () => {
    const op = usersModule.operations.find(
      o => o.method === "GET" && o.path === "/api/users/{userId}"
    )!;

    it("has a required userId path parameter", () => {
      const userId = op.parameters.find(p => p.name === "userId")!;
      expect(userId.in).toBe("path");
      expect(userId.required).toBe(true);
    });

    it("200 returns a bare User (not an envelope)", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({ $ref: "#/components/schemas/User" });
    });

    it("404 references the NotFound response component", () => {
      expect(op.responses["404"]).toEqual({
        $ref: "#/components/responses/NotFound",
      });
    });
  });

  describe("PATCH /api/users/{userId}", () => {
    const op = usersModule.operations.find(
      o => o.method === "PATCH" && o.path === "/api/users/{userId}"
    )!;

    it("requires an UpdateUserRequest body", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/UpdateUserRequest",
      });
    });

    it("200 returns MutationResponseUser", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/MutationResponseUser",
      });
    });
  });

  describe("DELETE /api/users/{userId}", () => {
    const op = usersModule.operations.find(
      o => o.method === "DELETE" && o.path === "/api/users/{userId}"
    )!;

    it("200 returns MutationResponseUser (the deleted user is echoed back)", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/MutationResponseUser",
      });
    });
  });

  describe("PATCH /api/users/{userId}/password", () => {
    const op = usersModule.operations.find(
      o => o.path === "/api/users/{userId}/password"
    )!;

    it("requires UpdatePasswordRequest body (passwordHash)", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/UpdatePasswordRequest",
      });
    });

    it("200 returns ActionMessageResponse — silent { message } only", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ActionMessageResponse",
      });
    });
  });

  describe("GET /api/users/{userId}/accounts", () => {
    const op = usersModule.operations.find(
      o => o.method === "GET" && o.path === "/api/users/{userId}/accounts"
    )!;

    it("200 returns ListAccountsResponse (non-paginated)", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ListAccountsResponse",
      });
    });
  });

  describe("DELETE /api/users/{userId}/accounts/{provider}/{providerAccountId}", () => {
    const op = usersModule.operations.find(
      o =>
        o.method === "DELETE" &&
        o.path === "/api/users/{userId}/accounts/{provider}/{providerAccountId}"
    )!;

    it("declares the three required path parameters", () => {
      const names = op.parameters.map(p => p.name).sort();
      expect(names).toEqual(["provider", "providerAccountId", "userId"]);
      for (const p of op.parameters) {
        expect(p.in).toBe("path");
        expect(p.required).toBe(true);
      }
    });

    it("200 returns UnlinkAccountResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/UnlinkAccountResponse",
      });
    });
  });

  describe("POST /api/users/{userId}/roles", () => {
    const op = usersModule.operations.find(
      o => o.method === "POST" && o.path === "/api/users/{userId}/roles"
    )!;

    it("requires AssignRoleRequest body", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/AssignRoleRequest",
      });
    });

    it("200 returns AssignRoleResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/AssignRoleResponse",
      });
    });
  });

  describe("GET /api/users/{userId}/roles", () => {
    const op = usersModule.operations.find(
      o => o.method === "GET" && o.path === "/api/users/{userId}/roles"
    )!;

    it("200 returns ListUserRolesResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ListUserRolesResponse",
      });
    });
  });

  describe("DELETE /api/users/{userId}/roles/{roleId}", () => {
    const op = usersModule.operations.find(
      o => o.path === "/api/users/{userId}/roles/{roleId}"
    )!;

    it("requires userId and roleId path params", () => {
      const names = op.parameters.map(p => p.name).sort();
      expect(names).toEqual(["roleId", "userId"]);
    });

    it("200 returns UnassignRoleResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/UnassignRoleResponse",
      });
    });
  });

  describe("registered schemas", () => {
    const schemas = usersModule.schemas ?? {};

    it("registers every schema referenced by the operations", () => {
      const names = Object.keys(schemas).sort();
      expect(names).toEqual([
        "AccountLink",
        "ActionMessageResponse",
        "AssignRoleRequest",
        "AssignRoleResponse",
        "CreateUserRequest",
        "ListAccountsResponse",
        "ListResponseUser",
        "ListUserRolesResponse",
        "MutationResponseUser",
        "RoleRef",
        "UnassignRoleResponse",
        "UnlinkAccountResponse",
        "UpdatePasswordRequest",
        "UpdateUserRequest",
        "User",
      ]);
    });

    it("User schema requires id + email and never exposes passwordHash", () => {
      const schema = schemas.User as {
        type?: string;
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.type).toBe("object");
      expect(schema.required).toEqual(["id", "email"]);
      const propNames = Object.keys(schema.properties ?? {}).sort();
      expect(propNames).toEqual([
        "createdAt",
        "email",
        "emailVerified",
        "id",
        "image",
        "isActive",
        "name",
        "roles",
        "updatedAt",
      ]);
      expect(propNames).not.toContain("passwordHash");
      expect(propNames).not.toContain("password");
    });

    it("User.createdAt / updatedAt / emailVerified use format: 'date-time'", () => {
      const props = (
        schemas.User as {
          properties?: Record<string, { format?: string }>;
        }
      ).properties;
      expect(props?.createdAt?.format).toBe("date-time");
      expect(props?.updatedAt?.format).toBe("date-time");
      expect(props?.emailVerified?.format).toBe("date-time");
    });

    it("CreateUserRequest requires email + name (password is optional)", () => {
      const schema = schemas.CreateUserRequest as { required?: string[] };
      expect(schema.required).toEqual(["email", "name"]);
    });

    it("UpdateUserRequest is fully optional — no required fields", () => {
      const schema = schemas.UpdateUserRequest as { required?: string[] };
      expect(schema.required ?? []).toEqual([]);
    });

    it("ListResponseUser uses the shared PaginationMeta envelope", () => {
      const schema = schemas.ListResponseUser as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toEqual(["items", "meta"]);
      expect(schema.properties?.meta).toEqual({
        $ref: "#/components/schemas/PaginationMeta",
      });
    });

    it("AccountLink carries the documented columns", () => {
      const schema = schemas.AccountLink as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toEqual([
        "id",
        "userId",
        "provider",
        "providerAccountId",
        "type",
      ]);
    });

    it("UpdatePasswordRequest requires passwordHash", () => {
      const schema = schemas.UpdatePasswordRequest as { required?: string[] };
      expect(schema.required).toEqual(["passwordHash"]);
    });
  });
});
