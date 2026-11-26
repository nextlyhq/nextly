/**
 * Moves between a host and a field group it uses, both ways, by Move to… and by the keys, in a
 * collection's editor and in another field group's: each is refused in the server's words, naming
 * the field group and every collection, Single and field group using it, one reaching it through
 * another field group among them, and nothing changes. A field group's own field, shown beneath the
 * field using the field group, offers every way a field moves (its drag handle, Move to…, the keys)
 * so a person who tries learns why; a row declared in code offers none of them. A drag is judged by
 * the same rule, and is driven in the browser test, where a pointer can drag.
 */
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { recordDragRegion } from "@admin/__tests__/helpers/drag";
import { render, screen } from "@admin/__tests__/utils";
import type { MoveContext } from "@admin/lib/builder/move-rule";

import {
  nestedFixtureBlockCatalogs,
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "../../__fixtures__/nested-fixture";
import type { BuilderField } from "../../types";

import { MoveHarness, newProbe } from "./move-harness";

/** The spec's fixture: the field group used by c1, c2 and the field group b, which the Single s uses. */
const USERS =
  "It is used by the collection c1, the collection c2, the field group b, the Single s (through b).";
const STAYS = "a field group is changed only in its own editor.";
const OUT = `Meta title cannot be moved into or out of the field group seo: ${STAYS} ${USERS}`;
const INTO = `Notes cannot be moved into or out of the field group seo: ${STAYS} ${USERS}`;

/** A collection's editor (c1), and the editor of the field group b that also places the field group. */
const EDITORS = [
  { editor: "a collection's editor", surface: "collection" },
  { editor: "another field group's editor", surface: "fieldGroup" },
] as const;

function contextIn(surface: MoveContext["surface"]): MoveContext {
  return {
    entityReadOnly: false,
    surface,
    describeFieldGroup: slug => {
      if (slug === "seo") {
        return {
          uses: [
            { entityType: "collection", entitySlug: "c1" },
            { entityType: "collection", entitySlug: "c2" },
            { entityType: "fieldGroup", entitySlug: "b" },
            { entityType: "single", entitySlug: "s", via: ["b"] },
          ],
          complete: true,
        };
      }
      // The field group the fixture's field group places inside it.
      return slug === "social"
        ? {
            uses: [{ entityType: "fieldGroup", entitySlug: "seo" }],
            complete: true,
          }
        : undefined;
    },
  };
}

/**
 * The nested fixture with a field accepting both field groups ahead of it, and one more field below
 * the field group, which the keys can move into it.
 */
function fieldsWithNotes(): BuilderField[] {
  return [
    {
      id: "f-cards",
      name: "cards",
      label: "Cards",
      type: "component",
      components: ["seo", "social"],
    } as BuilderField,
    ...nestedFixtureFields(),
    {
      id: "f-notes",
      name: "notes",
      label: "Notes",
      type: "text",
    } as BuilderField,
  ];
}

function setup(surface: MoveContext["surface"]) {
  const probe = newProbe();
  const initial = fieldsWithNotes();
  render(
    <MoveHarness
      initial={initial}
      context={contextIn(surface)}
      fieldGroups={nestedFixtureFieldGroups()}
      blockCatalogs={nestedFixtureBlockCatalogs()}
      probe={probe}
    />
  );
  return { probe, initial, user: userEvent.setup() };
}

const row = (path: string) =>
  document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`);

/** The handle a pointer drags a row by, drawn just before the row. */
const handleOf = (path: string) => row(path)?.previousElementSibling ?? null;

/**
 * What the outline last announced. Trimmed: the same refusal announced twice in a row is changed by
 * a space, so a screen reader says it again.
 */
const announced = () =>
  (document.querySelector('[aria-live="polite"]')?.textContent ?? "").trim();

/** Open a row's menu by its key, and its disabled Move to…'s description, if it has one. */
async function moveToOf(
  user: ReturnType<typeof userEvent.setup>,
  path: string
): Promise<string | null> {
  row(path)?.focus();
  await user.keyboard("{Shift>}{F10}{/Shift}");
  await screen.findByRole("menu");
  const item = screen.queryByRole("menuitem", { name: "Move to…" });
  if (!item) return null;
  expect(item).toHaveAttribute("aria-disabled", "true");
  return (
    document.getElementById(item.getAttribute("aria-describedby") ?? "")
      ?.textContent ?? ""
  );
}

describe.each(EDITORS)("in $editor", ({ surface }) => {
  describe("a field group's own field", () => {
    it("offers its handle to drag, where a row declared in code offers none", () => {
      setup(surface);
      expect(handleOf("seo/meta_title")).not.toBeNull();
      expect(handleOf("seo/meta_title")).not.toHaveClass("invisible");
      const blockRow = document.querySelector<HTMLElement>(
        '[role="treeitem"][data-path^="body/"]'
      );
      expect(blockRow?.previousElementSibling).toHaveClass("invisible");
    });

    it("offers Move to…, disabled, with the refusal as its description", async () => {
      const { user, probe, initial } = setup(surface);
      row("seo/meta_title")?.focus();
      await user.keyboard("{Shift>}{F10}{/Shift}");
      const item = await screen.findByRole("menuitem", { name: "Move to…" });
      expect(item).toHaveAttribute("aria-disabled", "true");
      const described = item.getAttribute("aria-describedby");
      expect(described).not.toBeNull();
      expect(document.getElementById(described ?? "")?.textContent).toBe(OUT);
      expect(probe.commits).toBe(0);
      expect(probe.fields).toEqual(initial);
    });

    // An open menu says what the rule says now: a refusal drawn while the users were being read is
    // drawn again once they are. Broken, it keeps "could not be read" until the menu is reopened.
    it("updates an open menu's refusal once the users have been read", async () => {
      const probe = newProbe();
      const initial = fieldsWithNotes();
      const harness = (context: MoveContext) => (
        <MoveHarness
          initial={initial}
          context={context}
          fieldGroups={nestedFixtureFieldGroups()}
          blockCatalogs={nestedFixtureBlockCatalogs()}
          probe={probe}
        />
      );
      const reading: MoveContext = {
        ...contextIn(surface),
        describeFieldGroup: () => ({ uses: null, complete: false }),
      };
      const { rerender } = render(harness(reading));
      const user = userEvent.setup();
      expect(await moveToOf(user, "seo/meta_title")).toBe(
        `Meta title cannot be moved into or out of the field group seo: ${STAYS} Where else it is used could not be read.`
      );

      rerender(harness(contextIn(surface)));
      const item = screen.getByRole("menuitem", { name: "Move to…" });
      expect(
        document.getElementById(item.getAttribute("aria-describedby") ?? "")
          ?.textContent
      ).toBe(OUT);
    });

    // The nearest field group defines a row: a field of the field group placed inside another is
    // changed in the inner one's editor, and is refused naming it and its users.
    it("names the field group inside another that defines it, with that one's users", async () => {
      const { user } = setup(surface);
      expect(await moveToOf(user, "seo/social/handle")).toBe(
        `Handle cannot be moved into or out of the field group social: ${STAYS} It is used by the field group seo.`
      );
    });

    // A drag of a row the entity's fields do not hold still names it, as a drag of any field does.
    it("is named when it is picked up to drag", async () => {
      setup(surface);
      const heard = recordDragRegion();
      const handle = handleOf("seo/meta_title") as HTMLElement;
      fireEvent.keyDown(handle, { code: "Space", key: " " });
      await waitFor(() =>
        expect(
          heard.some(said => said.startsWith("Picked up Meta title"))
        ).toBe(true)
      );
      fireEvent.keyDown(handle, { code: "Escape", key: "Escape" });
    });

    it("refuses a move out by key, up and out of its container, and changes nothing", async () => {
      const { user, probe, initial } = setup(surface);
      for (const key of ["{Alt>}{ArrowUp}{/Alt}", "{Alt>}{ArrowLeft}{/Alt}"]) {
        row("seo/meta_title")?.focus();
        await user.keyboard(key);
        expect(announced()).toBe(`${OUT} Nothing moved.`);
      }
      expect(probe.commits).toBe(0);
      expect(probe.fields).toEqual(initial);
    });
  });

  // An entry of a field accepting several field groups stands for one of them and is no field: it
  // offers no way of moving it. The fields beneath it are that field group's, and name it alone.
  describe("a field accepting several field groups", () => {
    it("offers no move on an entry, and names the entry's field group for a field beneath it", async () => {
      const { user, probe, initial } = setup(surface);
      expect(handleOf("cards/@seo")).toHaveClass("invisible");
      expect(await moveToOf(user, "cards/@seo")).toBeNull();
      await user.keyboard("{Escape}");
      expect(await moveToOf(user, "cards/@seo/meta_title")).toBe(OUT);
      expect(probe.commits).toBe(0);
      expect(probe.fields).toEqual(initial);
    });
  });

  describe("a host's field", () => {
    it("is refused a move into the field group by key, and nothing changes", async () => {
      const { user, probe, initial } = setup(surface);
      row("notes")?.focus();
      await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
      expect(announced()).toBe(`${INTO} Nothing moved.`);
      expect(probe.commits).toBe(0);
      expect(probe.fields).toEqual(initial);
    });

    it("finds the field group disabled in Move to…, with the refusal as its note", async () => {
      const { user, probe, initial } = setup(surface);
      row("notes")?.focus();
      await user.keyboard("{Shift>}{F10}{/Shift}");
      await user.click(
        await screen.findByRole("menuitem", { name: "Move to…" })
      );
      const dialog = await screen.findByRole("dialog");
      const seo = within(dialog)
        .getAllByRole<HTMLInputElement>("radio")
        .find(radio =>
          radio.labels?.[0]?.textContent?.startsWith("SEO (name in")
        );
      expect(seo?.disabled).toBe(true);
      const note = seo?.getAttribute("aria-describedby");
      expect(document.getElementById(note ?? "")?.textContent).toBe(INTO);
      expect(probe.commits).toBe(0);
      expect(probe.fields).toEqual(initial);
    });
  });
});
