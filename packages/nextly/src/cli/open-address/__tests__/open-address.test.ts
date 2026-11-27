/**
 * The addresses a site hands the command line to open or follow: only
 * `https`, only on the site's own origin or its sign-in issuer, and never
 * through a shell. A foreign origin, a `file:` address and crafted strings
 * that look like the site are all refused.
 */
import { describe, expect, it, vi } from "vitest";

import { addressToOpen, openInBrowser } from "../index";

const trusted = {
  site: "https://site.example",
  issuer: "https://auth.site.example",
};

describe("an address the site hands the command line", () => {
  it("is accepted on the site's own origin, with its path and query", () => {
    expect(
      addressToOpen("https://site.example/admin/cli-sign-in?code=AB12", trusted)
        ?.href
    ).toBe("https://site.example/admin/cli-sign-in?code=AB12");
  });

  it("is accepted on the site's sign-in issuer", () => {
    expect(
      addressToOpen("https://auth.site.example/authorize", trusted)?.href
    ).toBe("https://auth.site.example/authorize");
  });

  it("is refused on a foreign origin", () => {
    expect(addressToOpen("https://evil.example/", trusted)).toBeNull();
    expect(
      addressToOpen("https://site.example.evil.example/", trusted)
    ).toBeNull();
    // Another port is another origin.
    expect(addressToOpen("https://site.example:8443/", trusted)).toBeNull();
  });

  it("is refused when it is not https", () => {
    expect(addressToOpen("http://site.example/", trusted)).toBeNull();
    expect(addressToOpen("file:///etc/passwd", trusted)).toBeNull();
    expect(addressToOpen("javascript:alert(1)", trusted)).toBeNull();
    expect(
      addressToOpen("data:text/html,<script>alert(1)</script>", trusted)
    ).toBeNull();
  });

  it("is refused when it is crafted to look like the site", () => {
    for (const crafted of [
      // The site's name as a user name, the real host after the @.
      "https://site.example@evil.example/",
      "https://site.example:x@evil.example/",
      // A user name even on the site's own host: no address the site sends
      // carries one.
      "https://someone@site.example/",
      // A backslash the URL parser reads as a path separator.
      "https://evil.example\\@site.example/",
      // Whitespace or control characters around or inside it.
      " https://site.example/",
      "https://site.example/\n--flag",
      "https://site.example/\u0000",
      // Quotes and shell metacharacters, refused before anything opens.
      'https://site.example/" & calc',
      "https://site.example/;rm -rf ~",
      "",
      "not an address",
    ]) {
      expect(addressToOpen(crafted, trusted), crafted).toBeNull();
    }
  });

  it("is refused when the trusted origins themselves are not https", () => {
    expect(
      addressToOpen("http://site.example/", { site: "http://site.example" })
    ).toBeNull();
  });
});

describe("opening an address in the browser", () => {
  const address = new URL("https://site.example/admin/cli-sign-in?code=AB12");

  it.each([
    ["darwin", "open", [address.href]],
    ["linux", "xdg-open", [address.href]],
    ["win32", "rundll32", ["url.dll,FileProtocolHandler", address.href]],
  ] as const)(
    "on %s, starts %s with the address as one argument and no shell",
    (platform, command, args) => {
      const unref = vi.fn();
      const on = vi.fn();
      const spawn = vi.fn(() => ({ unref, on }));

      expect(openInBrowser(address, { platform, spawn })).toBe(true);

      expect(spawn).toHaveBeenCalledWith(command, [...args], {
        shell: false,
        stdio: "ignore",
        detached: true,
      });
      expect(unref).toHaveBeenCalled();
    }
  );

  it("says it could not when the system has no way to open a browser", () => {
    const spawn = vi.fn();
    expect(openInBrowser(address, { platform: "aix", spawn })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("says it could not when starting the browser throws", () => {
    const spawn = vi.fn(() => {
      throw new Error("spawn ENOENT");
    });
    expect(openInBrowser(address, { platform: "linux", spawn })).toBe(false);
  });
});
