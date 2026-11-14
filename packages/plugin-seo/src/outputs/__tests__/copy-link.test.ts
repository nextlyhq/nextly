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
import { describe, expect, it } from "vitest";

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
  const resolver = withCopyLink(ctx, { resolve: () => answer }, async () => ({
    patterns: {},
    plainTextCopies: copies,
  }));
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

  it("is not there while copies are off", async () => {
    expect((await answered(LISTED, POST, false)).formats).toBeUndefined();
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
