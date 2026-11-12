/**
 * The sign-in page offers "Sign up" only where the app takes sign-ups
 * (`auth.allowRegistration`, which setup-status serves): off by default, so a
 * page that offered it sent people to a form the server refuses.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetSetupStatusCache } from "@admin/lib/auth/setup-status";

import { Login } from "../index";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/publicApi", () => ({ publicApi: { get, post } }));
vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({ api: { public: { get, post } } }),
}));

const NO_AUTH_UI = {
  providers: [],
  challengeViews: {},
  slots: { beforeForm: [], afterForm: [], branding: [] },
};

/** Setup-status answering `answer`, held until `release` where given. */
function serveSetupStatus(answer: unknown, held?: Promise<void>) {
  get.mockImplementation(async (path: string) => {
    if (path !== "/auth/setup-status") return NO_AUTH_UI;
    await held;
    return answer;
  });
}

const signUp = () => screen.queryByRole("link", { name: /sign up/i });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  resetSetupStatusCache();
});

describe("the sign-in page's offer to sign up", () => {
  it("is made where the app takes sign-ups", async () => {
    serveSetupStatus({ isSetup: true, allowRegistration: true });
    render(<Login />);
    // The control: the offer is drawn once the answer says so, so its
    // absence below is the answer's doing, not a page that draws none.
    await waitFor(() =>
      expect(signUp()).toHaveAttribute("href", "/admin/register")
    );
  });

  it("is not made where the app takes none", async () => {
    serveSetupStatus({ isSetup: true, allowRegistration: false });
    render(<Login />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/auth/setup-status"));
    // Past the answer: the form is drawn and settled.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.getByRole("button", { name: /sign in/i })).toBeVisible();
    expect(signUp()).toBeNull();
    expect(screen.queryByText(/don.t have an account/i)).toBeNull();
  });

  it("is not made by a server that says nothing of it, as on an older release", async () => {
    serveSetupStatus({ isSetup: true });
    render(<Login />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/auth/setup-status"));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(signUp()).toBeNull();
  });

  it("is not made before the server has answered", async () => {
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    serveSetupStatus({ isSetup: true, allowRegistration: true }, held);
    render(<Login />);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(signUp()).toBeNull();
    release();
    await waitFor(() => expect(signUp()).not.toBeNull());
  });
});
