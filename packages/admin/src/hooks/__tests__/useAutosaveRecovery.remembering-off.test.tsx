/**
 * "Not now" on a recovery offer, where the site turned remembering off: kept
 * for this tab in memory, so the editor loaded again does not offer the same
 * point, and written nowhere on the device, the session storage included,
 * whether the account is known yet or not.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyRememberingSwitch,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";

const { getSpy } = vi.hoisted(() => ({ getSpy: vi.fn() }));
vi.mock("@admin/services/versionApi", () => ({
  versionApi: { getAutosave: getSpy },
}));
const signedIn = vi.hoisted(() => ({ id: "author-1" as string | null }));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ defaultLocale: "en", locales: [], enabled: true }),
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => signedIn.id,
}));

import { useAutosaveRecovery } from "../useAutosaveRecovery";

const SCOPE = { kind: "collection" as const, slug: "posts", entryId: "e1" };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function useHarness() {
  const form = useForm<Record<string, unknown>>({
    defaultValues: { title: "stored" },
  });
  return useAutosaveRecovery({ scope: SCOPE, form, locale: null });
}

const render = () => renderHook(() => useHarness(), { wrapper });

/** Everything in the tab's session storage. */
const sessionKeys = () => Object.keys(window.sessionStorage);

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetDeviceMemoryForTests();
  applyRememberingSwitch(false);
  signedIn.id = "author-1";
  getSpy.mockResolvedValue({
    snapshot: { title: "recovered" },
    updatedAt: "2026-08-17T10:00:00.000Z",
    locale: null,
  });
});

describe("Not now, where remembering is off", () => {
  it("keeps the point put off in this tab and writes nothing to storage", async () => {
    const first = render();
    await waitFor(() => expect(first.result.current.offer).not.toBeNull());
    act(() => first.result.current.dismiss());
    first.unmount();
    expect(sessionKeys()).toEqual([]);

    const again = render();
    await waitFor(() => expect(again.result.current.isResolved).toBe(true));
    expect(again.result.current.offer).toBeNull();
  });

  it("writes nothing for a Not now pressed before the account is known", async () => {
    signedIn.id = null;
    const first = render();
    await waitFor(() => expect(first.result.current.offer).not.toBeNull());
    act(() => first.result.current.dismiss());
    expect(sessionKeys()).toEqual([]);
    signedIn.id = "author-1";
    first.rerender();
    first.unmount();
    expect(sessionKeys()).toEqual([]);

    const again = render();
    await waitFor(() => expect(again.result.current.isResolved).toBe(true));
    expect(again.result.current.offer).toBeNull();
  });
});
