/**
 * A sign-in that must first replace an admin-set password, started on a
 * sign-in page asked to return somewhere, lands there once the password is
 * set, as a sign-in without that step does.
 *
 * Setting the password answers with the server's destination, which is the
 * admin root for a login that carried none, as a password sign-in never
 * does; following that dropped the return address.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetSetupStatusCache } from "@admin/lib/auth/setup-status";

import { Login } from "../index";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/publicApi", () => ({ publicApi: { get, post } }));
vi.mock("@admin/lib/api/csrf", () => ({
  getCsrfToken: async () => "csrf-token",
}));
vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({ api: { public: { get, post } } }),
}));

/**
 * The set-password view, reduced to its completion: it reports the server's
 * destination to the page, as the real one does once the password is set.
 */
const serverNext = vi.hoisted(() => ({
  value: "/admin" as string | undefined,
}));
vi.mock("../set-initial-password", () => ({
  SetInitialPassword: ({ onDone }: { onDone: (next?: string) => void }) => (
    <button type="button" onClick={() => onDone(serverNext.value)}>
      password set
    </button>
  ),
}));

const CALLBACK =
  "/admin/api/plugins/@nextlyhq/plugin-seo/connections/search-console/callback?code=4%2F0Ab&state=s-1";

let navigations: string[] = [];

function onSignInPage(search: string): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "http://localhost",
      pathname: "/admin/login",
      search,
      get href() {
        return `http://localhost/admin/login${search}`;
      },
      set href(value: string) {
        navigations.push(value);
      },
    },
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  navigations = [];
  resetSetupStatusCache();
  get.mockImplementation(async (path: string) =>
    path === "/auth/setup-status"
      ? { isSetup: true }
      : {
          providers: [],
          challengeViews: {},
          slots: { beforeForm: [], afterForm: [], branding: [] },
        }
  );
  post.mockResolvedValue({
    status: "password_change_required",
    pendingToken: "pending-1",
  });
});

async function signInAndSetPassword(): Promise<void> {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Login />
    </QueryClientProvider>
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: /email/i }),
    "ada@example.com"
  );
  await user.type(screen.getByPlaceholderText(/password/i), "correct-horse");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /sign in/i })
    ).not.toHaveAttribute("aria-disabled", "true")
  );
  await user.click(screen.getByRole("button", { name: /sign in/i }));
  await user.click(await screen.findByRole("button", { name: "password set" }));
  await waitFor(() => expect(navigations.length).toBeGreaterThan(0));
}

describe("a password sign-in on a sign-in page asked to return", () => {
  it("lands on the return address", async () => {
    onSignInPage(`?${new URLSearchParams({ next: CALLBACK })}`);
    post.mockResolvedValue({ message: "Login successful!" });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <Login />
      </QueryClientProvider>
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      "ada@example.com"
    );
    await user.type(screen.getByPlaceholderText(/password/i), "correct-horse");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /sign in/i })
      ).not.toHaveAttribute("aria-disabled", "true")
    );
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(navigations.length).toBeGreaterThan(0));

    expect(navigations).toEqual([CALLBACK]);
  });
});

describe("a required password change on a sign-in page asked to return", () => {
  it("lands on the return address when the login named no destination", async () => {
    onSignInPage(`?${new URLSearchParams({ next: CALLBACK })}`);
    serverNext.value = "/admin";

    await signInAndSetPassword();

    expect(navigations).toEqual([CALLBACK]);
  });

  it("keeps a destination the login carried", async () => {
    onSignInPage(`?${new URLSearchParams({ next: CALLBACK })}`);
    serverNext.value = "/admin/collections/posts";

    await signInAndSetPassword();

    expect(navigations).toEqual(["/admin/collections/posts"]);
  });
});
