import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { resolveAccountsSettings } from "./settings";

const origin = "https://shop.example.com";

/** The refusal's code and the option paths it names, or undefined when accepted. */
function refusalOf(
  options: unknown
): { code: string; paths: string[] } | undefined {
  try {
    resolveAccountsSettings(options);
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    const issues =
      (error.logContext as { issues?: string[] } | undefined)?.issues ?? [];
    return {
      code: String(error.code),
      paths: issues.map(issue => issue.split(":")[0]),
    };
  }
  return undefined;
}

describe("resolveAccountsSettings", () => {
  it("fills every default the design states", () => {
    expect(resolveAccountsSettings({ origin })).toEqual({
      origin,
      pages: {
        verify: "/account/verify",
        notMe: "/account/not-me",
        signIn: "/account/sign-in",
        reset: "/account/reset",
        confirmAddress: "/account/address",
        cancelAddressChange: "/account/address/cancel",
      },
      verificationRequired: true,
      session: { idleHours: 336, absoluteDays: 30, perAccount: 20 },
      unverifiedKeptDays: 7,
      verification: {
        linkHours: 24,
        codeDigits: 6,
        codeMinutes: 10,
        codeTries: 5,
      },
      resetLinkMinutes: 60,
      failuresBeforeReset: 100,
      knownBrowsers: { days: 90, perAccount: 10 },
      passwordMinLength: 8,
      breachedPasswordCheck: false,
    });
  });

  // Each bound at its edge: the last value accepted and the first refused, so
  // an off-by-one in either direction fails.
  it.each([
    [
      "session.absoluteDays",
      { session: { absoluteDays: 1, idleHours: 24 } },
      { session: { absoluteDays: 366 } },
    ],
    [
      "session.perAccount",
      { session: { perAccount: 5 } },
      { session: { perAccount: 4 } },
    ],
    [
      "session.perAccount",
      { session: { perAccount: 100 } },
      { session: { perAccount: 101 } },
    ],
    [
      "unverifiedKeptDays",
      { unverifiedKeptDays: 30 },
      { unverifiedKeptDays: 31 },
    ],
    [
      "verification.linkHours",
      { verification: { linkHours: 1 } },
      { verification: { linkHours: 25 } },
    ],
    [
      "verification.codeDigits",
      { verification: { codeDigits: 8 } },
      { verification: { codeDigits: 5 } },
    ],
    [
      "verification.codeMinutes",
      { verification: { codeMinutes: 5 } },
      { verification: { codeMinutes: 11 } },
    ],
    [
      "verification.codeTries",
      { verification: { codeTries: 3 } },
      { verification: { codeTries: 6 } },
    ],
    ["resetLinkMinutes", { resetLinkMinutes: 15 }, { resetLinkMinutes: 14 }],
    [
      "failuresBeforeReset",
      { failuresBeforeReset: 10 },
      { failuresBeforeReset: 101 },
    ],
    [
      "knownBrowsers.days",
      { knownBrowsers: { days: 7 } },
      { knownBrowsers: { days: 366 } },
    ],
    [
      "knownBrowsers.perAccount",
      { knownBrowsers: { perAccount: 20 } },
      { knownBrowsers: { perAccount: 0 } },
    ],
    ["passwordMinLength", { passwordMinLength: 64 }, { passwordMinLength: 7 }],
  ])("keeps %s within its bounds", (path, accepted, refused) => {
    expect(refusalOf({ origin, ...accepted })).toBeUndefined();
    expect(refusalOf({ origin, ...refused })).toEqual({
      code: "ACCOUNTS_INVALID_OPTIONS",
      paths: [path],
    });
  });

  it("refuses a fractional number rather than rounding it", () => {
    expect(refusalOf({ origin, failuresBeforeReset: 50.5 })?.paths).toEqual([
      "failuresBeforeReset",
    ]);
  });

  it("refuses an idle expiry longer than the absolute lifetime", () => {
    expect(
      refusalOf({ origin, session: { absoluteDays: 1, idleHours: 25 } })?.paths
    ).toEqual(["session.idleHours"]);
    expect(
      refusalOf({ origin, session: { absoluteDays: 1, idleHours: 24 } })
    ).toBeUndefined();
  });

  it("needs the site's origin over HTTP or HTTPS, which every emailed link is built on", () => {
    expect(refusalOf({})?.paths).toEqual(["origin"]);
    expect(refusalOf({ origin: "javascript:alert(1)" })?.paths).toEqual([
      "origin",
    ]);
  });

  it("takes a page as a path on the site, never another host or a query", () => {
    expect(
      resolveAccountsSettings({ origin, pages: { verify: "/verify-email" } })
        .pages.verify
    ).toBe("/verify-email");
    for (const verify of [
      "//evil.example.com/x",
      "https://evil.example.com/x",
      "verify",
      "/v?next=x",
      "/v#t",
      "/\\evil",
    ]) {
      expect(refusalOf({ origin, pages: { verify } })?.paths).toEqual([
        "pages.verify",
      ]);
    }
  });

  it("refuses an option it does not know, so a misspelt one is not ignored", () => {
    expect(refusalOf({ origin, sesion: {} })?.code).toBe(
      "ACCOUNTS_INVALID_OPTIONS"
    );
  });

  it("names the refused options only in the log context, never in the public message", () => {
    try {
      resolveAccountsSettings({ origin, passwordMinLength: 2 });
      expect.unreachable();
    } catch (error) {
      expect(NextlyError.is(error) && error.publicMessage).not.toContain(
        "passwordMinLength"
      );
    }
  });
});
