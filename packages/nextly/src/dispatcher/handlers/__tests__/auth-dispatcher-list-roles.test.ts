// Pins the listRoles dispatcher response shape so the
// "{ data: { data, meta } }" double-nest bug cannot regress.
//
// Same root cause as the listUsers fix in the sibling test:
// RoleQueryService.listRoles returns the raw `{ data, meta }`
// shape with no `statusCode` field, so the dispatcher's smart-
// extraction path skipped it and the dumb fallback wrapped the
// whole object as `data`. End-user impact: the admin user-detail
// page's "Roles" dropdown showed "Failed to load roles. Please
// try again." because the client expected `data: Role[]` and got
// `data: { data: Role[], meta: {...} }`.

import { describe, expect, it, vi } from "vitest";

import type { ServiceContainer } from "../../../services";
import { dispatchRbac } from "../auth-dispatcher";

describe("dispatchRbac('listRoles')", () => {
  it("returns { statusCode, data, meta } so the framework single-wraps the response", async () => {
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
    const fakeMeta = { total: 1, page: 1, pageSize: 10, totalPages: 1 };

    const listRolesMock = vi.fn().mockResolvedValue({
      data: fakeRoles,
      meta: fakeMeta,
    });

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

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      data: fakeRoles,
      meta: fakeMeta,
    });

    expect(listRolesMock).toHaveBeenCalledTimes(1);
    expect(listRolesMock.mock.calls[0]?.[0]).toMatchObject({
      page: 1,
      pageSize: 10,
    });
  });

  it("does NOT double-wrap data (regression guard for the user-reported bug)", async () => {
    const fakeRoles = [{ id: "r1", name: "Super Admin", level: 1000 }];
    const fakeMeta = { total: 1, page: 1, pageSize: 10, totalPages: 1 };

    const container = {
      roles: {
        listRoles: vi.fn().mockResolvedValue({
          data: fakeRoles,
          meta: fakeMeta,
        }),
      },
      permissions: {},
      access: {},
    } as unknown as ServiceContainer;

    const result = (await dispatchRbac(
      container,
      "listRoles",
      { page: "1", pageSize: "10" },
      undefined
    )) as { data: unknown };

    // Bug shape: result.data === { data: [...], meta: {...} }.
    // Fix: result.data is the role array directly.
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).not.toMatchObject({ data: expect.anything() });
  });
});
