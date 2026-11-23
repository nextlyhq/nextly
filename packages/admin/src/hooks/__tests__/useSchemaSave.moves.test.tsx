// A save that moves a field into or out of a group sends the move on its preview and its apply,
// and is applied even where the preview finds no column to change (a move between two groups):
// its values move in the migration it writes. A field moved and renamed in the same save is
// refused before anything is asked of the server.
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import type { SchemaChangeConfirmation } from "@admin/components/features/schema-builder/types";
import type { PendingChange } from "@admin/lib/builder/pending-changes";
import type { SchemaPreviewResponse } from "@admin/services/schemaApi";
import type { FieldDefinition } from "@admin/types/collection";

import { useSchemaSave } from "../useSchemaSave";

const { toastError, startRestart, stopRestart } = vi.hoisted(() => ({
  toastError: vi.fn(),
  startRestart: vi.fn(),
  stopRestart: vi.fn(),
}));

vi.mock("@admin/components/ui", () => ({
  toast: { error: toastError, warning: vi.fn(), success: vi.fn() },
}));

vi.mock("@admin/context/RestartContext", () => ({
  useRestart: () => ({ startRestart, stopRestart }),
}));

const FIELDS = [{ name: "street", type: "text" }] as FieldDefinition[];

const preview = (
  overrides: Partial<SchemaPreviewResponse> = {}
): SchemaPreviewResponse => ({
  hasChanges: true,
  hasDestructiveChanges: false,
  classification: "safe",
  changes: { added: [], removed: [], changed: [], unchanged: [] },
  warnings: [],
  interactiveFields: [],
  ddlPreview: [],
  schemaVersion: 4,
  renamed: [],
  ...overrides,
});

const confirmationStub = (
  pending: SchemaPreviewResponse | null = null
): SchemaChangeConfirmation => ({
  preview: pending,
  previewId: pending === null ? 0 : 1,
  isOpen: pending !== null,
  isApplying: false,
  isBusy: false,
  request: vi.fn(),
  setOpen: vi.fn(),
  settle: vi.fn(),
  beginPreview: vi.fn(),
  endPreview: vi.fn(),
  beginApply: vi.fn(),
  endApply: vi.fn(),
});

/** `street` moved from the group `address` into the group `billing`. */
const MOVED: PendingChange = {
  kind: "moved",
  fieldId: "street",
  label: "Street",
  name: "street",
  type: "text",
  movedFrom: ["address", "street"],
  movedTo: ["billing", "street"],
};
const HINTS = {
  moves: [{ from: ["address", "street"], to: ["billing", "street"] }],
};

function setup(
  changes: PendingChange[],
  confirmation: SchemaChangeConfirmation,
  previewed: SchemaPreviewResponse
) {
  const previewFn = vi.fn(() => Promise.resolve(previewed));
  const applyFn = vi.fn(() => Promise.resolve({ success: true }));
  const onNoChanges = vi.fn();
  const { result } = renderHook(() =>
    useSchemaSave({
      slug: "posts",
      missingSlugMessage: "Collection slug is missing",
      label: "Posts",
      confirmation,
      getValidatedFields: () => FIELDS,
      preview: previewFn,
      apply: applyFn,
      onNoChanges,
      onApplied: vi.fn(),
      pendingChanges: changes,
    })
  );
  return { result, previewFn, applyFn, onNoChanges };
}

describe("a save that moves a field", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it("sends the move on its preview, and reviews a move no column shows", async () => {
    const confirmation = confirmationStub();
    const { result, previewFn, onNoChanges } = setup(
      [MOVED],
      confirmation,
      preview({ hasChanges: false })
    );

    act(() => result.current.handleSave());

    await waitFor(() => expect(confirmation.request).toHaveBeenCalled());
    expect(previewFn).toHaveBeenCalledWith(FIELDS, HINTS);
    expect(onNoChanges).not.toHaveBeenCalled();
  });

  it("applies the move with it, though the preview found no column to change", async () => {
    const reviewed = preview({ hasChanges: false });
    const { result, applyFn, onNoChanges } = setup(
      [MOVED],
      confirmationStub(reviewed),
      reviewed
    );

    act(() => result.current.confirmApply({}, []));

    await waitFor(() => expect(applyFn).toHaveBeenCalled());
    expect(applyFn).toHaveBeenCalledWith(FIELDS, 4, {}, [], [], HINTS);
    expect(onNoChanges).not.toHaveBeenCalled();
  });

  it("refuses a field moved and renamed in the same save, asking the server nothing", () => {
    const { result, previewFn } = setup(
      [
        { ...MOVED, name: "road" },
        {
          kind: "renamed",
          fieldId: "street",
          label: "Street",
          name: "road",
          previousName: "street",
          type: "text",
        },
      ],
      confirmationStub(),
      preview()
    );

    act(() => result.current.handleSave());

    expect(previewFn).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Save the move and the other change separately")
    );
  });
});
