/**
 * What the role form loads for the roles screen's rows: the list of
 * collections and Singles, and which base role gives which permission.
 *
 * A failed load must leave the form in an error state rather than asking
 * again at once, and a role built on several bases (possible through the API)
 * must credit each grant to the base that gives it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: vi.fn() },
}));

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../../services/roleApi", () => ({
  roleApi: {
    getRoleDetails: vi.fn(),
    updateRole: vi.fn(async () => undefined),
    updateRolePermissions: vi.fn(async () => undefined),
    createRole: vi.fn(async () => undefined),
    fetchRoles: vi.fn(),
  },
}));

import { protectedApi } from "@admin/lib/api/protectedApi";

import { roleApi } from "../../services/roleApi";
import { useRoleForm } from "../useRoleForm";

function render(roleId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(() => useRoleForm(roleId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

/** How many times `path` was asked for. */
function askedFor(path: string): number {
  return vi
    .mocked(protectedApi.get)
    .mock.calls.filter(([asked]) => String(asked).startsWith(path)).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(roleApi.fetchRoles).mockResolvedValue({ items: [] } as never);
});

describe("useRoleForm's roles screen data", () => {
  it("stays in its error after a failed list of collections and Singles, rather than asking again", async () => {
    vi.mocked(protectedApi.get).mockImplementation(async path =>
      String(path).startsWith("/roles/screen")
        ? Promise.reject(new Error("registry unreadable"))
        : { items: [] }
    );

    const { result } = render();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // Long enough for a loop to have asked again several times.
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(askedFor("/roles/screen")).toBe(1);
  });

  it("reads every page of permissions, so an entity on a later page gets its row's permissions", async () => {
    const permission = (resource: string) => ({
      id: `read-${resource}`,
      name: null,
      action: "read",
      resource,
      description: null,
      owner: null,
    });
    vi.mocked(protectedApi.get).mockImplementation(async path => {
      const asked = String(path);
      if (asked.startsWith("/roles/screen")) {
        return {
          items: ["posts", "tags"].map(slug => ({
            slug,
            kind: "collection",
            labels: { singular: slug },
            plugin: null,
            declaredRules: [],
          })),
        };
      }
      if (asked.startsWith("/permissions")) {
        const second = asked.includes("page=2");
        return {
          items: [permission(second ? "tags" : "posts")],
          meta: { hasNext: !second },
        };
      }
      return { items: [] };
    });

    const { result } = render();

    await waitFor(() => expect(result.current.levelRows).toHaveLength(2));
    await waitFor(() =>
      expect(
        result.current.levelRows.map(row => row.permissions.length)
      ).toEqual([1, 1])
    );
  });

  it("credits each base role with the permissions it gives, not the first base with all of them", async () => {
    vi.mocked(protectedApi.get).mockResolvedValue({ items: [] });
    vi.mocked(roleApi.fetchRoles).mockResolvedValue({
      items: [
        { id: "base-1", roleName: "Editor", slug: "editor", permissions: [] },
        { id: "base-2", roleName: "Author", slug: "author", permissions: [] },
      ],
    } as never);
    vi.mocked(roleApi.getRoleDetails).mockResolvedValue({
      role: {
        id: "role-1",
        roleName: "Content team",
        slug: "content-team",
        description: "",
        type: "Custom",
        permissions: [],
      },
      childRoleIds: ["base-1", "base-2"],
      childRolePermissionsMap: { "base-1": ["p1"], "base-2": ["p2"] },
    } as never);

    const { result } = render("role-1");

    await waitFor(() => expect(result.current.baseGrants).toHaveLength(2));
    expect(
      result.current.baseGrants.map(base => [base.name, [...base.ids]])
    ).toEqual([
      ["Editor", ["p1"]],
      ["Author", ["p2"]],
    ]);
  });
});
