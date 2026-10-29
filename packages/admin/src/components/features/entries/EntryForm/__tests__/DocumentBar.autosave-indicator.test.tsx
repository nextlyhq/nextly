/**
 * What the header's save indicator reports, from the editor's own state.
 *
 * It reports the document's save, never the recovery point: these replace the
 * cases that pinned the indicator as a recovery-point indicator, whose
 * "Saved" meant a recovery point had been stored and whose "Saving..." meant
 * one was being written. Each case below is the document-save answer to the
 * same situation one of those described.
 */
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BarUnderTest as DocumentBar } from "./bar-under-test";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

function Harness({
  autosaveEnabled = true,
  isDirty = false,
  isSubmitting = false,
  autosaveLastSavedAt = null,
  pendingRecoveryAt = null,
}: {
  autosaveEnabled?: boolean;
  isDirty?: boolean;
  isSubmitting?: boolean;
  autosaveLastSavedAt?: Date | null;
  pendingRecoveryAt?: Date | null;
}) {
  const methods = useForm({ defaultValues: { title: "" } });
  return (
    <FormProvider {...methods}>
      <DocumentBar
        mode="edit"
        hasStatus
        isDirty={isDirty}
        isSubmitting={isSubmitting}
        entry={{ id: "e1", status: "draft" }}
        collectionSlug="posts"
        autosaveEnabled={autosaveEnabled}
        autosaveLastSavedAt={autosaveLastSavedAt}
        pendingRecoveryAt={pendingRecoveryAt}
        onSaveDraft={vi.fn()}
        onPublish={vi.fn()}
        onSaveChanges={vi.fn()}
        onSaveWorkingDraft={vi.fn()}
        onUnpublish={vi.fn()}
        onDiscardWorkingDraft={vi.fn()}
      />
    </FormProvider>
  );
}

/** A control the header always renders, asserted before an absence. */
function headerRendered() {
  expect(
    screen.getByRole("button", { name: /save draft/i })
  ).toBeInTheDocument();
}

describe("DocumentBar save indicator", () => {
  it("reports an unstored change before any recovery point exists", () => {
    render(<Harness isDirty />);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("does not call a stored recovery point a save", () => {
    render(
      <Harness autosaveLastSavedAt={new Date("2026-08-17T09:00:00.000Z")} />
    );
    headerRendered();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("reports a save in flight, not a recovery point being written", () => {
    render(<Harness isDirty isSubmitting />);
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("reports unstored work on a document recovery points cannot be recorded for", () => {
    // An entry never saved has no recovery point, but its work is no more
    // stored for that: the save indicator says so.
    render(<Harness autosaveEnabled={false} isDirty />);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("shows nothing for an opened document with no change", () => {
    render(<Harness />);
    headerRendered();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("reports unstored edits that live only in a newer recovery point", () => {
    render(<Harness pendingRecoveryAt={new Date()} />);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});
