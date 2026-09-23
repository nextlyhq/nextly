/**
 * Answering a challenge does not always mean a session exists.
 *
 * The forced first-sign-in password change answers 200 with no cookies
 * issued. Treating every successful response as a completed session navigated
 * to the dashboard, which bounced straight back to login — so the account
 * could never reach the set-password view, and the loop had no exit.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChallengeFlow } from "../use-resume-login";

const post = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: vi.fn().mockResolvedValue(null), post },
}));

/** Where the hook would send the browser, without actually navigating. */
let navigatedTo: string | undefined;

beforeEach(() => {
  post.mockReset();
  navigatedTo = undefined;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() {
        return "http://localhost/admin/login";
      },
      set href(value: string) {
        navigatedTo = value;
      },
    },
  });
});

describe("answering a challenge", () => {
  it("reports a required password change instead of navigating", async () => {
    post.mockResolvedValue({
      status: "password_change_required",
      pendingToken: "pending-abc",
    });

    const { result } = renderHook(() => useChallengeFlow());
    const answer = await result.current.resolve({ code: "123456" });

    expect(answer).toMatchObject({
      ok: true,
      passwordChangeRequired: { pendingToken: "pending-abc" },
    });
    // The decisive half: navigating here is what stranded the account, since
    // no session was issued to arrive with.
    expect(navigatedTo).toBeUndefined();
  });

  it("navigates when a session WAS issued", async () => {
    // The control. A hook that never navigated would satisfy the test above
    // while breaking every ordinary second-factor sign-in.
    post.mockResolvedValue({ next: "/admin/collections" });

    const { result } = renderHook(() => useChallengeFlow());
    const answer = await result.current.resolve({ code: "123456" });

    expect(answer).toMatchObject({ ok: true });
    expect(answer.passwordChangeRequired).toBeUndefined();
    expect(navigatedTo).toBe("/admin/collections");
  });

  it("still reports a wrong answer as a failure", async () => {
    post.mockRejectedValue(new Error("nope"));

    const { result } = renderHook(() => useChallengeFlow());
    const answer = await result.current.resolve({ code: "000000" });

    expect(answer.ok).toBe(false);
    expect(navigatedTo).toBeUndefined();
  });

  it("RAISES the password change on the flow, with its token", async () => {
    // The hook holds this state rather than the login component, so the view
    // has one thing to read. Asserting only the returned answer leaves that
    // untested: the answer can be right while nothing is raised, and then the
    // set-password view never renders.
    post.mockResolvedValue({
      status: "password_change_required",
      pendingToken: "pt-1",
    });

    const { result } = renderHook(() => useChallengeFlow());
    expect(result.current.passwordChange).toBeNull();

    await act(async () => {
      await result.current.resolve({ code: "123456" });
    });

    expect(result.current.passwordChange).toEqual({ pendingToken: "pt-1" });
  });

  it("raises nothing when a session WAS issued", async () => {
    // The control: raising unconditionally would satisfy the test above while
    // showing the set-password view to everyone who signs in normally.
    post.mockResolvedValue({ next: "/admin/collections" });

    const { result } = renderHook(() => useChallengeFlow());
    await act(async () => {
      await result.current.resolve({ code: "123456" });
    });

    expect(result.current.passwordChange).toBeNull();
  });
});
