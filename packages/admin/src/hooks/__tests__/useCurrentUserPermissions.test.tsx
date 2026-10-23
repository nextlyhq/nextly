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
  permissions: undefined as UserPermissionsResponse | Error | undefined,
  capabilities: undefined as CapabilitiesResponse | Error | undefined,
  asked: [] as string[],
}));

/** The content language the screen's `?locale=` names, if any. */
const onScreen = vi.hoisted(() => ({
  locale: undefined as string | undefined,
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: async (path: string) => {
      server.asked.push(path);
      if (path === "/me/permissions") {
        if (server.permissions instanceof Error) throw server.permissions;
        return server.permissions;
      }
      if (path.split("?")[0] === "/me/capabilities") {
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

vi.mock("../useLocaleParam", () => ({
  useLocaleParam: () => onScreen.locale,
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

/** How many times the server's answer about collections was asked for. */
const capabilityAsks = (): number =>
  server.asked.filter(p => p.split("?")[0] === "/me/capabilities").length;

/** The longest delay a browser timer holds without overflowing. */
const MAX_TIMER_MS = 2_147_483_647;

beforeEach(() => {
  server.permissions = EDITOR;
  server.capabilities = undefined;
  server.asked = [];
  onScreen.locale = undefined;
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

  it("offers no collection while the server's answer is missing, and keeps the permission answer", async () => {
    server.capabilities = new Error("capabilities unavailable");
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.content.isLoading).toBe(false));

    // A guard must not read the empty map as a refusal.
    expect(result.current.content.hasAnswer).toBe(false);
    expect(result.current.content.error).toBeInstanceOf(Error);
    expect(result.current.capabilities.collections).toEqual({});
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
    // The system sections are decided by the permission list, which did
    // arrive: a content-registry failure must not take them offline.
    expect(result.current.hasAnswer).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.hasPermission("read-posts")).toBe(true);
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
    expect(capabilityAsks()).toBeGreaterThan(before);
  });

  it("stops trusting an answer past its end when asking again fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    expect(result.current.canAccessCollection("posts", "read")).toBe(true);

    // The assignment ends and neither answer can be had again.
    server.capabilities = new Error("capabilities unavailable");
    server.permissions = new Error("permissions unavailable");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(result.current.content.error).not.toBeNull());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    // What the ended role allowed is no longer offered, and the failure is
    // not read as a refusal either.
    expect(result.current.content.hasAnswer).toBe(false);
    expect(result.current.hasAnswer).toBe(false);
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
    expect(result.current.hasPermission("read-posts")).toBe(false);
  });

  it("asks at an end further off than a timer holds, and not before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering(
      { read: true },
      Date.now() + MAX_TIMER_MS + 60_000
    );
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    const before = capabilityAsks();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TIMER_MS);
    });
    // Still a minute short of the end: nothing has changed to ask about.
    expect(capabilityAsks()).toBe(before);

    server.capabilities = answering({ read: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() =>
      expect(result.current.canAccessCollection("posts", "read")).toBe(false)
    );
  });

  it("shares one answer between callers instead of asking again for each", async () => {
    server.capabilities = answering({ read: true });
    const client = newClient();
    const first = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(first.result.current.content.hasAnswer).toBe(true)
    );
    const before = capabilityAsks();

    const second = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(second.result.current.content.hasAnswer).toBe(true)
    );

    // The answer covers every entity, so a component mounting is not a
    // reason to compute it again.
    expect(capabilityAsks()).toBe(before);
  });

  it("asks in the content language on screen, and again when it changes", async () => {
    onScreen.locale = "de";
    server.capabilities = answering({ read: true });
    const { result, rerender } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    expect(server.asked).toContain("/me/capabilities?locale=de");

    // A rule can answer by language, so another language is another answer.
    onScreen.locale = "fr";
    rerender();
    await waitFor(() =>
      expect(server.asked).toContain("/me/capabilities?locale=fr")
    );
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
