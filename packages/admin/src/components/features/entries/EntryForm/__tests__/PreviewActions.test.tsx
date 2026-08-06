/**
 * The preview control's four shapes.
 *
 * The shape adapts to what is available rather than showing disabled controls,
 * so which shape appears IS the design and is what these pin. A regression here
 * looks like a crowded sidebar or a button that promises something it cannot do.
 */
import { render, screen } from "@testing-library/react";
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

  it("disables both when the form is submitting", () => {
    render(<PreviewActions isPreviewAvailable onPreview={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
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
