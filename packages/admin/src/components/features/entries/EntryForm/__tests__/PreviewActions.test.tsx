/**
 * The preview control's four shapes.
 *
 * The shape adapts to what is available rather than showing disabled controls,
 * so which shape appears IS the design and is what these pin. A regression here
 * looks like a crowded sidebar or a button that promises something it cannot do.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PreviewActions } from "../PreviewActions";

describe("PreviewActions", () => {
  it("renders nothing when neither action is available", () => {
    const { container } = render(<PreviewActions />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a plain button when only preview is available", () => {
    // The shape that existed before shareable links, unchanged: a collection
    // with no link capability must look exactly as it did.
    render(<PreviewActions isPreviewAvailable onPreview={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.queryByText("Copy shareable link")).not.toBeInTheDocument();
  });

  it("is a plain button when only the link is available", () => {
    // A collection with no configured preview URL can still have its drafts
    // shared, so the link is not gated behind preview being set up.
    render(<PreviewActions isLinkAvailable onCopyLink={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Copy shareable link" })
    ).toBeInTheDocument();
  });

  it("becomes one menu when both are available", () => {
    // Rather than a fourth top-level button beside Preview, Cancel and Save.
    render(
      <PreviewActions
        isPreviewAvailable
        onPreview={vi.fn()}
        isLinkAvailable
        onCopyLink={vi.fn()}
      />
    );

    // One control, and it says it opens a menu rather than previewing.
    const triggers = screen.getAllByRole("button");
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toHaveAttribute("aria-label", "Preview options");
  });

  it("disables the plain preview button when the form is submitting", () => {
    render(<PreviewActions isPreviewAvailable onPreview={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });

  it("stops both menu actions when a submit begins with the menu open", async () => {
    // The menu is uncontrolled, so it stays open across the state change that
    // starts a save. Disabling the trigger alone prevents the NEXT opening and
    // nothing inside the current one, which leaves an author able to mint a
    // link or open a preview racing the write already in flight.
    const onPreview = vi.fn();
    const onCopyLink = vi.fn();
    const user = userEvent.setup();
    const props = {
      isPreviewAvailable: true,
      onPreview,
      isLinkAvailable: true,
      onCopyLink,
    };

    const { rerender } = render(<PreviewActions {...props} />);
    await user.click(screen.getByRole("button", { name: "Preview options" }));

    const preview = await screen.findByRole("menuitem", { name: "Preview" });
    expect(preview).toBeInTheDocument();

    rerender(<PreviewActions {...props} disabled />);

    for (const name of ["Preview", "Copy shareable link"]) {
      const item = screen.getByRole("menuitem", { name });
      expect(item, name).toHaveAttribute("aria-disabled", "true");
      await user.click(item);
    }

    expect(onPreview).not.toHaveBeenCalled();
    expect(onCopyLink).not.toHaveBeenCalled();
  });

  it("does not offer a preview action without a handler for it", () => {
    // `isPreviewAvailable` and a missing handler is a caller bug; showing a
    // control that does nothing is the worse of the two ways to report it.
    render(
      <PreviewActions isPreviewAvailable isLinkAvailable onCopyLink={vi.fn()} />
    );

    expect(
      screen.getByRole("button", { name: "Copy shareable link" })
    ).toBeInTheDocument();
  });
});
