/**
 * PermissionMatrix's Clear All takes away only what the role holds itself.
 *
 * A permission the role inherits from its base is locked: shown ticked and
 * not editable, because the base decides it. Clearing the matrix must keep
 * those, or the form saves the role without permissions its base still
 * gives, and the matrix shows them gone while the base says otherwise.
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

describe("PermissionMatrix's Clear All", () => {
  it("keeps the permissions the role inherits", async () => {
    const onChange = vi.fn();
    render(
      <PermissionMatrix
        permissions={PERMISSIONS}
        value={["p1", "p2", "p3"]}
        onChange={onChange}
        lockedIds={["p3"]}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Clear all permissions" })
    );

    expect(onChange).toHaveBeenCalledWith(["p3"]);
  });

  it("clears everything when the role inherits nothing", async () => {
    // The control: with nothing locked, nothing is kept.
    const onChange = vi.fn();
    render(
      <PermissionMatrix
        permissions={PERMISSIONS}
        value={["p1", "p2", "p3"]}
        onChange={onChange}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Clear all permissions" })
    );

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("has nothing to clear once only inherited permissions are left", () => {
    render(
      <PermissionMatrix
        permissions={PERMISSIONS}
        value={["p3"]}
        onChange={vi.fn()}
        lockedIds={["p3"]}
      />
    );

    expect(
      screen.getByRole("button", { name: "Clear all permissions" })
    ).toBeDisabled();
  });
});
