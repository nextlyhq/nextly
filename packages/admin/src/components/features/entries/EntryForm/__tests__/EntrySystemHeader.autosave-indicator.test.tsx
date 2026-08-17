/**
 * When the recovery-point indicator is shown, and when it is not.
 *
 * The header's condition is only whether recording is POSSIBLE.
 * `AutoSaveIndicator` already decides whether it has anything to report and
 * returns null when it does not, so any second opinion here is a duplicate that
 * can disagree with it -- and did: gating on "status is non-idle OR a recovery
 * point exists" hid the indicator for the whole debounce window after the first
 * edit, which is precisely when a reader most needs telling their change is not
 * stored yet.
 */
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntrySystemHeader } from "../EntrySystemHeader";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

function Harness({
  autosaveEnabled,
  isDirty = false,
  autosaveStatus = "idle" as const,
  autosaveLastSavedAt = null,
}: {
  autosaveEnabled: boolean;
  isDirty?: boolean;
  autosaveStatus?: "idle" | "saving" | "saved" | "error";
  autosaveLastSavedAt?: Date | null;
}) {
  const methods = useForm({ defaultValues: { title: "" } });
  return (
    <FormProvider {...methods}>
      <EntrySystemHeader
        mode="edit"
        hasStatus
        isDirty={isDirty}
        entry={{ id: "e1", status: "draft" }}
        collectionSlug="posts"
        autosaveEnabled={autosaveEnabled}
        autosaveStatus={autosaveStatus}
        autosaveLastSavedAt={autosaveLastSavedAt}
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

describe("EntrySystemHeader autosave indicator", () => {
  /**
   * The regression this file exists for. First edit to a saved entry: the
   * debounce has not fired, so the status is still idle and no recovery point
   * exists. The reader must still be told the change is not stored.
   */
  it("reports an unstored change before the first recording", () => {
    render(<Harness autosaveEnabled isDirty />);

    expect(screen.getByText(/not saved/i)).toBeInTheDocument();
  });

  it("reports a stored recovery point once one exists", () => {
    render(
      <Harness
        autosaveEnabled
        autosaveLastSavedAt={new Date("2026-08-17T09:00:00.000Z")}
      />
    );

    expect(screen.getByText(/saved/i)).toBeInTheDocument();
  });

  it("reports the recording in progress", () => {
    render(<Harness autosaveEnabled isDirty autosaveStatus="saving" />);

    expect(screen.getByText(/saving/i)).toBeInTheDocument();
  });

  /**
   * An entry that has never been saved has no id for the endpoint to address,
   * so recording cannot happen and the indicator must stay absent rather than
   * promise a recovery point that will never be written.
   *
   * Dirty here deliberately: `isDirty` alone would render "Not saved", so this
   * separates "nothing to report" from "cannot record at all".
   */
  it("shows nothing while the document cannot be recorded against", () => {
    render(<Harness autosaveEnabled={false} isDirty />);

    expect(screen.queryByText(/not saved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/saving/i)).not.toBeInTheDocument();
  });

  /**
   * Enabled but with nothing to say: the component's own null return, not a
   * condition restated in the header.
   */
  it("shows nothing when there is no change and no recovery point", () => {
    render(<Harness autosaveEnabled />);

    expect(screen.queryByText(/not saved/i)).not.toBeInTheDocument();
  });
});
