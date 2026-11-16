// @vitest-environment jsdom
/**
 * The top bar's Preview: a split button. The press previews this version,
 * showing what the canvas shows by saving a draft first; its arrow opens a
 * menu holding "Preview this version" and "Preview as visitor", the author's
 * own view of the page as a visitor gets it.
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
import userEvent from "@testing-library/user-event";
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
type Visitor = Parameters<typeof PreviewButton>[0]["visitor"];

// What Radix's menu reaches for and jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

/** "Preview as visitor" as the editor hands it: off, and available. */
function visitorView(extra: Partial<Visitor> = {}): Visitor {
  return {
    on: false,
    onChange: () => undefined,
    unavailable: undefined,
    ...extra,
  };
}

afterEach(() => {
  cleanup();
  preview = null;
  actions = null;
  toastError.mockReset();
});

/** Presses the button and hands back the step it gave the preview, if any. */
function press(name = "Preview"): { open: ReturnType<typeof vi.fn> } {
  const open = vi.fn();
  preview = { open };
  render(<PreviewButton visitor={visitorView()} />);
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
    const { open } = press();
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
    render(<PreviewButton visitor={visitorView()} />);
    const button = screen.getByRole("button", { name: "Preview" });
    expect(button.textContent).toBe("Preview");
    expect(button.getAttribute("aria-label")).toBeNull();
  });

  it("offers only the visitor's view where the editor offers no preview", async () => {
    // No preview configured, an entry never saved, or a reader: there is no
    // press that would open nothing, but the visitor's view is the canvas's
    // own, so it stays where it can be found.
    preview = null;
    render(<PreviewButton visitor={visitorView()} />);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Preview as visitor" })
    ).toBeTruthy();
  });

  it("is unavailable while the document is being saved, as the admin's own Preview is", () => {
    // A preview minted mid-save could show the revision before it.
    preview = { open: vi.fn() };
    actions = { saveState: { kind: "saving" } };
    render(<PreviewButton visitor={visitorView()} />);
    const button = screen.getByRole("button", { name: "Preview" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  describe("with unsaved changes", () => {
    it("saves a draft in the claimed tab, then lets it open", async () => {
      const saveWithoutPublishing = vi.fn(() => Promise.resolve({ ok: true }));
      actions = { saveState: { kind: "unsaved" }, saveWithoutPublishing };
      const { open } = press();
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
      const { open } = press();
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
      const { open } = press();
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
      const { open } = press();
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
      const { open } = press();
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
      const { open } = press();
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
      const { open } = press();
      expect(await runStep(open)).toBe(false);
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  describe("where no save would keep the work unpublished", () => {
    // Someone who may not save, or a page whose Save would publish it: a
    // preview never saves there, so it says which version it shows.
    it("opens the saved version without saving", () => {
      actions = { saveState: { kind: "unsaved" } };
      const { open } = press();
      expect(open.mock.calls[0]).toEqual([]);
    });

    it("names it Preview the saved version, on the press and in the menu", async () => {
      preview = { open: vi.fn() };
      actions = { saveState: { kind: "unsaved" } };
      render(<PreviewButton visitor={visitorView()} />);
      expect(
        screen.getByRole("button", { name: "Preview" }).getAttribute("title")
      ).toBe("Preview the saved version");
      await openMenu();
      const item = screen.getByRole("menuitem", {
        name: "Preview the saved version",
      });
      expect(item.getAttribute("aria-describedby")).toBeNull();
      // Nothing is saved, so the menu never says a draft is.
      expect(item.textContent).toBe("Preview the saved version");
      expect(screen.queryByText("Saves a draft first")).toBeNull();
    });
  });
});

/** Opens the arrow's menu. */
async function openMenu(): Promise<void> {
  await userEvent.click(
    screen.getByRole("button", { name: "Preview options" })
  );
}

describe("the Preview menu", () => {
  it("holds Preview this version and Preview as visitor, each described", async () => {
    preview = { open: vi.fn() };
    actions = {
      saveState: { kind: "unsaved" },
      saveWithoutPublishing: () => Promise.resolve({ ok: true }),
    };
    render(<PreviewButton visitor={visitorView()} />);
    await openMenu();
    const rows = [
      ...screen.getAllByRole("menuitem"),
      ...screen.getAllByRole("menuitemcheckbox"),
    ];
    // Each named by its label, and described by the line under it.
    expect(
      rows.map(row => [
        row.getAttribute("aria-labelledby") === null
          ? ""
          : document.getElementById(row.getAttribute("aria-labelledby") ?? "")
              ?.textContent,
        document.getElementById(row.getAttribute("aria-describedby") ?? "")
          ?.textContent,
      ])
    ).toEqual([
      ["Preview this version", "Saves a draft first"],
      ["Preview as visitor", "Hides blocks whose conditions don’t match"],
    ]);
    expect(
      screen.getByRole("menuitem", { name: "Preview this version" })
    ).toBeTruthy();
  });

  it("says a draft is saved first only while there is unsaved work", async () => {
    preview = { open: vi.fn() };
    actions = {
      saveState: { kind: "saved" },
      saveWithoutPublishing: () => Promise.resolve({ ok: true }),
    };
    render(<PreviewButton visitor={visitorView()} />);
    await openMenu();
    const item = screen.getByRole("menuitem", { name: "Preview this version" });
    expect(item.textContent).toBe("Preview this version");
    expect(item.getAttribute("aria-describedby")).toBeNull();
  });

  it("previews this version from the menu as the press does, saving first", async () => {
    const open = vi.fn();
    preview = { open };
    const saveWithoutPublishing = vi.fn(() => Promise.resolve({ ok: true }));
    actions = { saveState: { kind: "unsaved" }, saveWithoutPublishing };
    render(<PreviewButton visitor={visitorView()} />);
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Preview this version" })
    );
    expect(open).toHaveBeenCalledTimes(1);
    // The same save-first step the press hands the preview.
    expect(await runStep(open)).toBe(true);
    expect(saveWithoutPublishing).toHaveBeenCalledTimes(1);
  });

  it("holds Preview this version while the document is being saved, and not the visitor's view", async () => {
    preview = { open: vi.fn() };
    actions = {
      saveState: { kind: "saving" },
      saveWithoutPublishing: () => Promise.resolve({ ok: true }),
    };
    render(<PreviewButton visitor={visitorView()} />);
    await openMenu();
    expect(
      screen
        .getByRole("menuitem", { name: "Preview this version" })
        .getAttribute("aria-disabled")
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Preview as visitor" })
        .hasAttribute("aria-disabled")
    ).toBe(false);
  });

  it("names it Preview the saved version with nothing unsaved too", async () => {
    preview = { open: vi.fn() };
    actions = { saveState: { kind: "saved" } };
    render(<PreviewButton visitor={visitorView()} />);
    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Preview the saved version" })
    ).toBeTruthy();
  });

  it("turns Preview as visitor on, and shows it checked while it is", async () => {
    preview = { open: vi.fn() };
    actions = { saveState: { kind: "saved" } };
    const onChange = vi.fn();
    const { rerender } = render(
      <PreviewButton visitor={visitorView({ onChange })} />
    );
    await openMenu();
    const item = screen.getByRole("menuitemcheckbox", {
      name: "Preview as visitor",
    });
    expect(item.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(item);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<PreviewButton visitor={visitorView({ on: true, onChange })} />);
    await openMenu();
    const checked = screen.getByRole("menuitemcheckbox", {
      name: "Preview as visitor",
    });
    expect(checked.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(checked);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("lists Preview as visitor disabled, with the reason in place of what it does", async () => {
    preview = { open: vi.fn() };
    actions = { saveState: { kind: "saved" } };
    const onChange = vi.fn();
    render(
      <PreviewButton
        visitor={visitorView({
          onChange,
          unavailable: "No block on this page has conditions",
        })}
      />
    );
    await openMenu();
    const item = screen.getByRole("menuitemcheckbox", {
      name: "Preview as visitor",
    });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    // The reason in place of what it does, shown and described.
    expect(item.textContent).toBe(
      "Preview as visitorNo block on this page has conditions"
    );
    expect(
      document.getElementById(item.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toBe("No block on this page has conditions");
    await userEvent.click(item);
    expect(onChange).not.toHaveBeenCalled();
  });
});
