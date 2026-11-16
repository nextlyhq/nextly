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

/**
 * A registry of these groups, listed by offset as core lists them; `totals`
 * names the total each page reports, in order, where it is not the count.
 */
function registry(
  groups: readonly { slug: string; fields?: unknown }[],
  totals: readonly number[] = []
): FieldGroupPage {
  let call = 0;
  return (offset, limit) => {
    const total = totals[call] ?? groups.length;
    call += 1;
    return Promise.resolve({
      items: groups.slice(offset, offset + limit),
      meta: { total, hasNext: offset + limit < total },
    });
  };
}

describe("the site's field groups as a walk reads them", () => {
  it("takes the registry's definition over the code's, and the code's for a slug the registry lacks", async () => {
    const groups = await readSiteFieldGroups({
      page: registry([
        { slug: "seo", ...EDITED },
        { slug: "promo", ...PLAIN },
      ]),
      inCode,
      warn: () => {},
      perPage: 1,
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
        { slug: "promo", ...PLAIN },
        { slug: "seo", ...EDITED },
      ]),
      inCode,
      warn: message => warned.push(message),
      pages: 1,
      perPage: 1,
    });

    // The edited `seo` on the page not read is why the code's cannot answer.
    expect(groups("seo")).toBeUndefined();
    expect(groups("promo")).toBeUndefined();
    expect(warned).toHaveLength(1);
  });

  it("resolves nothing when the total the registry reports shifts between pages", async () => {
    const warned: string[] = [];
    // A group removed behind the walk: the second page reports one fewer, and
    // the offset now steps past the group that moved back into the first.
    const groups = await readSiteFieldGroups({
      page: registry(
        [
          { slug: "promo", ...PLAIN },
          { slug: "seo", ...EDITED },
        ],
        [3, 2]
      ),
      inCode,
      warn: message => warned.push(message),
      perPage: 1,
    });

    expect(groups("seo")).toBeUndefined();
    expect(groups("promo")).toBeUndefined();
    expect(warned).toEqual([
      expect.stringContaining("changed while it was read"),
    ]);
  });

  it("resolves nothing when a page ends short before the reported total", async () => {
    const warned: string[] = [];
    const short: FieldGroupPage = async offset => ({
      items: offset === 0 ? [{ slug: "promo", ...PLAIN }] : [],
      meta: { total: 3, hasNext: true },
    });
    const groups = await readSiteFieldGroups({
      page: short,
      inCode,
      warn: message => warned.push(message),
      perPage: 2,
    });

    expect(groups("promo")).toBeUndefined();
    expect(groups("cta")).toBeUndefined();
    expect(warned).toEqual([
      expect.stringContaining("changed while it was read"),
    ]);
  });
});
