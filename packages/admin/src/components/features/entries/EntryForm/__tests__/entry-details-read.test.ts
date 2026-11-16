/**
 * Who, in words, and the address chip's text: what it says, what Copy writes
 * and what Open live page opens, from the server's answer and the slug the
 * form holds now.
 */
import { describe, expect, it } from "vitest";

import { addressChipText, changerWords } from "../entry-details-read";

describe("changerWords", () => {
  it("names a person by the name their account gives now", () => {
    expect(changerWords({ kind: "person", name: "Ana Ruiz" })).toBe("Ana Ruiz");
  });

  it("says a former user once the account is gone", () => {
    expect(changerWords({ kind: "person", name: null, gone: true })).toBe(
      "a former user"
    );
  });

  it("says a user for an account that has no name, never its email", () => {
    expect(changerWords({ kind: "person", name: null })).toBe("a user");
    expect(changerWords({ kind: "person", name: "" })).toBe("a user");
  });

  it("names anything that is not a person by its kind", () => {
    expect(changerWords({ kind: "apiKey", name: null })).toBe("an API key");
    expect(changerWords({ kind: "release", name: null })).toBe("a release");
    expect(changerWords({ kind: "system", name: null })).toBe("the system");
    expect(changerWords({ kind: "agent", name: null })).toBe("an agent");
    expect(
      changerWords({ kind: "principal", name: null, principalKind: "member" })
    ).toBe("a plugin");
  });

  it("says nobody where nobody is recorded, so the date stands alone", () => {
    expect(changerWords(null)).toBeNull();
    expect(changerWords(undefined)).toBeNull();
  });
});

const page = {
  site: "https://ridgeline.com/",
  path: "/pricing",
  aroundSlug: { before: "/", after: "" },
};

describe("addressChipText", () => {
  it("shows the site's host then the path, and copies the full address", () => {
    expect(
      addressChipText({ address: page, slug: "pricing", published: true })
    ).toEqual({
      before: "ridgeline.com/",
      slug: "pricing",
      after: "",
      copied: "https://ridgeline.com/pricing",
      live: "https://ridgeline.com/pricing",
    });
  });

  it("shows the slug as the form holds it, and opens the address that is live now", () => {
    const text = addressChipText({
      address: {
        ...page,
        path: "/blog/pricing",
        aroundSlug: { before: "/blog/", after: "" },
      },
      slug: "prices",
      published: true,
    });
    expect(text).toMatchObject({
      before: "ridgeline.com/blog/",
      slug: "prices",
      copied: "https://ridgeline.com/blog/prices",
      live: "https://ridgeline.com/blog/pricing",
    });
  });

  it("shows the path alone, and offers no live page, while the site's address isn't set", () => {
    expect(
      addressChipText({
        address: { ...page, site: null },
        slug: "pricing",
        published: true,
      })
    ).toMatchObject({
      before: "/",
      slug: "pricing",
      copied: "/pricing",
      live: undefined,
    });
  });

  it("offers no live page for an entry that isn't published", () => {
    expect(
      addressChipText({ address: page, slug: "pricing", published: false })
        ?.live
    ).toBeUndefined();
  });

  it("joins a site address with a path of its own to the entry's path", () => {
    expect(
      addressChipText({
        address: { ...page, site: "https://ridgeline.com/site/" },
        slug: "pricing",
        published: true,
      })
    ).toMatchObject({
      before: "ridgeline.com/site/",
      copied: "https://ridgeline.com/site/pricing",
    });
  });

  it("shows the whole path where the slug is not part of it", () => {
    expect(
      addressChipText({
        address: { site: null, path: "/about-us" },
        slug: "about",
        published: true,
      })
    ).toMatchObject({
      before: "/about-us",
      slug: undefined,
      copied: "/about-us",
    });
  });

  it("shows the slug alone where the type has no public address", () => {
    expect(
      addressChipText({ address: null, slug: "pricing", published: true })
    ).toEqual({
      before: "",
      slug: "pricing",
      after: "",
      copied: "pricing",
      live: undefined,
    });
  });

  it("draws no chip where there is neither an address nor a slug", () => {
    expect(
      addressChipText({ address: null, slug: undefined, published: true })
    ).toBeUndefined();
  });
});
