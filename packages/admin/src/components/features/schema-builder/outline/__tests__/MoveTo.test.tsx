/**
 * Move to… over the nested fixture: every place a field could go, told apart,
 * the ones it may not go disabled with the move rule's reason, where each
 * entry's value goes for a place inside repeating rows, and a move made from
 * it announced with focus back on the field.
 */
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { MoveContext } from "@admin/lib/builder/move-rule";

import {
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "../../__fixtures__/nested-fixture";

import { MoveHarness, newProbe } from "./move-harness";

/** The rule's whole answer, every change of container included. */
const WHOLE: MoveContext = {
  entityReadOnly: false,
  topLevelReservesNames: true,
  containerChanges: true,
  describeFieldGroup: slug =>
    slug === "seo"
      ? { label: "SEO", usedBy: ["the collection posts", "the Single home"] }
      : undefined,
};
/** What the Builder asks today. */
const TODAY: MoveContext = {
  entityReadOnly: false,
  topLevelReservesNames: true,
};

function setup(context: MoveContext) {
  const probe = newProbe();
  render(
    <MoveHarness
      initial={nestedFixtureFields()}
      context={context}
      fieldGroups={nestedFixtureFieldGroups()}
      probe={probe}
    />
  );
  return { probe, user: userEvent.setup() };
}

/** Open Move to… on a row, from its menu, as the keyboard does. */
async function openMoveTo(
  user: ReturnType<typeof userEvent.setup>,
  path: string
): Promise<HTMLElement> {
  const row = document.querySelector<HTMLElement>(`[data-path="${path}"]`);
  row?.focus();
  await user.keyboard("{Shift>}{F10}{/Shift}");
  await user.click(await screen.findByRole("menuitem", { name: "Move to…" }));
  return screen.findByRole("dialog");
}

/** Each place's radio, by its accessible name. */
function places(dialog: HTMLElement): Map<string, HTMLInputElement> {
  return new Map(
    within(dialog)
      .getAllByRole<HTMLInputElement>("radio")
      .map(radio => [radio.labels?.[0]?.textContent ?? "", radio])
  );
}

/** The reason or note shown for a place. */
function noteOf(radio: HTMLInputElement): string {
  const id = radio.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? "") : "";
}

describe("Move to…", () => {
  it("lists every allowed place, told apart", async () => {
    const { user } = setup(WHOLE);
    const dialog = await openMoveTo(user, "summary_a");
    const listed = places(dialog);
    const allowed = [...listed]
      .filter(([, radio]) => !radio.disabled)
      .map(([name]) => name);
    expect(allowed).toEqual([
      "The top level",
      "Meta (name in the database and API: meta)",
      "Sections (name in the database and API: sections)",
      "Sections › Items (name in the database and API: sections.items)",
      "Sections › Items › Call to action (name in the database and API: sections.items.cta)",
    ]);
    // Its own place is chosen to start with.
    expect(listed.get("The top level")?.checked).toBe(true);
  });

  it("gives each refused place the rule's reason, naming the field group and every place using it", async () => {
    const { user } = setup(WHOLE);
    const dialog = await openMoveTo(user, "summary_a");
    const listed = places(dialog);
    const body = listed.get("Body (name in the database and API: body)");
    const seo = listed.get("SEO (name in the database and API: seo)");
    expect(body?.disabled).toBe(true);
    expect(noteOf(body!)).toBe(
      "Body holds blocks declared in code, not fields."
    );
    expect(seo?.disabled).toBe(true);
    expect(noteOf(seo!)).toBe(
      "SEO uses the field group SEO, which is changed only in its own editor, where a change reaches every place that uses it. It is used by the collection posts, the Single home."
    );
  });

  it("names the clashing field when the field's name is taken there", async () => {
    const { user } = setup(WHOLE);
    // Meta title is named title, as the top level's Title is.
    const dialog = await openMoveTo(user, "meta/title");
    const top = places(dialog).get("The top level");
    expect(top?.disabled).toBe(true);
    expect(noteOf(top!)).toBe(
      "Title in the top level has the same name as Meta title. Rename one of them first."
    );
  });

  it("names the destination rows for a move into repeating rows inside repeating rows", async () => {
    const { user } = setup(WHOLE);
    const dialog = await openMoveTo(user, "summary_a");
    const cta = places(dialog).get(
      "Sections › Items › Call to action (name in the database and API: sections.items.cta)"
    );
    expect(noteOf(cta!)).toBe(
      "Each entry's value goes into the first row of Sections, then the first row of Items; other rows start without it."
    );
  });

  it("moves to the chosen position, says so and keeps focus on the field", async () => {
    const { probe, user } = setup(WHOLE);
    const dialog = await openMoveTo(user, "summary_a");
    await user.click(
      places(dialog).get("Meta (name in the database and API: meta)")!
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Position"),
      "At the start"
    );
    await user.click(within(dialog).getByRole("button", { name: "Move" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const meta = probe.fields.find(field => field.id === "f-meta");
    expect(meta?.fields?.map(field => field.name)).toEqual([
      "summary_a",
      "title",
      "rating",
    ]);
    expect(
      screen.getByText("Moved Summary into Meta, position 1 of 3.")
    ).toHaveAttribute("aria-live", "polite");
    expect(document.activeElement).toBe(
      document.querySelector('[data-path="meta/summary_a"]')
    );
  });

  it("offers only the field's own place today, saying why not the others", async () => {
    const { probe, user } = setup(TODAY);
    const dialog = await openMoveTo(user, "summary_a");
    const listed = places(dialog);
    const meta = listed.get("Meta (name in the database and API: meta)");
    expect(meta?.disabled).toBe(true);
    expect(noteOf(meta!)).toBe(
      "Moving a field into or out of a group or repeating rows is not available yet."
    );
    // Where it already is, nothing is moved.
    const move = within(dialog).getByRole("button", { name: "Move" });
    expect(move).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByLabelText("Position"),
      "At the start"
    );
    await user.click(move);
    expect(probe.fields.slice(0, 2).map(field => field.name)).toEqual([
      "summary_a",
      "title",
    ]);
  });
});
