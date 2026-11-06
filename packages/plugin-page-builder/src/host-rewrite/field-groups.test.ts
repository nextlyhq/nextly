/**
 * Reading the site's field groups for a walk: the registry's definition wins
 * for its slug, the code's answers only for a slug the registry, read to the
 * end, does not hold, and a registry not read to the end resolves nothing,
 * not even a group declared in code, whose definition an admin may have
 * edited in the registry.
 */
import { describe, expect, it } from "vitest";

import { readSiteFieldGroups, type FieldGroupPage } from "./field-groups";

const PLAIN = { fields: [{ type: "text", name: "metaTitle" }] };
const EDITED = {
  fields: [
    { type: "text", name: "metaTitle" },
    { type: "blocks", name: "body" },
  ],
};

/** The code's declarations: `seo` of plain fields, and `cta`. */
const inCode = (slug: string) =>
  slug === "seo" || slug === "cta" ? PLAIN : undefined;

/** A registry of these pages, the last saying there is no more. */
function registry(
  pages: readonly (readonly { slug: string; fields?: unknown }[])[]
): FieldGroupPage {
  return offset => {
    const at = offset / 200;
    return Promise.resolve({
      items: pages[at] ?? [],
      meta: { hasNext: at < pages.length - 1 },
    });
  };
}

describe("the site's field groups as a walk reads them", () => {
  it("takes the registry's definition over the code's, and the code's for a slug the registry lacks", async () => {
    const groups = await readSiteFieldGroups({
      page: registry([
        [{ slug: "seo", ...EDITED }],
        [{ slug: "promo", ...PLAIN }],
      ]),
      inCode,
      warn: () => {},
    });

    expect(groups("seo")).toEqual(EDITED);
    expect(groups("promo")).toEqual(PLAIN);
    expect(groups("cta")).toEqual(PLAIN);
    expect(groups("never-made")).toBeUndefined();
  });

  it("resolves nothing, a code group included, when the registry can't be read", async () => {
    const warned: string[] = [];
    const groups = await readSiteFieldGroups({
      page: () => Promise.reject(new Error("the connection dropped")),
      inCode,
      warn: message => warned.push(message),
    });

    expect(groups("seo")).toBeUndefined();
    expect(groups("cta")).toBeUndefined();
    expect(warned).toHaveLength(1);
  });

  it("resolves nothing when the registry holds more pages than a walk reads", async () => {
    const warned: string[] = [];
    const groups = await readSiteFieldGroups({
      page: registry([
        [{ slug: "promo", ...PLAIN }],
        [{ slug: "seo", ...EDITED }],
      ]),
      inCode,
      warn: message => warned.push(message),
      pages: 1,
    });

    // The edited `seo` on the page not read is why the code's cannot answer.
    expect(groups("seo")).toBeUndefined();
    expect(groups("promo")).toBeUndefined();
    expect(warned).toHaveLength(1);
  });
});
