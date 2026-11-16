/**
 * A cached production session is replaced before its access token expires,
 * judged from the token's own lifetime (`support/session-lifetime`).
 */
import { expect } from "@playwright/test";

import { sessionNeedsRenewal } from "./support/session-lifetime";
import { test } from "./support/test";

const ISSUED = 1_800_000_000;

/** A session's cookies holding a token of `lifetime` seconds. */
function sessionCookies(lifetime: number) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = [
    encode({ alg: "HS256" }),
    encode({ iat: ISSUED, exp: ISSUED + lifetime }),
    "signature",
  ].join(".");
  return [{ name: "nextly_session", value: token }];
}

const at = (seconds: number) => (ISSUED + seconds) * 1000;

test("keeps a session until two thirds of its token's lifetime have gone", () => {
  const cookies = sessionCookies(900);
  expect(sessionNeedsRenewal(cookies, at(599))).toBe(false);
  expect(sessionNeedsRenewal(cookies, at(600))).toBe(true);
  expect(sessionNeedsRenewal(cookies, at(900))).toBe(true);
});

test("follows the token's real lifetime, not a fixed age", () => {
  const cookies = sessionCookies(30);
  expect(sessionNeedsRenewal(cookies, at(19))).toBe(false);
  expect(sessionNeedsRenewal(cookies, at(20))).toBe(true);
});

test("replaces a session whose token cannot be read", () => {
  expect(sessionNeedsRenewal([], at(0))).toBe(true);
  expect(
    sessionNeedsRenewal(
      [{ name: "nextly_session", value: "not-a-token" }],
      at(0)
    )
  ).toBe(true);
  expect(
    sessionNeedsRenewal(
      [{ name: "nextly_session", value: "a.bm90IGpzb24.c" }],
      at(0)
    )
  ).toBe(true);
});
