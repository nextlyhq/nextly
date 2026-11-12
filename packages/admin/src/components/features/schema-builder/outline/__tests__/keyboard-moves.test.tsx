/**
 * Moving a field by key: Alt+Up and Alt+Down past the field beside it, and out
 * of its container at either end; Alt+Left out of its container, Alt+Right into
 * the container right above it. Each move asks the move rule, is announced in
 * the outline's live region, and leaves focus on the field it moved.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { MoveContext } from "@admin/lib/builder/move-rule";

import type { BuilderField } from "../../types";

import { MoveHarness, newProbe, plain } from "./move-harness";

/** The rule's whole answer: what the keys do once values are kept across containers. */
const WHOLE: MoveContext = {
  entityReadOnly: false,
  topLevelReservesNames: true,
  containerChanges: true,
};
/** What the Builder asks today. */
const TODAY: MoveContext = { entityReadOnly: false, topLevelReservesNames: true };

const tree = (): BuilderField[] => [
  plain("title"),
  plain("details", { type: "group", fields: [plain("subtitle")] }),
  plain("body"),
];

const row = (name: string) => screen.getByTestId(`field-row-${name}`);

/** The names at the top level and in Details, as a probe last saw them. */
function shape(fields: readonly BuilderField[]): string[] {
  return fields.map(field =>
    field.fields ? `${field.name}[${field.fields.map(f => f.name).join(",")}]` : field.name
  );
}

function setup(context: MoveContext) {
  const probe = newProbe();
  render(<MoveHarness initial={tree()} context={context} probe={probe} />);
  return { probe, user: userEvent.setup() };
}

/** The outline's live region says exactly `text` now. */
function says(text: string): void {
  const region = screen.getByText(text);
  expect(region).toHaveAttribute("aria-live", "polite");
}

describe("moving a field by key", () => {
  it("moves up, down, into and out by key", async () => {
    const { probe, user } = setup(WHOLE);
    row("body").focus();

    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(shape(probe.fields)).toEqual(["title", "details[subtitle,body]"]);

    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(shape(probe.fields)).toEqual(["title", "details[body,subtitle]"]);

    // Up from the first place in a container goes out, before it.
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(shape(probe.fields)).toEqual(["title", "body", "details[subtitle]"]);

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(shape(probe.fields)).toEqual(["title", "details[subtitle]", "body"]);

    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    // Out goes to just after the container.
    expect(shape(probe.fields)).toEqual(["title", "details[subtitle]", "body"]);
    expect(probe.commits).toBe(6);
  });

  it("announces 'moved into …, position n of m' and keeps focus", async () => {
    const { user } = setup(WHOLE);
    row("body").focus();

    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    says("Moved Body into Details, position 2 of 2.");
    expect(document.activeElement).toBe(row("body"));

    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    says("Moved Body up, position 1 of 2.");
    expect(document.activeElement).toBe(row("body"));

    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    says("Moved Body out to the top level, position 3 of 3.");
    expect(document.activeElement).toBe(row("body"));
  });

  it("unfolds a folded container a field moves into, and focuses the field there", async () => {
    const { user } = setup(WHOLE);
    // Left on an open container folds it.
    row("details").focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByTestId("field-row-subtitle")).toBeNull();

    row("body").focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    says("Moved Body into Details, position 2 of 2.");
    expect(document.activeElement).toBe(row("body"));
    expect(row("subtitle")).toBeInTheDocument();
  });

  it("says why when there is nowhere to go, and changes nothing", async () => {
    const { probe, user } = setup(WHOLE);
    row("title").focus();

    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    says("Title is already at the top level. Nothing moved.");
    // Above Title is nothing at all, so there is no container to enter.
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    says("There is no container right above Title to move into. Nothing moved.");
    expect(probe.commits).toBe(0);
    expect(document.activeElement).toBe(row("title"));
  });

  it("refuses a change of container today, saying so, and still reorders", async () => {
    const { probe, user } = setup(TODAY);
    row("body").focus();

    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    says("Moving a field into or out of a group or repeating rows is not available yet. Nothing moved.");
    expect(shape(probe.fields)).toEqual(["title", "details[subtitle]", "body"]);

    // Up past Details stays at the top level, so it goes ahead.
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(shape(probe.fields)).toEqual(["title", "body", "details[subtitle]"]);
    expect(probe.commits).toBe(1);
  });

  it("names the keys in a movable row's description", () => {
    setup(TODAY);
    const describedBy = row("body").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(
      /Alt\+Up and Alt\+Down move the field; Alt\+Left moves it out of its\s+container, Alt\+Right into the container above it/
    );
  });
});
