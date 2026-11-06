// @vitest-environment jsdom
/**
 * The roles a role-based API key can act as: the picker leaves out the Public
 * role, which the server refuses as a key's role.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { CreateApiKeyForm } from "../CreateApiKeyForm";

vi.mock("@admin/hooks/queries/useRoles", () => ({
  useRoles: () => ({
    data: {
      items: [
        { id: "role-editor", roleName: "Editor", assignable: true },
        { id: "role-public", roleName: "Public", assignable: false },
      ],
    },
    isLoading: false,
  }),
}));

describe("CreateApiKeyForm", () => {
  it("offers a role-based key every role but the Public role", async () => {
    const user = userEvent.setup();
    render(<CreateApiKeyForm onSubmit={vi.fn()} isPending={false} />);

    await user.click(screen.getByRole("combobox", { name: /token type/i }));
    await user.click(await screen.findByRole("option", { name: "Role-based" }));
    await user.click(await screen.findByRole("combobox", { name: /^role$/i }));

    // The positive control: the role list is open and shows a role.
    expect(await screen.findByRole("option", { name: "Editor" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Public" })).toBeNull();
  });
});
