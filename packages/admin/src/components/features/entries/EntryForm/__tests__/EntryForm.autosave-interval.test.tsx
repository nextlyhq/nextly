/**
 * The entry editor records recovery points at the interval the collection
 * configures, rather than at the editor's own fixed default.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render } from "@admin/__tests__/utils";

const { useDocumentAutosave } = vi.hoisted(() => ({
  useDocumentAutosave: vi.fn(() => ({
    status: "idle",
    lastSavedAt: null,
  })),
}));

vi.mock("../DocumentBar", () => ({ DocumentBar: () => null }));
// Spied for its options: the interval it is handed is the thing under test.
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave,
}));

import { EntryForm } from "../EntryForm";

const entry = { id: "e1", title: "Hello" } as never;

function collectionWith(versions: unknown) {
  return {
    name: "posts",
    label: "Posts",
    fields: [{ name: "title", type: "text", label: "Title" }],
    versions,
  } as never;
}

describe("EntryForm autosave interval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records at the interval the collection configures", () => {
    render(
      <EntryForm
        collection={collectionWith({
          enabled: true,
          drafts: {
            enabled: true,
            autosave: { enabled: true, intervalMs: 7000 },
          },
        })}
        entry={entry}
        mode="edit"
      />
    );

    expect(useDocumentAutosave).toHaveBeenCalledWith(
      expect.objectContaining({ debounceMs: 7000 })
    );
  });

  it("keeps the editor's default when the collection configures none", () => {
    render(
      <EntryForm collection={collectionWith(null)} entry={entry} mode="edit" />
    );

    const calls = useDocumentAutosave.mock.calls as unknown as [
      { debounceMs?: number },
    ][];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0].debounceMs).toBeUndefined();
  });
});
