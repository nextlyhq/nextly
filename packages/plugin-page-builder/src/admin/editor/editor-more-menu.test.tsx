// @vitest-environment jsdom
/**
 * The builder's ⋯ menu: "Open as form", and the editor's own pin action, run
 * through the document's actions so its words, toast and Undo are the entry
 * page's.
 *
 * @module admin/editor/editor-more-menu.test
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Action = { id: string; label: string; disabledReason?: string };

let actions: { actions: Action[]; run: (id: string) => unknown } | null = null;
const run = vi.fn(() => Promise.resolve({ ok: true }));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // The id core gives the pin action, as the SDK publishes it.
  PIN_TO_DASHBOARD_ACTION: "pin-to-dashboard",
  useDocumentActions: () => actions,
}));

const { EditorMoreMenu } = await import("./editor-more-menu");

// What Radix's menu reaches for and jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

/** The document's actions, as the editor lists them, with Save among them. */
function offering(...extra: Action[]): void {
  actions = {
    actions: [{ id: "save", label: "Save" }, ...extra],
    run,
  };
}

const PIN: Action = { id: "pin-to-dashboard", label: "Pin to dashboard" };

async function openMenu(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
}

const rows = (): string[] =>
  screen.getAllByRole("menuitem").map(row => row.textContent ?? "");

beforeEach(() => {
  actions = null;
  run.mockClear();
});
afterEach(cleanup);

describe("the builder's ⋯ menu", () => {
  it("offers Open as form and the pin, in that order, and Open as form leaves for the form", async () => {
    offering(PIN);
    const openAsForm = vi.fn();
    render(<EditorMoreMenu onOpenAsForm={openAsForm} />);
    await openMenu();

    // Save is the bar's own; the menu holds only what the bar doesn't.
    expect(rows()).toEqual(["Open as form", "Pin to dashboard"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Open as form" }));
    expect(openAsForm).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the editor's own pin action, in the words the editor gives it", async () => {
    // Unpinning is the same action in its other words: the menu shows what
    // the editor says, rather than deciding the verb itself.
    offering({ ...PIN, label: "Unpin from dashboard" });
    render(<EditorMoreMenu onOpenAsForm={vi.fn()} />);
    await openMenu();

    await userEvent.click(
      screen.getByRole("menuitem", { name: "Unpin from dashboard" })
    );
    expect(run).toHaveBeenCalledWith("pin-to-dashboard");
  });

  it("shows why the pin can't run now, and doesn't run it", async () => {
    offering({ ...PIN, disabledReason: "Saving your pin…" });
    render(<EditorMoreMenu onOpenAsForm={vi.fn()} />);
    await openMenu();

    const row = screen.getByRole("menuitem", { name: "Pin to dashboard" });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("title")).toBe("Saving your pin…");
    await userEvent.click(row);
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves the pin out where the document offers none, and keeps Open as form", async () => {
    offering();
    render(<EditorMoreMenu onOpenAsForm={vi.fn()} />);
    await openMenu();

    expect(rows()).toEqual(["Open as form"]);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("leaves Open as form out where the editor offers no way out, and keeps the pin", async () => {
    offering(PIN);
    render(<EditorMoreMenu onOpenAsForm={undefined} />);
    await openMenu();

    expect(rows()).toEqual(["Pin to dashboard"]);
  });

  it("draws nothing where neither is offered", () => {
    offering();
    render(<EditorMoreMenu onOpenAsForm={undefined} />);
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });
});
