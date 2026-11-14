/**
 * The link from a page's head to its plain-text copy: only a listed page
 * (indexed, its own canonical) links one, only while copies are on, and a
 * page built in code links none, since it has no copy.
 */
import type {
  PageMetadataAnswer,
  PageMetadataInput,
  PluginContext,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

/**
 * Where the serving decision says each page's copy is: as copyPathsOf
 * names it, except where a test says another page holds it.
 */
const served = vi.hoisted(() => ({
  taken: new Set<string>(),
  asked: [] as string[],
}));

vi.mock("../ai-outputs", () => ({
  servedCopyAddress: async (_ctx: unknown, loc: string) => {
    served.asked.push(loc);
    const url = new URL(loc);
    const paths = url.pathname.endsWith("/")
      ? [`${url.pathname}index.md`, `${url.pathname}index.html.md`]
      : [`${url.pathname}.md`];
    const free = paths.find(path => !served.taken.has(path));
    return free === undefined ? undefined : new URL(free, loc).href;
  },
}));

import { withCopyLink } from "../copy-link";

const ctx = { self: { collections: {} } } as unknown as PluginContext;

const POST: PageMetadataInput = {
  path: "/blog/hello",
  locale: "en",
  source: { kind: "entry", collection: "posts", entry: { id: "1" } },
};

const LISTED: PageMetadataAnswer = {
  title: "Hello",
  canonical: "https://acme.example/blog/hello",
  robots: { index: true, follow: true },
};

/** What the head is answered for `input`, with copies on or off. */
async function answered(
  answer: PageMetadataAnswer,
  input: PageMetadataInput = POST,
  copies = true
): Promise<PageMetadataAnswer> {
  const resolver = withCopyLink(
    ctx,
    { resolve: () => answer },
    {
      readRules: async () => ({ patterns: {}, plainTextCopies: copies }),
      origin: "https://acme.example",
    }
  );
  return resolver.resolve(input);
}

describe("the head's link to a page's plain-text copy", () => {
  it("is the copy's address, beside the canonical, where copies are on", async () => {
    expect((await answered(LISTED)).formats).toEqual({
      "text/markdown": "https://acme.example/blog/hello.md",
    });
    expect(
      (await answered({ ...LISTED, canonical: "/" }, { ...POST, path: "/" }))
        .formats
    ).toEqual({ "text/markdown": "/index.md" });
  });

  it("leads only to an address where the page's own copy is served", async () => {
    served.taken = new Set(["/blog/hello.md", "/index.md"]);
    try {
      // Another page holds the copy's only address: no link.
      expect((await answered(LISTED)).formats).toBeUndefined();
      // The home page's index.md is another page's: its other name is linked.
      expect(
        (await answered({ ...LISTED, canonical: "/" }, { ...POST, path: "/" }))
          .formats
      ).toEqual({ "text/markdown": "/index.html.md" });
    } finally {
      served.taken = new Set();
    }
  });

  it("is made whole against the site's production address where no base address is set", async () => {
    const resolver = withCopyLink(
      ctx,
      { resolve: () => ({ ...LISTED, canonical: "/blog/hello" }) },
      {
        readRules: async () => ({
          patterns: {},
          plainTextCopies: true,
          productionAddresses: ["https://acme.example"],
        }),
      }
    );
    expect((await resolver.resolve(POST)).formats).toEqual({
      "text/markdown": "/blog/hello.md",
    });
  });

  it("is not there while copies are off, and asks nothing then", async () => {
    served.asked = [];
    expect((await answered(LISTED, POST, false)).formats).toBeUndefined();
    expect(served.asked).toEqual([]);
  });

  it("is not there for a page kept out of search or naming another page as canonical", async () => {
    expect(
      (await answered({ ...LISTED, robots: { index: false, follow: true } }))
        .formats
    ).toBeUndefined();
    expect(
      (
        await answered({
          ...LISTED,
          canonical: "https://acme.example/blog/other",
        })
      ).formats
    ).toBeUndefined();
  });

  it("is not there for a page built in code, which has no copy of its own", async () => {
    expect(
      (
        await answered(LISTED, {
          ...POST,
          source: { kind: "entry", collection: "nx_seo_code_pages", entry: {} },
        })
      ).formats
    ).toBeUndefined();
  });
});
