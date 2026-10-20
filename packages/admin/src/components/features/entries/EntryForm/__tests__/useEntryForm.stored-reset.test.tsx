/**
 * What the form holds after a save: what the server stored.
 *
 * The form used to be reset to what it SENT, so a value the server normalised
 * on the way in — a trimmed title, a generated slug, a blocks document a hook
 * rewrote — stayed on screen as sent, the form's defaults disagreed with the
 * stored row, and anything judged against those defaults judged the wrong
 * thing. What these pin is the stored value becoming the default, and the one
 * thing that must not happen while it does: losing what the author typed while
 * the save was in flight.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "@admin/__tests__/utils";
import { RESTRICTED_REFERENCE } from "@admin/lib/form/stored-references";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDeleteEntry", () => ({
  useDeleteEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDiscardWorkingDraft", () => ({
  useDiscardWorkingDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useEntryForm } from "../useEntryForm";

const collection = {
  name: "pages",
  label: "Pages",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "summary", type: "text", label: "Summary" },
    { name: "layout", type: "blocks", label: "Layout" },
  ],
} as never;
const entry = {
  id: "e1",
  title: "Hello",
  summary: "Short",
  layout: { formatVersion: 1, kind: "page", nodes: [] },
};

afterEach(() => {
  update.mockReset();
});

function render() {
  return renderHook(() => useEntryForm({ collection, entry, mode: "edit" }));
}

describe("after a save, the form holds what the server stored", () => {
  it("adopts a value the server normalised, and is not dirty for it", async () => {
    update.mockImplementation((sent: Record<string, unknown>) =>
      Promise.resolve({
        item: { ...entry, ...sent, title: String(sent.title).trim() },
      })
    );
    const { result } = render();
    act(() => {
      result.current.form.setValue("title", "  Hello there  ", {
        shouldDirty: true,
      });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.form.getValues("title")).toBe("Hello there");
    expect(result.current.form.formState.isDirty).toBe(false);
  });

  it("adopts a blocks document the server rewrote", async () => {
    const rewritten = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/heading", version: 1, props: {} }],
    };
    update.mockImplementation((sent: Record<string, unknown>) =>
      Promise.resolve({ item: { ...entry, ...sent, layout: rewritten } })
    );
    const { result } = render();
    act(() => {
      result.current.form.setValue(
        "layout",
        { formatVersion: 1, kind: "page", nodes: [{ id: "n1" }] },
        { shouldDirty: true }
      );
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.form.getValues("layout")).toEqual(rewritten);
    expect(result.current.form.formState.isDirty).toBe(false);
  });

  it("keeps what the author typed while the save was in flight", async () => {
    let land: (value: unknown) => void = () => {};
    update.mockImplementation(
      (sent: Record<string, unknown>) =>
        new Promise(resolve => {
          land = () => resolve({ item: { ...entry, ...sent } });
        })
    );
    const { result } = render();
    act(() => {
      result.current.form.setValue("title", "Saved title", {
        shouldDirty: true,
      });
    });

    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = result.current.handleSubmit();
    });
    // Typed after the save left and before it landed.
    await act(async () => {
      await Promise.resolve();
      result.current.form.setValue("summary", "Typed meanwhile", {
        shouldDirty: true,
      });
    });
    await act(async () => {
      land(undefined);
      await saving;
    });

    // The save's own value is now the stored default; the later typing is
    // still on screen, and still counts as unsaved.
    expect(result.current.form.getValues("title")).toBe("Saved title");
    expect(result.current.form.getValues("summary")).toBe("Typed meanwhile");
    expect(result.current.form.formState.dirtyFields).toEqual({
      summary: true,
    });
  });
});

describe("after a save that sent a link the editor cannot see", () => {
  const related = {
    name: "posts",
    label: "Posts",
    fields: [
      { name: "title", type: "text", label: "Title" },
      {
        name: "related",
        type: "relationship",
        label: "Related",
        relationTo: "articles",
        hasMany: true,
      },
    ],
  } as never;
  const hidden = { id: "a2", [RESTRICTED_REFERENCE]: true };
  const withHidden = {
    id: "e1",
    title: "Hello",
    related: [{ id: "a1", title: "Seen" }, hidden],
  };

  it("keeps the placeholder, which the stored row leaves out", async () => {
    // The answer is read as the edit page's populated read is: the row the
    // editor may not read is not in it.
    update.mockImplementation((sent: Record<string, unknown>) =>
      Promise.resolve({
        item: {
          ...withHidden,
          ...sent,
          related: [{ id: "a1", title: "Seen" }],
        },
      })
    );
    const { result } = renderHook(() =>
      useEntryForm({ collection: related, entry: withHidden, mode: "edit" })
    );
    act(() => {
      result.current.form.setValue("title", "Hello there", {
        shouldDirty: true,
      });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    // What went out named the hidden link by its id.
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      related: [{ id: "a1", title: "Seen" }, "a2"],
    });
    // And the form still holds it, so the next save keeps it too.
    expect(result.current.form.getValues("related")).toEqual([
      { id: "a1", title: "Seen" },
      hidden,
    ]);
    expect(result.current.form.getValues("title")).toBe("Hello there");
  });
});

/*
 * The stored row a save puts in the cache comes back to the form as a new
 * entry. That echo of the author's own save keeps what they typed since; any
 * other arrival — a restored version, a colleague's change — resets the form
 * to it, as Restore promises when it warns that unsaved work is discarded.
 */
describe("when the entry arrives again", () => {
  const saved = { ...entry, updatedAt: "2026-10-17T12:00:00.000Z" };

  function renderWith(initial: typeof saved) {
    return renderHook(
      ({ current }: { current: typeof saved }) =>
        useEntryForm({ collection, entry: current, mode: "edit" }),
      { initialProps: { current: initial } }
    );
  }

  it("keeps what was typed since, when it is the echo of this author's own save", async () => {
    const stored = {
      ...saved,
      title: "Saved",
      updatedAt: "2026-10-17T12:05:00.000Z",
    };
    update.mockResolvedValue({ item: stored });
    const { result, rerender } = renderWith(saved);
    act(() => {
      result.current.form.setValue("title", "Saved", { shouldDirty: true });
    });
    await act(async () => {
      await result.current.handleSubmit();
    });
    act(() => {
      result.current.form.setValue("summary", "Typed since", {
        shouldDirty: true,
      });
    });

    // The stored row, arriving through the cache after the save.
    rerender({ current: stored });

    expect(result.current.form.getValues("summary")).toBe("Typed since");
    expect(result.current.form.getValues("title")).toBe("Saved");
  });

  it("resets to any other arrival of the same entry, discarding unsaved edits", () => {
    const { result, rerender } = renderWith(saved);
    act(() => {
      result.current.form.setValue("summary", "Unsaved", { shouldDirty: true });
    });

    // A restored version: a new row nobody here saved.
    rerender({
      current: {
        ...saved,
        summary: "Restored",
        updatedAt: "2026-10-17T12:09:00.000Z",
      },
    });

    expect(result.current.form.getValues("summary")).toBe("Restored");
    expect(result.current.form.formState.isDirty).toBe(false);
  });

  it("starts clean for a different entry", () => {
    const { result, rerender } = renderWith(saved);
    act(() => {
      result.current.form.setValue("summary", "Unsaved", { shouldDirty: true });
    });

    rerender({ current: { ...saved, id: "e2", summary: "Other entry" } });

    expect(result.current.form.getValues("summary")).toBe("Other entry");
    expect(result.current.form.formState.isDirty).toBe(false);
  });
});
