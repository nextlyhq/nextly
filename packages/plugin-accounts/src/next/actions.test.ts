/**
 * The server actions' own rules, with Next.js's request APIs stood in for:
 * the origin is checked before any flow runs, the form's fields reach the
 * function under the REST endpoints' names, the cookies it answers are
 * written with the plugin's attributes, a refusal becomes the form's state,
 * and the visitor is sent only to a path on the site.
 *
 * @module next/actions.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { accountsError } from "../errors";
import type { FlowDeps } from "../flows/deps";
import type { AccountsServer } from "../server/contract";
import { accountsService } from "../server/service";
import { resolveAccountsSettings } from "../settings";
import { fakeAccountsCore } from "../testing";

import {
  changePasswordAction,
  initialAccountFormState,
  resendVerificationAction,
  signInAction,
  signOutAction,
  verifyAddressAction,
} from "./actions";

const ORIGIN = "https://shop.example.com";

/** What Next.js's `redirect` throws, so a test sees where the visitor was sent. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirected to ${to}`);
  }
}

const next = vi.hoisted(() => ({
  headers: new Headers(),
  jar: { set: vi.fn() },
  server: undefined as unknown,
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(next.headers),
  cookies: () => Promise.resolve(next.jar),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("../server/installed", () => ({
  accountsServer: () => Promise.resolve(next.server),
}));

const now = new Date("2026-01-01T00:00:00.000Z");
const later = new Date(now.getTime() + 3_600_000);

/** The plugin's real functions over settings alone, the flows' replaced by `flows`. */
function serve(flows: Partial<AccountsServer>): AccountsServer {
  // Only what the helpers over settings read: every flow a test reaches is
  // replaced, so no database is needed.
  const deps = {
    settings: resolveAccountsSettings({ origin: ORIGIN }),
    core: fakeAccountsCore({ start: now }),
    now: () => now,
  } as unknown as FlowDeps;
  const server = { ...accountsService(() => deps), ...flows };
  next.server = server;
  return server;
}

/** A form with these fields. */
function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Where the action sent the visitor, or a failure when it answered instead. */
async function sentTo(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  throw new Error("expected a redirect");
}

const signedIn = vi.fn(() =>
  Promise.resolve({
    message: "Signed in.",
    cookies: [
      {
        cookie: "session" as const,
        action: "set" as const,
        value: "session-token",
        expiresAt: later,
      },
    ],
  })
);

beforeEach(() => {
  next.headers = new Headers({ origin: ORIGIN });
  next.jar.set.mockReset();
  signedIn.mockClear();
});

describe("a server action", () => {
  it("refuses a form from another origin, or from none, before any flow runs", async () => {
    serve({ signIn: signedIn });
    const fields = form({ address: "dana@example.com", password: "x" });

    const sent: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { referer: "https://evil.example/page" },
      {},
    ];
    for (const headers of sent) {
      next.headers = new Headers(headers);
      expect(await signInAction(initialAccountFormState, fields)).toMatchObject(
        {
          status: "refused",
          code: "ACCOUNTS_CROSS_SITE",
          message: "This request was refused.",
        }
      );
    }
    expect(signedIn).not.toHaveBeenCalled();
    expect(next.jar.set).not.toHaveBeenCalled();
  });

  it("takes the referer's origin where a form sends no Origin", async () => {
    serve({ signIn: signedIn });
    next.headers = new Headers({ referer: `${ORIGIN}/account/sign-in` });

    expect(await sentTo(signInAction(initialAccountFormState, form()))).toBe(
      "/"
    );
    expect(signedIn).toHaveBeenCalledOnce();
  });

  it("hands the function the form's fields and the visitor's cookies", async () => {
    const changed = vi.fn(() =>
      Promise.resolve({ message: "Your password is changed.", cookies: [] })
    );
    serve({ changePassword: changed });
    next.headers = new Headers({
      origin: ORIGIN,
      cookie: "__Host-nx-account=held; __Host-nx-account-known=k1.k2",
    });

    expect(
      await changePasswordAction(
        initialAccountFormState,
        form({ currentPassword: "old one", newPassword: "new one" })
      )
    ).toEqual({
      status: "done",
      message: "Your password is changed.",
      signedIn: false,
    });
    expect(changed).toHaveBeenCalledWith({
      visitor: {
        client: null,
        sessionToken: "held",
        knownTokens: ["k1", "k2"],
        signUpToken: null,
      },
      currentPassword: "old one",
      newPassword: "new one",
    });
  });

  it("writes the cookies the function answers, with the plugin's attributes", async () => {
    serve({ signIn: signedIn });

    await sentTo(signInAction(initialAccountFormState, form()));
    expect(next.jar.set).toHaveBeenCalledWith(
      "__Host-nx-account",
      "session-token",
      {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
        maxAge: 3600,
      }
    );
  });

  it("clears a cookie with the attributes it was set with", async () => {
    serve({
      signOut: () =>
        Promise.resolve({
          message: "Signed out.",
          cookies: [{ cookie: "session", action: "clear" }],
        }),
    });

    await signOutAction(initialAccountFormState, form());
    expect(next.jar.set).toHaveBeenCalledWith("__Host-nx-account", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 0,
    });
  });

  it("answers a refusal as the plugin's code, its message and its data, writing no cookie", async () => {
    serve({
      signIn: () =>
        Promise.reject(
          accountsError(
            "ACCOUNTS_WAIT",
            { reason: "wait" },
            { reason: "wait", retryAfterSeconds: 4 }
          )
        ),
    });

    expect(
      await signInAction(initialAccountFormState, form({ next: "/orders" }))
    ).toEqual({
      status: "refused",
      code: "ACCOUNTS_WAIT",
      message: "Too many attempts. Wait a little, then try again.",
      data: { reason: "wait", retryAfterSeconds: 4 },
    });
    expect(next.jar.set).not.toHaveBeenCalled();
  });

  it("throws a fault of the site's rather than showing it on the form", async () => {
    serve({
      signIn: () => Promise.reject(accountsError("ACCOUNTS_NOT_STARTED")),
    });

    await expect(
      signInAction(initialAccountFormState, form())
    ).rejects.toMatchObject({ code: "ACCOUNTS_NOT_STARTED" });
  });

  it("says whether a verification signed the visitor in", async () => {
    serve({
      verifyAddress: () =>
        Promise.resolve({
          message: "Your address is confirmed.",
          cookies: [],
          signedIn: true,
        }),
    });

    expect(
      await verifyAddressAction(initialAccountFormState, form({ token: "t" }))
    ).toMatchObject({ status: "done", signedIn: true });
  });
});

describe("where an action sends the visitor", () => {
  it("sends a signed-in visitor to the form's next when it is a path on the site", async () => {
    serve({ signIn: signedIn });

    expect(
      await sentTo(
        signInAction(initialAccountFormState, form({ next: "/orders?page=2" }))
      )
    ).toBe("/orders?page=2");
  });

  it("sends a signed-in visitor home for a next on another origin, protocol-relative or encoded", async () => {
    serve({ signIn: signedIn });

    for (const unsafe of [
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example",
      "/%2F%2Fevil.example",
    ]) {
      expect(
        await sentTo(
          signInAction(initialAccountFormState, form({ next: unsafe }))
        )
      ).toBe("/");
    }
  });

  it("stays on the page, answering, when the form names no next or an unsafe one", async () => {
    serve({
      resendVerification: () =>
        Promise.resolve({ message: "Sent.", cookies: [] }),
    });

    const forms: Record<string, string>[] = [{}, { next: "//evil.example/x" }];
    for (const fields of forms) {
      expect(
        await resendVerificationAction(initialAccountFormState, form(fields))
      ).toEqual({ status: "done", message: "Sent.", signedIn: false });
    }
    expect(
      await sentTo(
        resendVerificationAction(
          initialAccountFormState,
          form({ next: "/account/verify/sent" })
        )
      )
    ).toBe("/account/verify/sent");
  });
});
