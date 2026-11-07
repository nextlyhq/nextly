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

const { steppedEntry, useTemplatePreview } = await import(
  "./use-template-preview"
);
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

describe("a window that regains focus", () => {
  it("asks for the list again, so an entry made in another tab can be previewed", async () => {
    listPreviewEntries.mockResolvedValueOnce(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2", "p9"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
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

  it("asks nothing more while the window keeps its focus (the control)", async () => {
    listPreviewEntries.mockResolvedValue(listed([NEWEST, OLDER]));
    entriesReadable(["p1", "p2"]);
    const { result } = renderHook(() => useTemplatePreview(ARGS));
    await waitFor(() =>
      expect(result.current.previewed).toMatchObject({ id: "p2" })
    );
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
