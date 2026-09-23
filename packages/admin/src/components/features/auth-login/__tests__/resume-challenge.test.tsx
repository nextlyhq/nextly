import { renderHook, waitFor } from "@testing-library/react";
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
