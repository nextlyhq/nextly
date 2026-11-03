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
let actions: { saveState: { kind: string } } | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentPreview: () => preview,
  useDocumentActions: () => actions,
}));

const { PreviewButton } = await import("./preview-button");

afterEach(() => {
  cleanup();
  preview = null;
  actions = null;
});

describe("PreviewButton", () => {
  it("opens the document's preview", () => {
    const open = vi.fn();
    preview = { open };
    render(<PreviewButton />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("says Preview in words, not only to a screen reader", () => {
    // An eye alone is a guess at what the button opens.
    preview = { open: vi.fn() };
    render(<PreviewButton />);
    const button = screen.getByRole("button", { name: "Preview" });
    expect(button.textContent).toBe("Preview");
    expect(button.getAttribute("aria-label")).toBeNull();
  });

  it("draws nothing where the editor offers no preview", () => {
    // No preview configured, an entry never saved, or a reader: a button that
    // opens nothing would read as broken.
    preview = null;
    const { container } = render(<PreviewButton />);
    expect(container.firstChild).toBeNull();
  });

  it("is unavailable while the document is being saved, as the admin's own Preview is", () => {
    // A preview minted mid-save could show the revision before it.
    preview = { open: vi.fn() };
    actions = { saveState: { kind: "saving" } };
    render(<PreviewButton />);
    const button = screen.getByRole("button", { name: "Preview" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("is available once the save has finished", () => {
    preview = { open: vi.fn() };
    actions = { saveState: { kind: "unsaved" } };
    render(<PreviewButton />);
    const button = screen.getByRole("button", { name: "Preview" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
