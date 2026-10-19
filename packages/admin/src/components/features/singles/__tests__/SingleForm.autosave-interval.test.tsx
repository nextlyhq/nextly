/**
 * The Single editor records recovery points at the interval the Single
 * configures, rather than at the editor's own fixed default.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render } from "@admin/__tests__/utils";

const { useDocumentAutosave } = vi.hoisted(() => ({
  useDocumentAutosave: vi.fn(() => ({ status: "idle", lastSavedAt: null })),
}));

// Spied for its options: the interval it is handed is the thing under test.
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave,
}));

import {
  SingleForm,
  type SingleSchema,
  type SingleDocumentData,
} from "../SingleForm";

const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
} as unknown as SingleDocumentData;

function schemaWith(versions: unknown): SingleSchema {
  return {
    slug: "homepage",
    label: "Homepage",
    fields: [{ type: "text", name: "title", label: "Title" }],
    versions,
  } as unknown as SingleSchema;
}

describe("SingleForm autosave interval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records at the interval the Single configures", () => {
    render(
      <SingleForm
        schema={schemaWith({
          enabled: true,
          drafts: {
            enabled: true,
            autosave: { enabled: true, intervalMs: 9000 },
          },
        })}
        document={document}
        onSubmit={vi.fn()}
      />
    );

    expect(useDocumentAutosave).toHaveBeenCalledWith(
      expect.objectContaining({ debounceMs: 9000 })
    );
  });

  it("keeps the editor's default when the Single configures none", () => {
    render(
      <SingleForm
        schema={schemaWith(null)}
        document={document}
        onSubmit={vi.fn()}
      />
    );

    const calls = useDocumentAutosave.mock.calls as unknown as [
      { debounceMs?: number },
    ][];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0].debounceMs).toBeUndefined();
  });
});
