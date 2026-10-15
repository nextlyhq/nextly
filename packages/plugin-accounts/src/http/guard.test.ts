import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { FakeOpaqueSecrets } from "../testing/fake-opaque";

import { assertSameSiteWrite, CSRF_HEADER, safeReturnPath } from "./guard";

const settings = { origin: "https://shop.example.com" };
const core = { opaque: new FakeOpaqueSecrets() };

function write(headers: Record<string, string>) {
  return new Request("https://shop.example.com/x", { method: "POST", headers });
}

function refusal(request: Request): string | null {
  try {
    assertSameSiteWrite(request, settings, core);
    return null;
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    return String(
      (error.logContext as { reason?: string } | undefined)?.reason
    );
  }
}

const token = "a-csrf-token-of-ours";
const own = {
  origin: "https://shop.example.com",
  cookie: `__Host-nx-account-csrf=${token}`,
  [CSRF_HEADER]: token,
};

describe("assertSameSiteWrite", () => {
  it("lets a write from the site with its token through", () => {
    expect(refusal(write(own))).toBeNull();
    const { origin: _origin, ...noOrigin } = own;
    expect(
      refusal(
        write({ ...noOrigin, referer: "https://shop.example.com/account" })
      )
    ).toBeNull();
  });

  it("refuses a write from another site, or that says where it is from nowhere, cookie or not", () => {
    expect(refusal(write({ ...own, origin: "https://evil.example.com" }))).toBe(
      "origin"
    );
    const { origin: _origin, ...noOrigin } = own;
    expect(refusal(write(noOrigin))).toBe("origin");
    expect(refusal(write({ origin: "https://evil.example.com" }))).toBe(
      "origin"
    );
  });

  it("refuses a write without the token, or with one its cookie does not hold", () => {
    expect(refusal(write({ ...own, [CSRF_HEADER]: "" }))).toBe("csrf");
    expect(refusal(write({ ...own, [CSRF_HEADER]: "another" }))).toBe("csrf");
    expect(refusal(write({ origin: own.origin, [CSRF_HEADER]: token }))).toBe(
      "csrf"
    );
  });
});

describe("safeReturnPath", () => {
  it("keeps a path on the site", () => {
    expect(safeReturnPath(settings, "/checkout?step=2#pay")).toBe(
      "/checkout?step=2#pay"
    );
  });

  it("refuses another origin, a protocol-relative address, a backslash and an encoded one", () => {
    for (const next of [
      "https://evil.example.com/x",
      "//evil.example.com/x",
      "/\\evil.example.com",
      "/%2F%2Fevil.example.com",
      "/%5cevil.example.com",
      "/%2e%2e//evil.example.com/path",
      "/./%2e//evil.example.com",
      "javascript:alert(1)",
      "checkout",
    ]) {
      expect(safeReturnPath(settings, next), next).toBe("/");
    }
    expect(safeReturnPath(settings, undefined, "/account")).toBe("/account");
  });
});
