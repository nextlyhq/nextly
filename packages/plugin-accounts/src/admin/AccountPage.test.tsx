// @vitest-environment jsdom

/**
 * An account's page as staff see it, in both of the admin's modes: what it
 * shows, which actions it offers to whom, and what confirming one sends.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  usePluginRouteMutation: vi.fn(),
}));

import {
  usePluginRoute,
  usePluginRouteMutation,
} from "@nextlyhq/plugin-sdk/admin";

import type { StaffAccountDetail } from "../admin-contract";

import {
  expectTokenColoursOnly,
  renderInTheme,
  THEMES,
} from "./__tests__/themes";
import { AccountPage, actionsFor } from "./AccountPage";

const read = vi.mocked(usePluginRoute);
const mutation = vi.mocked(usePluginRouteMutation);

const DANA: StaffAccountDetail = {
  id: "a1",
  address: "dana@example.com",
  name: "Dana",
  verified: true,
  active: true,
  resetRequired: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSignedInAt: null,
  verifiedAt: "2026-01-01T00:00:00.000Z",
  verifiedBy: "link",
  deactivatedAt: null,
  resetRequiredAt: null,
  passwordChangedAt: null,
  liveSessions: 2,
};

/** Every write the page sends, by the route path it was made for. */
const writes: string[] = [];

function showing(account: StaffAccountDetail, canManage: boolean): void {
  read.mockReturnValue({
    data: { account, canManage },
    pending: false,
    error: null,
    refetch: () => {},
  });
}

beforeEach(() => {
  read.mockReset();
  mutation.mockReset();
  writes.length = 0;
  mutation.mockImplementation(({ path }) => ({
    write: () => {
      writes.push(path);
      return Promise.resolve({ message: `Done: ${path}` });
    },
    pending: false,
    error: null,
  }));
});

const page = (id = "a1") => <AccountPage searchParams={{ id }} />;

describe.each(THEMES)("an account's page (%s)", theme => {
  it("reads the account the address names and shows it, in the theme's tokens alone", () => {
    showing(DANA, false);

    renderInTheme(page("a 1"), theme);

    expect(read.mock.calls.at(-1)?.[0]).toMatchObject({
      plugin: "@nextlyhq/plugin-accounts",
      path: "/staff/accounts/a%201",
    });
    expect(screen.getByText("Dana")).toBeTruthy();
    expect(screen.getByText("dana@example.com")).toBeTruthy();
    expect(screen.getByText("Live sessions")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expectTokenColoursOnly(document.body);
  });

  it("shows a name holding markup as the text it is", () => {
    const name = '<img src=x onerror="alert(1)"><b>Dana</b>';
    showing({ ...DANA, name }, false);

    const { container } = renderInTheme(page(), theme);

    expect(screen.getByText(name).textContent).toBe(name);
    expect(container.querySelector("img, b")).toBeNull();
  });

  it("offers no action to staff who may only read", () => {
    showing(DANA, false);

    renderInTheme(page(), theme);

    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("offers staff who may manage the actions that apply, and sends one once confirmed", async () => {
    showing(DANA, true);
    renderInTheme(page(), theme);

    expect(
      screen.getAllByRole("button").map(button => button.textContent)
    ).toEqual([
      "Deactivate",
      "End sessions",
      "Send reset link",
      "Delete account",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "End sessions" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(writes).toEqual([]);
    expectTokenColoursOnly(document.body);
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "End sessions" }));
      await Promise.resolve();
    });

    expect(writes).toEqual(["/staff/accounts/a1/end-sessions"]);
    expect(screen.getByRole("status").textContent).toBe(
      "Done: /staff/accounts/a1/end-sessions"
    );
  });

  it("sends nothing when staff cancel", () => {
    showing(DANA, true);
    renderInTheme(page(), theme);

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      })
    );

    expect(writes).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says why an action was refused, and keeps the dialog open", () => {
    showing(DANA, true);
    mutation.mockImplementation(() => ({
      write: () => Promise.resolve(undefined),
      pending: false,
      error: new Error("That can't be done to this account as it stands."),
    }));
    renderInTheme(page(), theme);

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    expect(
      within(screen.getByRole("dialog")).getByRole("alert").textContent
    ).toBe("That can't be done to this account as it stands.");
  });
});

describe("the actions an account is offered", () => {
  it("follows the account's state", () => {
    expect(actionsFor({ active: true, verified: true })).toEqual([
      "deactivate",
      "end-sessions",
      "send-reset",
      "delete",
    ]);
    expect(actionsFor({ active: true, verified: false })).toEqual([
      "deactivate",
      "end-sessions",
      "resend-verification",
      "send-reset",
      "delete",
    ]);
    expect(actionsFor({ active: false, verified: false })).toEqual([
      "reactivate",
      "end-sessions",
      "delete",
    ]);
  });
});
