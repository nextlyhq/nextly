/**
 * The document's actions as one control, for a bar with room for one: the
 * leading action, and on its arrow the save beside it, the other ways to
 * publish and Unpublish, each with the model's reason when it is held.
 *
 * @module components/features/entries/EntryForm/__tests__/DocumentActionBar.compact.test
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import {
  CompactDocumentActionBar,
  type ActionBinding,
} from "../DocumentActionBar";
import type { EditorDocumentAction } from "../document-actions";

const PUBLISH: EditorDocumentAction = {
  id: "publish",
  label: "Publish",
  placement: "primary",
};
const SAVE: EditorDocumentAction = {
  id: "save",
  label: "Save",
  placement: "primary",
};
const SAVE_DRAFT: EditorDocumentAction = {
  id: "save",
  label: "Save draft",
  placement: "toolbar",
};
const SCHEDULE: EditorDocumentAction = {
  id: "schedule-publish",
  label: "Schedule publish…",
  placement: "publish-menu",
};
const DUPLICATE: EditorDocumentAction = {
  id: "duplicate",
  label: "Duplicate",
  placement: "menu",
  group: "document",
};
const DISCARD: EditorDocumentAction = {
  id: "discard-changes",
  label: "Discard changes",
  placement: "menu",
  group: "danger",
  destructive: true,
};
const UNPUBLISH: EditorDocumentAction = {
  id: "unpublish",
  label: "Unpublish",
  placement: "menu",
  group: "danger",
  destructive: true,
};
const DELETE: EditorDocumentAction = {
  id: "delete",
  label: "Delete",
  placement: "menu",
  group: "danger",
  destructive: true,
};

function bindings(
  over: Record<string, ActionBinding | undefined> = {}
): Record<string, ActionBinding | undefined> {
  return {
    publish: { onSelect: vi.fn() },
    save: { onSelect: vi.fn() },
    "schedule-publish": { onSelect: vi.fn() },
    duplicate: { onSelect: vi.fn() },
    "discard-changes": { onSelect: vi.fn() },
    unpublish: { onSelect: vi.fn() },
    delete: { onSelect: vi.fn() },
    ...over,
  };
}

async function openArrow(name: string) {
  await userEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("menu");
}

const rows = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map(item => item.textContent);

describe("the compact document control", () => {
  it("puts Save draft, the ways to publish and Unpublish on Publish's arrow, and nothing else", async () => {
    render(
      <CompactDocumentActionBar
        actions={[
          SAVE_DRAFT,
          PUBLISH,
          DUPLICATE,
          SCHEDULE,
          DISCARD,
          UNPUBLISH,
          DELETE,
        ]}
        bindings={bindings()}
      />
    );
    // The leading action is the only button besides its arrow: no Save draft
    // beside it and no More menu.
    expect(
      screen.getAllByRole("button").map(button => button.textContent)
    ).toEqual(["Publish", ""]);
    const menu = await openArrow("More ways to publish");
    expect(rows(menu)).toEqual([
      "Save draft",
      "Schedule publish…",
      "Unpublish",
    ]);
    // Unpublish sits apart, below a rule, in the destructive colour.
    expect(within(menu).getByRole("separator")).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: "Unpublish" }).className
    ).toContain("text-destructive");
  });

  it("names the arrow for what it holds when saving leads", async () => {
    // A published page with nothing pending: saving leads, so an arrow named
    // for publishing would offer Unpublish as a way to publish.
    render(
      <CompactDocumentActionBar
        actions={[SAVE, UNPUBLISH, DELETE]}
        bindings={bindings()}
      />
    );
    expect(
      screen.queryByRole("button", { name: "More ways to publish" })
    ).toBeNull();
    const menu = await openArrow("More document actions");
    expect(rows(menu)).toEqual(["Unpublish"]);
  });

  it("runs the row chosen", async () => {
    const unpublish = vi.fn();
    render(
      <CompactDocumentActionBar
        actions={[SAVE, UNPUBLISH]}
        bindings={bindings({ unpublish: { onSelect: unpublish } })}
      />
    );
    await openArrow("More document actions");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Unpublish" })
    );
    expect(unpublish).toHaveBeenCalledTimes(1);
  });

  it("shows a held row's reason as text, and does not run it", async () => {
    const unpublish = vi.fn();
    const reason =
      "You do not have permission to unpublish in this collection.";
    render(
      <CompactDocumentActionBar
        actions={[SAVE, { ...UNPUBLISH, disabledReason: reason }]}
        bindings={bindings({ unpublish: { onSelect: unpublish } })}
      />
    );
    const menu = await openArrow("More document actions");
    const row = within(menu).getByRole("menuitem", { name: /Unpublish/ });
    expect(row.textContent).toContain(reason);
    await userEvent.click(row);
    expect(unpublish).not.toHaveBeenCalled();
  });

  it("disables a held leading action for real, and says why", async () => {
    // A control only marked aria-disabled kept the enabled look and cursor,
    // and read as a button that did nothing when pressed.
    const publish = vi.fn();
    const reason = "You are viewing a past version.";
    render(
      <CompactDocumentActionBar
        actions={[{ ...PUBLISH, disabledReason: reason }, SCHEDULE]}
        bindings={bindings({ publish: { onSelect: publish } })}
      />
    );
    const button = screen.getByRole("button", { name: "Publish" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe(reason);
    await userEvent.click(button);
    expect(publish).not.toHaveBeenCalled();
  });

  it("draws no arrow when there is nothing to put on it", () => {
    render(
      <CompactDocumentActionBar
        actions={[SAVE, DUPLICATE, DELETE]}
        bindings={bindings()}
      />
    );
    expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual([
      "Save",
    ]);
  });

  it("draws nothing when nothing leads and it keeps no row", () => {
    // Writes refused: only reading actions are left, and this bar keeps none
    // of them, so an empty menu would be a control that does nothing.
    const VIEW_API: EditorDocumentAction = {
      id: "view-api",
      label: "View API response",
      placement: "menu",
      group: "document",
    };
    const { container } = render(
      <CompactDocumentActionBar
        actions={[VIEW_API]}
        bindings={bindings({ "view-api": { onSelect: vi.fn() } })}
      />
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("keeps the rows in a menu of their own when nothing leads", async () => {
    // A reader who may unpublish but not edit: no leading action, and the
    // row they may use still has somewhere to be.
    render(
      <CompactDocumentActionBar
        actions={[UNPUBLISH, DELETE]}
        bindings={bindings()}
      />
    );
    const menu = await openArrow("More actions");
    expect(rows(menu)).toEqual(["Unpublish"]);
  });
});
