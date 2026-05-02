// Phase 4: regression tests for the user-dispatcher op-types beyond
// listUsers. One test per op-type pattern proves the handler returns
// the correct Response shape; new methods adopting the same pattern
// inherit the guarantee at the helper level (respondX is unit-tested
// in api/__tests__/response-shapes.test.ts).

import { describe, expect, it, vi } from "vitest";

import type { ServiceContainer } from "../../../services";
import { dispatchUser } from "../user-dispatcher";

describe("dispatchUser — single-doc reads (respondDoc)", () => {
  it("getUserById returns bare doc body", async () => {
    const fakeUser = { id: "u1", email: "a@example.com", name: "Alice" };
    const container = {
      users: { getUserById: vi.fn().mockResolvedValue(fakeUser) },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "getUserById",
      { userId: "u1" },
      undefined
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(fakeUser);
    // Regression guard: no { data } wrapper.
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });
});

describe("dispatchUser — mutations (respondMutation)", () => {
  it("createLocalUser returns { message, item } body and 201 status", async () => {
    const fakeUser = { id: "u3", email: "new@example.com" };
    const container = {
      users: { createLocalUser: vi.fn().mockResolvedValue(fakeUser) },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "createLocalUser",
      {},
      { email: "new@example.com" }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ message: "User created.", item: fakeUser });
    expect(body).not.toHaveProperty("data");
  });

  it("updateUser returns { message, item } body and 200 status", async () => {
    const fakeUser = { id: "u1", email: "a@example.com", name: "Alice2" };
    const container = {
      users: { updateUser: vi.fn().mockResolvedValue(fakeUser) },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "updateUser",
      { userId: "u1" },
      { name: "Alice2" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "User updated.", item: fakeUser });
  });

  it("deleteUser returns { message, item } body with the deleted doc", async () => {
    const fakeUser = { id: "u1", email: "a@example.com" };
    const container = {
      users: { deleteUser: vi.fn().mockResolvedValue(fakeUser) },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "deleteUser",
      { userId: "u1" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual({ message: "User deleted.", item: fakeUser });
  });
});

describe("dispatchUser — actions (respondAction)", () => {
  it("updatePasswordHash returns just { message } body", async () => {
    const container = {
      users: { updatePasswordHash: vi.fn().mockResolvedValue(undefined) },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "updatePasswordHash",
      { userId: "u1" },
      { passwordHash: "hashed-pw" }
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual({ message: "Password hash updated." });
  });

  it("unlinkAccountForUser returns { message, provider, providerAccountId }", async () => {
    const container = {
      users: { unlinkAccountForUser: vi.fn().mockResolvedValue(undefined) },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "unlinkAccountForUser",
      { userId: "u1", provider: "google", providerAccountId: "g123" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual({
      message: "Account unlinked.",
      provider: "google",
      providerAccountId: "g123",
    });
  });
});

describe("dispatchUser — bare data reads (respondData)", () => {
  it("getCurrentUserPermissions returns { permissions, isSuperAdmin, roles } body", async () => {
    // permissions library is a free function; mock via vi.mock dynamically would be
    // complex. Just call the dispatcher and verify the response shape — actual
    // permission resolution is tested in services/lib/permissions tests.
    // The mock here simulates an empty permission set.
    vi.doMock("../../../services/lib/permissions", () => ({
      isSuperAdmin: vi.fn().mockResolvedValue(false),
      listEffectivePermissions: vi.fn().mockResolvedValue([]),
      listRoleSlugsForUser: vi.fn().mockResolvedValue([]),
    }));

    // Re-import after mocking
    const { dispatchUser: dispatchUserMocked } = await import(
      "../user-dispatcher"
    );

    const container = {
      users: {},
    } as unknown as ServiceContainer;

    const result = await dispatchUserMocked(
      container,
      "getCurrentUserPermissions",
      { userId: "u1" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toHaveProperty("permissions");
    expect(body).toHaveProperty("isSuperAdmin");
    expect(body).toHaveProperty("roles");
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("message");

    vi.doUnmock("../../../services/lib/permissions");
  });

  it("hasPassword returns { hasPassword: boolean } body (no Boolean-only)", async () => {
    const container = {
      users: { hasPassword: vi.fn().mockResolvedValue(true) },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "hasPassword",
      { userId: "u1" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual({ hasPassword: true });
  });

  it("getAccounts returns { accounts: [...] } body", async () => {
    const fakeAccounts = [
      { id: "a1", provider: "google" },
      { id: "a2", provider: "github" },
    ];
    const container = {
      users: { getAccounts: vi.fn().mockResolvedValue(fakeAccounts) },
    } as unknown as ServiceContainer;

    const result = await dispatchUser(
      container,
      "getAccounts",
      { userId: "u1" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual({ accounts: fakeAccounts });
  });
});
