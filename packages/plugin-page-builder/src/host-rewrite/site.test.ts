/**
 * Which languages the walk reads each host in: a top-level field by its own
 * classification, anything deeper in every configured language, because core
 * stores a localized field group's values per language under a parent that is
 * not translated.
 */
import { describe, expect, it } from "vitest";

import { siteHostSource, type RewriteSite } from "./site";

/** A site with one collection, `notes`, holding one entry, `n1`. */
function siteWith(declaration: unknown): RewriteSite {
  const nextly = {
    find: async () => ({ items: [{ id: "n1" }], meta: { hasNext: false } }),
  };
  return {
    nextly: async () => nextly as never,
    collectionSlugs: async () => ["notes"],
    resolveCollection: async () => declaration,
    singles: async () => [],
    locales: () => ["en", "de"],
    layouts: "layouts",
    hints: async () => [],
    componentId: "card",
    identity: async () => ({ overrideAccess: false }),
  };
}

/** Every host the walk yields, as `path@locale`. */
async function hostsOf(declaration: unknown): Promise<string[]> {
  const found: string[] = [];
  for await (const document of siteHostSource(siteWith(declaration)).documents(
    null
  )) {
    for (const { host } of document.hosts) {
      found.push(`${host.path.join(".") || "*"}@${host.locale ?? "-"}`);
    }
  }
  return found;
}

describe("the languages each host is read in", () => {
  it("reads a field behind a field group in every language of an untranslated parent", async () => {
    const hosts = await hostsOf({
      fields: [
        { type: "text", name: "title" },
        { type: "fieldGroup", name: "hero", group: "hero-group" },
      ],
    });

    expect(hosts).toEqual(["*@en", "*@de"]);
  });

  it("reads a field under a named group in every language", async () => {
    const hosts = await hostsOf({
      fields: [
        {
          type: "group",
          name: "hero",
          fields: [{ type: "blocks", name: "body" }],
        },
      ],
    });

    expect(hosts).toEqual(["hero.body@en", "hero.body@de"]);
  });

  it("CONTROL: reads an untranslated top-level field once", async () => {
    const hosts = await hostsOf({
      fields: [{ type: "blocks", name: "content" }],
    });

    expect(hosts).toEqual(["content@-"]);
  });
});
