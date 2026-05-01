// Phase 4: pin the listRoles wire shape so the canonical
// `{ items, meta }` body cannot regress. Same migration story as
// user-dispatcher-list-users: the original PR #125 fix wrapped via
// `{ statusCode, data, meta }`; Phase 4 finishes by switching to a
// Response built via respondList.

import { describe, expect, it, vi } from "vitest";

import type { ServiceContainer } from "../../../services";
import { dispatchRbac } from "../auth-dispatcher";

describe("dispatchRbac('listRoles')", () => {
  it("returns a Response with { items, meta } body and 200 status", async () => {
    const fakeRoles = [
      {
        id: "r1",
        name: "Super Admin",
        slug: "super-admin",
        description: null,
        level: 1000,
        isSystem: true,
        childRoleIds: [],
      },
    ];
    const fakeServiceResult = {
      data: fakeRoles,
      meta: { total: 1, page: 1, pageSize: 10, totalPages: 1 },
    };

    const listRolesMock = vi.fn().mockResolvedValue(fakeServiceResult);

    const container = {
      roles: { listRoles: listRolesMock },
      permissions: {},
      access: {},
    } as unknown as ServiceContainer;

    const result = await dispatchRbac(
      container,
      "listRoles",
      { page: "1", pageSize: "10" },
      undefined
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      items: fakeRoles,
      meta: {
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });

    expect(listRolesMock).toHaveBeenCalledTimes(1);
    expect(listRolesMock.mock.calls[0]?.[0]).toMatchObject({
      page: 1,
      pageSize: 10,
    });
  });

  it("does NOT double-wrap items (regression guard)", async () => {
    const fakeRoles = [{ id: "r1", name: "Super Admin", level: 1000 }];
    const fakeServiceResult = {
      data: fakeRoles,
      meta: { total: 1, page: 1, pageSize: 10, totalPages: 1 },
    };

    const container = {
      roles: {
        listRoles: vi.fn().mockResolvedValue(fakeServiceResult),
      },
      permissions: {},
      access: {},
    } as unknown as ServiceContainer;

    const result = await dispatchRbac(
      container,
      "listRoles",
      { page: "1", pageSize: "10" },
      undefined
    );

    const body = (await (result as Response).json()) as {
      items: unknown;
      meta?: unknown;
    };

    expect(Array.isArray(body.items)).toBe(true);
    expect(body).not.toHaveProperty("data");
    expect(body.items).not.toMatchObject({ data: expect.anything() });
  });
});
