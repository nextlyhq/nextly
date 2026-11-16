/**
 * A recovery point remembers the version its edits began from: its offer
 * carries it and what changed since, restoring it hands the editor that
 * version (and leaves it out of the form's values), and it is not mistaken
 * for different work from the stored document because of it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSpy } = vi.hoisted(() => ({ getSpy: vi.fn() }));
vi.mock("@admin/services/versionApi", () => ({
  versionApi: { getAutosave: getSpy },
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "author-1",
}));

import { useAutosaveRecovery } from "../useAutosaveRecovery";

const SCOPE = { kind: "collection" as const, slug: "posts", entryId: "e1" };
const CHANGED = {
  currentVersion: "8",
  changedBy: { kind: "person", name: "Ana Ruiz" },
  changedAt: "2026-11-05T10:42:00.000Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function render(onRestored = vi.fn()) {
  const rendered = renderHook(
    () => {
      const form = useForm<Record<string, unknown>>({
        defaultValues: { title: "stored" },
      });
      return {
        form,
        recovery: useAutosaveRecovery({ scope: SCOPE, form, onRestored }),
      };
    },
    { wrapper }
  );
  return { ...rendered, onRestored };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("a recovery point's starting version", () => {
  it("is offered with what changed since, and handed to the editor on restore, out of the form's values", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered", _rev: "7" },
      updatedAt: "2026-11-05T10:00:00.000Z",
      locale: null,
      superseded: "by-another",
      changedSince: CHANGED,
    });
    const { result, onRestored } = render();
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());
    expect(result.current.recovery.offer).toMatchObject({
      startedFrom: "7",
      changedSince: CHANGED,
      startingVersionUnknown: false,
    });

    act(() => result.current.recovery.take());

    expect(onRestored).toHaveBeenCalledWith("7");
    expect(result.current.form.getValues()).toEqual({ title: "recovered" });
  });

  it("hands the editor no version for a point saved before versions", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-11-05T10:00:00.000Z",
      locale: null,
      startingVersionUnknown: true,
    });
    const { result, onRestored } = render();
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());
    expect(result.current.recovery.offer?.startingVersionUnknown).toBe(true);
    act(() => result.current.recovery.take());
    expect(onRestored).toHaveBeenCalledWith(undefined);
  });

  it("is not offered when its values are what the document stores, whatever version it began from", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "stored", _rev: "7" },
      updatedAt: "2026-11-05T10:00:00.000Z",
      locale: null,
    });
    const { result } = render();
    await waitFor(() => expect(result.current.recovery.isResolved).toBe(true));
    expect(result.current.recovery.offer).toBeNull();
  });
});
