/**
 * PermissionMatrix edits only what the role holds itself.
 *
 * Its value is the role's own permissions. A permission the role inherits
 * from its base is locked: shown ticked and not editable, because the base
 * decides it. Clearing, selecting all and every other change act on the
 * role's own permissions alone, so an inherited permission is never saved as
 * the role's own, and one the role holds itself as well as inheriting is
 * still its own to take away.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { Permission } from "@admin/types/ui/form";

import { PermissionMatrix } from "./PermissionMatrix";

const PERMISSIONS: Permission[] = [
  { id: "p1", name: "Read posts", resource: "posts", action: "read" },
  { id: "p2", name: "Update posts", resource: "posts", action: "update" },
  { id: "p3", name: "Read tags", resource: "tags", action: "read" },
];

/** The "read" cell of the tags row. */
function readTags() {
  return screen.getByRole("checkbox", { name: /read.*tags/i });
}

describe("PermissionMatrix", () => {
  it("shows an inherited permission ticked and locked", () => {
    render(
      <PermissionMatrix
        permissions={PERMISSIONS}
        value={[]}
        onChange={vi.fn()}
        lockedIds={["p3"]}
      />
    );

    expect(readTags()).toBeChecked();
    expect(readTags()).toBeDisabled();
  });

  it("clears everything the role holds itself, an inherited one included", async () => {
    const onChange = vi.fn();
    render(
      <PermissionMatrix
        permissions={PERMISSIONS}
        value={["p1", "p3"]}
        onChange={onChange}
        lockedIds={["p3"]}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Clear all permissions" })
    );

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("clears only its own permissions, leaving those set elsewhere on the screen", async () => {
    // The roles screen sets collections and Singles by level above the grid,
    // so the role's value holds ids the grid does not show.
    const onChange = vi.fn();
    render(
      <PermissionMatrix
        permissions={PERMISSIONS}
        value={["p1", "pages-read"]}
        onChange={onChange}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Clear all permissions" })
    );

    expect(onChange).toHaveBeenCalledWith(["pages-read"]);
  });

  it("has nothing to clear while it holds none of its own", () => {
    render(
      <PermissionMatrix
        permissions={PERMISSIONS}
        value={["pages-read"]}
        onChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Clear all permissions" })
    ).toBeDisabled();
  });

  it("offers only the tabs it has permissions in", () => {
    render(
      <PermissionMatrix
        permissions={[
          {
            id: "s1",
            name: "Read settings",
            resource: "settings",
            action: "read",
            category: "settings",
          },
        ]}
        value={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "Settings",
    ]);
  });

  it("has nothing to clear once the role holds nothing itself", () => {
    render(
      <PermissionMatrix
        permissions={PERMISSIONS}
        value={[]}
        onChange={vi.fn()}
        lockedIds={["p3"]}
      />
    );

    expect(
      screen.getByRole("button", { name: "Clear all permissions" })
    ).toBeDisabled();
  });

  it("selects every permission the role does not inherit", async () => {
    const onChange = vi.fn();
    render(
      <PermissionMatrix
        permissions={PERMISSIONS}
        value={[]}
        onChange={onChange}
        lockedIds={["p3"]}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Select all permissions" })
    );

    expect(onChange).toHaveBeenCalledWith(["p1", "p2"]);
  });

  it("ticks a row without taking its inherited permission as the role's own", async () => {
    const onChange = vi.fn();
    render(
      <PermissionMatrix
        permissions={[
          ...PERMISSIONS,
          { id: "p4", name: "Update tags", resource: "tags", action: "update" },
        ]}
        value={[]}
        onChange={onChange}
        lockedIds={["p3"]}
      />
    );

    // The desktop table's row; the phone layout renders its own as well.
    const [row] = screen.getAllByRole("checkbox", {
      name: "Toggle all permissions for tags",
    });
    await userEvent.click(row);

    expect(onChange).toHaveBeenCalledWith(["p4"]);
  });
});
