// @vitest-environment jsdom
/**
 * The router-free permission check: what the signed-in user holds, read from
 * the same `/me/permissions` answer as `useCurrentUserPermissions`.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { answer } = vi.hoisted(() => ({
  answer: { current: { permissions: [] as string[], isSuperAdmin: false } },
}));

vi.mock("../current-user-permissions-query", () => ({
  CURRENT_USER_PERMISSIONS_KEY: ["currentUserPermissions"],
  fetchCurrentUserPermissions: () => Promise.resolve(answer.current),
}));

import { useHasPermission } from "../useHasPermission";

function check() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useHasPermission(), { wrapper });
}

describe("useHasPermission", () => {
  it("answers for the permissions the user holds, and no others", async () => {
    answer.current = {
      permissions: ["update-email-providers"],
      isSuperAdmin: false,
    };
    const { result } = check();
    await waitFor(() =>
      expect(result.current("update-email-providers")).toBe(true)
    );
    expect(result.current("delete-email-providers")).toBe(false);
  });

  it("answers yes for every permission to a super-admin", async () => {
    answer.current = { permissions: [], isSuperAdmin: true };
    const { result } = check();
    await waitFor(() => expect(result.current("anything-at-all")).toBe(true));
  });
});
