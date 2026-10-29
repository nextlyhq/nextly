/**
 * PermissionLevelRow — one collection or Single, read at a level and changed
 * by setting one.
 *
 * What a row saves is the contract: each level must leave the role holding
 * exactly that level's permissions on the row, and nothing it does not decide
 * (another row, an action under the switch, a base role's grant) may move.
 * The tests read the role's whole permission list after each change.
 */
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { LevelRow } from "@admin/lib/permissions/level-rows";
import type { Permission } from "@admin/types/ui/form";

import { PermissionLevelRow } from "./PermissionLevelRow";

function permission(resource: string, action: string): Permission {
  return {
    id: `${resource}-${action}`,
    name: `${action} ${resource}`,
    resource,
    action,
  };
}

const POSTS: LevelRow = {
  slug: "posts",
  kind: "collection",
  label: "Post",
  plugin: null,
  declaredRules: [],
  permissions: [
    "read",
    "create",
    "update",
    "delete",
    "publish",
    "unpublish",
    "export",
  ].map(action => permission("posts", action)),
};

const HOMEPAGE: LevelRow = {
  slug: "homepage",
  kind: "single",
  label: "Homepage",
  plugin: null,
  declaredRules: [],
  permissions: ["read", "update", "publish", "unpublish"].map(action =>
    permission("homepage", action)
  ),
};

/** Another row's grant, which no change to this row may touch. */
const ELSEWHERE = "pages-read";

let saved: string[] = [];

function Harness({
  row,
  initial,
  lockedIds = [],
  baseName,
}: {
  row: LevelRow;
  initial: string[];
  lockedIds?: string[];
  baseName?: string;
}) {
  const [value, setValue] = useState(initial);
  saved = value;
  return (
    <PermissionLevelRow
      row={row}
      value={value}
      onChange={next => {
        saved = next;
        setValue(next);
      }}
      lockedIds={lockedIds}
      baseName={baseName}
    />
  );
}

/** The row's level control: its radio group, named after the row. */
function levels(label: string) {
  return within(screen.getByRole("radiogroup", { name: `${label} level` }));
}

describe("PermissionLevelRow", () => {
  it("lets the role take away its own copy of an action the base also gives, but not the base's", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        row={POSTS}
        initial={["posts-read", "posts-create"]}
        lockedIds={["posts-read", "posts-update"]}
        baseName="Editor"
      />
    );

    await user.click(screen.getByRole("switch", { name: "Post: each action" }));
    // Held by the role and the base: the role's own copy can go.
    const read = screen.getByRole("switch", { name: "Post: View" });
    expect(read).toBeEnabled();
    await user.click(read);
    expect(saved).toEqual(["posts-create"]);
    // POPULATION CONTROL: given by the base alone, so it stays locked.
    expect(screen.getByRole("switch", { name: "Post: Edit" })).toBeDisabled();
    // Still shown held: the base still gives it.
    expect(screen.getByRole("switch", { name: "Post: View" })).toBeChecked();
  });

  it.each([
    ["No access", []],
    ["Can view", ["posts-read"]],
    [
      "Can edit",
      ["posts-read", "posts-create", "posts-update", "posts-delete"],
    ],
    [
      "Can publish",
      [
        "posts-read",
        "posts-create",
        "posts-update",
        "posts-delete",
        "posts-publish",
        "posts-unpublish",
      ],
    ],
  ])("saves exactly %s's permissions on the row", async (level, ids) => {
    const user = userEvent.setup();
    // Start from a level other than the one set, keeping the action under
    // the switch and another row's grant.
    render(
      <Harness
        row={POSTS}
        initial={[
          ELSEWHERE,
          "posts-export",
          ...(level === "Can view"
            ? ["posts-read", "posts-update"]
            : ["posts-read"]),
        ]}
      />
    );

    await user.click(levels("Post").getByRole("radio", { name: level }));

    expect([...saved].sort()).toEqual(
      [ELSEWHERE, "posts-export", ...ids].sort()
    );
    expect(levels("Post").getByRole("radio", { name: level })).toBeChecked();
  });

  it("offers a Single no create or delete, and saves its own levels", async () => {
    const user = userEvent.setup();
    render(<Harness row={HOMEPAGE} initial={[]} />);

    await user.click(
      levels("Homepage").getByRole("radio", { name: "Can edit" })
    );

    expect([...saved].sort()).toEqual(["homepage-read", "homepage-update"]);
  });

  it("reads Custom where the actions match no level, and keeps them until a level is set", async () => {
    render(<Harness row={POSTS} initial={["posts-read", "posts-create"]} />);

    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByText("View and create")).toBeInTheDocument();
    // No level is selected, and the role is untouched by reading it.
    for (const radio of levels("Post").getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
    expect([...saved].sort()).toEqual(["posts-create", "posts-read"]);
  });

  it("turns one action on and off under the switch, leaving the rest", async () => {
    const user = userEvent.setup();
    render(<Harness row={POSTS} initial={[ELSEWHERE, "posts-read"]} />);

    expect(
      screen.queryByRole("switch", { name: "Post: Create" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Post: each action" }));
    expect(
      screen.getByRole("switch", { name: "Post: each action" })
    ).toBeChecked();
    await user.click(screen.getByRole("switch", { name: "Post: Create" }));

    expect([...saved].sort()).toEqual(
      [ELSEWHERE, "posts-create", "posts-read"].sort()
    );
    expect(screen.getByText("Custom")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Post: Create" }));
    expect([...saved].sort()).toEqual([ELSEWHERE, "posts-read"].sort());
    expect(
      levels("Post").getByRole("radio", { name: "Can view" })
    ).toBeChecked();
  });

  it("names an action outside the levels by its permission", async () => {
    const user = userEvent.setup();
    render(<Harness row={POSTS} initial={[]} />);

    await user.click(screen.getByRole("switch", { name: "Post: each action" }));

    expect(
      screen.getByRole("switch", { name: "Post: export posts" })
    ).toBeInTheDocument();
  });

  it("reads a base role's grants as the row's level, and saves none of them as the role's own", async () => {
    const user = userEvent.setup();
    const base = ["posts-read", "posts-create", "posts-update", "posts-delete"];
    render(
      <Harness row={POSTS} initial={[]} lockedIds={base} baseName="Editor" />
    );

    expect(screen.getByText("from Editor")).toBeInTheDocument();
    expect(
      levels("Post").getByRole("radio", { name: "Can edit" })
    ).toBeChecked();
    expect(
      levels("Post").getByRole("radio", { name: "No access" })
    ).toBeDisabled();
    expect(
      levels("Post").getByRole("radio", { name: "Can view" })
    ).toBeDisabled();

    await user.click(
      levels("Post").getByRole("radio", { name: "Can publish" })
    );
    expect([...saved].sort()).toEqual(["posts-publish", "posts-unpublish"]);

    await user.click(levels("Post").getByRole("radio", { name: "Can edit" }));
    expect(saved).toEqual([]);

    await user.click(screen.getByRole("switch", { name: "Post: each action" }));
    const read = screen.getByRole("switch", { name: "Post: View" });
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
  });
});
