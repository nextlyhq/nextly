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
  /** Refuse the next recording with a server error, storing nothing. */
  failNext: false,
}));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: {
    getAutosave: vi.fn(async () => server.point),
    saveAutosave: vi.fn(
      async (_scope: unknown, snapshot: unknown, locale?: string | null) => {
        if (server.failNext) {
          server.failNext = false;
          throw Object.assign(new Error("unavailable"), { status: 503 });
        }
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

import { versionApi } from "@admin/services/versionApi";

import { useAutosaveRecovery } from "../useAutosaveRecovery";
import {
  documentRecordingKey,
  useDocumentAutosave,
} from "../useDocumentAutosave";
import {
  DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  useSnapshotAutosave,
} from "../useSnapshotAutosave";

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

/** What a block canvas holds that the form does not, while it is open. */
const CANVAS = { title: "Welcome", layout: ["a block laid out"] };

/**
 * One editor session: the form, its recorder and the offer, as the editor
 * wires them, and a second recorder of the same document beside the form, as
 * a block canvas records its own live state while the form may be clean.
 */
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
      const document = documentRecordingKey(SCOPE);
      const canvas = useSnapshotAutosave({
        identity: `${document}:`,
        document,
        save: () => versionApi.saveAutosave(SCOPE, CANVAS, null),
      });
      const recovery = useAutosaveRecovery({ scope: SCOPE, form });
      return { form, recovery, canvas, isDirty: form.formState.isDirty };
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
  server.failNext = false;
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

describe("Discard, when the point changed since it was offered", () => {
  it("leaves a newer point from another tab as it is", async () => {
    server.point = waitingPoint();
    const editor = openEditor();
    await waitFor(() =>
      expect(editor.result.current.recovery.offer).not.toBeNull()
    );
    // Another tab of the same author records newer work meanwhile.
    const newer = {
      snapshot: { title: "Welcome, from the other tab" },
      updatedAt: "2026-11-16T12:30:00.000Z",
      locale: null,
    };
    server.point = newer;

    act(() => editor.result.current.recovery.discard());
    await settle(0);

    expect(server.writes).toEqual([]);
    editor.unmount();
    expect(await offerInANewTab()).toEqual(
      expect.objectContaining({ snapshot: newer.snapshot })
    );
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

  it("keep edits stored before the current version is loaded over them, though its values are the same", async () => {
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

    // A refused save keeps the edits as the point, then loads the current
    // version, whose values here are the ones the form started from.
    await act(async () => {
      await versionApi.saveAutosave(SCOPE, { title: "Welcome abc" }, null);
    });
    act(() => editor.result.current.form.reset({ title: "Welcome" }));
    expect(editor.result.current.isDirty).toBe(false);
    await settle();

    expect(server.point?.snapshot).toEqual({ title: "Welcome abc" });
    editor.unmount();
    expect(await offerInANewTab()).not.toBeNull();
  });

  it("leave a block canvas's newer recording alone, though the form is back to what it stores", async () => {
    const editor = openEditor();
    await waitFor(() =>
      expect(editor.result.current.recovery.isResolved).toBe(true)
    );
    // The title renamed: the form records it.
    act(() =>
      editor.result.current.form.setValue("title", "Welcome renamed", {
        shouldDirty: true,
      })
    );
    await settle();
    // Blocks laid out on the canvas, which records its own live state.
    act(() => editor.result.current.canvas.schedule());
    await settle();
    expect(server.point?.snapshot).toEqual(CANVAS);

    // The title renamed back: the form is clean, the canvas work is not.
    act(() =>
      editor.result.current.form.setValue("title", "Welcome", {
        shouldDirty: true,
      })
    );
    expect(editor.result.current.isDirty).toBe(false);
    await settle();

    expect(server.point?.snapshot).toEqual(CANVAS);
    expect(server.writes).not.toContainEqual({});
    editor.unmount();
  });

  it("leave another tab's newer recording alone, though this tab recorded first", async () => {
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
    // The same author's other tab records newer work over this tab's point.
    const newer = {
      snapshot: { title: "Welcome, from the other tab" },
      updatedAt: "2026-11-16T12:30:00.000Z",
      locale: null,
    };
    server.point = newer;

    act(() =>
      editor.result.current.form.setValue("title", "Welcome", {
        shouldDirty: true,
      })
    );
    await settle();

    expect(server.point).toEqual(newer);
    editor.unmount();
  });

  it("leave a point waiting from a last visit when the recording of the undone edits failed", async () => {
    server.point = waitingPoint();
    const editor = openEditor();
    await waitFor(() =>
      expect(editor.result.current.recovery.offer).not.toBeNull()
    );
    server.failNext = true;
    act(() =>
      editor.result.current.form.setValue("title", "Welcome abc", {
        shouldDirty: true,
      })
    );
    await settle();
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
