/**
 * A recovery point read as the page renders, before the editor opens: the
 * editor's offer takes that read rather than asking again, and offers what it
 * would have offered from its own, a point recorded against a version someone
 * else has since changed included. Nothing is read where the page passes no
 * scope.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VersionScope } from "@admin/services/versionApi";

const { getSpy } = vi.hoisted(() => ({ getSpy: vi.fn() }));
vi.mock("@admin/services/versionApi", () => ({
  versionApi: { getAutosave: getSpy },
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ defaultLocale: "en", locales: [], enabled: true }),
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "author-1",
}));

import {
  useAutosaveRecovery,
  useStartRecoveryPointRead,
} from "../useAutosaveRecovery";

const SCOPE: VersionScope = { kind: "collection", slug: "posts", entryId: "e1" };

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function useOffer(scope: VersionScope | null) {
  const form = useForm<Record<string, unknown>>({
    defaultValues: { title: "stored" },
  });
  return useAutosaveRecovery({ scope, form, locale: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("a recovery point read as the page renders", () => {
  it("is the read the editor's offer takes, with the conflict it carries", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
      changedSince: { by: "Ben", at: "2026-08-17T11:00:00.000Z" },
    });
    const { wrapper } = setup();
    const page = renderHook(() => useStartRecoveryPointRead(SCOPE), {
      wrapper,
    });
    page.rerender();
    expect(getSpy).toHaveBeenCalledTimes(1);

    const { result } = renderHook(() => useOffer(SCOPE), { wrapper });
    await waitFor(() => expect(result.current.offer).not.toBeNull());
    expect(result.current.offer?.snapshot).toEqual({ title: "recovered" });
    expect(result.current.offer?.changedSince).toBeDefined();
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("reads nothing without a scope", () => {
    const { wrapper } = setup();
    renderHook(() => useStartRecoveryPointRead(null), { wrapper });
    expect(getSpy).not.toHaveBeenCalled();
  });
});
