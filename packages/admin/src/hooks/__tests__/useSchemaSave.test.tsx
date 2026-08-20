// The pipeline between Save and a changed schema. Each builder page ran its own
// copy, and the parts that matter are the ones that are invisible when they go
// wrong: an early return that skips `endApply` leaves the page permanently
// "applying", and a `stopRestart` missed on one branch leaves the restart
// overlay up over a page that has finished.
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import type { SchemaChangeConfirmation } from "@admin/components/features/schema-builder/types";
import type { SchemaPreviewResponse } from "@admin/services/schemaApi";
import type { FieldDefinition } from "@admin/types/collection";

import { useSchemaSave, type SchemaApplyOutcome } from "../useSchemaSave";

const { toastError, toastWarning, startRestart, stopRestart } = vi.hoisted(
  () => ({
    toastError: vi.fn(),
    toastWarning: vi.fn(),
    startRestart: vi.fn(),
    stopRestart: vi.fn(),
  })
);

vi.mock("@admin/components/ui", () => ({
  toast: { error: toastError, warning: toastWarning, success: vi.fn() },
}));

vi.mock("@admin/context/RestartContext", () => ({
  useRestart: () => ({ startRestart, stopRestart }),
}));

const FIELDS: FieldDefinition[] = [
  {
    name: "body",
    label: "Body",
    type: "text",
    required: false,
    unique: false,
    index: false,
  },
];

function preview(
  overrides: Partial<SchemaPreviewResponse> = {}
): SchemaPreviewResponse {
  return {
    hasChanges: true,
    hasDestructiveChanges: false,
    classification: "safe",
    changes: { added: [], removed: [], changed: [], unchanged: [] },
    warnings: [],
    interactiveFields: [],
    ddlPreview: [],
    schemaVersion: 9,
    renamed: [],
    ...overrides,
  };
}

function confirmationStub(
  pending: SchemaPreviewResponse | null = null
): SchemaChangeConfirmation {
  return {
    preview: pending,
    isOpen: pending !== null,
    isApplying: false,
    request: vi.fn(),
    setOpen: vi.fn(),
    settle: vi.fn(),
    beginApply: vi.fn(),
    endApply: vi.fn(),
  };
}

type Overrides = {
  slug?: string | undefined;
  confirmation?: SchemaChangeConfirmation;
  getValidatedFields?: () => FieldDefinition[] | null;
  previewFn?: (fields: FieldDefinition[]) => Promise<SchemaPreviewResponse>;
  applyFn?: () => Promise<SchemaApplyOutcome>;
  onNoChanges?: (fields: FieldDefinition[]) => void;
  onApplied?: (fields: FieldDefinition[]) => void | Promise<void>;
};

function setup(overrides: Overrides = {}) {
  const confirmation = overrides.confirmation ?? confirmationStub();
  const previewFn =
    overrides.previewFn ?? vi.fn(() => Promise.resolve(preview()));
  const applyFn =
    overrides.applyFn ?? vi.fn(() => Promise.resolve({ success: true }));
  const onNoChanges = overrides.onNoChanges ?? vi.fn();
  const onApplied = overrides.onApplied ?? vi.fn();

  const { result } = renderHook(() =>
    useSchemaSave({
      slug: "slug" in overrides ? overrides.slug : "posts",
      missingSlugMessage: "Collection slug is missing",
      label: "Posts",
      confirmation,
      getValidatedFields:
        overrides.getValidatedFields ??
        ((): FieldDefinition[] | null => FIELDS),
      preview: previewFn,
      apply: applyFn,
      onNoChanges,
      onApplied,
    })
  );

  return { result, confirmation, previewFn, applyFn, onNoChanges, onApplied };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleSave", () => {
  it("refuses without a slug and previews nothing", async () => {
    const { result, previewFn } = setup({ slug: undefined });
    await act(async () => result.current.handleSave());
    expect(toastError).toHaveBeenCalledWith("Collection slug is missing");
    expect(previewFn).not.toHaveBeenCalled();
  });

  // The fields failing validation has already been reported to the user by the
  // validator, so this path must stay silent and simply not preview.
  it("stops quietly when the fields do not validate", async () => {
    const { result, previewFn } = setup({ getValidatedFields: () => null });
    await act(async () => result.current.handleSave());
    expect(previewFn).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("persists settings and asks nothing when there is no schema change", async () => {
    const { result, confirmation, onNoChanges } = setup({
      previewFn: vi.fn(() => Promise.resolve(preview({ hasChanges: false }))),
    });
    await act(async () => result.current.handleSave());
    expect(onNoChanges).toHaveBeenCalledWith(FIELDS);
    expect(confirmation.request).not.toHaveBeenCalled();
  });

  it("puts a real schema change in front of the user", async () => {
    const changed = preview();
    const { result, confirmation, onNoChanges } = setup({
      previewFn: vi.fn(() => Promise.resolve(changed)),
    });
    await act(async () => result.current.handleSave());
    expect(confirmation.request).toHaveBeenCalledWith(changed);
    expect(onNoChanges).not.toHaveBeenCalled();
  });

  it("reports a failed preview and confirms nothing", async () => {
    const { result, confirmation } = setup({
      previewFn: vi.fn(() => Promise.reject(new Error("server exploded"))),
    });
    await act(async () => result.current.handleSave());
    expect(toastError).toHaveBeenCalledWith("server exploded");
    expect(confirmation.request).not.toHaveBeenCalled();
  });
});

describe("confirmApply", () => {
  it("applies the confirmed change and reports it once", async () => {
    const pending = preview();
    const confirmation = confirmationStub(pending);
    const { result, applyFn, onApplied } = setup({
      confirmation,
      applyFn: vi.fn(() =>
        Promise.resolve({ success: true, toastSummary: "1 field added" })
      ),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(FIELDS));
    // The version applied is the one the user was shown, not a re-read.
    expect(applyFn).toHaveBeenCalledWith(FIELDS, 9, {}, []);
    expect(startRestart).toHaveBeenCalledTimes(1);
    expect(stopRestart).toHaveBeenCalledWith(
      true,
      "Posts schema updated. 1 field added"
    );
    expect(confirmation.settle).toHaveBeenCalledTimes(1);
    expect(confirmation.beginApply).toHaveBeenCalledTimes(1);
    expect(confirmation.endApply).toHaveBeenCalledTimes(1);
  });

  // "no changes" is the server saying the apply was a no-op, which reads as
  // nonsense appended to a success line.
  it("leaves a no-op summary off the success message", async () => {
    const confirmation = confirmationStub(preview());
    const { result } = setup({
      confirmation,
      applyFn: vi.fn(() =>
        Promise.resolve({ success: true, toastSummary: "no changes" })
      ),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() =>
      expect(stopRestart).toHaveBeenCalledWith(true, "Posts schema updated")
    );
  });

  it("reports a refused apply, and does not clear the pending change", async () => {
    const confirmation = confirmationStub(preview());
    const { result, onApplied } = setup({
      confirmation,
      applyFn: vi.fn(() =>
        Promise.resolve({ success: false, message: "column still in use" })
      ),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() =>
      expect(stopRestart).toHaveBeenCalledWith(false, "column still in use")
    );
    expect(confirmation.settle).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    // Still released, or the page would sit "applying" forever.
    expect(confirmation.endApply).toHaveBeenCalledTimes(1);
  });

  it("releases the applying state when the apply throws", async () => {
    const confirmation = confirmationStub(preview());
    const { result } = setup({
      confirmation,
      applyFn: vi.fn(() => Promise.reject(new Error("network died"))),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() => expect(confirmation.endApply).toHaveBeenCalledTimes(1));
    expect(stopRestart).toHaveBeenCalledWith(false, "network died");
    expect(confirmation.settle).not.toHaveBeenCalled();
  });

  it("does nothing when there is no pending change to apply", async () => {
    const confirmation = confirmationStub(null);
    const { result, applyFn } = setup({ confirmation });

    await act(async () => result.current.confirmApply({}, []));

    expect(applyFn).not.toHaveBeenCalled();
    expect(startRestart).not.toHaveBeenCalled();
    expect(confirmation.beginApply).not.toHaveBeenCalled();
  });
});
