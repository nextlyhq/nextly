import { describe, expect, it } from "vitest";

import {
  clearCookie,
  cookieName,
  knownTokensOf,
  readCookie,
  setCookie,
  withKnownToken,
} from "./cookies";

const https = { origin: "https://shop.example.com" };
const http = { origin: "http://localhost:3000" };
const now = new Date("2026-01-01T00:00:00.000Z");

describe("the plugin's cookies", () => {
  it("are HTTP-only, SameSite=Lax, path /, Secure and __Host- over HTTPS, and last until what they name ends", () => {
    expect(
      setCookie(
        https,
        "session",
        "tok",
        new Date(now.getTime() + 30 * 86_400_000),
        now
      )
    ).toBe(
      "__Host-nx-account=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure"
    );
  });

  it("drop the prefix and Secure on a plain-HTTP origin, as a local site serves", () => {
    expect(
      setCookie(http, "signUp", "tok", new Date(now.getTime() + 1000), now)
    ).toBe("nx-account-signup=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=1");
    expect(clearCookie(http, "session")).toBe(
      "nx-account=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    );
  });

  it("are read back by their own name and no other", () => {
    const request = new Request("https://shop.example.com", {
      headers: {
        cookie: "nextly-session=staff; __Host-nx-account=mine; other=x",
      },
    });
    expect(readCookie(request, cookieName(https, "session"))).toBe("mine");
    expect(readCookie(request, cookieName(https, "signUp"))).toBeUndefined();
  });

  it("read a value that is not valid percent-encoding as no cookie, and decode a valid one", () => {
    const request = new Request("https://shop.example.com", {
      headers: { cookie: "__Host-nx-account=%E0%A4%A; nx-account-csrf=a%20b" },
    });
    expect(readCookie(request, cookieName(https, "session"))).toBeUndefined();
    expect(readCookie(request, "nx-account-csrf")).toBe("a b");
  });

  it("hold at most ten known-browser tokens, the newest last and each once", () => {
    const tokens = Array.from({ length: 10 }, (_, n) => `t${n}`);
    expect(withKnownToken(tokens, "t11").split(".")).toEqual([
      ...tokens.slice(1),
      "t11",
    ]);
    expect(withKnownToken(["a", "b"], "a")).toBe("b.a");
    const request = new Request("https://shop.example.com", {
      headers: {
        cookie: `__Host-nx-account-known=${[...tokens, "t10", "t11"].join(".")}`,
      },
    });
    expect(knownTokensOf(https, request)).toHaveLength(10);
  });
});
