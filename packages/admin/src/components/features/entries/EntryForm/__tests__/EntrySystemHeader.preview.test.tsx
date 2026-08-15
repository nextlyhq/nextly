/**
 * The preview control in the standalone editor's action bar.
 *
 * `PreviewActions` decides its own shape and is covered by its own suite; what
 * is asserted here is that the header RENDERS it and supplies the halves it
 * owns. That is the property that was missing: the control, its service, its
 * hook and their tests all existed while nothing in the standalone editor
 * rendered any of them, so every component-level suite passed on a feature no
 * author could reach.
 */
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const { canMock } = vi.hoisted(() => ({ canMock: vi.fn() }));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (permission: string) => canMock(permission) as boolean,
}));

import { EntrySystemHeader } from "../EntrySystemHeader";

/**
 * The header reads form state through context, so it is given a real form:
 * a partial stub misses the ref plumbing `register` returns and fails for
 * reasons unrelated to what is under test.
 */
function WithForm({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

const COPY_LABEL = "Copy shareable link";

function renderHeader(overrides: Record<string, unknown> = {}) {
  return render(
    <WithForm>
      <EntrySystemHeader
        mode="edit"
        hasStatus={false}
        collectionSlug="posts"
        entry={{ id: "e1" } as never}
        isSubmitting={false}
        isDirty={false}
        isLinkAvailable
        onCopyLink={vi.fn()}
        {...overrides}
      />
    </WithForm>
  );
}

describe("EntrySystemHeader preview control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canMock.mockReturnValue(true);
  });

  it("offers the shareable link in the action bar", () => {
    renderHeader();

    expect(
      screen.getByRole("button", { name: COPY_LABEL })
    ).toBeInTheDocument();
  });

  it("mints through the handler it was given", async () => {
    const onCopyLink = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onCopyLink });

    await user.click(screen.getByRole("button", { name: COPY_LABEL }));

    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it("withholds the link from an author who cannot update the document", () => {
    // The permission half is ANDed in by the header rather than left to the
    // caller, so this stays closed however the caller answers.
    canMock.mockReturnValue(false);
    renderHeader();

    expect(
      screen.queryByRole("button", { name: COPY_LABEL })
    ).not.toBeInTheDocument();
  });

  it("asks about update on the document being edited", () => {
    // A permission resolved for a different slug would gate the control on
    // access to some other collection.
    renderHeader({ collectionSlug: "pages" });

    expect(canMock).toHaveBeenCalledWith("update-pages");
  });

  it("withholds the link when there is no saved document to name", () => {
    renderHeader({ mode: "create", entry: null, isLinkAvailable: false });

    expect(
      screen.queryByRole("button", { name: COPY_LABEL })
    ).not.toBeInTheDocument();
  });

  it("refuses a second mint while one is in flight", () => {
    renderHeader({ isCopyingLink: true });

    expect(screen.getByRole("button", { name: COPY_LABEL })).toBeDisabled();
  });

  it("refuses a mint while the form is submitting", () => {
    // Minting reads what is saved, so a submit in flight is a race with it.
    renderHeader({ isSubmitting: true });

    expect(screen.getByRole("button", { name: COPY_LABEL })).toBeDisabled();
  });

  it("renders nothing when neither action is available", () => {
    // A disabled control says "you cannot do this" without saying why, so the
    // header shows no preview affordance at all rather than a dead button.
    renderHeader({ isLinkAvailable: false, onCopyLink: undefined });

    expect(
      screen.queryByRole("button", { name: COPY_LABEL })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
  });
});
