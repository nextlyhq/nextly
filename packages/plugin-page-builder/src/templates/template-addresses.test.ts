/**
 * A template address declared in code has one spelling, lies outside the
 * paths the runtime keeps, and belongs to one collection; anything else
 * refuses to start, naming what is wrong.
 */
import { describe, expect, it } from "vitest";

import {
  checkedTemplateAddresses,
  templateAddressProblem,
} from "./template-addresses";

describe("a template address's one spelling", () => {
  it.each([
    ["/blog/", /ends with "\/"/],
    ["//blog", /scheme or a host/],
    ["/blog//news", /empty segment/],
    ["/blog/../news", /"\." or "\.\." segment/],
    ["/blog/./news", /"\." or "\.\." segment/],
    ["https://x/blog", /scheme or a host/],
    ["blog", /does not start with "\/"/],
    ["/", /site's root/],
    ["/blog?page=2", /query or a fragment/],
    ["/blog#top", /query or a fragment/],
    ["/%62log", /write it as "\/blog"/],
  ])("refuses %s", (address, why) => {
    expect(templateAddressProblem(address)).toMatch(why);
  });

  it.each(["/admin/blog", "/api", "/_next/blog"])(
    "refuses %s, a path the runtime keeps",
    address => {
      expect(templateAddressProblem(address)).toMatch(/kept by the runtime/);
    }
  );

  it.each(["/blog", "/news/2026", "/caf%C3%A9"])("accepts %s", address => {
    expect(templateAddressProblem(address)).toBeNull();
  });

  it("refuses an address that is not text", () => {
    expect(templateAddressProblem(42)).toMatch(/not a path/);
  });
});

describe("the declared addresses", () => {
  it("are each collection's decoded segments", () => {
    const addresses = checkedTemplateAddresses({
      addresses: { posts: "/blog", events: "/caf%C3%A9/events" },
    });
    expect([...addresses]).toEqual([
      ["posts", ["blog"]],
      ["events", ["café", "events"]],
    ]);
  });

  it("are none when nothing is declared", () => {
    expect(checkedTemplateAddresses(undefined).size).toBe(0);
    expect(checkedTemplateAddresses({}).size).toBe(0);
  });

  it("refuse two collections given one address, naming both", () => {
    expect(() =>
      checkedTemplateAddresses({
        addresses: { posts: "/blog", articles: "/news", stories: "/blog" },
      })
    ).toThrow(/"posts" and "stories" are both given the address "\/blog"/);
  });

  it("refuse a malformed one, naming its collection", () => {
    expect(() =>
      checkedTemplateAddresses({ addresses: { posts: "/blog/" } })
    ).toThrow(/For "posts", "\/blog\/" ends with "\/"/);
  });

  it("refuse every problem at once, so one start names them all", () => {
    let message = "";
    try {
      checkedTemplateAddresses({
        addresses: { posts: "/admin/blog", events: "/" },
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/For "posts"/);
    expect(message).toMatch(/For "events"/);
  });

  it("refuse a declaration that is not a map of paths", () => {
    expect(() =>
      checkedTemplateAddresses({
        addresses: ["/blog"] as unknown as Record<string, string>,
      })
    ).toThrow(/must map collection slugs to paths/);
  });
});
