import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { hasSignInError, useResumeLogin } from "../use-resume-login";

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
