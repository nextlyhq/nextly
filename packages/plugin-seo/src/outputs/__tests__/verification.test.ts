/**
 * The verification tags reach the home page's head, and only it: at `/` on
 * whichever production address served it, or, for a page whose route does
 * not say where it is, by its canonical. Every other page is answered as
 * before, and reads nothing for them.
 */
import type {
  PageMetadataAnswer,
  PageMetadataInput,
  PageMetadataResolver,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { withVerification } from "../verification";

const TAGS = { "msvalidate.01": "8A2F61C4", "p:domain_verify": "a91c7e04" };

function input(path: string | undefined): PageMetadataInput {
  return {
    ...(path === undefined ? {} : { path }),
    source: { kind: "entry", collection: "pages", entry: { id: "1" } },
    code: {},
    derived: {},
  };
}

function answering(answer: PageMetadataAnswer): PageMetadataResolver {
  return { resolve: () => answer, tags: () => ["settings-tag"] };
}

describe("withVerification", () => {
  it("adds the saved tags to the home page", async () => {
    const read = vi.fn(async () => TAGS);
    const resolver = withVerification(answering({ title: "Home" }), read);
    expect(await resolver.resolve(input("/"))).toEqual({
      title: "Home",
      verification: TAGS,
    });
  });

  it("treats the home page's address with a trailing slash or none as the home page", async () => {
    const resolver = withVerification(answering({}), async () => TAGS);
    expect((await resolver.resolve(input(""))).verification).toEqual(TAGS);
    expect((await resolver.resolve(input("//"))).verification).toEqual(TAGS);
  });

  it("finds the home page by its canonical where the route gives no address", async () => {
    const resolver = withVerification(
      answering({ canonical: "https://example.com/" }),
      async () => TAGS
    );
    expect((await resolver.resolve(input(undefined))).verification).toEqual(
      TAGS
    );
  });

  it("adds nothing to any other page, and reads nothing for it", async () => {
    const read = vi.fn(async () => TAGS);
    const resolver = withVerification(
      answering({ canonical: "https://example.com/" }),
      read
    );
    expect(await resolver.resolve(input("/about"))).toEqual({
      canonical: "https://example.com/",
    });
    const deeper = withVerification(
      answering({ canonical: "https://example.com/de" }),
      read
    );
    expect((await deeper.resolve(input(undefined))).verification).toBe(
      undefined
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("adds nothing where no tag is saved", async () => {
    const resolver = withVerification(
      answering({ title: "Home" }),
      async () => ({})
    );
    expect(await resolver.resolve(input("/"))).toEqual({ title: "Home" });
  });

  it("keeps the resolver's cache tags", () => {
    const resolver = withVerification(answering({}), async () => TAGS);
    expect(resolver.tags?.(input("/"))).toEqual(["settings-tag"]);
  });
});
