// Phase 4: regression tests for auth + rbac dispatcher op-types beyond
// listRoles. One test per op-type pattern; new methods adopting the
// same pattern inherit shape correctness from the respondX helpers
// (covered in api/__tests__/response-shapes.test.ts).

import { describe, expect, it, vi } from "vitest";

import type { ServiceContainer } from "../../../services";
import { dispatchAuth, dispatchRbac } from "../auth-dispatcher";

describe("dispatchAuth — actions", () => {
  it("registerUser returns { message, item } body and 201 status", async () => {
    const fakeUser = { id: "u1", email: "new@example.com" };
    const container = {
      auth: { registerUser: vi.fn().mockResolvedValue(fakeUser) },
    } as unknown as ServiceContainer;

    const result = await dispatchAuth(
      container,
      "registerUser",
      {},
      { email: "new@example.com", password: "Pass1234!" }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ message: "Account created.", item: fakeUser });
  });

  it("verifyCredentials returns { user } body via respondData", async () => {
    const fakeUser = { id: "u1", email: "a@example.com" };
    const container = {
      auth: { verifyCredentials: vi.fn().mockResolvedValue(fakeUser) },
    } as unknown as ServiceContainer;

    const result = await dispatchAuth(
      container,
      "verifyCredentials",
      {},
      { email: "a@example.com", password: "Pass1234!" }
    );

    const body = await (result as Response).json();
    expect(body).toEqual({ user: fakeUser });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("message");
  });

  it("changePassword returns just { message } body", async () => {
    const container = {
      auth: { changePassword: vi.fn().mockResolvedValue(undefined) },
    } as unknown as ServiceContainer;

    const result = await dispatchAuth(
      container,
      "changePassword",
      { userId: "u1" },
      { currentPassword: "old", newPassword: "new" }
    );

    const body = await (result as Response).json();
    expect(body).toEqual({ message: "Password changed." });
  });

  it("generatePasswordResetToken returns generic message (no leak)", async () => {
    const container = {
      auth: {
        generatePasswordResetToken: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as ServiceContainer;

    const result = await dispatchAuth(
      container,
      "generatePasswordResetToken",
      {},
      { email: "a@example.com" }
    );

    const body = (await (result as Response).json()) as { message: string };
    expect(body.message).toMatch(/^If an account exists/);
    // Critical: do not echo the email back in the message
    expect(body.message).not.toContain("a@example.com");
  });
});

describe("dispatchRbac — single-doc reads (respondDoc)", () => {
  it("getRoleById returns bare doc body", async () => {
    const fakeRole = { id: "r1", name: "Admin", level: 100 };
    const container = {
      roles: { getRoleById: vi.fn().mockResolvedValue(fakeRole) },
      permissions: {},
    } as unknown as ServiceContainer;

    const result = await dispatchRbac(
      container,
      "getRoleById",
      { roleId: "r1" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual(fakeRole);
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });
});

describe("dispatchRbac — paginated lists (respondList)", () => {
  it("listPermissions returns { items, meta } body", async () => {
    const fakePerms = [
      { id: "p1", action: "read", resource: "users" },
      { id: "p2", action: "write", resource: "users" },
    ];
    const fakeServiceResult = {
      data: fakePerms,
      meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
    };
    const container = {
      permissions: {
        listPermissions: vi.fn().mockResolvedValue(fakeServiceResult),
      },
      roles: {},
    } as unknown as ServiceContainer;

    const result = await dispatchRbac(
      container,
      "listPermissions",
      { page: "1", limit: "10" },
      undefined
    );

    const body = await (result as Response).json();
    expect(body).toEqual({
      items: fakePerms,
      meta: {
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
  });
});

describe("dispatchRbac — non-paginated lists (respondData)", () => {
  it("listRolePermissions returns { permissions: [...] } body", async () => {
    const fakePerms = [{ id: "p1", action: "read", resource: "users" }];
    const container = {
      rolePermissions: {
        listRolePermissions: vi.fn().mockResolvedValue(fakePerms),
      },
      roles: {},
      permissions: {},
    } as unknown as ServiceContainer;

    const result = await dispatchRbac(
      container,
      "listRolePermissions",
      { roleId: "r1" },
      undefined
    );

    const body = await (result as Response).json();
    expect(body).toEqual({ permissions: fakePerms });
  });

  it("listUserRoles returns { roles: [...] } body", async () => {
    const fakeRoles = [{ id: "r1", name: "Admin" }];
    const container = {
      userRoles: { listUserRoles: vi.fn().mockResolvedValue(fakeRoles) },
      roles: {},
      permissions: {},
    } as unknown as ServiceContainer;

    const result = await dispatchRbac(
      container,
      "listUserRoles",
      { userId: "u1" },
      undefined
    );

    const body = await (result as Response).json();
    expect(body).toEqual({ roles: fakeRoles });
  });
});

describe("dispatchRbac — mutations (respondMutation)", () => {
  it("createRole returns { message, item } body and 201 status", async () => {
    const fakeRole = { id: "r2", name: "Editor", slug: "editor" };
    const container = {
      roles: { createRole: vi.fn().mockResolvedValue(fakeRole) },
      permissions: {},
    } as unknown as ServiceContainer;

    const result = await dispatchRbac(
      container,
      "createRole",
      {},
      { name: "Editor", slug: "editor", permissionIds: ["p1"] }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ message: "Role created.", item: fakeRole });
  });
});

describe("dispatchRbac — actions (respondAction)", () => {
  it("assignRoleToUser returns { message, userId, roleId } body", async () => {
    const container = {
      userRoles: { assignRoleToUser: vi.fn().mockResolvedValue({}) },
      roles: {},
      permissions: {},
    } as unknown as ServiceContainer;

    const result = await dispatchRbac(
      container,
      "assignRoleToUser",
      { userId: "u1", roleId: "r1" },
      undefined
    );

    const body = await (result as Response).json();
    expect(body).toMatchObject({
      message: "Role assigned to user.",
      userId: "u1",
      roleId: "r1",
    });
  });

  it("setRolePermissions returns count metadata", async () => {
    const container = {
      rolePermissions: {
        setRolePermissions: vi.fn().mockResolvedValue(undefined),
      },
      roles: {},
      permissions: {},
    } as unknown as ServiceContainer;

    const result = await dispatchRbac(
      container,
      "setRolePermissions",
      { roleId: "r1" },
      { permissionIds: ["p1", "p2", "p3"] }
    );

    const body = await (result as Response).json();
    expect(body).toEqual({
      message: "Role permissions updated.",
      roleId: "r1",
      permissionCount: 3,
    });
  });
});
