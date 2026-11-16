// @vitest-environment jsdom
/**
 * The top bar's Preview: the editor's own preview, offered only where one
 * exists, showing what the canvas shows by saving a draft first.
 *
 * @module admin/editor/preview-button.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Outcome =
  | { ok: true }
  | { ok: false; reason: string; message: string; reported?: true };
type Step = () => Promise<boolean>;

let preview: { open: (before?: Step) => void } | null = null;
let actions: {
  saveState: { kind: string };
  actions?: { id: string; disabledReason?: string }[];
  saveWithoutPublishing?: () => Promise<Outcome>;
} | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentPreview: () => preview,
  // The real hook always lists the actions; where a case names none, Save is
  // offered and can run.
  useDocumentActions: () =>
    actions === null ? null : { actions: [{ id: "save" }], ...actions },
}));

const toastError = vi.fn();
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/ui")>()),
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

const { PreviewButton } = await import("./preview-button");

afterEach(() => {
  cleanup();
  preview = null;
  actions = null;
  toastError.mockReset();
});

/** Presses the button and hands back the step it gave the preview, if any. */
function press(name: string): { open: ReturnType<typeof vi.fn> } {
  const open = vi.fn();
  preview = { open };
  render(<PreviewButton />);
  fireEvent.click(screen.getByRole("button", { name }));
  expect(open).toHaveBeenCalledTimes(1);
  return { open };
}

async function runStep(open: ReturnType<typeof vi.fn>): Promise<boolean> {
  const step = open.mock.calls[0]?.[0] as Step | undefined;
  expect(step).toBeTypeOf("function");
  let answer = false;
  await act(async () => {
    answer = await (step as Step)();
  });
  return answer;
}

describe("PreviewButton", () => {
  it("opens the saved document as it is when nothing is unsaved", () => {
    const saveWithoutPublishing = vi.fn(() => Promise.resolve({ ok: true }));
    actions = { saveState: { kind: "saved" }, saveWithoutPublishing };
    const { open } = press("Preview");
    // No step: the saved version already is what the canvas shows.
    expect(open.mock.calls[0]).toEqual([]);
    expect(saveWithoutPublishing).not.toHaveBeenCalled();
  });

  it("says Preview in words, not only to a screen reader", () => {
    // An eye alone is a guess at what the button opens.
    preview = { open: vi.fn() };
    actions = {
      saveState: { kind: "saved" },
      saveWithoutPublishing: () => Promise.resolve({ ok: true }),
    };
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
    const button = screen.getByRole("button", { name: /preview/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  describe("with unsaved changes", () => {
    it("reads Save and preview, saves a draft in the claimed tab, then lets it open", async () => {
      const saveWithoutPublishing = vi.fn(() => Promise.resolve({ ok: true }));
      actions = { saveState: { kind: "unsaved" }, saveWithoutPublishing };
      const { open } = press("Save and preview");
      // Nothing is saved before the tab is claimed: the preview runs the
      // step once it holds the tab, so the popup keeps the click's gesture.
      expect(saveWithoutPublishing).not.toHaveBeenCalled();
      expect(await runStep(open)).toBe(true);
      expect(saveWithoutPublishing).toHaveBeenCalledTimes(1);
      expect(toastError).not.toHaveBeenCalled();
    });

    it("also saves first after a save that failed, whose work is still unstored", async () => {
      const saveWithoutPublishing = vi.fn(() => Promise.resolve({ ok: true }));
      actions = {
        saveState: { kind: "failed" },
        actions: [{ id: "save" }],
        saveWithoutPublishing,
      };
      const { open } = press("Save and preview");
      expect(await runStep(open)).toBe(true);
      expect(saveWithoutPublishing).toHaveBeenCalledTimes(1);
    });

    it("still saves first after a failure while Save is held, and says why it can't", async () => {
      // A failed save, then a colleague takes the document: the edits are
      // still unstored, so the stale saved version must not open as if it
      // were the canvas. The save refuses, the tab closes, and the reason shows.
      const saveWithoutPublishing = vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          reason: "refused",
          message: "This document is being edited elsewhere",
        })
      );
      actions = {
        saveState: { kind: "failed" },
        actions: [
          {
            id: "save",
            disabledReason: "This document is being edited elsewhere",
          },
        ],
        saveWithoutPublishing,
      };
      const { open } = press("Save and preview");
      expect(await runStep(open)).toBe(false);
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't save, so the preview didn't open.",
        { description: "This document is being edited elsewhere" }
      );
    });

    it("stops the preview and says why when the save throws", async () => {
      actions = {
        saveState: { kind: "unsaved" },
        saveWithoutPublishing: () => Promise.reject(new Error("Offline.")),
      };
      const { open } = press("Save and preview");
      expect(await runStep(open)).toBe(false);
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't save, so the preview didn't open.",
        { description: "Offline." }
      );
    });

    it("stops the preview and shows the save's error when the draft save fails", async () => {
      actions = {
        saveState: { kind: "unsaved" },
        saveWithoutPublishing: () =>
          Promise.resolve({
            ok: false,
            reason: "failed",
            message: "The server could not be reached.",
          }),
      };
      const { open } = press("Save and preview");
      // false: the preview closes the tab it claimed and opens nothing.
      expect(await runStep(open)).toBe(false);
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't save, so the preview didn't open.",
        { description: "The server could not be reached." }
      );
    });

    it("stops quietly when the author said no to a question the save asked", async () => {
      actions = {
        saveState: { kind: "unsaved" },
        saveWithoutPublishing: () =>
          Promise.resolve({ ok: false, reason: "cancelled", message: "" }),
      };
      const { open } = press("Save and preview");
      expect(await runStep(open)).toBe(false);
      expect(toastError).not.toHaveBeenCalled();
    });

    it("says nothing twice when the save has already told the author", async () => {
      actions = {
        saveState: { kind: "unsaved" },
        saveWithoutPublishing: () =>
          Promise.resolve({
            ok: false,
            reason: "invalid",
            message: "Fix the highlighted fields.",
            reported: true,
          }),
      };
      const { open } = press("Save and preview");
      expect(await runStep(open)).toBe(false);
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  describe("where no save would keep the work unpublished", () => {
    // Someone who may not save, or a page whose Save would publish it: a
    // preview never saves there, so it says which version it shows.
    it("reads Preview the saved version and opens it without saving", () => {
      actions = { saveState: { kind: "unsaved" } };
      const { open } = press("Preview the saved version");
      expect(open.mock.calls[0]).toEqual([]);
    });

    it("reads Preview the saved version with nothing unsaved too", () => {
      actions = { saveState: { kind: "saved" } };
      press("Preview the saved version");
    });
  });
});
