// @vitest-environment jsdom
/**
 * The builder's save verbs, from the editor's own actions.
 *
 * What these pin is that the bar offers what the header offers and runs it the
 * same way: the toolbar's verbs and the leading one, never the document menu;
 * pressing one runs that action; a refusal keeps the control named and says
 * why, rather than running it; and outside an editor nothing is drawn.
 */
import type {
  DocumentAction,
  DocumentActions,
  DocumentSaveState,
} from "@nextlyhq/plugin-sdk/admin";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let offered: DocumentActions | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentActions: () => offered,
}));

const { DocumentActionButtons } = await import("./document-action-buttons");

const run = vi.fn(async () => ({ ok: true as const }));
const saved: DocumentSaveState = { kind: "saved" } as DocumentSaveState;

function actions(...list: DocumentAction[]): DocumentActions {
  return {
    actions: list,
    primary: list.find(action => action.placement === "primary"),
    run,
    saveState: saved,
  } as DocumentActions;
}

const publish = {
  id: "publish",
  label: "Publish",
  placement: "primary",
} as DocumentAction;
const saveDraft = {
  id: "save",
  label: "Save draft",
  placement: "toolbar",
} as DocumentAction;
const duplicate = {
  id: "duplicate",
  label: "Duplicate",
  placement: "menu",
} as DocumentAction;

beforeEach(() => {
  run.mockClear();
  offered = null;
});

afterEach(cleanup);

describe("DocumentActionButtons", () => {
  it("draws the toolbar's verbs and then the leading one, and not the menu", () => {
    offered = actions(publish, saveDraft, duplicate);
    render(<DocumentActionButtons />);

    expect(
      screen.getAllByRole("button").map(button => button.textContent)
    ).toEqual(["Save draft", "Publish"]);
  });

  it("runs the action whose control was pressed", () => {
    offered = actions(publish, saveDraft);
    render(<DocumentActionButtons />);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(run).toHaveBeenCalledWith("publish");
  });

  it("runs Save while a write the page depends on is still saving, as the header does", () => {
    // "saving" here is a tracked write in flight, not a save: the runner waits
    // for it and then stores, so the bar must not refuse on its own.
    offered = {
      ...actions(publish, saveDraft),
      saveState: { kind: "saving" } as DocumentSaveState,
    };
    render(<DocumentActionButtons />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(run).toHaveBeenCalledWith("save");
    expect(
      screen
        .getByRole("button", { name: "Save draft" })
        .getAttribute("aria-disabled")
    ).toBeNull();
  });

  it("keeps a refused action named, says why, and does not run it", () => {
    offered = actions({ ...publish, disabledReason: "Reading a past version" });
    render(<DocumentActionButtons />);

    const button = screen.getByRole("button", { name: "Publish" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("title")).toBe("Reading a past version");
    fireEvent.click(button);
    expect(run).not.toHaveBeenCalled();
  });

  it("draws nothing outside an editor", () => {
    offered = null;
    const { container } = render(<DocumentActionButtons />);
    expect(container.textContent).toBe("");
  });
});
