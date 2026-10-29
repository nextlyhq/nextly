/**
 * PluginLevelGroup — a plugin's collections and its own permissions, folded
 * under the plugin's name on the roles screen.
 *
 * Folded, a group says what the role holds across it in one word; open, it
 * sets each collection by level and each of the plugin's own permissions by
 * a switch. Nothing a plugin declares may be left without a control.
 */
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { PluginGroup } from "@admin/lib/permissions/level-rows";
import type { Permission } from "@admin/types/ui/form";

import { PluginLevelGroup } from "./PluginLevelGroup";

const FORMS = "@nextlyhq/plugin-form-builder";

function permission(
  resource: string,
  action: string,
  owner?: string
): Permission {
  return {
    id: `${resource}-${action}`,
    name: owner ? `Export ${resource}` : `${action} ${resource}`,
    resource,
    action,
    ...(owner ? { owner } : {}),
  };
}

const GROUP: PluginGroup = {
  plugin: FORMS,
  rows: [
    {
      slug: "forms",
      kind: "collection",
      label: "Form",
      plural: "Forms",
      plugin: FORMS,
      declaredRules: [],
      permissions: ["read", "create", "update", "delete"].map(action =>
        permission("forms", action)
      ),
    },
    {
      slug: "form-submissions",
      kind: "collection",
      label: "Submission",
      plural: "Submissions",
      plugin: FORMS,
      declaredRules: [],
      permissions: ["read", "create", "update", "delete"].map(action =>
        permission("form-submissions", action)
      ),
    },
  ],
  permissions: [permission("submissions", "export", FORMS)],
};

let saved: string[] = [];

function Harness({
  group = GROUP,
  initial,
}: {
  group?: PluginGroup;
  initial: string[];
}) {
  const [value, setValue] = useState(initial);
  saved = value;
  return (
    <PluginLevelGroup
      group={group}
      displayName="Form builder"
      value={value}
      onChange={next => {
        saved = next;
        setValue(next);
      }}
    />
  );
}

/** The group's fold button, named for the plugin. */
function fold() {
  return screen.getByRole("button", { name: /Form builder/ });
}

describe("PluginLevelGroup", () => {
  it("folds a plugin under its name, listing its collections, closed at first", () => {
    render(<Harness initial={[]} />);

    expect(fold()).toHaveAttribute("aria-expanded", "false");
    expect(within(fold()).getByText("Forms, Submissions")).toBeInTheDocument();
    expect(
      screen.queryByRole("radiogroup", { name: "Form (forms) level" })
    ).not.toBeInTheDocument();
  });

  it("says in one word what the role holds across the plugin", () => {
    const { unmount } = render(<Harness initial={[]} />);
    expect(within(fold()).getByText("No access")).toBeInTheDocument();
    unmount();

    render(<Harness initial={["forms-read", "form-submissions-read"]} />);
    expect(within(fold()).getByText("Can view")).toBeInTheDocument();
  });

  it("reads Custom where the plugin's own permission is held beside a level", () => {
    render(<Harness initial={["submissions-export"]} />);

    expect(within(fold()).getByText("Custom")).toBeInTheDocument();
  });

  it("opens to set each collection by level, keeping the rest of the role", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["pages-read"]} />);

    await user.click(fold());
    await user.click(
      within(
        screen.getByRole("radiogroup", { name: "Form (forms) level" })
      ).getByRole("radio", { name: "Can view" })
    );

    expect([...saved].sort()).toEqual(["forms-read", "pages-read"]);
  });

  it("gives each of the plugin's own permissions a switch, by its name", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);

    await user.click(fold());
    await user.click(
      screen.getByRole("switch", { name: "Form builder: Export submissions" })
    );

    expect(saved).toEqual(["submissions-export"]);
  });

  it("gives a plugin with no collection a switch for each permission it declares", async () => {
    const user = userEvent.setup();
    render(<Harness group={{ ...GROUP, rows: [] }} initial={[]} />);

    expect(within(fold()).getByText("1 permission")).toBeInTheDocument();
    await user.click(fold());
    expect(
      screen.getByRole("switch", { name: "Form builder: Export submissions" })
    ).toBeInTheDocument();
  });
});
