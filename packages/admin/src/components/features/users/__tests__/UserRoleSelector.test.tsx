// @vitest-environment jsdom
/**
 * The roles a person can be given: the picker on the user create and edit
 * pages leaves out the Public role, which the server refuses to give anyone.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { Role } from "@admin/types/entities";

import { UserRoleSelector } from "../UserRoleSelector";

const role = (name: string, assignable: boolean): Role => ({
  id: `role-${name.toLowerCase()}`,
  roleName: name,
  name,
  subtitle: "",
  description: "",
  type: assignable ? "Custom" : "System",
  permissions: [],
  assignable,
});

describe("UserRoleSelector", () => {
  it("offers every role a person can be given, and not the Public role", async () => {
    const user = userEvent.setup();
    render(
      <UserRoleSelector
        value={[]}
        onChange={vi.fn()}
        roles={[role("Editor", true), role("Public", false)]}
      />
    );

    await user.click(
      screen.getByRole("combobox", { name: "Open role selector" })
    );

    // The positive control: the list is open and shows a role.
    expect(await screen.findByText("Editor")).toBeTruthy();
    expect(screen.queryByText("Public")).toBeNull();
  });
});
