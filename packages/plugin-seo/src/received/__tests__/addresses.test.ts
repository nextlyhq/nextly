/**
 * Which addresses the page check may fetch, decided before anything is
 * fetched: only the site's own pages, on the standard web ports, with no
 * user name or password, and connecting only to public network addresses.
 */
import { describe, expect, it } from "vitest";

import { addressToCheck, mayConnect, sitesNamed } from "../addresses";

const SITE = ["https://rext.ai"];

/** The reason `value` is refused, or "allowed" with the address it checks. */
function decide(value: string, origins: readonly string[] = SITE): string {
  const checked = addressToCheck(value, origins);
  return checked instanceof URL ? `allowed ${checked.href}` : checked.reason;
}

describe("the address to check", () => {
  it.each([
    ["https://rext.ai/pricing", "allowed https://rext.ai/pricing"],
    ["  https://rext.ai/pricing  ", "allowed https://rext.ai/pricing"],
    ["https://REXT.ai/Pricing", "allowed https://rext.ai/Pricing"],
    ["http://rext.ai/pricing", "allowed http://rext.ai/pricing"],
    ["https://rext.ai:443/pricing", "allowed https://rext.ai/pricing"],
    ["http://rext.ai:443/pricing", "allowed http://rext.ai:443/pricing"],
    // A path is one of the site's own pages, on its first address.
    ["/pricing", "allowed https://rext.ai/pricing"],
    ["/", "allowed https://rext.ai/"],
  ])("%s is %s", (value, expected) => {
    expect(decide(value)).toBe(expected);
  });

  it("allows each of the site's addresses", () => {
    const origins = ["https://rext.ai", "https://fr.rext.ai"];
    expect(decide("https://fr.rext.ai/tarifs", origins)).toBe(
      "allowed https://fr.rext.ai/tarifs"
    );
  });

  it.each([
    ["https://evil.example/pricing", "other-site"],
    ["https://rext.ai.evil.example/", "other-site"],
    ["https://www.rext.ai/", "other-site"],
    ["https://evilrext.ai/", "other-site"],
    ["https://rext.ai./", "other-site"],
    ["https://169.254.169.254/latest/meta-data", "other-site"],
    ["http://127.0.0.1/", "other-site"],
    ["https://rext.ai:8443/", "port"],
    ["http://rext.ai:8080/", "port"],
    ["https://user:secret@rext.ai/", "credentials"],
    ["https://user@rext.ai/", "credentials"],
    ["ftp://rext.ai/file", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["rext.ai/pricing", "not-an-address"],
    ["", "not-an-address"],
    ["//evil.example/pricing", "other-site"],
    ["/\\evil.example/pricing", "other-site"],
  ])("%s is refused: %s", (value, reason) => {
    expect(decide(value)).toBe(reason);
  });

  it("refuses everything while the site has no production address", () => {
    expect(decide("https://rext.ai/pricing", [])).toBe("no-site");
    expect(decide("/pricing", [])).toBe("no-site");
  });

  it("says in plain words why an address is refused", () => {
    const refused = addressToCheck("https://evil.example/x", SITE);
    expect(refused).not.toBeInstanceOf(URL);
    expect(refused).toMatchObject({
      message:
        "That address is on another site, evil.example. Only rext.ai addresses can be checked.",
    });
    expect(addressToCheck("https://rext.ai:8080/", SITE)).toMatchObject({
      message:
        "Only the standard web ports can be checked, and that address uses port 8080.",
    });
  });

  it("allows the exact address the site is configured at, its port included", () => {
    const local = ["http://localhost:3000"];
    expect(decide("http://localhost:3000/blog", local)).toBe(
      "allowed http://localhost:3000/blog"
    );
    expect(decide("http://localhost:3001/blog", local)).toBe("port");
    expect(decide("/blog", local)).toBe("allowed http://localhost:3000/blog");
  });
});

describe("where the check may connect", () => {
  const at = (address: string) => new URL(address);

  it("connects a public site only to public addresses", () => {
    expect(mayConnect(at("https://rext.ai/"), "93.184.216.34", SITE)).toBe(
      undefined
    );
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
    ]) {
      expect(mayConnect(at("https://rext.ai/"), ip, SITE)?.reason).toBe(
        "private"
      );
    }
  });

  it("refuses an answer that is no IP address at all", () => {
    expect(mayConnect(at("https://rext.ai/"), "not-an-ip", SITE)?.reason).toBe(
      "private"
    );
  });

  it("connects a site configured on this machine or its own network there", () => {
    const local = ["http://localhost:3000", "http://10.0.0.5:8080"];
    expect(mayConnect(at("http://localhost:3000/"), "127.0.0.1", local)).toBe(
      undefined
    );
    expect(mayConnect(at("http://localhost:3000/"), "::1", local)).toBe(
      undefined
    );
    expect(mayConnect(at("http://10.0.0.5:8080/"), "10.0.0.5", local)).toBe(
      undefined
    );
    // Never a link-local address: cloud metadata services answer there.
    expect(
      mayConnect(at("http://localhost:3000/"), "169.254.169.254", local)?.reason
    ).toBe("private");
  });

  it("never lets a named site that resolves to a private address through", () => {
    // A site configured by name stays held to public addresses, so a name
    // pointed at the inside of the network is refused.
    const named = ["https://intranet.rext.ai"];
    expect(
      mayConnect(at("https://intranet.rext.ai/"), "10.0.0.5", named)?.message
    ).toBe(
      "intranet.rext.ai points to an address inside a private network, so it can't be checked."
    );
  });
});

describe("the sites an address may be on", () => {
  it.each([
    [["https://rext.ai"], "rext.ai"],
    [["https://rext.ai", "https://fr.rext.ai"], "rext.ai and fr.rext.ai"],
    [
      ["https://rext.ai", "https://fr.rext.ai", "http://localhost:3000"],
      "rext.ai, fr.rext.ai and localhost:3000",
    ],
  ])("%j reads %s", (origins, expected) => {
    expect(sitesNamed(origins)).toBe(expected);
  });
});
