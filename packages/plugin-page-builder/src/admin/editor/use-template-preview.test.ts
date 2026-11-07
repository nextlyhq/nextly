// @vitest-environment jsdom

/**
 * Which entry a template is previewed with: the most recent the author may
 * read, else the one they left it on this session while it can still be
 * read; and the list asked again when the window regains focus, so an entry
 * made in another tab can be previewed without a reload.
 *
 * The reads are the template preview client's, replaced with a store the
 * test holds, so each case says what the server answers and watches what
 * the editor asks.
 *
 * @module admin/editor/use-template-preview.test
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PreviewEntriesResponse,
  PreviewEntryItem,
} from "../../templates/template-preview-contract";

const listPreviewEntries = vi.hoisted(() => vi.fn());
const readPreviewEntry = vi.hoisted(() => vi.fn());
vi.mock("../template-preview-client", () => ({
  listPreviewEntries,
  readPreviewEntry,
}));

const { followingCanvas, steppedEntry, useRefreshOnFocus, useTemplatePreview } =
  await import("./use-template-preview");
const { rememberEntry, rememberedEntry, templatePreviewStore } = await import(
  "./template-preview-memory"
);

/** An entry row as the list answers it. */
function row(id: string, title: string, updatedAt: string): PreviewEntryItem {
  return { id, title, status: "published", updatedAt };
}

const NEWEST = row("p2", "Release notes: September", "2026-11-07T08:00:00Z");
const OLDER = row("p1", "Building a content model", "2026-11-06T08:00:00Z");
const MADE_ELSEWHERE = row("p9", "Made in another tab", "2026-11-07T09:00:00Z");

/** The list's answer, holding `items`. */
function listed(items: readonly PreviewEntryItem[]): PreviewEntriesResponse {
  return {
    items,
    meta: {
      total: items.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      mayCreate: true,
      labels: { singular: "Post", plural: "Posts" },
      blocksFields: [{ name: "body", label: "Body" }],
    },
  };
}

/** The server's entry reads: readable ids answer, any other is refused. */
function entriesReadable(ids: readonly string[]) {
  readPreviewEntry.mockImplementation(async ({ id }: { id: string }) => {
    if (!ids.includes(id)) throw new Error("Forbidden");
    return {
      id,
      title: `Entry ${id}`,
      status: "published",
      editorValues: { id },
      publicValues: { id },
      fields: [],
    };
  });
}

const ARGS = {
  collection: "posts",
  templateId: "t1",
  userId: "u1",
  locale: undefined,
};

beforeEach(() => {
  window.sessionStorage.clear();
  listPreviewEntries.mockReset();
  readPreviewEntry.mockReset();
});

describe("the entry a template opens on", () => {
  it("is the most recently updated entry the author may read", async () => {
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({
        kind: "entry",
        id: "p2",
      })
    );
    expect(readPreviewEntry).toHaveBeenCalledWith({
      collection: "posts",
      id: "p2",
    });
  });

  it("is the one the author left it on this session, while it can still be read", async () => {
    rememberEntry(templatePreviewStore("u1"), "t1", "p1");
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({
        kind: "entry",
        id: "p1",
      })
    );
  });

  it("falls back to the most recent when the remembered entry is gone or unreadable, and forgets it", async () => {
    const store = templatePreviewStore("u1");
    rememberEntry(store, "t1", "gone");
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({
        kind: "entry",
        id: "p2",
      })
    );
    expect(rememberedEntry(store, "t1")).toBe("p2");
  });

  it("is remembered per person and per template", async () => {
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({ id: "p2" })
    );
    act(() => result.current.choose(OLDER));
    await waitFor(() =>
      expect(rememberedEntry(templatePreviewStore("u1"), "t1")).toBe("p1")
    );
    // Another person, and another template, remember nothing of it.
    expect(rememberedEntry(templatePreviewStore("u2"), "t1")).toBeUndefined();
    expect(rememberedEntry(templatePreviewStore("u1"), "t2")).toBeUndefined();
  });

  it("is the remembered one once the person is known, on a load that learns who they are late", async () => {
    rememberEntry(templatePreviewStore("u1"), "t1", "p1");
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    // Signed in, but not known yet: the admin is still asking who they are.
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) =>
        useTemplatePreview({ ...ARGS, userId }),
      { initialProps: { userId: null as string | null } }
    );
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({ id: "p2" })
    );
    rerender({ userId: "u1" });
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({ id: "p1" })
    );
    // What they left the template on is still theirs, not the newest.
    expect(rememberedEntry(templatePreviewStore("u1"), "t1")).toBe("p1");
  });

  it("is none, with the reason empty, where the author may read no entry", async () => {
    listPreviewEntries.mockResolvedValue(listed([]));
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toEqual({
        kind: "none",
        reason: "empty",
      })
    );
    expect(readPreviewEntry).not.toHaveBeenCalled();
  });

  it("is none in the same words where the collection is refused", async () => {
    listPreviewEntries.mockRejectedValue(new Error("Forbidden"));
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toEqual({
        kind: "none",
        reason: "empty",
      })
    );
    expect(result.current.list.mayCreate).toBe(false);
  });
});

describe("an entry listed but not readable", () => {
  it("is named as unavailable, and the canvas reads no entry, rather than claiming the listed row", async () => {
    // Listed, then deleted before its read: the read is refused.
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toEqual({
        kind: "none",
        reason: "unavailable",
      })
    );
    expect(result.current.chip).toMatchObject({ id: "p2", unavailable: true });
  });

  it("is marked available again once a retry reads it (the control)", async () => {
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.chip).toMatchObject({ unavailable: true })
    );
    entriesReadable(["p1", "p2"]);
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({
        kind: "entry",
        id: "p2",
      })
    );
    expect(result.current.chip).toMatchObject({ id: "p2", unavailable: false });
  });

  it("never hands on the previous entry as the one previewed while the next is read", async () => {
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({ id: "p2" })
    );
    // The next read is held, so the switch is seen mid-way.
    let release = (): void => {};
    readPreviewEntry.mockImplementationOnce(
      ({ id }: { id: string }) =>
        new Promise(resolve => {
          release = () =>
            resolve({
              id,
              title: `Entry ${id}`,
              status: "published",
              editorValues: { id },
              publicValues: { id },
              fields: [],
            });
        })
    );
    act(() => result.current.choose(OLDER));
    expect(result.current.chip?.id).toBe("p1");
    expect(result.current.previewed).toEqual({
      kind: "none",
      reason: "loading",
    });
    act(() => release());
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({ id: "p1" })
    );
  });
});

describe("an entry waiting on a working draft", () => {
  it("is listed by its saved title, and once chosen the chip names its draft's", async () => {
    const changed: PreviewEntryItem = {
      id: "p3",
      title: "Field notes: a week with the editor",
      status: "changed",
      updatedAt: "2026-11-05T08:00:00Z",
    };
    listPreviewEntries.mockResolvedValue(listed([NEWEST, changed]));
    entriesReadable(["p2"]);
    readPreviewEntry.mockImplementation(async ({ id }: { id: string }) => ({
      id,
      title: id === "p3" ? "Field notes, the draft's title" : `Entry ${id}`,
      status: "changed",
      editorValues: { id },
      publicValues: { id },
      fields: [],
    }));
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() => expect(result.current.list.items).toHaveLength(2));
    // The list keeps the saved title, marked as Changed.
    expect(result.current.list.items[1]).toMatchObject({
      title: "Field notes: a week with the editor",
      status: "changed",
    });
    act(() => result.current.choose(changed));
    await waitFor(() =>
      expect(result.current.chip).toMatchObject({
        id: "p3",
        title: "Field notes, the draft's title",
        loading: false,
      })
    );
  });
});

describe("an entry's own design", () => {
  it("previews the one entry it serves, whatever is newer, and chooses nothing else", async () => {
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const { result } = renderHook(() =>
      useTemplatePreview({ ...ARGS, entry: "p1" })
    );
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({
        kind: "entry",
        id: "p1",
      })
    );
    expect(result.current.fixed).toBe(true);
    act(() => result.current.choose(NEWEST));
    expect(result.current.step(1)).toBeUndefined();
    expect(result.current.chip?.id).toBe("p1");
    // It remembers nothing: there is nothing to come back to.
    expect(rememberedEntry(templatePreviewStore("u1"), "t1")).toBeUndefined();
  });

  it("previews the newest on a collection's template (the control)", async () => {
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({ id: "p2" })
    );
    expect(result.current.fixed).toBe(false);
  });
});

/**
 * The preview as the strip wires it: following the canvas's read, and asked
 * again whole when the window regains focus. `retryCanvas` is the canvas's
 * read being asked again.
 */
function useStripPreview(retryCanvas: () => void) {
  const preview = followingCanvas(
    useTemplatePreview(ARGS),
    undefined,
    retryCanvas
  );
  useRefreshOnFocus(preview.refresh);
  return preview;
}

describe("a window that regains focus", () => {
  it("asks for the list again, so an entry made in another tab can be previewed", async () => {
    listPreviewEntries.mockResolvedValueOnce(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2", "p9"]);
    const retryCanvas = vi.fn();
    const { result } = renderHook(() => useStripPreview(retryCanvas));
    await waitFor(() => expect(result.current.list.items).toHaveLength(2));
    listPreviewEntries.mockResolvedValueOnce(
      listed([MADE_ELSEWHERE, NEWEST, OLDER])
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(result.current.list.items.map(item => item.id)).toEqual([
        "p9",
        "p2",
        "p1",
      ])
    );
    expect(listPreviewEntries).toHaveBeenCalledTimes(2);
  });

  it("asks the canvas's read again with the entry's, so a new title never sits over kept canvas text", async () => {
    // The canvas keeps an answer for the same ask for a while; only a retry
    // reads it afresh. So focus has to ask the canvas too, not only the
    // list and the entry, or the chip names the new title over old text.
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const retryCanvas = vi.fn();
    const { result } = renderHook(() => useStripPreview(retryCanvas));
    await waitFor(() =>
      expect(result.current.chip).toMatchObject({ id: "p2" })
    );
    const entryReads = readPreviewEntry.mock.calls.length;
    expect(retryCanvas).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(retryCanvas).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(readPreviewEntry.mock.calls.length).toBeGreaterThan(entryReads)
    );
  });

  it("asks nothing more while the window keeps its focus (the control)", async () => {
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const retryCanvas = vi.fn();
    const { result } = renderHook(() => useStripPreview(retryCanvas));
    await waitFor(() =>
      expect(result.current.chip).toMatchObject({ id: "p2" })
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(listPreviewEntries).toHaveBeenCalledTimes(1);
    expect(retryCanvas).not.toHaveBeenCalled();
  });

  it("is not asked by the preview alone, so nothing refreshes the list without the canvas", async () => {
    // The hook on its own no longer listens: only the strip's whole refresh
    // does, so a focus can never read the entry without the canvas.
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({ id: "p2" })
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(listPreviewEntries).toHaveBeenCalledTimes(1);
  });
});

describe("stepping through the list", () => {
  const items = [NEWEST, OLDER, MADE_ELSEWHERE];

  it("goes to the next and the previous entry in the list's order, wrapping at its ends", () => {
    expect(steppedEntry(items, "p2", 1)?.id).toBe("p1");
    expect(steppedEntry(items, "p9", 1)?.id).toBe("p2");
    expect(steppedEntry(items, "p2", -1)?.id).toBe("p9");
    expect(steppedEntry(items, "p1", -1)?.id).toBe("p2");
  });

  it("goes nowhere with one entry, and to an end from an entry found by search", () => {
    expect(steppedEntry([NEWEST], "p2", 1)).toBeUndefined();
    expect(steppedEntry(items, "elsewhere", 1)?.id).toBe("p2");
    expect(steppedEntry(items, "elsewhere", -1)?.id).toBe("p9");
  });
});

describe("what the strip says, following the canvas's own read", () => {
  /** A preview whose entry read answered for p2. */
  function answered() {
    return {
      collection: "posts",
      fixed: false,
      labels: { singular: "Post", plural: "Posts" },
      blocksFields: undefined,
      language: undefined,
      list: { state: "ready" as const, items: [NEWEST], mayCreate: true },
      chip: {
        id: "p2",
        title: NEWEST.title,
        status: "published" as const,
        unavailable: false,
        loading: false,
      },
      previewed: {
        kind: "entry" as const,
        collection: "posts",
        id: "p2",
        title: NEWEST.title,
        editorValues: {},
        publicValues: null,
        fields: [],
      },
      choose: vi.fn(),
      step: vi.fn(),
      refresh: vi.fn(),
    };
  }

  it("names the entry previewed once the canvas's read of it has answered", () => {
    const shown = followingCanvas(
      answered(),
      { entryId: "p2", state: "answered" },
      vi.fn()
    );
    expect(shown.previewed).toMatchObject({ kind: "entry", id: "p2" });
    expect(shown.chip).toMatchObject({ unavailable: false, loading: false });
    // A canvas with nothing bound reads nothing, and counts as answered.
    expect(
      followingCanvas(answered(), { entryId: "p2", state: "none" }, vi.fn())
        .previewed
    ).toMatchObject({ kind: "entry" });
  });

  it("marks the entry unavailable when the canvas's read failed, and retries both reads", () => {
    const preview = answered();
    const retry = vi.fn();
    const shown = followingCanvas(
      preview,
      { entryId: "p2", state: "failed" },
      retry
    );
    expect(shown.chip).toMatchObject({ id: "p2", unavailable: true });
    expect(shown.previewed).toEqual({ kind: "none", reason: "unavailable" });
    shown.refresh();
    expect(preview.refresh).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("names no entry previewed while the canvas still reads it, or reads another", () => {
    for (const canvas of [
      { entryId: "p2", state: "pending" as const },
      // The canvas's last answer is another entry's.
      { entryId: "p1", state: "answered" as const },
      undefined,
    ]) {
      const shown = followingCanvas(answered(), canvas, vi.fn());
      expect(shown.previewed).toEqual({ kind: "none", reason: "loading" });
      expect(shown.chip).toMatchObject({ loading: true, unavailable: false });
    }
  });
});
