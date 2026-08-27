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

  it("still offers the link when the flat permission list omits update", () => {
    // `update` can be granted by a code-first `access.update` rule that the
    // flat `update-{slug}` list does not carry, and the mint endpoint evaluates
    // that rule. Gating the control on the list would hide the link from an
    // author who can edit the document — the same reasoning the Discard Draft
    // affordance beside it is built on. The endpoint refuses a caller who
    // genuinely may not update.
    canMock.mockReturnValue(false);
    renderHeader();

    expect(
      screen.getByRole("button", { name: COPY_LABEL })
    ).toBeInTheDocument();
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

  it("uses a declared label VERBATIM on the pane toggle", () => {
    /*
     * `previewLabel` is a complete button label, not a noun. Collections
     * legitimately name one "View page" — the preview-link suite uses exactly
     * that — and interpolating it produced "Show View page", which is not
     * English. The state the prefix used to carry is reported by `aria-pressed`
     * and by the variant, which is how a toggle button reports itself.
     */
    renderHeader({
      previewLabel: "View page",
      onTogglePreviewPane: () => {},
      previewPaneOpen: false,
    });

    const toggle = screen.getByRole("button", { name: "View page" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/Show View page/)).toBeNull();
    expect(screen.queryByText(/Hide View page/)).toBeNull();
  });

  it("says what the click will do where no label was declared", () => {
    /*
     * The control. Dropping "Show"/"Hide" for every label would cost the
     * default case its plainest affordance for no reason — there is no verb to
     * collide with when the author supplied nothing.
     */
    renderHeader({ onTogglePreviewPane: () => {}, previewPaneOpen: false });

    expect(
      screen.getByRole("button", { name: "Show preview" })
    ).toBeInTheDocument();
  });

  it("reports the open state on a declared label through aria-pressed", () => {
    // Where the visible text no longer changes, this is the only thing that
    // tells a screen-reader user the pane is open.
    renderHeader({
      previewLabel: "View page",
      onTogglePreviewPane: () => {},
      previewPaneOpen: true,
    });

    expect(screen.getByRole("button", { name: "View page" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
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
