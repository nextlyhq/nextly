/**
 * A field group's own field, shown beneath the field that uses the field group, is offered every
 * way a field moves (drag, Move to…, the keys), and each is refused with the move rule's reason:
 * the field group is changed only in its own editor, named with every place using it. Nothing
 * changes. A row declared in code offers none of them.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { MoveContext } from "@admin/lib/builder/move-rule";

import {
  nestedFixtureBlockCatalogs,
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "../../__fixtures__/nested-fixture";

import { MoveHarness, newProbe } from "./move-harness";

const CONTEXT: MoveContext = {
  entityReadOnly: false,
  surface: "collection",
  describeFieldGroup: slug =>
    slug === "seo"
      ? { label: "SEO", usedBy: ["the collection posts", "the Single home"] }
      : undefined,
};

const REFUSAL =
  "SEO uses the field group SEO, which is changed only in its own editor, where a change reaches every place that uses it. It is used by the collection posts, the Single home.";

function setup() {
  const probe = newProbe();
  render(
    <MoveHarness
      initial={nestedFixtureFields()}
      context={CONTEXT}
      fieldGroups={nestedFixtureFieldGroups()}
      blockCatalogs={nestedFixtureBlockCatalogs()}
      probe={probe}
    />
  );
  return { probe, user: userEvent.setup() };
}

const row = (path: string) =>
  document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`);

/** The handle a pointer drags a row by, drawn just before the row. */
const handleOf = (path: string) => row(path)?.previousElementSibling ?? null;

describe("a field group's own field", () => {
  it("offers its handle to drag, where a row declared in code offers none", () => {
    setup();
    expect(handleOf("seo/meta_title")).not.toBeNull();
    expect(handleOf("seo/meta_title")).not.toHaveClass("invisible");
    const blockRow = document.querySelector<HTMLElement>(
      '[role="treeitem"][data-path^="body/"]'
    );
    expect(blockRow?.previousElementSibling).toHaveClass("invisible");
  });

  it("offers Move to…, disabled, with the reason as its description", async () => {
    const { user, probe } = setup();
    row("seo/meta_title")?.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    const item = await screen.findByRole("menuitem", { name: "Move to…" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    const described = item.getAttribute("aria-describedby");
    expect(described).not.toBeNull();
    expect(document.getElementById(described ?? "")?.textContent).toBe(REFUSAL);
    expect(probe.commits).toBe(0);
  });

  it("refuses a move by key with the same reason, and changes nothing", async () => {
    const { user, probe } = setup();
    row("seo/meta_title")?.focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    const region =
      document.querySelector('[aria-live="polite"]')?.textContent ?? "";
    expect(region).toBe(`${REFUSAL} Nothing moved.`);
    expect(probe.commits).toBe(0);
  });
});
