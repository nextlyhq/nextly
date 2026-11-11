/**
 * The rule a declared public address is judged by, and how one is filled
 * from an entry.
 *
 * An address has one spelling, so the template that declares it must too: a
 * leading `/`, no trailing one but the root's, no empty or dot segment,
 * literal segments spelled as a browser sends them, each placeholder a whole
 * segment naming a real field, and nothing the runtime keeps for itself. A
 * collection's address names at least one placeholder, since every entry has
 * its own; a Single's names none, since it is one page.
 */
import { describe, expect, it } from "vitest";

import {
  fillPublicAddress,
  publicAddressProblem,
} from "../public-address-template";

const POST_FIELDS = ["title", "slug", "category"];

const collection = { kind: "collection" as const, fieldNames: POST_FIELDS };
const single = { kind: "single" as const, fieldNames: ["headline"] };

describe("publicAddressProblem", () => {
  it.each([
    "/blog/{slug}",
    "/{slug}",
    "/docs/{category}/{slug}",
    "/posts/{id}",
    "/caf%C3%A9/{slug}",
    "/a-b_c.d~e/{slug}",
  ])("accepts the collection address %s", template => {
    expect(publicAddressProblem(template, collection)).toBeNull();
  });

  it.each(["/", "/about", "/about-us/team"])(
    "accepts the Single address %s",
    template => {
      expect(publicAddressProblem(template, single)).toBeNull();
    }
  );

  it.each([
    [42, /string/],
    ["", /start with "\/"/],
    ["blog/{slug}", /start with "\/"/],
    ["/blog/{slug}/", /end with "\/"/],
    ["/blog//{slug}", /empty segment/],
    ["//example.com/{slug}", /empty segment/],
    ["/blog/./{slug}", /"\." or "\.\." segment/],
    ["/blog/../{slug}", /"\." or "\.\." segment/],
    ["/blog?page={slug}", /query or fragment/],
    ["/blog/{slug}#top", /query or fragment/],
    ["/blog/post-{slug}", /whole segment/],
    ["/blog/{slug}{category}", /whole segment/],
    ["/blog/{missing}", /"missing" is not a field/],
    ["/blog", /at least one placeholder/],
    ["/a b/{slug}", /as a browser sends it/],
    ["/caf%c3%a9/{slug}", /as a browser sends it/],
    ["/caf%/{slug}", /as a browser sends it/],
    ["/admin/{slug}", /kept for the admin, the API or the runtime/],
    ["/api/{slug}", /kept for the admin, the API or the runtime/],
    ["/_next/{slug}", /kept for the admin, the API or the runtime/],
  ])("refuses the collection address %j", (template, message) => {
    expect(publicAddressProblem(template, collection)).toMatch(message);
  });

  it.each([
    ["/about/{headline}", /no placeholder/],
    ["/admin", /kept for the admin, the API or the runtime/],
    ["/sitemap.xml", /kept for the admin, the API or the runtime/],
    ["/robots.txt", /kept for the admin, the API or the runtime/],
  ])("refuses the Single address %j", (template, message) => {
    expect(publicAddressProblem(template, single)).toMatch(message);
  });
});

describe("fillPublicAddress", () => {
  it("fills each placeholder from the entry", () => {
    expect(
      fillPublicAddress("/docs/{category}/{slug}", {
        category: "guides",
        slug: "install",
      })
    ).toBe("/docs/guides/install");
    expect(fillPublicAddress("/posts/{id}", { id: 7 })).toBe("/posts/7");
  });

  it("gives a fixed address as it is", () => {
    expect(fillPublicAddress("/", {})).toBe("/");
    expect(fillPublicAddress("/about", {})).toBe("/about");
  });

  it.each([
    ["an empty value", { slug: "" }],
    ["a missing value", {}],
    ["a value with no text form", { slug: { nested: true } }],
  ])("answers nothing for %s", (_, entry) => {
    expect(fillPublicAddress("/blog/{slug}", entry)).toBeNull();
  });

  it("encodes a value as one segment, its `/` included", () => {
    expect(fillPublicAddress("/blog/{slug}", { slug: "a b" })).toBe(
      "/blog/a%20b"
    );
    expect(fillPublicAddress("/blog/{slug}", { slug: "a/b" })).toBe(
      "/blog/a%2Fb"
    );
  });

  it("lets one placeholder stand for a slug path of several segments", () => {
    const options = { pathFields: ["slug"] };
    expect(
      fillPublicAddress("/{slug}", { slug: "docs/install" }, options)
    ).toBe("/docs/install");
    expect(
      fillPublicAddress("/help/{slug}", { slug: "a/b c/d" }, options)
    ).toBe("/help/a/b%20c/d");
    // A path that would step out of its place is one segment, not a path.
    expect(fillPublicAddress("/{slug}", { slug: "a/../b" }, options)).toBe(
      "/a%2F..%2Fb"
    );
  });

  it.each([".", ".."])(
    "answers nothing for a value that is the segment %j",
    value => {
      expect(fillPublicAddress("/blog/{slug}", { slug: value })).toBeNull();
      expect(
        fillPublicAddress("/{slug}", { slug: value }, { pathFields: ["slug"] })
      ).toBeNull();
    }
  );

  it.each(["admin", "api", "sitemap.xml", "robots.txt", "_next"])(
    "answers nothing where the value lands on the runtime's own path /%s",
    slug => {
      expect(fillPublicAddress("/{slug}", { slug })).toBeNull();
    }
  );

  it("answers nothing where a slug path lands under a runtime path", () => {
    expect(
      fillPublicAddress(
        "/{slug}",
        { slug: "admin/users" },
        { pathFields: ["slug"] }
      )
    ).toBeNull();
  });
});
