// @vitest-environment jsdom

/**
 * The list of accounts as staff see it, in both of the admin's modes: what
 * it asks the server for, and how it draws what comes back.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
}));

import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import type {
  StaffAccountSummary,
  StaffAccountsListBody,
} from "../admin-contract";

import {
  expectTokenColoursOnly,
  renderInTheme,
  THEMES,
} from "./__tests__/themes";
import { AccountsListPage, listPath } from "./AccountsListPage";

const read = vi.mocked(usePluginRoute);

const DANA: StaffAccountSummary = {
  id: "a1",
  address: "dana@example.com",
  name: "Dana",
  verified: true,
  active: true,
  resetRequired: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSignedInAt: null,
};

function answering(
  items: StaffAccountSummary[],
  meta: Partial<StaffAccountsListBody["meta"]> = {}
): void {
  read.mockReturnValue({
    data: {
      items,
      meta: { page: 1, limit: 25, hasNext: false, hasPrev: false, ...meta },
    },
    pending: false,
    error: null,
    refetch: () => {},
  });
}

/** The path of the latest read the page asked for. */
function lastPath(): string {
  return read.mock.calls.at(-1)?.[0].path ?? "";
}

beforeEach(() => {
  read.mockReset();
});

describe.each(THEMES)("the list of accounts (%s)", theme => {
  it("draws each account with its states and a link to its page, in the theme's tokens alone", () => {
    answering([
      DANA,
      {
        ...DANA,
        id: "a2",
        address: "lee@example.com",
        name: "Lee",
        verified: false,
        active: false,
        resetRequired: true,
      },
    ]);

    const { container } = renderInTheme(<AccountsListPage />, theme);

    const link = screen.getByRole("link", { name: "Lee" });
    expect(link.getAttribute("href")).toBe(
      "/admin/plugins/nextlyhq-plugin-accounts/account?id=a2"
    );
    const row = within(screen.getByRole("row", { name: /Lee/ }));
    expect(row.getByText("lee@example.com")).toBeTruthy();
    expect(row.getByText("Deactivated")).toBeTruthy();
    expect(row.getByText("Reset required")).toBeTruthy();
    expect(row.getByText("Unverified")).toBeTruthy();
    expect(row.getByText("Never")).toBeTruthy();
    expectTokenColoursOnly(container);
  });

  it("shows a name holding markup as the text it is", () => {
    const name = '<img src=x onerror="alert(1)"><b>Dana</b>';
    answering([{ ...DANA, name }]);

    const { container } = renderInTheme(<AccountsListPage />, theme);

    expect(screen.getByRole("link", { name }).textContent).toBe(name);
    expect(container.querySelector("img, b")).toBeNull();
  });

  it("asks for the search typed, from the first page", () => {
    answering([DANA], { hasNext: true });
    renderInTheme(<AccountsListPage />, theme);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(lastPath()).toBe(listPath("", undefined, 2));

    fireEvent.change(screen.getByLabelText("Address or name"), {
      target: { value: "  dana " },
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(lastPath()).toBe(listPath("dana", undefined, 1));
    expect(lastPath()).toBe("/staff/accounts?search=dana&page=1&perPage=25");
  });

  it("offers the next and previous pages only where they exist", () => {
    answering([DANA], { hasNext: false, hasPrev: false });
    renderInTheme(<AccountsListPage />, theme);

    expect(
      screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it("says when nothing matches, and why a read failed", () => {
    answering([]);
    const { unmount } = renderInTheme(<AccountsListPage />, theme);
    expect(screen.getByText("No account matches.")).toBeTruthy();
    unmount();

    read.mockReturnValue({
      data: undefined,
      pending: false,
      error: new Error("You do not have permission."),
      refetch: () => {},
    });
    renderInTheme(<AccountsListPage />, theme);
    expect(screen.getByRole("alert").textContent).toBe(
      "You do not have permission."
    );
  });
});

describe("the list route's path", () => {
  it("carries the state filter and the page size", () => {
    expect(listPath("", "deactivated", 3)).toBe(
      "/staff/accounts?state=deactivated&page=3&perPage=25"
    );
  });
});
