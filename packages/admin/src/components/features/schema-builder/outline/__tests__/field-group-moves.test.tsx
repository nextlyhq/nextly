/**
 * Moves between a host and a field group it uses, both ways, by Move to… and by the keys, in a
 * collection's editor and in another field group's: each is refused in the server's words, naming
 * the field group and every collection, Single and field group using it, one reaching it through
 * another field group among them, and nothing changes. A field group's own field, shown beneath the
 * field using the field group, offers every way a field moves (its drag handle, Move to…, the keys)
 * so a person who tries learns why; a row declared in code offers none of them. A drag is judged by
 * the same rule, and is driven in the browser test, where a pointer can drag.
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
    describeFieldGroup: slug =>
      slug === "seo"
        ? {
            uses: [
              { entityType: "collection", entitySlug: "c1" },
              { entityType: "collection", entitySlug: "c2" },
              { entityType: "fieldGroup", entitySlug: "b" },
              { entityType: "single", entitySlug: "s", via: ["b"] },
            ],
            complete: true,
          }
        : undefined,
  };
}

/** The nested fixture with one more field below the field group, which the keys can move into it. */
function fieldsWithNotes(): BuilderField[] {
  return [
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
