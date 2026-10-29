/**
 * `nextly upgrade` converts every role holding a retired `manage-` permission
 * and checks the scheduled releases once, after the last, not once a role.
 */
import { describe, expect, it, vi } from "vitest";

const recheck = vi.hoisted(() => vi.fn(async () => undefined));
const convert = vi.hoisted(() =>
  vi.fn(async (_roleId: string, _options?: { recheckReleases?: boolean }) => true)
);

vi.mock("../../../../domains/auth/retired-manage", () => ({
  rolesHoldingRetiredManage: async () =>
    ["a", "b", "c"].map(id => ({ id, name: id, permissions: ["manage-media"] })),
}));
vi.mock("../../../../domains/auth/services/role-permission-service", () => ({
  RolePermissionService: class {
    convertRetiredManage = convert;
  },
}));
vi.mock("../../../../domains/auth/services/role-grants-changed", () => ({
  afterGrantsChanged: recheck,
}));

const { convertRoles } = await import("../retired-manage");

describe("converting roles holding a retired manage permission", () => {
  it("converts each role and checks the scheduled releases once", async () => {
    const context = {
      adapter: {},
      warn: vi.fn(),
    } as unknown as Parameters<typeof convertRoles>[0];

    expect(await convertRoles(context)).toBe(3);
    expect(convert).toHaveBeenCalledTimes(3);
    for (const call of convert.mock.calls) {
      expect(call[1]).toEqual({ recheckReleases: false });
    }
    expect(recheck).toHaveBeenCalledTimes(1);
  });
});
