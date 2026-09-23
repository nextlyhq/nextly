import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  hasSignInError,
  useChallengeFlow,
  useResumeLogin,
} from "../use-resume-login";

const get = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get },
}));

beforeEach(() => {
  get.mockReset();
});

describe("useResumeLogin", () => {
  it("does not ask the server when the URL is not resuming", async () => {
    const { result } = renderHook(() => useResumeLogin("?foo=1"));

    await waitFor(() => expect(result.current.status).toBe("none"));
    expect(get).not.toHaveBeenCalled();
  });

  it("reports the outstanding challenge and where the login was headed", async () => {
    get.mockResolvedValue({
      challengeId: "test-totp",
      next: "/admin/collections",
    });

    const { result } = renderHook(() => useResumeLogin("?resume=1"));

    await waitFor(() => expect(result.current.status).toBe("resume"));
    expect(get).toHaveBeenCalledWith("/auth/pending");
    expect(result.current).toMatchObject({
      pending: { challengeId: "test-totp", next: "/admin/collections" },
    });
  });

  it("falls back to the password form when nothing is outstanding", async () => {
    // 204 arrives as an empty body: an expired cookie is indistinguishable
    // from none, and either way there is nothing to resume.
    get.mockResolvedValue(null);

    const { result } = renderHook(() => useResumeLogin("?resume=1"));

    await waitFor(() => expect(result.current.status).toBe("none"));
  });

  it("falls back to the password form when the request fails", async () => {
    // The password form is a working way in, so a failure here must not
    // replace it with an error screen.
    get.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useResumeLogin("?resume=1"));

    await waitFor(() => expect(result.current.status).toBe("none"));
  });

  it("never receives the pending token itself", async () => {
    get.mockResolvedValue({ challengeId: "test-totp", next: null });

    const { result } = renderHook(() => useResumeLogin("?resume=1"));

    await waitFor(() => expect(result.current.status).toBe("resume"));
    expect(JSON.stringify(result.current)).not.toContain("Token");
  });
});

describe("hasSignInError", () => {
  it("recognises the generic provider failure", () => {
    expect(hasSignInError("?error=signin-failed")).toBe(true);
  });

  it("is false for anything else, including an invented reason", () => {
    // The reason is deliberately absent from the URL: it would say which
    // account was reached.
    expect(hasSignInError("")).toBe(false);
    expect(hasSignInError("?error=locked")).toBe(false);
    expect(hasSignInError("?resume=1")).toBe(false);
  });
});

describe("a resumed forced password change", () => {
  it("is NOT offered as a plugin challenge", async () => {
    // `completeLogin` sends an externally authenticated account that must
    // replace its password here with the internal `must-change-password`
    // sentinel as the pending cookie's challenge id. Treating that as a
    // plugin challenge rendered the missing-view fallback — no view is
    // registered for it and none can be — so the login was unfinishable.
    get.mockResolvedValue({ challengeId: "must-change-password", next: null });

    const { result } = renderHook(() => useChallengeFlow("?resume=1"));

    await waitFor(() => expect(result.current.passwordChange).not.toBeNull());
    // No TOKEN: a resumed login's pending cookie travels with the request and
    // the endpoint reads it there. An empty object is the whole signal.
    expect(result.current.passwordChange?.pendingToken).toBeUndefined();
    // Not ALSO shown as a challenge: `index.tsx` prefers the password view,
    // so a stray challenge here would be invisible now and wrong later.
    expect(result.current.challenge).toBeNull();
  });

  it("still offers an ordinary challenge as a challenge", async () => {
    // The control. Routing every resumed login to the password view would
    // satisfy the assertion above while breaking second-factor sign-in.
    get.mockResolvedValue({ challengeId: "test-totp", next: "/admin/posts" });

    const { result } = renderHook(() => useChallengeFlow("?resume=1"));

    await waitFor(() =>
      expect(result.current.challenge?.challengeType).toBe("test-totp")
    );
    expect(result.current.passwordChange).toBeNull();
    expect(result.current.challenge?.next).toBe("/admin/posts");
  });
});

describe("a resumed login does not clobber a tokenized continuation", () => {
  it("keeps the token a password login already raised", async () => {
    // The password form stays usable while `/auth/pending` is loading, so a
    // password login can report `password_change_required` first. Replacing
    // that with the tokenless resumed continuation left the set-password step
    // relying on a cookie from a different — possibly expired — attempt.
    let release: (value: unknown) => void = () => undefined;
    get.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );

    const { result } = renderHook(() => useChallengeFlow("?resume=1"));

    act(() => {
      result.current.requirePasswordChange({ pendingToken: "pt-password" });
    });
    expect(result.current.passwordChange).toEqual({
      pendingToken: "pt-password",
    });

    await act(async () => {
      release({ challengeId: "must-change-password", next: null });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.passwordChange).toEqual({
        pendingToken: "pt-password",
      })
    );
  });

  it("still raises it when nothing was set", async () => {
    // The control: keeping whatever is there would satisfy the test above
    // while never raising the resumed continuation at all.
    get.mockResolvedValue({ challengeId: "must-change-password", next: null });

    const { result } = renderHook(() => useChallengeFlow("?resume=1"));

    await waitFor(() => expect(result.current.passwordChange).not.toBeNull());
    expect(result.current.passwordChange?.pendingToken).toBeUndefined();
  });
});

describe("a resumed login does not clobber a challenge already in progress", () => {
  it("keeps the body token a password login's challenge carries", async () => {
    // The password form stays usable while `/auth/pending` is loading, so a
    // password login can pause at its own challenge first. Replacing it with
    // the cookie-backed resume discarded that token, and every later answer
    // went to the stale cookie flow — a login the person had already moved
    // past, and possibly a different account's.
    let release: (value: unknown) => void = () => undefined;
    get.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );

    const { result } = renderHook(() => useChallengeFlow("?resume=1"));

    act(() => {
      result.current.start({
        challengeType: "test-totp",
        pendingToken: "pt-password",
        next: null,
      });
    });

    await act(async () => {
      release({ challengeId: "test-totp", next: "/admin/posts" });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.challenge).toEqual({
        challengeType: "test-totp",
        pendingToken: "pt-password",
        next: null,
      })
    );
  });

  it("still raises the cookie-backed challenge when none was in progress", async () => {
    // The control: keeping whatever is there would satisfy the test above
    // while never raising the resumed challenge at all.
    get.mockResolvedValue({ challengeId: "test-totp", next: null });

    const { result } = renderHook(() => useChallengeFlow("?resume=1"));

    await waitFor(() =>
      expect(result.current.challenge?.challengeType).toBe("test-totp")
    );
    expect(result.current.challenge?.pendingToken).toBeUndefined();
  });
});
