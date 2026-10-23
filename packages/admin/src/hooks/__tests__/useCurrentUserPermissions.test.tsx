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
  /** A delay for the next permissions request, which answers as asked. */
  permissionsDelayMs: 0,
  /** The same, for the next capabilities request. */
  capabilitiesDelayMs: 0,
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
        // Answered as the server stood when asked, however late it arrives.
        const asAsked = server.permissions;
        const delay = server.permissionsDelayMs;
        server.permissionsDelayMs = 0;
        if (delay > 0) await new Promise(done => setTimeout(done, delay));
        if (asAsked instanceof Error) throw asAsked;
        return asAsked;
      }
      if (path.split("?")[0] === "/me/capabilities") {
        const asAsked = server.capabilities;
        const delay = server.capabilitiesDelayMs;
        server.capabilitiesDelayMs = 0;
        if (delay > 0) await new Promise(done => setTimeout(done, delay));
        if (asAsked instanceof Error) throw asAsked;
        return asAsked;
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
  currentUserCapabilitiesKey,
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
  server.permissionsDelayMs = 0;
  server.capabilitiesDelayMs = 0;
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

  it("never counts an answer already past its end, not even before asking again", async () => {
    // Both answers are in the cache from before the role assignment ended,
    // as they are when a page mounts the hook after the end.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ended = Date.now() - 60_000;
    const before = { updatedAt: ended - 60_000 };
    client.setQueryData(CURRENT_USER_PERMISSIONS_KEY, EDITOR, before);
    client.setQueryData(
      currentUserCapabilitiesKey(undefined),
      answering({ read: true }, ended),
      before
    );
    server.capabilities = answering({ read: true });

    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });

    // The first render, before any request has answered.
    expect(result.current.content.hasAnswer).toBe(false);
    expect(result.current.hasAnswer).toBe(false);
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
    // Waited on, not refused: no current answer and no error is not a "no".
    expect(result.current.isLoading).toBe(true);
    expect(result.current.content.isLoading).toBe(true);
  });

  it("decides content from the server's answer, its super-admin verdict included", async () => {
    // The permission list still says super-admin; the content answer, asked
    // separately, no longer gives it.
    server.permissions = { ...EDITOR, isSuperAdmin: true };
    server.capabilities = answering({ read: false });
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
    expect(result.current.capabilities.collections.posts?.canRead).toBe(false);
    // POPULATION CONTROL: the system sections still follow the permission
    // list, which is what reports super-admin authority for them.
    expect(result.current.isSuperAdmin).toBe(true);
    expect(result.current.capabilities.canViewUsers).toBe(true);
  });

  it("gives a super-admin's answer every entity, one added since included", async () => {
    server.permissions = { ...EDITOR, isSuperAdmin: true };
    server.capabilities = { ...answering({}), isSuperAdmin: true };
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    expect(result.current.canAccessCollection("pages", "delete")).toBe(true);
    expect(result.current.capabilities.canViewCollections).toBe(true);
  });

  it("keeps an ended permission list out, though the content answer's refresh drops the end", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));

    // The ending assignment is gone: the content answer comes back with no
    // end at all, while the permission list cannot be had again.
    server.capabilities = answering({ read: true }, null);
    server.permissions = new Error("permissions unavailable");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    // POPULATION CONTROL: the content answer did arrive, with no end.
    expect(result.current.content.hasAnswer).toBe(true);
    // The permission list from before the end still does not count.
    expect(result.current.hasAnswer).toBe(false);
    expect(result.current.hasPermission("read-posts")).toBe(false);
  });

  it("asks again at the end, rather than taking a refresh asked before it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));

    // A refresh asked a second before the end, whose permission list arrives
    // two seconds later: after the end, though it describes the role before.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    server.permissionsDelayMs = 2_000;
    const asks = server.asked.length;
    await act(async () => {
      result.current.retry();
    });
    // POPULATION CONTROL: that refresh was asked before the change below.
    expect(server.asked.slice(asks)).toContain("/me/permissions");

    // From the end on, the permission list cannot be had again.
    server.permissions = new Error("permissions unavailable");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.hasAnswer).toBe(false);
    expect(result.current.hasPermission("read-posts")).toBe(false);
  });

  it("keeps an end an answer named, though a later answer drops it before it arrives", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));

    // A refresh a second before the end: the content answer comes back at
    // once with no end, and the permission list, as it stood then, after it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    server.capabilities = answering({ read: true }, null);
    server.permissionsDelayMs = 2_000;
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    // POPULATION CONTROL: the end is gone from the answer that named it.
    expect(capabilityAsks()).toBeGreaterThan(1);

    server.permissions = new Error("permissions unavailable");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.hasAnswer).toBe(false);
  });

  it("lets the slower half of a refresh at the end finish rather than restarting it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });

    // At the end the permission list answers at once and the content answer
    // three seconds later.
    server.capabilities = answering({ read: true }, null);
    server.capabilitiesDelayMs = 3_000;
    const before = capabilityAsks();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    // POPULATION CONTROL: the list's answer from after the end has landed.
    expect(result.current.hasAnswer).toBe(true);
    expect(capabilityAsks()).toBe(before + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    // Asked once at the end, and left to finish.
    expect(capabilityAsks()).toBe(before + 1);
  });

  it("asks again every minute while the content answer is missing, so an ended role is noticed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = new Error("capabilities unavailable");
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.content.error).not.toBeNull());
    expect(result.current.hasPermission("read-posts")).toBe(true);

    // The role ends, and no answer said when.
    server.permissions = { ...EDITOR, permissions: [] };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    await waitFor(() =>
      expect(result.current.hasPermission("read-posts")).toBe(false)
    );
  });

  it("stops counting an answer once a change invalidates it, until a new one arrives", async () => {
    server.capabilities = answering({ read: true });
    const client = newClient();
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    expect(result.current.canAccessCollection("posts", "read")).toBe(true);

    // A role change lands, and asking again fails for both.
    server.capabilities = new Error("capabilities unavailable");
    server.permissions = new Error("permissions unavailable");
    act(() => {
      invalidateCurrentUserAccess(client);
    });
    await waitFor(() => expect(result.current.content.error).not.toBeNull());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.content.hasAnswer).toBe(false);
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
    expect(result.current.hasAnswer).toBe(false);
  });

  it("decides content from the content answer when the permission list fails", async () => {
    server.permissions = new Error("permissions unavailable");
    server.capabilities = answering({ read: true });
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.canAccessCollection("posts", "read")).toBe(true);
    expect(result.current.capabilities.collections.posts?.canRead).toBe(true);
    // POPULATION CONTROL: the system half has no answer.
    expect(result.current.hasAnswer).toBe(false);
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
