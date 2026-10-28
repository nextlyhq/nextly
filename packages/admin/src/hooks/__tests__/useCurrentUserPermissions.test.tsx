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
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
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
  /** Held until released, for the next capabilities request. */
  capabilitiesGate: null as Promise<void> | null,
  /** The same, for the next permissions request. */
  permissionsGate: null as Promise<void> | null,
}));

/** The content language the screen's `?locale=` names, if any. */
const onScreen = vi.hoisted(() => ({
  locale: undefined as string | undefined,
  pathname: "/admin",
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: async (path: string) => {
      server.asked.push(path);
      if (path === "/me/permissions") {
        // Answered as the server stood when asked, however late it arrives.
        const asAsked = server.permissions;
        const delay = server.permissionsDelayMs;
        const gate = server.permissionsGate;
        server.permissionsDelayMs = 0;
        server.permissionsGate = null;
        if (delay > 0) await new Promise(done => setTimeout(done, delay));
        if (gate) await gate;
        if (asAsked instanceof Error) throw asAsked;
        return asAsked;
      }
      if (path.split("?")[0] === "/me/capabilities") {
        const asAsked = server.capabilities;
        const delay = server.capabilitiesDelayMs;
        const gate = server.capabilitiesGate;
        server.capabilitiesDelayMs = 0;
        server.capabilitiesGate = null;
        if (delay > 0) await new Promise(done => setTimeout(done, delay));
        if (gate) await gate;
        if (asAsked instanceof Error) throw asAsked;
        return asAsked;
      }
      throw new Error(`unexpected request ${path}`);
    },
  },
}));

vi.mock("../useRouter", () => ({
  useRouter: () => ({
    route: { routeType: "private" },
    pathname: onScreen.pathname,
  }),
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
import {
  namedEndsAfter,
  useCurrentUserPermissions,
} from "../useCurrentUserPermissions";
import { editsOffered, useUpdateAnswer } from "../useUpdateAnswer";

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
  server.capabilitiesGate = null;
  server.permissionsGate = null;
  onScreen.locale = undefined;
  onScreen.pathname = "/admin";
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

  it("keeps an end an answer named, though an answer given after it drops it before its timer runs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const end = Date.now() + 60_000;
    server.capabilities = answering({ read: true }, end);
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });

    // A refresh a second before the end. Its content answer, with no end, is
    // held until the clock has passed the end while the end's own timer has
    // not run, as in a throttled tab; its permission list, as the role stood
    // when asked, comes later still.
    let release = (): void => {};
    server.capabilitiesGate = new Promise(done => {
      release = done;
    });
    server.capabilities = answering({ read: true }, null);
    server.permissionsDelayMs = 2_000;
    await act(async () => {
      result.current.retry();
    });
    vi.setSystemTime(end + 500);
    server.permissions = new Error("permissions unavailable");
    await act(async () => {
      release();
    });
    // POPULATION CONTROL: the answer given after the end, with none, landed.
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.hasAnswer).toBe(false);
  });

  it("retires an end that a newer answer, given before it, no longer names", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    const client = newClient();
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));

    // Half-way there, the ending assignment is extended: the new answer
    // names no end.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    server.capabilities = answering({ read: true }, null);
    await act(async () => {
      invalidateCurrentUserAccess(client);
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));

    // Past the old end, nothing is asked again: the answers in hand stand.
    server.permissions = new Error("permissions unavailable");
    const asked = capabilityAsks();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(capabilityAsks()).toBe(asked);
    expect(result.current.hasAnswer).toBe(true);
    expect(result.current.hasPermission("read-posts")).toBe(true);
  });

  it("keeps an end learned in one language when an older answer in another is restored", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A client that keeps a language's answer once nothing shows it, as the
    // app's does, so switching back restores it from the cache.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    onScreen.locale = "fr";
    server.capabilities = answering({ read: true }, null);
    const { result, rerender } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    // In German, the answer names an assignment that ends in a minute.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    onScreen.locale = "de";
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    rerender();
    await waitFor(() =>
      expect(server.asked).toContain("/me/capabilities?locale=de")
    );
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    // Back to French, whose older answer named no end.
    onScreen.locale = "fr";
    rerender();
    server.permissions = new Error("permissions unavailable");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    // The permission list from before the end no longer counts.
    expect(result.current.hasAnswer).toBe(false);
  });

  it("judges an answer by when it was asked, not when it arrived", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const end = Date.now() + 60_000;
    server.capabilities = answering({ read: true }, end);
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });

    // A refresh asked a second before the end, both of whose answers arrive
    // after it, together, before the end's own timer has run, as in a
    // throttled tab. The content answer names no end any more.
    let release = (): void => {};
    const held = new Promise<void>(done => {
      release = done;
    });
    server.capabilitiesGate = held;
    server.permissionsGate = held;
    server.capabilities = answering({ read: true }, null);
    await act(async () => {
      result.current.retry();
    });
    vi.setSystemTime(end + 500);
    server.permissions = new Error("permissions unavailable");
    await act(async () => {
      release();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    // The permission list was asked before the end, so it is asked again,
    // and that fails.
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.hasAnswer).toBe(false);
  });

  it("keeps an ended permission list out for a caller mounted after the end", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    const client = newClient();
    const first = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(first.result.current.hasAnswer).toBe(true));

    // At the end the content answer comes back with no end, and the
    // permission list cannot be had again.
    server.capabilities = answering({ read: true }, null);
    server.permissions = new Error("permissions unavailable");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(first.result.current.error).not.toBeNull());

    // A guard mounted after the end, as a page opened then mounts one.
    const later = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    expect(later.result.current.hasAnswer).toBe(false);
    expect(later.result.current.hasPermission("read-posts")).toBe(false);
  });

  it("asks again in a language returned to after a newer answer in another", async () => {
    // A client that keeps a language's answer once nothing shows it, as the
    // app's does, so switching back would restore it from the cache.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    onScreen.locale = "fr";
    server.capabilities = answering({ read: true });
    const { result, rerender } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    onScreen.locale = "de";
    rerender();
    await waitFor(() =>
      expect(server.asked).toContain("/me/capabilities?locale=de")
    );

    // A rule changes, and the German answer is asked again and refuses.
    server.capabilities = answering({ read: false });
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() =>
      expect(result.current.canAccessCollection("posts", "read")).toBe(false)
    );

    // Back to French: its older cached answer is not restored as current.
    const frenchAsks = server.asked.filter(
      p => p === "/me/capabilities?locale=fr"
    ).length;
    onScreen.locale = "fr";
    rerender();
    await waitFor(() =>
      expect(
        server.asked.filter(p => p === "/me/capabilities?locale=fr").length
      ).toBe(frenchAsks + 1)
    );
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
  });

  it("does not ask a failed answer again for each caller that mounts", async () => {
    server.capabilities = new Error("capabilities unavailable");
    const client = newClient();
    const first = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(first.result.current.content.error).not.toBeNull()
    );
    const before = capabilityAsks();

    // Two more callers mount, as a system page's children would.
    const second = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    // POPULATION CONTROL: the new callers see the failure, not a fresh ask.
    expect(second.result.current.content.error).not.toBeNull();
    // A mount's retry would be asked as the callers mount; let it settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(capabilityAsks()).toBe(before);
  });

  it("does not let another language's older request revive its answer", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    onScreen.locale = "fr";
    server.capabilities = answering({ read: true });
    const { result, rerender } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    // French is asked again and its answer held, while German answers after
    // a rule change.
    let release = (): void => {};
    server.capabilitiesGate = new Promise(done => {
      release = done;
    });
    await act(async () => {
      result.current.retry();
    });
    server.capabilities = answering({ read: false });
    onScreen.locale = "de";
    rerender();
    // German's answer itself: before it arrives nothing is allowed either, and
    // a French request landing then has no newer answer to be older than.
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
    // The held French request now lands, with what it saw before the change.
    await act(async () => {
      release();
    });

    // Back to French: it is asked again rather than restored from that.
    const frenchAsks = server.asked.filter(
      p => p === "/me/capabilities?locale=fr"
    ).length;
    onScreen.locale = "fr";
    rerender();
    await waitFor(() =>
      expect(
        server.asked.filter(p => p === "/me/capabilities?locale=fr").length
      ).toBe(frenchAsks + 1)
    );
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
  });

  it("leaves a newer language's answer alone when returning to an older one fails", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    onScreen.locale = "fr";
    server.capabilities = answering({ read: true });
    const { result, rerender } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    // German answers later, which marks French stale.
    onScreen.locale = "de";
    rerender();
    await waitFor(() =>
      expect(server.asked).toContain("/me/capabilities?locale=de")
    );
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    // Back to French during an outage: its refresh fails.
    server.capabilities = new Error("capabilities unavailable");
    onScreen.locale = "fr";
    rerender();
    await waitFor(() => expect(result.current.content.error).not.toBeNull());

    // German's answer, newer than anything French had, still counts.
    onScreen.locale = "de";
    rerender();
    expect(result.current.content.hasAnswer).toBe(true);
    expect(result.current.canAccessCollection("posts", "read")).toBe(true);
  });

  it("asks the permission list again on the schedule when only its refresh failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true });
    const client = newClient();
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));

    // A role change: the content answer comes back, the permission list
    // cannot be had.
    server.permissions = new Error("permissions unavailable");
    act(() => {
      invalidateCurrentUserAccess(client);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    // POPULATION CONTROL: the content half answered.
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    expect(result.current.hasAnswer).toBe(false);

    // The endpoint recovers; the next scheduled ask brings the list back.
    server.permissions = EDITOR;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));
  });

  it("keeps asking on the schedule after a change's refresh fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true });
    const client = newClient();
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    // A role change lands and the content answer cannot be had again.
    server.capabilities = new Error("capabilities unavailable");
    act(() => {
      invalidateCurrentUserAccess(client);
    });
    await waitFor(() => expect(result.current.content.error).not.toBeNull());
    expect(result.current.content.hasAnswer).toBe(false);

    // The endpoint recovers; the next scheduled ask brings the answer back.
    server.capabilities = answering({ read: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
  });

  it("does not let a first request asked before a change stand in for the refresh", async () => {
    // The first content request is under way, answering as roles stood.
    let release = (): void => {};
    server.capabilitiesGate = new Promise(done => {
      release = done;
    });
    server.capabilities = answering({ read: true });
    const client = newClient();
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(capabilityAsks()).toBe(1));

    // A role change lands meanwhile, and the server now refuses the read.
    server.capabilities = answering({ read: false });
    await act(async () => {
      invalidateCurrentUserAccess(client);
    });
    await act(async () => {
      release();
    });

    // A request asked after the change decides, not the one before it.
    await waitFor(() => expect(capabilityAsks()).toBe(2));
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    expect(result.current.canAccessCollection("posts", "read")).toBe(false);
  });

  it("asks once at an end, however many callers are mounted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.capabilities = answering({ read: true }, Date.now() + 60_000);
    const client = newClient();
    const guard = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    const sidebar = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(guard.result.current.hasAnswer).toBe(true));
    await waitFor(() => expect(sidebar.result.current.hasAnswer).toBe(true));
    const before = capabilityAsks();

    server.capabilities = answering({ read: true }, null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() =>
      expect(guard.result.current.content.hasAnswer).toBe(true)
    );

    expect(capabilityAsks()).toBe(before + 1);
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

  it("keeps the language moved from on screen while the next is asked, and grants nothing on its word", async () => {
    // A role that may edit English and only read German.
    onScreen.locale = "en";
    server.capabilities = answering({ read: true, update: true });
    const { result, rerender } = renderHook(
      () => ({
        access: useCurrentUserPermissions(),
        edits: editsOffered(useUpdateAnswer("posts")),
      }),
      { wrapper: wrapperFor(newClient()) }
    );
    await waitFor(() =>
      expect(result.current.access.content.hasAnswer).toBe(true)
    );
    expect(result.current.edits).toBe(true);

    // Switching to German: its answer is held back, so the English one stays
    // on screen meanwhile.
    let release!: () => void;
    server.capabilitiesGate = new Promise(done => {
      release = done;
    });
    server.capabilities = answering({ read: true, update: false });
    onScreen.locale = "de";
    rerender();
    await waitFor(() =>
      expect(server.asked).toContain("/me/capabilities?locale=de")
    );
    // The page stays (a placeholder), and nothing is granted on its word:
    // no update, and no edit offered, though English allowed both.
    expect(result.current.access.content).toMatchObject({
      isPlaceholder: true,
      hasAnswer: false,
    });
    expect(result.current.access.canAccessCollection("posts", "update")).toBe(
      false
    );
    expect(result.current.edits).toBe(false);

    // German's own answer arrives, and it refuses.
    release();
    await waitFor(() =>
      expect(result.current.access.content).toMatchObject({
        isPlaceholder: false,
        hasAnswer: true,
      })
    );
    expect(result.current.edits).toBe(false);
    expect(result.current.access.canAccessCollection("posts", "read")).toBe(
      true
    );
  });

  it("offers no edit to an editor mounted while the next language is asked", async () => {
    // The entry page shows its skeleton while the document loads in the new
    // language, so the editor mounts again during the switch, with no answer
    // of its own to keep. It reads the English answer as a placeholder too.
    onScreen.locale = "en";
    server.capabilities = answering({ read: true, update: true });
    const client = newClient();
    // The route guard, which stays mounted through the switch.
    const guard = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(guard.result.current.content.hasAnswer).toBe(true)
    );

    let release!: () => void;
    server.capabilitiesGate = new Promise(done => {
      release = done;
    });
    server.capabilities = answering({ read: true, update: false });
    onScreen.locale = "de";
    const editor = renderHook(
      () => ({
        access: useCurrentUserPermissions(),
        edits: editsOffered(useUpdateAnswer("posts")),
      }),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() =>
      expect(server.asked).toContain("/me/capabilities?locale=de")
    );
    expect(editor.result.current.access.content).toMatchObject({
      isPlaceholder: true,
      hasAnswer: false,
    });
    expect(editor.result.current.edits).toBe(false);

    release();
    await waitFor(() =>
      expect(editor.result.current.access.content.hasAnswer).toBe(true)
    );
    expect(editor.result.current.edits).toBe(false);
  });
});

describe("returning to a language another has answered since", () => {
  it("waits on the language's own answer while it is asked again, rather than keeping it", async () => {
    // An answer for the language on screen that no longer holds may have
    // stopped holding because access changed, so it is not kept as another
    // language's would be: the page waits for the current one.
    onScreen.locale = "en";
    server.capabilities = answering({ read: true, update: true });
    // A cache that keeps a language's answer once nothing reads it, as the
    // admin's does; with none kept, returning would read as a first visit.
    const caching = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const { result, rerender } = renderHook(
      () => ({
        access: useCurrentUserPermissions(),
        edits: editsOffered(useUpdateAnswer("posts")),
      }),
      { wrapper: wrapperFor(caching) }
    );
    await waitFor(() =>
      expect(result.current.access.content.hasAnswer).toBe(true)
    );

    // German answers, which leaves the English answer in the cache no longer
    // current.
    onScreen.locale = "de";
    rerender();
    await waitFor(() =>
      expect(server.asked).toContain("/me/capabilities?locale=de")
    );
    await waitFor(() =>
      expect(result.current.access.content).toMatchObject({
        hasAnswer: true,
        isPlaceholder: false,
      })
    );

    // Back to English: its own answer is asked again, and held back here.
    let release!: () => void;
    server.capabilitiesGate = new Promise(done => {
      release = done;
    });
    onScreen.locale = "en";
    rerender();
    await waitFor(() =>
      expect(
        server.asked.filter(p => p === "/me/capabilities?locale=en")
      ).toHaveLength(2)
    );
    expect(result.current.access.content).toMatchObject({
      isPlaceholder: false,
      hasAnswer: false,
      isLoading: true,
    });

    release();
    await waitFor(() =>
      expect(result.current.access.content).toMatchObject({
        hasAnswer: true,
        isPlaceholder: false,
      })
    );
    expect(result.current.edits).toBe(true);
  });
});

describe("switching language after a change to access", () => {
  it("keeps no invalidated answer on screen for the next language", async () => {
    onScreen.locale = "en";
    server.capabilities = answering({ read: true, update: true });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const { result, rerender } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    // A change to roles invalidates the answer; its refresh is held back.
    server.capabilitiesGate = new Promise(() => {});
    await act(async () => {
      invalidateCurrentUserAccess(client);
    });
    await waitFor(() =>
      expect(
        server.asked.filter(p => p === "/me/capabilities?locale=en")
      ).toHaveLength(2)
    );

    // On to French, whose answer is held back too: the English answer, which
    // may no longer describe the user's access, is no placeholder for it.
    server.capabilitiesGate = new Promise(() => {});
    onScreen.locale = "fr";
    rerender();
    await waitFor(() =>
      expect(server.asked).toContain("/me/capabilities?locale=fr")
    );
    expect(result.current.content).toMatchObject({
      isPlaceholder: false,
      hasAnswer: false,
      isLoading: true,
    });
  });
});

describe("a placeholder past its end", () => {
  it("keeps no answer the end of a role has left behind, before it is asked again", async () => {
    // The English answer is in the cache, not yet invalidated, from before the
    // role assignment it was read under ended. German is opened and its own
    // answer is held back: the English one is no placeholder for it.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const ended = Date.now() - 60_000;
    client.setQueryData(
      currentUserCapabilitiesKey("en"),
      answering({ read: true, update: true }, ended),
      { updatedAt: ended - 60_000 }
    );
    server.capabilitiesGate = new Promise(() => {});
    onScreen.locale = "de";

    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });

    // The first render, before anything is asked again.
    expect(result.current.content).toMatchObject({
      isPlaceholder: false,
      hasAnswer: false,
    });
  });
});

describe("a change to access during a language switch", () => {
  it("stops keeping the language moved from once a change invalidates it", async () => {
    onScreen.locale = "en";
    server.capabilities = answering({ read: true, update: true });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const { result, rerender } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    // On to German, held back: the English answer is the placeholder.
    server.capabilitiesGate = new Promise(() => {});
    onScreen.locale = "de";
    rerender();
    await waitFor(() =>
      expect(result.current.content.isPlaceholder).toBe(true)
    );

    // A change to roles invalidates every answer while German is still
    // asked: the English one may no longer describe the user's access.
    server.capabilitiesGate = new Promise(() => {});
    await act(async () => {
      invalidateCurrentUserAccess(client);
    });
    await waitFor(() =>
      expect(result.current.content.isPlaceholder).toBe(false)
    );
    expect(result.current.content.hasAnswer).toBe(false);
  });
});

describe("invalidateCurrentUserAccess", () => {
  it("asks for both the permissions and the capabilities again", async () => {
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    invalidateCurrentUserAccess(client);

    // Each is invalidated once any request under way has been cancelled.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: CURRENT_USER_PERMISSIONS_KEY,
      })
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CURRENT_USER_CAPABILITIES_KEY,
    });
  });
});

describe("the requests judged in other languages", () => {
  const render = () =>
    renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });

  it("answers each from its own cell, not from the action it is a kind of", async () => {
    server.capabilities = answering({
      read: true,
      update: true,
      publish: true,
      create: true,
      readTranslations: false,
      readHistory: false,
      publishEveryLanguage: false,
      updateInDefaultLanguage: false,
      duplicate: false,
    });
    const { result } = render();
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));

    const may = (
      access: Parameters<typeof result.current.canAccessCollection>[1]
    ) => result.current.canAccessCollection("posts", access);
    expect([may("read"), may("readTranslations"), may("readHistory")]).toEqual([
      true,
      false,
      false,
    ]);
    expect([may("publish"), may("publishEveryLanguage")]).toEqual([
      true,
      false,
    ]);
    expect([may("update"), may("updateInDefaultLanguage")]).toEqual([
      true,
      false,
    ]);
    expect(may("duplicate")).toBe(false);
  });

  it("answers a create as the admin sends one, with no language", async () => {
    // Every create the admin sends writes the default language, so the cell
    // for that create answers it, and with it the list's New and the
    // create page.
    server.capabilities = answering({
      read: true,
      create: true,
      createInDefaultLanguage: false,
    });
    const { result } = render();
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    expect(result.current.canAccessCollection("posts", "create")).toBe(false);
    expect(result.current.can("create-posts")).toBe(false);
  });

  it("refuses each request a server names no cell for", async () => {
    // An older server answers only the actions, each judged in one language;
    // a request judged in others is not offered on that answer.
    server.capabilities = answering({
      read: true,
      create: true,
      update: true,
      publish: true,
    });
    const { result } = render();
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    const may = (
      access: Parameters<typeof result.current.canAccessCollection>[1]
    ) => result.current.canAccessCollection("posts", access);
    expect([
      may("readTranslations"),
      may("readHistory"),
      may("publishEveryLanguage"),
      may("updateInDefaultLanguage"),
      may("duplicate"),
      may("create"),
    ]).toEqual([false, false, false, false, false, false]);
    // POPULATION CONTROL: the actions the answer names still count.
    expect([may("read"), may("update"), may("publish")]).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe("the end the permission list names", () => {
  it("asks again when only the permission list names an end", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The content answer names no end; the permission list, read under an
    // assignment ending in a minute, does.
    server.permissions = { ...EDITOR, validUntil: Date.now() + 60_000 };
    server.capabilities = answering({ read: true });
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() =>
      expect(result.current.hasPermission("read-posts")).toBe(true)
    );
    const before = server.asked.filter(p => p === "/me/permissions").length;

    // The assignment ends and takes the permission with it.
    server.permissions = { ...EDITOR, permissions: [], validUntil: null };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() =>
      expect(result.current.hasPermission("read-posts")).toBe(false)
    );
    expect(
      server.asked.filter(p => p === "/me/permissions").length
    ).toBeGreaterThan(before);
  });

  it("asks again while the permission list arrives already past its end", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Read after its end by the browser's clock, as a clock ahead of the
    // server's reads it; the content answer names no end at all.
    server.permissions = { ...EDITOR, validUntil: Date.now() - 5_000 };
    server.capabilities = answering({ read: true });
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() =>
      expect(result.current.hasPermission("read-posts")).toBe(true)
    );
    const before = server.asked.filter(p => p === "/me/permissions").length;

    // The server reaches the end, and the permission goes with it.
    server.permissions = { ...EDITOR, permissions: [], validUntil: null };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await waitFor(() =>
      expect(result.current.hasPermission("read-posts")).toBe(false)
    );
    expect(
      server.asked.filter(p => p === "/me/permissions").length
    ).toBeGreaterThan(before);
  });

  it("settles when a newer permission list drops an end the content answer still names", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Both answers name the end of an assignment a minute away.
    const end = Date.now() + 60_000;
    server.capabilities = answering({ read: true }, end);
    server.permissions = { ...EDITOR, validUntil: end };
    const client = newClient();
    const { result } = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.content.hasAnswer).toBe(true));
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));

    // Only the permission list is asked again, and its newer answer names no
    // end, while the content answer, not asked again, still names it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    server.permissions = { ...EDITOR, validUntil: null };
    await act(async () => {
      await client.invalidateQueries({
        queryKey: CURRENT_USER_PERMISSIONS_KEY,
      });
    });

    // The hook settles on the answers in hand rather than setting its ends
    // again on every render.
    await waitFor(() => expect(result.current.hasAnswer).toBe(true));
    expect(result.current.content.hasAnswer).toBe(true);
    expect(result.current.hasPermission("read-posts")).toBe(true);
  });

  it("keeps an end until an answer newer than the one that named it leaves it out", () => {
    const end = 5_000;
    const named = [{ end, namedAt: 100 }];
    const now = 1_000;
    // The permission list named it; a content answer from before then, which
    // does not, retires nothing.
    expect(
      namedEndsAfter(
        named,
        [
          { validUntil: null, answeredAt: 50 },
          { validUntil: end, answeredAt: 100 },
        ],
        now
      )
    ).toEqual(named);
    // An answer that still names it keeps it, though a newer one does not:
    // the list read under it is acted on at that end, at the cost of one
    // refresh at most.
    expect(
      namedEndsAfter(
        named,
        [
          { validUntil: null, answeredAt: 200 },
          { validUntil: end, answeredAt: 100 },
        ],
        now
      )
    ).toEqual(named);
    // Once no answer names it, a newer one retires it: the assignment was
    // removed or extended.
    expect(
      namedEndsAfter(
        named,
        [
          { validUntil: null, answeredAt: 200 },
          { validUntil: null, answeredAt: 150 },
        ],
        now
      )
    ).toEqual([]);
    // Once passed, an end stands whatever is answered after.
    expect(
      namedEndsAfter(named, [{ validUntil: null, answeredAt: 200 }], 6_000)
    ).toEqual(named);
    // Each answer's own end is learned.
    expect(
      namedEndsAfter([], [{ validUntil: 9_000, answeredAt: 300 }], now)
    ).toEqual([{ end: 9_000, namedAt: 300 }]);
  });
});

describe("one screen's callers", () => {
  /** How many times the permission list was asked for. */
  const permissionAsks = (): number =>
    server.asked.filter(p => p === "/me/permissions").length;

  it("share one answer however late they mount, and the next screen asks once", async () => {
    // 🔴 A screen's callers mount over more than one commit: the dashboard's
    // cards mount once its layout has answered, after the shell has asked, and
    // a slow layout answers seconds later. Each mount asking again read the
    // list twice on every dashboard load; a time window still did whenever the
    // layout outlasted it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = newClient();
    const shell = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(shell.result.current.hasAnswer).toBe(true));
    const asked = permissionAsks();

    // A card mounts ten seconds later on the same screen: it reads the answer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const card = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    expect(card.result.current.hasPermission("read-posts")).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(permissionAsks()).toBe(asked);

    // The control: the next screen asks again, so a changed role is seen
    // there, and asks ONCE, however many of its callers see the new pathname.
    onScreen.pathname = "/admin/collections/posts";
    shell.rerender();
    card.rerender();
    renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(permissionAsks()).toBe(asked + 1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(permissionAsks()).toBe(asked + 1);
  });

  it("ask again when the admin regains focus, on the same screen", async () => {
    // An answer kept for the screen is never stale, so a focus refetch that
    // waits for staleness would keep a role granted or revoked elsewhere until
    // the next screen.
    const client = newClient();
    const shell = renderHook(() => useCurrentUserPermissions(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(shell.result.current.hasAnswer).toBe(true));
    const asked = permissionAsks();
    try {
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(permissionAsks()).toBe(asked + 1));
    } finally {
      focusManager.setFocused(undefined);
    }
  });
});
