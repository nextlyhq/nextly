import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCan } from "../useCan";

const mockPerms = vi.fn();
vi.mock("../useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => mockPerms(),
}));

describe("useCan", () => {
  it("returns true when the user holds the permission", () => {
    mockPerms.mockReturnValue({
      hasPermission: (s: string) => s === "manage-seo",
      isSuperAdmin: false,
    });
    const { result } = renderHook(() => useCan("manage-seo"));
    expect(result.current).toBe(true);
  });

  it("returns false when the user lacks the permission", () => {
    mockPerms.mockReturnValue({
      hasPermission: () => false,
      isSuperAdmin: false,
    });
    const { result } = renderHook(() => useCan("manage-seo"));
    expect(result.current).toBe(false);
  });

  it("returns true for a super-admin (delegates to hasPermission)", () => {
    mockPerms.mockReturnValue({
      hasPermission: () => true,
      isSuperAdmin: true,
    });
    const { result } = renderHook(() => useCan("anything-here"));
    expect(result.current).toBe(true);
  });

  it("returns false while permissions are still loading", () => {
    // During load hasPermission returns false (perms empty, not super-admin).
    mockPerms.mockReturnValue({
      hasPermission: () => false,
      isSuperAdmin: false,
    });
    const { result } = renderHook(() => useCan("manage-seo"));
    expect(result.current).toBe(false);
  });
});
