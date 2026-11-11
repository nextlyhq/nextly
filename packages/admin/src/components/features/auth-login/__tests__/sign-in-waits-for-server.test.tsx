/**
 * The sign-in form while the server has not answered the page: it can be
 * filled in and pressed, its button reads as unavailable, and the sign-in is
 * sent once the server answers, exactly once however often it was pressed.
 *
 * The server's first answer is setup-status, held here on a promise the test
 * resolves, so "not answered yet" is a state the test holds open.
 */
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

let answerSetupStatus = () => {};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  resetSetupStatusCache();
  const setupStatus = new Promise<{ isSetup: boolean }>(resolve => {
    answerSetupStatus = () => resolve({ isSetup: true });
  });
  get.mockImplementation((path: string) =>
    path === "/auth/setup-status"
      ? setupStatus
      : Promise.resolve({
          providers: [],
          challengeViews: {},
          slots: { beforeForm: [], afterForm: [], branding: [] },
        })
  );
  // A sign-in the server refuses, so the form stays where it is.
  post.mockRejectedValue(
    Object.assign(new Error("Invalid email or password."), { status: 401 })
  );
});

const signInButton = () => screen.getByRole("button", { name: /sign in/i });

async function fillIn() {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: /email/i }),
    "ada@example.com"
  );
  await user.type(screen.getByPlaceholderText(/password/i), "correct-horse");
  return user;
}

describe("signing in before the server has answered", () => {
  it("takes typing and presses, and sends nothing until the server answers", async () => {
    render(<Login />);
    const user = await fillIn();

    expect(signInButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(signInButton());
    await user.click(signInButton());
    // Give a premature send every chance to happen.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(post).not.toHaveBeenCalled();
  });

  it("sends the sign-in once, when the server answers, however often it was pressed", async () => {
    render(<Login />);
    const user = await fillIn();
    await user.click(signInButton());
    await user.click(signInButton());
    await user.click(signInButton());

    answerSetupStatus();

    await waitFor(() => expect(post).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    const signIns = post.mock.calls.filter(([path]) => path === "/auth/login");
    expect(signIns).toHaveLength(1);
    expect(signIns[0]?.[1]).toMatchObject({
      email: "ada@example.com",
      password: "correct-horse",
    });
    // The button is available again once the server has answered.
    await waitFor(() =>
      expect(signInButton()).not.toHaveAttribute("aria-disabled")
    );
  });

  it("sends nothing on its own when nobody pressed Sign in", async () => {
    render(<Login />);
    await fillIn();

    answerSetupStatus();

    await waitFor(() =>
      expect(signInButton()).not.toHaveAttribute("aria-disabled")
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("sends the held sign-in when a hung server is asked again, keeping what was typed", async () => {
    // The first ask is held for good, as a server that never answers it; a
    // retry drops it (resetting setup-status, as asking the session again
    // does) and asks afresh, and that ask is answered.
    render(<Login />);
    const user = await fillIn();
    await user.click(signInButton());
    get.mockImplementation((path: string) =>
      path === "/auth/setup-status"
        ? Promise.resolve({ isSetup: true })
        : Promise.resolve({
            providers: [],
            challengeViews: {},
            slots: { beforeForm: [], afterForm: [], branding: [] },
          })
    );

    resetSetupStatusCache();

    await waitFor(() => expect(post).toHaveBeenCalled());
    const signIns = post.mock.calls.filter(([path]) => path === "/auth/login");
    expect(signIns).toHaveLength(1);
    // The same form, not one drawn afresh: what was typed is still in it.
    expect(screen.getByRole("textbox", { name: /email/i })).toHaveValue(
      "ada@example.com"
    );
  });
});
