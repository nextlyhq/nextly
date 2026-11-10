/**
 * Every author the blog template's demo seed creates has an avatar a page can
 * draw, and a stored avatar that is no address draws the author's initial.
 *
 * The seed uploads each user's avatar file from its media folder into the
 * media library and gives the author profile it creates that record, so the
 * profile's avatar is a media address. The users keep a text `avatarUrl`,
 * which the seed makes absolute from `seedMedia.baseUrl`; no page reads it.
 *
 * The pages draw an author's avatar only from an address: absolute over http
 * or https, or a path on the site. A bare filename, which an import or an old
 * value can leave, would resolve against whichever page draws it and show a
 * broken image, so it gives no address and the author's initial is drawn.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { avatarAddress } from "../../../../templates/blog/src/lib/queries/coerce";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(
  here,
  "../../../../templates/blog/src/endpoints/seed"
);
const data = JSON.parse(
  readFileSync(path.join(SEED, "seed-data.json"), "utf8")
) as {
  seedMedia: { baseUrl: string };
  users: { slug: string; avatarUrl?: string }[];
};

describe("blog template: seeded avatars", () => {
  it("names an avatar file for every seeded author, one the media folder has", () => {
    // A floor, so a seed with no users cannot pass by checking nothing.
    expect(data.users.length).toBeGreaterThan(0);
    for (const user of data.users) {
      expect(user.avatarUrl, user.slug).toMatch(
        /^[\w.-]+\.(?:svg|webp|png|jpe?g)$/i
      );
      expect(
        existsSync(path.join(SEED, "media", user.avatarUrl ?? "")),
        user.slug
      ).toBe(true);
    }
  });

  it("makes every user's own avatar address a full https address", () => {
    const base = new URL(data.seedMedia.baseUrl);
    expect(base.protocol).toBe("https:");
    for (const user of data.users) {
      const address = new URL(user.avatarUrl ?? "", base);
      expect(address.protocol, user.slug).toBe("https:");
      expect(avatarAddress(address.href), user.slug).toBe(address.href);
    }
  });
});

describe("blog template: an author's avatar address", () => {
  it("keeps an absolute http or https address, and a path on the site", () => {
    for (const address of [
      "https://cdn.example/jane.svg",
      "http://cdn.example/jane.svg",
      "/uploads/author-jane.svg",
    ]) {
      expect(avatarAddress(address)).toBe(address);
    }
  });

  it("gives no address for a bare filename, so the author's initial is drawn", () => {
    expect(avatarAddress("author-jane.svg")).toBeNull();
  });

  it("gives no address for a script, another host with no scheme, or no value", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "//elsewhere.example/a.svg",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(avatarAddress(value), String(value)).toBeNull();
    }
  });
});
