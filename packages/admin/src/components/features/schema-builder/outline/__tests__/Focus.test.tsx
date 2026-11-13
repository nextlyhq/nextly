/**
 * Focus: one container on its own, under a breadcrumb from the top level, with
 * every action still there, a way back that keeps the selection, and moves out
 * that follow the field so it stays in view and focused.
 */
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { MoveContext } from "@admin/lib/builder/move-rule";

import {
  nestedFixtureBlockCatalogs,
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "../../__fixtures__/nested-fixture";
import type { BuilderField } from "../../types";
import { MoveHarness, newProbe, plain } from "./move-harness";

/** The rule's whole answer, every change of container included. */
const WHOLE: MoveContext = {
  entityReadOnly: false,
  topLevelReservesNames: true,
  containerChanges: true,
};

function setup(initial: BuilderField[] = nestedFixtureFields()) {
  const probe = newProbe();
  render(
    <MoveHarness
      initial={initial}
      context={WHOLE}
      fieldGroups={nestedFixtureFieldGroups()}
      blockCatalogs={nestedFixtureBlockCatalogs()}
      probe={probe}
    />
  );
  return { probe, user: userEvent.setup() };
}

const rowAt = (path: string) =>
  document.querySelector<HTMLElement>(`[data-path="${path}"]`);

/** The paths of the rows drawn, in order. */
const drawn = () =>
  [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].map(
    row => row.dataset.path
  );

/** Open a row's menu as the keyboard does. */
async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  path: string
): Promise<void> {
  rowAt(path)?.focus();
  await user.keyboard("{Shift>}{F10}{/Shift}");
  await screen.findByRole("menu");
}

async function focusOn(
  user: ReturnType<typeof userEvent.setup>,
  path: string
): Promise<void> {
  await openMenu(user, path);
  await user.click(screen.getByRole("menuitem", { name: "Focus" }));
}

const crumbs = () => screen.getByRole("navigation", { name: "Focus" });

describe("Focus", () => {
  it("shows a group on its own, under its crumb", async () => {
    const { user } = setup();
    await focusOn(user, "meta");
    expect(drawn()).toEqual(["meta/title", "meta/rating"]);
    expect(within(crumbs()).getByText("Meta")).toHaveAttribute(
      "aria-current",
      "location"
    );
    // Its own fields are the first level drawn.
    expect(rowAt("meta/title")).toHaveAttribute("aria-level", "1");
  });

  it("shows repeating rows three deep, with a crumb for each container above", async () => {
    const { user } = setup();
    await focusOn(user, "sections");
    await focusOn(user, "sections/items");
    await focusOn(user, "sections/items/cta");
    expect(drawn()).toEqual([
      "sections/items/cta/label",
      "sections/items/cta/kind",
    ]);
    const nav = crumbs();
    expect(
      within(nav)
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual(["All fields", "Sections", "Items", "Call to action"]);
  });

  it("shows a blocks field's accepted blocks and their props", async () => {
    const { user } = setup();
    await focusOn(user, "body");
    const paths = drawn();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every(path => path?.startsWith("body/"))).toBe(true);
  });

  it("offers Focus only on a group, repeating rows or a blocks field", async () => {
    const { user } = setup();
    for (const path of ["summary_a", "seo"]) {
      await openMenu(user, path);
      expect(screen.queryByRole("menuitem", { name: "Focus" })).toBeNull();
      await user.keyboard("{Escape}");
    }
  });

  it("returns by a crumb or Exit focus with the selection kept, and focus on it", async () => {
    const { probe, user } = setup();
    await focusOn(user, "meta");
    await user.click(rowAt("meta/title")!);
    expect(probe.selectedId).toBe("f-meta-title");

    await user.click(
      within(crumbs()).getByRole("button", { name: "All fields" })
    );
    expect(screen.queryByRole("navigation", { name: "Focus" })).toBeNull();
    expect(drawn()).toContain("summary_a");
    expect(probe.selectedId).toBe("f-meta-title");
    expect(rowAt("meta/title")).toHaveAttribute("aria-selected", "true");
    expect(rowAt("meta/title")).toHaveFocus();

    await focusOn(user, "meta");
    await user.click(screen.getByRole("button", { name: "Exit focus" }));
    expect(screen.queryByRole("navigation", { name: "Focus" })).toBeNull();
    expect(rowAt("meta/title")).toHaveFocus();
  });

  it("moves a field out by key while focused, and the focus follows it", async () => {
    const { probe, user } = setup([
      plain("title"),
      plain("details", { type: "group", fields: [plain("subtitle")] }),
    ]);
    await focusOn(user, "details");
    rowAt("details/subtitle")?.focus();
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(probe.fields.map(field => field.name)).toContain("subtitle");
    // Out at the top level, so focus is off and the field is in view, focused.
    expect(screen.queryByRole("navigation", { name: "Focus" })).toBeNull();
    expect(rowAt("subtitle")).toHaveFocus();
  });

  it("moves a field out through Move to… while focused, the focus stepping to where it went", async () => {
    const { probe, user } = setup([
      plain("outer", {
        type: "group",
        fields: [plain("inner", { type: "group", fields: [plain("note")] })],
      }),
    ]);
    await focusOn(user, "outer");
    await focusOn(user, "outer/inner");
    await openMenu(user, "outer/inner/note");
    await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /^Outer \(/ }));
    await user.click(within(dialog).getByRole("button", { name: "Move" }));
    const outer = probe.fields.find(field => field.name === "outer");
    expect(outer?.fields?.map(field => field.name)).toContain("note");
    // Focus stepped up to Outer, where the field now is.
    expect(within(crumbs()).getByText("Outer")).toHaveAttribute(
      "aria-current",
      "location"
    );
    expect(rowAt("outer/note")).toHaveFocus();
  });
});
