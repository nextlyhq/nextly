/**
 * When a recovery point stops being offered for good: Discard, and edits the
 * author undid back to what the document stores.
 *
 * Both leave the author's point holding no values, through the same write a
 * recording makes, and a point holding no values is never offered. The cases
 * run the editor's real recorder beside the offer, against a stand-in server
 * that keeps the one point the author has, so "a later session" is a fresh
 * mount reading what the earlier one left there.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AutosaveDetail } from "@admin/services/versionApi";

/** The author's one point on the server, as the routes keep it. */
const server = vi.hoisted(() => ({
  point: null as AutosaveDetail | null,
  writes: [] as unknown[],
  clock: 0,
}));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: {
    getAutosave: vi.fn(async () => server.point),
    saveAutosave: vi.fn(
      async (_scope: unknown, snapshot: unknown, locale?: string | null) => {
        server.writes.push(snapshot);
        server.clock += 1;
        const updatedAt = new Date(
          Date.UTC(2026, 10, 16, 12, 0, server.clock)
        ).toISOString();
        server.point = { snapshot, updatedAt, locale: locale ?? null };
        return { updatedAt, locale: locale ?? null };
      }
    ),
  },
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ defaultLocale: "en", locales: [], enabled: true }),
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "author-1",
}));

import { useAutosaveRecovery } from "../useAutosaveRecovery";
import { useDocumentAutosave } from "../useDocumentAutosave";
import { DEFAULT_AUTOSAVE_DEBOUNCE_MS } from "../useSnapshotAutosave";

const SCOPE = { kind: "collection" as const, slug: "posts", entryId: "e1" };
const STORED = { title: "Welcome" };

/** A point from an earlier visit, holding work the document does not. */
function waitingPoint(): AutosaveDetail {
  return {
    snapshot: { title: "Welcome, edited last week" },
    updatedAt: "2026-11-09T09:00:00.000Z",
    locale: null,
  };
}

/** One editor session: the form, its recorder and the offer, as the editor wires them. */
function openEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return renderHook(
    () => {
      const form = useForm<Record<string, unknown>>({
        defaultValues: STORED,
      });
      useDocumentAutosave({ scope: SCOPE, form });
      const recovery = useAutosaveRecovery({ scope: SCOPE, form });
      return { form, recovery, isDirty: form.formState.isDirty };
    },
    { wrapper }
  );
}

/** A later session in a new tab: nothing kept in this tab's storage. */
async function offerInANewTab() {
  window.sessionStorage.clear();
  const later = openEditor();
  await waitFor(() =>
    expect(later.result.current.recovery.isResolved).toBe(true)
  );
  const offer = later.result.current.recovery.offer;
  later.unmount();
  return offer;
}

/** Let the recorder's debounce and every write it starts run out. */
async function settle(ms = DEFAULT_AUTOSAVE_DEBOUNCE_MS * 2) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  window.sessionStorage.clear();
  server.point = null;
  server.writes = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a point holding no values", () => {
  it("offers nothing, with or without the version its edits began from", async () => {
    for (const snapshot of [{}, { _rev: "3" }]) {
      server.point = {
        snapshot,
        updatedAt: "2026-11-16T12:00:00.000Z",
        locale: null,
      };
      expect(await offerInANewTab()).toBeNull();
    }
  });

  it("while a point with values is still offered, which is the control", async () => {
    server.point = waitingPoint();
    expect(await offerInANewTab()).not.toBeNull();
  });
});

describe("Discard", () => {
  it("is never offered again, in a later session or another tab", async () => {
    server.point = waitingPoint();
    const editor = openEditor();
    await waitFor(() =>
      expect(editor.result.current.recovery.offer).not.toBeNull()
    );

    act(() => editor.result.current.recovery.discard());
    expect(editor.result.current.recovery.offer).toBeNull();
    await settle(0);

    expect(server.writes).toEqual([{}]);
    editor.unmount();
    expect(await offerInANewTab()).toBeNull();
  });

  it("writes nothing over edits the form holds, which the next recording keeps", async () => {
    server.point = waitingPoint();
    const editor = openEditor();
    await waitFor(() =>
      expect(editor.result.current.recovery.offer).not.toBeNull()
    );
    act(() =>
      editor.result.current.form.setValue("title", "Welcome!", {
        shouldDirty: true,
      })
    );
    expect(editor.result.current.isDirty).toBe(true);

    act(() => editor.result.current.recovery.discard());
    await settle(0);

    // No empty point over live work: only the recorder writes, and what it
    // writes is the form's.
    expect(server.writes).not.toContainEqual({});
    editor.unmount();
  });
});

describe("Not now", () => {
  it("stops offering in this tab only: a new tab is offered the point again", async () => {
    server.point = waitingPoint();
    const editor = openEditor();
    await waitFor(() =>
      expect(editor.result.current.recovery.offer).not.toBeNull()
    );

    act(() => editor.result.current.recovery.dismiss());
    await settle(0);

    expect(server.writes).toEqual([]);
    editor.unmount();
    expect(await offerInANewTab()).not.toBeNull();
  });
});

describe("edits undone back to what the document stores", () => {
  it("leave nothing to offer next time, once a recording kept them", async () => {
    const editor = openEditor();
    await waitFor(() =>
      expect(editor.result.current.recovery.isResolved).toBe(true)
    );
    act(() =>
      editor.result.current.form.setValue("title", "Welcome abc", {
        shouldDirty: true,
      })
    );
    await settle();
    // Recorded while the form held them.
    expect(server.point?.snapshot).toEqual({ title: "Welcome abc" });

    act(() =>
      editor.result.current.form.setValue("title", "Welcome", {
        shouldDirty: true,
      })
    );
    expect(editor.result.current.isDirty).toBe(false);
    await settle();

    expect(server.point?.snapshot).toEqual({});
    editor.unmount();
    expect(await offerInANewTab()).toBeNull();
  });

  it("leave a point waiting from a last visit as it was, when undone before anything recorded them", async () => {
    server.point = waitingPoint();
    const editor = openEditor();
    await waitFor(() =>
      expect(editor.result.current.recovery.offer).not.toBeNull()
    );
    act(() =>
      editor.result.current.form.setValue("title", "Welcome a", {
        shouldDirty: true,
      })
    );
    // Undone inside the debounce: no recording replaced the waiting point.
    await settle(DEFAULT_AUTOSAVE_DEBOUNCE_MS / 2);
    act(() =>
      editor.result.current.form.setValue("title", "Welcome", {
        shouldDirty: true,
      })
    );
    await settle();

    expect(server.writes).toEqual([]);
    editor.unmount();
    expect(await offerInANewTab()).toEqual(
      expect.objectContaining({
        snapshot: { title: "Welcome, edited last week" },
      })
    );
  });

  it("write nothing when a save made the form clean: the save itself deletes the point", async () => {
    const editor = openEditor();
    await waitFor(() =>
      expect(editor.result.current.recovery.isResolved).toBe(true)
    );
    act(() =>
      editor.result.current.form.setValue("title", "Welcome abc", {
        shouldDirty: true,
      })
    );
    await settle();
    const writes = server.writes.length;

    // A save loads what it stored as the form's new baseline.
    act(() => editor.result.current.form.reset({ title: "Welcome abc" }));
    expect(editor.result.current.isDirty).toBe(false);
    await settle();

    expect(server.writes).toHaveLength(writes);
    editor.unmount();
  });
});
