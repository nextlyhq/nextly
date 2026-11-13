/**
 * A collection's stored hooks are shown for reading only: each with what it
 * does to writes, when it runs, its settings and whether it is on, in the order
 * the server runs them, and with no control that could change one.
 *
 * @module components/features/schema-builder/HooksEditor/__tests__/StoredHooksView.test
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { StoredHookConfig } from "@admin/types/collection";

import { StoredHooksView } from "../StoredHooksView";

const slugHook: StoredHookConfig = {
  hookId: "auto-slug",
  hookType: "beforeChange",
  enabled: true,
  config: {
    sourceField: "title",
    targetField: "slug",
    overwriteExisting: false,
  },
  order: 0,
};
const auditHook: StoredHookConfig = {
  hookId: "audit-fields",
  hookType: "beforeChange",
  enabled: false,
  config: { createdByField: "createdBy", updatedByField: "updatedBy" },
  order: 1,
};
const uniqueHook: StoredHookConfig = {
  hookId: "unique-validation",
  hookType: "beforeChange",
  enabled: true,
  config: { field: "email", errorMessage: "Taken", caseInsensitive: true },
  order: 2,
};
const unknownHook: StoredHookConfig = {
  hookId: "send-sms",
  hookType: "afterChange",
  enabled: true,
  config: { to: "+1" },
  order: 3,
};

/** Every role a control that changes something would have. */
const EDITABLE_ROLES = [
  "button",
  "textbox",
  "checkbox",
  "switch",
  "combobox",
  "spinbutton",
  "radio",
  "slider",
  "menuitem",
] as const;

function expectNothingEditable(container: HTMLElement): void {
  for (const role of EDITABLE_ROLES) {
    expect(within(container).queryAllByRole(role)).toEqual([]);
  }
  // A role-less input or a contenteditable would slip past the role query.
  expect(
    container.querySelectorAll("input, select, textarea, [contenteditable]")
  ).toHaveLength(0);
}

function hookItem(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  const item = heading.closest("li");
  if (!item) throw new Error(`no list item holds the hook "${name}"`);
  return item;
}

describe("a collection's stored hooks, read-only", () => {
  it("shows a slug hook with what it does, when, its settings and that it is on", () => {
    const { container } = render(<StoredHooksView hooks={[slugHook]} />);
    const item = hookItem("Auto-generate Slug");

    expect(item).toHaveTextContent(
      "Fills slug from title, unless slug already has a value."
    );
    expect(item).toHaveTextContent("Before an entry is created or updated");
    // Each hook shows its stored order, which orders it within its pass.
    expect(item).toHaveTextContent("· order 0");
    expect(within(item).getByText("On")).toBeInTheDocument();
    expect(
      within(item).getByText("Field to generate slug from")
    ).toBeInTheDocument();
    expect(within(item).getByText("title")).toBeInTheDocument();
    expectNothingEditable(container);
  });

  it("shows an audit hook that is turned off as off", () => {
    const { container } = render(<StoredHooksView hooks={[auditHook]} />);
    const item = hookItem("Set Audit Fields");

    expect(item).toHaveTextContent(
      "Records who created an entry in createdBy, and who last changed it in updatedBy."
    );
    expect(within(item).getByText("Off")).toBeInTheDocument();
    expect(within(item).queryByText("On")).toBeNull();
    expectNothingEditable(container);
  });

  it("shows a uniqueness hook with its message and case rule", () => {
    const { container } = render(<StoredHooksView hooks={[uniqueHook]} />);
    const item = hookItem("Validate Uniqueness");

    expect(item).toHaveTextContent(
      'Refuses an entry whose email another entry already uses, ignoring case, saying "Taken".'
    );
    expect(
      within(item).getByText("Case-insensitive comparison")
    ).toBeInTheDocument();
    expect(within(item).getByText("Yes")).toBeInTheDocument();
    expectNothingEditable(container);
  });

  it("shows an unknown hook as running nothing", () => {
    const { container } = render(<StoredHooksView hooks={[unknownHook]} />);
    const item = hookItem("send-sms");

    expect(item).toHaveTextContent(
      "Not a hook this version of Nextly knows, so it runs nothing."
    );
    expectNothingEditable(container);
  });

  it("lists the hooks in the order they run, not the order they are stored", () => {
    render(
      <StoredHooksView hooks={[uniqueHook, unknownHook, slugHook, auditHook]} />
    );

    const names = within(
      screen.getByRole("list", {
        name: "Stored hooks, grouped by when they run",
      })
    )
      .getAllByRole("heading")
      .map(h => h.textContent);
    expect(names).toEqual([
      "Auto-generate Slug",
      "Set Audit Fields",
      "Validate Uniqueness",
      "send-sms",
    ]);
  });

  it("shows a malformed stored entry as unreadable instead of failing", () => {
    // The API accepts any array for `hooks`, so a null entry can be stored.
    const { container } = render(<StoredHooksView hooks={[null, slugHook]} />);

    expect(hookItem("Auto-generate Slug")).toBeInTheDocument();
    expect(hookItem("Unreadable entry")).toHaveTextContent(
      "This stored entry is not in the shape a hook is stored in, so what it does cannot be shown."
    );
    expectNothingEditable(container);
  });

  it("says the hooks can only be changed through the API", () => {
    render(<StoredHooksView hooks={[slugHook]} />);

    expect(
      screen.getByText(
        "Shown read-only. To change or turn off a stored hook, use the API."
      )
    ).toBeInTheDocument();
  });
});
