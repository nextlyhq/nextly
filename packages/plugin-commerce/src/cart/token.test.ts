import { describe, expect, it } from "vitest";

import {
  cartCookieHeader,
  cartCookieName,
  clearCartCookieHeader,
  hashCartToken,
  newCartToken,
  parseCartToken,
  readCartToken,
} from "./token";

function withCookie(header: string): Request {
  return new Request("https://shop.example/cart", {
    headers: { cookie: header },
  });
}

describe("the cart token", () => {
  it("is 43 base64url characters, fresh every time", () => {
    const a = newCartToken();
    const b = newCartToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).not.toBe(a);
    expect(parseCartToken(a)).toBe(a);
  });

  it("is stored as its SHA-256, never as itself", () => {
    const token = newCartToken();
    const hash = hashCartToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashCartToken(token));
    expect(hash).not.toContain(token);
    expect(hashCartToken(newCartToken())).not.toBe(hash);
  });

  it("refuses a value this plugin could not have made", () => {
    const token = newCartToken();
    for (const value of [
      undefined,
      null,
      42,
      "",
      token.slice(1),
      `${token}A`,
      `${token.slice(1)}+`,
      `${token.slice(1)}=`,
      `${token.slice(1)}%`,
    ]) {
      expect(parseCartToken(value)).toBeNull();
    }
  });
});

describe("the cart cookie", () => {
  it("is named with the __Host- prefix only when it is Secure", () => {
    expect(cartCookieName(true)).toBe("__Host-commerce-cart");
    expect(cartCookieName(false)).toBe("commerce-cart");
  });

  it("reads the token from the cookie of this mode's name only", () => {
    const token = newCartToken();
    expect(
      readCartToken(withCookie(`__Host-commerce-cart=${token}`), true)
    ).toBe(token);
    // In production a cookie without the prefix could have been set by a
    // subdomain, so it is not read.
    expect(
      readCartToken(withCookie(`commerce-cart=${token}`), true)
    ).toBeNull();
    expect(readCartToken(withCookie(`commerce-cart=${token}`), false)).toBe(
      token
    );
  });

  it("finds it among other cookies, and takes the first of its name", () => {
    const first = newCartToken();
    const second = newCartToken();
    expect(
      readCartToken(
        withCookie(
          `theme=dark; commerce-cart=${first}; other=1; commerce-cart=${second}`
        ),
        false
      )
    ).toBe(first);
  });

  it("reads no token from a malformed cookie, or from none", () => {
    expect(readCartToken(withCookie("commerce-cart=not-a-token"), false)).toBe(
      null
    );
    expect(readCartToken(withCookie("commerce-cart"), false)).toBeNull();
    expect(readCartToken(new Request("https://shop.example/"), false)).toBe(
      null
    );
  });

  it("lasts until the cart's deadline, HTTP-only and same-site", () => {
    const token = newCartToken();
    const now = new Date("2026-10-14T00:00:00.000Z");
    const expiresAt = new Date("2026-11-13T00:00:00.000Z");
    expect(cartCookieHeader({ token, expiresAt, now, secure: true })).toBe(
      `__Host-commerce-cart=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure`
    );
    expect(cartCookieHeader({ token, expiresAt, now, secure: false })).toBe(
      `commerce-cart=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`
    );
  });

  it("never asks the browser to keep a cookie past a deadline already gone", () => {
    const now = new Date("2026-10-14T00:00:10.000Z");
    const expiresAt = new Date("2026-10-14T00:00:00.000Z");
    expect(
      cartCookieHeader({ token: newCartToken(), expiresAt, now, secure: false })
    ).toContain("Max-Age=0;");
  });

  it("is cleared with an empty value that expires at once", () => {
    expect(clearCartCookieHeader(true)).toBe(
      "__Host-commerce-cart=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"
    );
  });
});
