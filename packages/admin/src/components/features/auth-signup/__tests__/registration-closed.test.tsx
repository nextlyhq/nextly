/**
 * The register page draws its form only where the app takes sign-ups
 * (`auth.allowRegistration`, which setup-status serves). Where it takes none,
 * it says so and points back to sign-in, rather than a form the server
 * refuses once it has been filled in.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetSetupStatusCache } from "@admin/lib/auth/setup-status";

import { Signup } from "../index";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/publicApi", () => ({ publicApi: { get, post } }));
vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({ api: { public: { get, post } } }),
}));

function serveSetupStatus(answer: unknown) {
  get.mockImplementation(async (path: string) =>
    path === "/auth/setup-status" ? answer : undefined
  );
}

const createAccount = () =>
  screen.queryByRole("button", { name: /create account/i });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  resetSetupStatusCache();
});

describe("the register page", () => {
  it("draws the form where the app takes sign-ups", async () => {
    serveSetupStatus({ isSetup: true, allowRegistration: true });
    render(<Signup />);
    // The control: the same page draws the form when the answer says so.
    await waitFor(() => expect(createAccount()).not.toBeNull());
    expect(screen.queryByText(/registration is closed/i)).toBeNull();
  });

  it("says registration is closed, and leads back to sign-in, where it takes none", async () => {
    serveSetupStatus({ isSetup: true, allowRegistration: false });
    render(<Signup />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /registration is closed/i })
      ).toBeVisible()
    );
    expect(screen.getByText(/ask an administrator/i)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /back to sign in/i })
    ).toHaveAttribute("href", "/admin/login");
    expect(createAccount()).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("draws no form before the server has answered", async () => {
    get.mockImplementation(() => new Promise(() => {}));
    render(<Signup />);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(createAccount()).toBeNull();
    expect(screen.queryByText(/registration is closed/i)).toBeNull();
  });
});
