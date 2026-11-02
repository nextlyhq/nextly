// @vitest-environment jsdom
/**
 * The top bar's Preview: the editor's own preview, offered only where one
 * exists.
 *
 * @module admin/editor/preview-button.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let preview: { open: () => void } | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentPreview: () => preview,
}));

const { PreviewButton } = await import("./preview-button");

afterEach(() => {
  cleanup();
  preview = null;
});

describe("PreviewButton", () => {
  it("opens the document's preview", () => {
    const open = vi.fn();
    preview = { open };
    render(<PreviewButton />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("draws nothing where the editor offers no preview", () => {
    // No preview configured, an entry never saved, or a reader: a button that
    // opens nothing would read as broken.
    preview = null;
    const { container } = render(<PreviewButton />);
    expect(container.firstChild).toBeNull();
  });
});
