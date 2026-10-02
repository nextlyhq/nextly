/**
 * The login PAGE through a resumed challenge, rendered whole.
 *
 * The hook's own tests cannot see what the page does with the view's
 * callbacks: a view that finishes a challenge calls `resolve()` and then
 * `onResolved(...)`, and the page navigating on both sent a login headed for
 * `next` to the dashboard instead.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChallengeViewProps } from "../auth-ui-extras";
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
 * The plugin's challenge view, as a real one behaves: it answers, and on an
 * ok answer that does not continue, it calls `onResolved` with what it knows
 * of the destination — which is nothing. With no view registered it renders
 * the host's fallback, as the real slot does.
 */
vi.mock("@admin/components/shared/plugin-slot", () => ({
  PluginSlot: ({
    path,
    props,
    fallback,
  }: {
    path?: string;
    props?: Record<string, unknown>;
    fallback?: ReactNode;
  }) => {
    if (!path) return fallback ?? null;
    const view = props as unknown as ChallengeViewProps | undefined;
    if (!view?.resolve) return null;
    return (
      <button
        type="button"
        onClick={() => {
          void view.resolve({ code: "123456" }).then(result => {
            if (result.ok && !result.continues) view.onResolved(null);
          });
        }}
      >
        submit code
      </button>
    );
  },
}));

let navigations: string[] = [];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  navigations = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      search: "?resume=1",
      get href() {
        return "http://localhost/admin/login?resume=1";
      },
      set href(value: string) {
        navigations.push(value);
      },
    },
  });
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  get.mockImplementation(async (path: string) =>
    path === "/auth/pending"
      ? { challengeId: "test-totp", next: "/admin/collections/posts" }
      : {
          providers: [],
          challengeViews: { "test-totp": "@t/totp#View" },
          slots: { beforeForm: [], afterForm: [], branding: [] },
        }
  );
});

describe("a resumed challenge on the login page", () => {
  it("lands on the login's next, once", async () => {
    post.mockResolvedValue({ next: "/admin/collections/posts" });

    render(<Login />);
    const submit = await screen.findByRole("button", { name: "submit code" });
    submit.click();

    await waitFor(() => expect(navigations.length).toBeGreaterThan(0));
    // Give a second navigation the chance to happen before judging.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(navigations).toEqual(["/admin/collections/posts"]);
  });

  it("says the attempt ended when the last answer is refused", async () => {
    post.mockRejectedValue(
      Object.assign(new Error("Invalid credentials"), { status: 401 })
    );

    render(<Login />);
    const submit = await screen.findByRole("button", { name: "submit code" });
    submit.click();

    expect(await screen.findByTestId("signin-ended")).toHaveTextContent(
      "That sign-in attempt ended"
    );
  });

  it("keeps the challenge when the request fails for another reason", async () => {
    post.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<Login />);
    const submit = await screen.findByRole("button", { name: "submit code" });
    submit.click();

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(
      screen.getByRole("button", { name: "submit code" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("signin-ended")).toBeNull();
  });
});

describe("a resumed challenge before /auth/ui answers", () => {
  const authUi = {
    providers: [],
    challengeViews: { "test-totp": "@t/totp#View" },
    slots: { beforeForm: [], afterForm: [], branding: [] },
  };

  it("keeps the page continuing until the view is known, then renders it", async () => {
    // `/auth/pending` answering first left the challenge with no view to
    // render, and the fallback's link back to sign-in abandoned a valid flow.
    let answerUi: (value: unknown) => void = () => undefined;
    get.mockImplementation((path: string) =>
      path === "/auth/pending"
        ? Promise.resolve({ challengeId: "test-totp", next: null })
        : new Promise(resolve => {
            answerUi = resolve;
          })
    );

    render(<Login />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/auth/pending"));
    // Let the pending answer land and raise the challenge.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    expect(screen.getByTestId("resuming-sign-in")).toBeInTheDocument();
    expect(screen.queryByTestId("challenge-fallback")).toBeNull();
    expect(screen.queryByText(/no UI is registered/)).toBeNull();

    await act(async () => {
      answerUi(authUi);
    });

    expect(
      await screen.findByRole("button", { name: "submit code" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("resuming-sign-in")).toBeNull();
  });

  it("falls through to the missing-view message when /auth/ui fails", async () => {
    // The control: waiting forever on a request that failed would hold the
    // page on a spinner with no way on.
    get.mockImplementation((path: string) =>
      path === "/auth/pending"
        ? Promise.resolve({ challengeId: "test-totp", next: null })
        : Promise.reject(new Error("offline"))
    );

    render(<Login />);

    expect(await screen.findByTestId("challenge-fallback")).toHaveTextContent(
      "no UI is registered"
    );
    expect(screen.queryByTestId("resuming-sign-in")).toBeNull();
  });
});
