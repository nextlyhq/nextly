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
  plural: "Posts",
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
  plural: "Homepage",
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
  bases,
  visitors,
}: {
  row: LevelRow;
  initial: string[];
  lockedIds?: string[];
  bases?: { name: string; ids: string[] }[];
  visitors?: boolean;
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
      bases={bases}
      visitors={visitors}
    />
  );
}

/** The row's level control: its radio group, named after the row. */
function levels(label: string) {
  return within(screen.getByRole("radiogroup", { name: `${label} level` }));
}

describe("PermissionLevelRow", () => {
  it("names each control by the row's label and slug, so two rows sharing a label differ", () => {
    render(<Harness row={POSTS} initial={[]} />);

    expect(
      screen.getByRole("radiogroup", { name: "Post (posts) level" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Post (posts): each action" })
    ).toBeInTheDocument();
  });

  it("credits a base role's grant to the base that gives it", () => {
    render(
      <Harness
        row={POSTS}
        initial={[]}
        lockedIds={["posts-read", "pages-read"]}
        bases={[
          { name: "Editor", ids: ["pages-read"] },
          { name: "Author", ids: ["posts-read"] },
        ]}
      />
    );

    expect(screen.getByText("from Author")).toBeInTheDocument();
    // POPULATION CONTROL: the first base gives this row nothing.
    expect(screen.queryByText(/from Editor/)).not.toBeInTheDocument();
  });

  it("names every base that gives the row something", () => {
    render(
      <Harness
        row={POSTS}
        initial={[]}
        lockedIds={["posts-read", "posts-update"]}
        bases={[
          { name: "Editor", ids: ["posts-read"] },
          { name: "Author", ids: ["posts-update"] },
        ]}
      />
    );

    expect(screen.getByText("from Editor and Author")).toBeInTheDocument();
  });

  it("marks a row whose code narrows it, naming the actions the code limits", () => {
    render(
      <Harness
        row={{ ...POSTS, declaredRules: ["read", "update"] }}
        initial={[]}
      />
    );

    expect(screen.getByText("Narrowed in code")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This collection's code also limits who can view and edit it. The level here is the most a role can be given."
      )
    ).toBeInTheDocument();
  });

  it("does not mark a row whose code declares no rule", () => {
    render(<Harness row={POSTS} initial={[]} />);

    expect(screen.queryByText("Narrowed in code")).not.toBeInTheDocument();
  });

  it("lets the role take away its own copy of an action the base also gives, but not the base's", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        row={POSTS}
        initial={["posts-read", "posts-create"]}
        lockedIds={["posts-read", "posts-update"]}
        bases={[{ name: "Editor", ids: ["posts-read", "posts-update"] }]}
      />
    );

    await user.click(
      screen.getByRole("switch", { name: "Post (posts): each action" })
    );
    // Held by the role and the base: the role's own copy can go.
    const read = screen.getByRole("switch", { name: "Post (posts): View" });
    expect(read).toBeEnabled();
    await user.click(read);
    expect(saved).toEqual(["posts-create"]);
    // POPULATION CONTROL: given by the base alone, so it stays locked.
    expect(
      screen.getByRole("switch", { name: "Post (posts): Edit" })
    ).toBeDisabled();
    // Still shown held: the base still gives it.
    expect(
      screen.getByRole("switch", { name: "Post (posts): View" })
    ).toBeChecked();
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

    await user.click(
      levels("Post (posts)").getByRole("radio", { name: level })
    );

    expect([...saved].sort()).toEqual(
      [ELSEWHERE, "posts-export", ...ids].sort()
    );
    expect(
      levels("Post (posts)").getByRole("radio", { name: level })
    ).toBeChecked();
  });

  it("offers a Single no create or delete, and saves its own levels", async () => {
    const user = userEvent.setup();
    render(<Harness row={HOMEPAGE} initial={[]} />);

    await user.click(
      levels("Homepage (homepage)").getByRole("radio", { name: "Can edit" })
    );

    expect([...saved].sort()).toEqual(["homepage-read", "homepage-update"]);
  });

  it("reads Custom where the actions match no level, and keeps them until a level is set", async () => {
    render(<Harness row={POSTS} initial={["posts-read", "posts-create"]} />);

    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByText("View and create")).toBeInTheDocument();
    // No level is selected, and the role is untouched by reading it.
    for (const radio of levels("Post (posts)").getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
    expect([...saved].sort()).toEqual(["posts-create", "posts-read"]);
  });

  it("turns one action on and off under the switch, leaving the rest", async () => {
    const user = userEvent.setup();
    render(<Harness row={POSTS} initial={[ELSEWHERE, "posts-read"]} />);

    expect(
      screen.queryByRole("switch", { name: "Post (posts): Create" })
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("switch", { name: "Post (posts): each action" })
    );
    expect(
      screen.getByRole("switch", { name: "Post (posts): each action" })
    ).toBeChecked();
    await user.click(
      screen.getByRole("switch", { name: "Post (posts): Create" })
    );

    expect([...saved].sort()).toEqual(
      [ELSEWHERE, "posts-create", "posts-read"].sort()
    );
    expect(screen.getByText("Custom")).toBeInTheDocument();

    await user.click(
      screen.getByRole("switch", { name: "Post (posts): Create" })
    );
    expect([...saved].sort()).toEqual([ELSEWHERE, "posts-read"].sort());
    expect(
      levels("Post (posts)").getByRole("radio", { name: "Can view" })
    ).toBeChecked();
  });

  it("names an action outside the levels by its permission", async () => {
    const user = userEvent.setup();
    render(<Harness row={POSTS} initial={[]} />);

    await user.click(
      screen.getByRole("switch", { name: "Post (posts): each action" })
    );

    expect(
      screen.getByRole("switch", { name: "Post (posts): export posts" })
    ).toBeInTheDocument();
  });

  it("reads a base role's grants as the row's level, and saves none of them as the role's own", async () => {
    const user = userEvent.setup();
    const base = ["posts-read", "posts-create", "posts-update", "posts-delete"];
    render(
      <Harness
        row={POSTS}
        initial={[]}
        lockedIds={base}
        bases={[{ name: "Editor", ids: base }]}
      />
    );

    expect(screen.getByText("from Editor")).toBeInTheDocument();
    expect(
      levels("Post (posts)").getByRole("radio", { name: "Can edit" })
    ).toBeChecked();
    expect(
      levels("Post (posts)").getByRole("radio", { name: "No access" })
    ).toBeDisabled();
    expect(
      levels("Post (posts)").getByRole("radio", { name: "Can view" })
    ).toBeDisabled();

    await user.click(
      levels("Post (posts)").getByRole("radio", { name: "Can publish" })
    );
    expect([...saved].sort()).toEqual(["posts-publish", "posts-unpublish"]);

    await user.click(
      levels("Post (posts)").getByRole("radio", { name: "Can edit" })
    );
    expect(saved).toEqual([]);

    await user.click(
      screen.getByRole("switch", { name: "Post (posts): each action" })
    );
    const read = screen.getByRole("switch", { name: "Post (posts): View" });
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
  });

  describe("for the Public role, whose permissions are what visitors may do", () => {
    it("offers only No access and Can view", () => {
      render(<Harness row={POSTS} initial={[]} visitors />);

      const offered = levels("Post (posts)")
        .getAllByRole("radio")
        .map(radio => radio.textContent);
      expect(offered).toEqual(["No access", "Can view"]);
    });

    it("saves Can view as reading alone", async () => {
      render(<Harness row={POSTS} initial={[ELSEWHERE]} visitors />);

      await userEvent.click(
        levels("Post (posts)").getByRole("radio", { name: "Can view" })
      );

      expect([...saved].sort()).toEqual([ELSEWHERE, "posts-read"].sort());
    });

    it("shows no publish or unpublish switch, and warns beside a write that is on", async () => {
      render(<Harness row={POSTS} initial={["posts-read"]} visitors />);
      await userEvent.click(
        screen.getByRole("switch", { name: "Post (posts): each action" })
      );

      expect(
        screen.queryByRole("switch", { name: /Post \(posts\): Publish/ })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("switch", { name: /Post \(posts\): Unpublish/ })
      ).not.toBeInTheDocument();
      // POPULATION CONTROL: the other actions are still there.
      expect(
        screen.getByRole("switch", { name: "Post (posts): Create" })
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          "Visitors who aren't signed in can change these entries."
        )
      ).not.toBeInTheDocument();

      await userEvent.click(
        screen.getByRole("switch", { name: "Post (posts): Create" })
      );

      expect(
        screen.getByText(
          "Visitors who aren't signed in can change these entries."
        )
      ).toBeInTheDocument();
    });

    it("reads a row holding create as Custom, and keeps it", () => {
      render(
        <Harness
          row={POSTS}
          initial={["posts-read", "posts-create"]}
          visitors
        />
      );

      expect(screen.getByText("Custom")).toBeInTheDocument();
      expect([...saved].sort()).toEqual(["posts-create", "posts-read"]);
    });
  });
});
