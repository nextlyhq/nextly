/**
 * The sections the llms files list pages under: by content type, a Single's
 * page under "Pages", a page built in code under its folder (or "Other
 * pages" at the root), in the order and with the headings the site chose,
 * and what llms-full.txt and a folder's own files hold of them.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { codePagesSlug } from "../../code-pages/collection";
import type { ListedPage } from "../listing";
import { inFolderFiles, inFullFile, llmsListOf } from "../llms-groups";

/** A context that names the collections' labels and nothing else. */
const ctx = {
  self: { collections: {}, singles: {} },
  services: {
    collections: {
      getCollection: async (slug: string) => ({
        labels: { plural: slug === "posts" ? "Blog posts" : "Docs" },
      }),
    },
  },
} as unknown as PluginContext;

const SITE = "https://acme.example";

/** The bookkeeping collection pages built in code are held by. */
const CODE_PAGES_SLUG = codePagesSlug(ctx);

/** A listed page of `collection` at `path`. */
function at(collection: string, path: string): ListedPage {
  return {
    loc: `${SITE}${path}`,
    path,
    language: "en",
    holder: { collection, id: path },
  } as unknown as ListedPage;
}

const pages = [
  at("single:home", "/"),
  at("posts", "/blog/hello"),
  at(CODE_PAGES_SLUG, "/docs"),
  at(CODE_PAGES_SLUG, "/docs/start"),
  at(CODE_PAGES_SLUG, "/pricing"),
  at("posts", "/blog/second"),
  at("single:about", "/about"),
];

const listedPaths = (listed: { page: ListedPage }[]) =>
  listed.map(each => each.page.path);

describe("the llms files' sections", () => {
  it("are each page's content type, a Single's page under Pages and a page built in code under its folder, in the listing's order", async () => {
    const { listed, groups } = await llmsListOf(ctx, pages, undefined);
    expect(listed.map(each => [each.page.path, each.section])).toEqual([
      ["/", "Pages"],
      ["/blog/hello", "Blog posts"],
      ["/blog/second", "Blog posts"],
      ["/docs", "Docs"],
      ["/docs/start", "Docs"],
      ["/pricing", "Other pages"],
      ["/about", "Pages"],
    ]);
    expect(
      groups.map(group => [group.key, group.defaultHeading, group.pages])
    ).toEqual([
      ["single:home", "Pages", 1],
      ["posts", "Blog posts", 2],
      ["code:docs", "Docs", 2],
      ["code:", "Other pages", 1],
      ["single:about", "Pages", 1],
    ]);
  });

  it("follow the site's order and headings, list an Optional group under Optional, and leave a left-out group out", async () => {
    const { listed, groups } = await llmsListOf(ctx, pages, {
      groups: [
        { key: "code:docs", heading: "Guides" },
        { key: "posts", optional: true },
        { key: "code:", leftOut: true },
      ],
    });
    expect(listed.map(each => [each.page.path, each.section])).toEqual([
      ["/docs", "Guides"],
      ["/docs/start", "Guides"],
      ["/blog/hello", "Optional"],
      ["/blog/second", "Optional"],
      ["/", "Pages"],
      ["/about", "Pages"],
    ]);
    // Every group is still offered, the one left out too.
    expect(groups.map(group => group.key)).toContain("code:");
  });

  it("narrow llms-full.txt to the chosen groups or addresses, and a folder's files to its pages", async () => {
    const { listed } = await llmsListOf(ctx, pages, undefined);
    expect(listedPaths(inFullFile(listed, undefined))).toEqual(
      listedPaths(listed)
    );
    expect(
      listedPaths(
        inFullFile(listed, {
          fullContents: { include: "groups", groups: ["posts"] },
        })
      )
    ).toEqual(["/blog/hello", "/blog/second"]);
    expect(
      listedPaths(
        inFullFile(listed, {
          fullContents: { include: "addresses", prefixes: ["/docs/"] },
        })
      )
    ).toEqual(["/docs", "/docs/start"]);
    expect(listedPaths(inFolderFiles(listed, "blog"))).toEqual([
      "/blog/hello",
      "/blog/second",
    ]);
  });
});
