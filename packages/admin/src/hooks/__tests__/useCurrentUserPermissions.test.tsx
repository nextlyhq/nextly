/**
 * What the admin believes the signed-in user may do with each collection and
 * Single: the server's answer from `/me/capabilities`, beside the permission
 * slugs from `/me/permissions` that still decide the system sections.
 *
 * The property that separates the hook from a plausible broken one is that a
 * collection's access follows the server even where the slugs say otherwise,
 * as they do when a collection's code rule refuses what a role's permission
 * allows. A hook still reading the slugs passes every case where the two
 * agree.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CapabilitiesResponse,
  UserPermissionsResponse,
} from "../../types/permissions";

const server = vi.hoisted(() => ({
  permissions: undefined as UserPermissionsResponse | undefined,
  capabilities: undefined as CapabilitiesResponse | Error | undefined,
  asked: [] as string[],
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: async (path: string) => {
      server.asked.push(path);
      if (path === "/me/permissions") return server.permissions;
      if (path === "/me/capabilities") {
        if (server.capabilities instanceof Error) throw server.capabilities;
        return server.capabilities;
      }
      throw new Error(`unexpected request ${path}`);
    },
  },
}));

vi.mock("../useRouter", () => ({
  useRouter: () => ({ route: { routeType: "private" } }),
}));

import {
  CURRENT_USER_CAPABILITIES_KEY,
  CURRENT_USER_PERMISSIONS_KEY,
  invalidateCurrentUserAccess,
} from "../current-user-access";
import { useCurrentUserPermissions } from "../useCurrentUserPermissions";

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

/** A user whose role holds read and update on posts. */
const EDITOR: UserPermissionsResponse = {
  permissions: ["read-posts", "update-posts"],
  isSuperAdmin: false,
  roles: ["editor"],
};

const answering = (
  posts: Partial<CapabilitiesResponse["entities"][string]>,
  validUntil: number | null = null
): CapabilitiesResponse => ({
  isSuperAdmin: false,
  validUntil,
  entities: {
    posts: {
      kind: "collection",
      read: false,
      create: false,
      update: false,
      delete: false,
      publish: false,
      unpublish: false,
      ...posts,
    },
  },
});

beforeEach(() => {
  server.permissions = EDITOR;
  server.capabilities = undefined;
  server.asked = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCurrentUserPermissions", () => {
  it("follows the server where a code rule refuses what the role's permission allows", async () => {
    // The role holds read-posts; the collection's rule refuses the read.
    server.capabilities = answering({ read: false, update: false });
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));

    expect(result.current.capabilities.collections.posts?.canRead).toBe(false);
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
    expect(result.current.capabilities.canViewCollections).toBe(false);
    // POPULATION CONTROL: the slug is held, so a slug reader would allow.
    expect(result.current.hasPermission("read-posts")).toBe(true);
  });

  it("allows what the server allows, publish included", async () => {
    server.capabilities = answering({ read: true, publish: true });
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));

    expect(result.current.canAccessCollection("posts", "read")).toBe(true);
    expect(result.current.canAccessCollection("posts", "publish")).toBe(true);
    expect(result.current.canAccessCollection("posts", "delete")).toBe(false);
    expect(result.current.canAccessCollection("pages", "read")).toBe(false);
  });

  it("has no answer, and offers no collection, while the server's answer is missing", async () => {
    server.capabilities = new Error("capabilities unavailable");
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A guard must not read the empty map as a refusal.
    expect(result.current.hasAnswer).toBe(false);
    expect(result.current.capabilities.collections).toEqual({});
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
  });

  it("asks again when the soonest role assignment ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));
    const before = server.asked.filter(p => p === "/me/capabilities").length;

    // The assignment ends: the answer no longer gives the read.
    server.capabilities = answering({ read: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() =>
      expect(result.current.canAccessCollection("posts", "read")).toBe(false)
    );
    expect(
      server.asked.filter(p => p === "/me/capabilities").length
    ).toBeGreaterThan(before);
  });
});

describe("invalidateCurrentUserAccess", () => {
  it("asks for both the permissions and the capabilities again", () => {
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    invalidateCurrentUserAccess(client);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CURRENT_USER_PERMISSIONS_KEY,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CURRENT_USER_CAPABILITIES_KEY,
    });
  });
});
