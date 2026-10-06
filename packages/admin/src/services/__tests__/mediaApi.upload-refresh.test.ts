/**
 * What an upload does when its access token has expired.
 *
 * The upload goes through `XMLHttpRequest` for progress events, so it cannot
 * use `authFetch` and repeats its refresh contract by hand: retry only after a
 * refresh that succeeded, sign in again only when the session is dead, and
 * surface the original 401 when the refresh failed for a passing reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshAccessToken = vi.hoisted(() => vi.fn());
const redirectToLogin = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api/refreshInterceptor", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../lib/api/refreshInterceptor")>();
  return { ...actual, refreshAccessToken, redirectToLogin };
});

import { uploadMedia } from "../mediaApi";

const EXPIRED = {
  status: 401,
  responseText: JSON.stringify({
    error: { code: "TOKEN_EXPIRED", message: "Your session has expired." },
  }),
};
const CREATED = {
  status: 201,
  responseText: JSON.stringify({
    message: "Uploaded.",
    item: { id: "m1", filename: "a.png" },
  }),
};

/** The answers the fake server gives, one per `send`, in order. */
let answers: Array<{ status: number; responseText: string }> = [];
let sends = 0;

/** Enough of `XMLHttpRequest` for `uploadMediaOnce`: it answers on `send`. */
class FakeXhr {
  status = 0;
  responseText = "";
  withCredentials = false;
  upload = { addEventListener: () => undefined };
  private onLoad: (() => void) | undefined;

  addEventListener(type: string, listener: () => void): void {
    if (type === "load") this.onLoad = listener;
  }

  open(): void {}

  send(): void {
    const answer = answers[sends];
    sends += 1;
    this.status = answer.status;
    this.responseText = answer.responseText;
    queueMicrotask(() => this.onLoad?.());
  }
}

beforeEach(() => {
  sends = 0;
  answers = [];
  refreshAccessToken.mockReset();
  redirectToLogin.mockReset();
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = () => new File(["x"], "a.png", { type: "image/png" });

describe("uploadMedia after an expired access token", () => {
  it("retries once the refresh succeeded", async () => {
    answers = [EXPIRED, CREATED];
    refreshAccessToken.mockResolvedValueOnce("ok");

    await expect(uploadMedia(file())).resolves.toMatchObject({ id: "m1" });
    expect(sends).toBe(2);
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it("sends the user to sign in when the session is dead, without a retry", async () => {
    answers = [EXPIRED, CREATED];
    refreshAccessToken.mockResolvedValueOnce("auth_failed");

    await expect(uploadMedia(file())).rejects.toBeDefined();
    expect(sends).toBe(1);
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it("surfaces the original 401 on a transient refresh failure, neither retrying nor signing out", async () => {
    answers = [EXPIRED, CREATED];
    refreshAccessToken.mockResolvedValueOnce("transient");

    await expect(uploadMedia(file())).rejects.toMatchObject({
      status: 401,
    });
    expect(sends).toBe(1);
    expect(redirectToLogin).not.toHaveBeenCalled();
  });
});
