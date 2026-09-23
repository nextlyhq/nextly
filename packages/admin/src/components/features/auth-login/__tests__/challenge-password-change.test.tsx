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

describe("a wrong answer advances the token", () => {
  /** The shape `parseApiError` produces for a canonical error envelope. */
  function envelopeError(data: Record<string, unknown>) {
    return Object.assign(new Error("Invalid code."), {
      status: 401,
      code: "AUTH_INVALID_CREDENTIALS",
      data,
    });
  }

  it("replaces the pending token it will send next", async () => {
    // A wrong answer answers 401, which the fetcher throws, so the fresh
    // token rides in the error envelope. Ignoring it meant the next attempt
    // replayed the OLD counter: the budget was spent without ever advancing,
    // so the cap ran out while the person was still guessing.
    const { result } = renderHook(() => useChallengeFlow());
    act(() => {
      result.current.start({
        challengeType: "totp",
        pendingToken: "pt-first",
        next: null,
      });
    });

    post.mockRejectedValueOnce(envelopeError({ pendingToken: "pt-second" }));
    await act(async () => {
      await result.current.resolve({ code: "000000" });
    });

    expect(result.current.challenge?.pendingToken).toBe("pt-second");
  });

  it("keeps the token it has when the failure carries none", async () => {
    // The control, and the cookie-mode case: there the replacement arrives as
    // a `Set-Cookie` the browser applies, and the body carries no token at
    // all. Clearing it here would strand the next attempt with nothing.
    const { result } = renderHook(() => useChallengeFlow());
    act(() => {
      result.current.start({
        challengeType: "totp",
        pendingToken: "pt-first",
        next: null,
      });
    });

    post.mockRejectedValueOnce(envelopeError({}));
    await act(async () => {
      await result.current.resolve({ code: "000000" });
    });

    expect(result.current.challenge?.pendingToken).toBe("pt-first");
  });
});

describe("a password change is not reported as a finished login", () => {
  it("marks the answer as CONTINUING", async () => {
    // A challenge view reads `ok` as "done" and calls `onResolved`, which
    // navigates. The factor was correct, so this is not a failure — but the
    // login is not finished either, and the host is already rendering the
    // set-password step.
    post.mockResolvedValue({
      status: "password_change_required",
      pendingToken: "pt-1",
    });

    const { result } = renderHook(() => useChallengeFlow());
    let answer: Awaited<ReturnType<typeof result.current.resolve>> | undefined;
    await act(async () => {
      answer = await result.current.resolve({ code: "123456" });
    });

    expect(answer).toMatchObject({ ok: true, continues: true });
  });

  it("reports isContinuing SYNCHRONOUSLY, for a callback that closed over an older render", async () => {
    // `onResolved` is invoked from the view's own handler, often in the tick
    // that raised the continuation. A state read there is still the stale one,
    // which is why the host checks a ref instead.
    post.mockResolvedValue({
      status: "password_change_required",
      pendingToken: "pt-1",
    });

    const { result } = renderHook(() => useChallengeFlow());
    expect(result.current.isContinuing()).toBe(false);

    // The accessor captured BEFORE the answer, as a view's callback would be.
    const isContinuing = result.current.isContinuing;
    await act(async () => {
      await result.current.resolve({ code: "123456" });
    });

    expect(isContinuing()).toBe(true);
  });

  it("does NOT mark an ordinary success as continuing", async () => {
    // The control: reporting every answer as continuing would satisfy both
    // tests above while stopping a normal second-factor login from ever
    // navigating anywhere.
    post.mockResolvedValue({ next: "/admin/collections" });

    const { result } = renderHook(() => useChallengeFlow());
    let answer: Awaited<ReturnType<typeof result.current.resolve>> | undefined;
    await act(async () => {
      answer = await result.current.resolve({ code: "123456" });
    });

    expect(answer?.continues).toBeUndefined();
    expect(result.current.isContinuing()).toBe(false);
  });
});

describe("a password change that arrived over a cookie-mode challenge", () => {
  it("raises the tokenless continuation the cookie carries", async () => {
    // The server replaces the pending cookie rather than putting the token
    // in the body, so the answer carries the status alone. Reading the
    // absence of a token as "nothing to do" navigated to the dashboard with
    // no session — the step the cookie exists to reach was skipped.
    post.mockResolvedValue({ status: "password_change_required" });

    const { result } = renderHook(() => useChallengeFlow());
    let answer: Awaited<ReturnType<typeof result.current.resolve>>;
    await act(async () => {
      answer = await result.current.resolve({ code: "123456" });
    });

    expect(answer!.ok).toBe(true);
    expect(answer!.continues).toBe(true);
    expect(answer!.passwordChangeRequired).toEqual({});
    expect(result.current.passwordChange).toEqual({});
    expect(navigatedTo).toBeUndefined();
  });
});
