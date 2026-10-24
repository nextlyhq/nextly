/**
 * A refusal's message names the action and the thing in the site's own words.
 *
 * The thing is a collection's label, a Single's label or a system resource's
 * name, never a slug or a permission as stored. A slug the site does not know
 * is never repeated back, so a caller cannot make a refusal echo a URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { logRefusal, refusalMessageFor } from "../refusal-message";

const CONFIG = {
  collections: [
    { slug: "posts", labels: { singular: "Post", plural: "Posts" } },
    {
      slug: "blog-posts",
      labels: { singular: "Blog Post", plural: "Blog Posts" },
    },
    { slug: "faqs", labels: { singular: "FAQ", plural: "FAQs" } },
    // Registered without labels: named from its own slug.
    { slug: "case-studies" },
  ],
  singles: [{ slug: "site-settings", label: { singular: "Site Settings" } }],
};

/** The executor each registry read was given, by slug. */
const readOn = new Map<string, unknown>();

describe("a refusal's message", () => {
  // The site's registered configuration, as a booted instance holds it,
  // taken away again after.
  beforeAll(() => {
    container.register("config", () => CONFIG);
    // The registries, which also hold what the Schema Builder made.
    container.register("collectionRegistryService", () => ({
      getCollectionBySlug: async (slug: string, executor?: unknown) => {
        readOn.set(slug, executor);
        return slug === "guides" || slug === "press"
          ? {
              slug,
              labels:
                slug === "guides"
                  ? { singular: "Guide", plural: "Guides" }
                  : { singular: "Newsroom Story", plural: "Newsroom" },
            }
          : null;
      },
    }));
    container.register("singleRegistryService", () => ({
      getSingleBySlug: async (slug: string) =>
        slug === "footer" ? { slug, label: "Footer" } : null,
    }));
  });
  afterAll(() => {
    container.clear();
  });

  it("names the action and one entry of a collection", async () => {
    await expect(refusalMessageFor("update", "posts", "one")).resolves.toBe(
      "You can't edit this post."
    );
    await expect(refusalMessageFor("read", "blog-posts", "one")).resolves.toBe(
      "You can't see this blog post."
    );
  });

  it("names the action and the collection when no one entry is named", async () => {
    await expect(refusalMessageFor("create", "posts")).resolves.toBe(
      "You can't create posts."
    );
    await expect(refusalMessageFor("read", "posts")).resolves.toBe(
      "You can't see posts."
    );
    await expect(refusalMessageFor("delete", "blog-posts")).resolves.toBe(
      "You can't delete blog posts."
    );
  });

  it("keeps an acronym in a label as written", async () => {
    await expect(refusalMessageFor("read", "faqs")).resolves.toBe(
      "You can't see FAQs."
    );
  });

  it("names a collection registered without labels from its slug", async () => {
    await expect(refusalMessageFor("read", "case-studies")).resolves.toBe(
      "You can't see case studies."
    );
  });

  it("names a Single by its label", async () => {
    await expect(refusalMessageFor("update", "site-settings")).resolves.toBe(
      "You can't edit Site Settings."
    );
  });

  it("names a system resource in words", async () => {
    await expect(refusalMessageFor("read", "users")).resolves.toBe(
      "You can't see users."
    );
    await expect(refusalMessageFor("update", "email-providers")).resolves.toBe(
      "You can't edit email providers."
    );
    await expect(refusalMessageFor("create", "api-keys")).resolves.toBe(
      "You can't create API keys."
    );
    await expect(refusalMessageFor("manage", "settings")).resolves.toBe(
      "You can't manage settings."
    );
  });

  it("never repeats a slug the site does not know, or none at all", async () => {
    await expect(
      refusalMessageFor("read", "anything-a-url-says")
    ).resolves.toBe("You can't do that.");
    await expect(refusalMessageFor("manage", "")).resolves.toBe(
      "You can't do that."
    );
  });

  it("names what only the registries hold", async () => {
    await expect(refusalMessageFor("update", "guides", "one")).resolves.toBe(
      "You can't edit this guide."
    );
    await expect(refusalMessageFor("read", "guides")).resolves.toBe(
      "You can't see guides."
    );
    await expect(refusalMessageFor("update", "footer")).resolves.toBe(
      "You can't edit Footer."
    );
  });

  it("names a thing server code named by its label before its words", async () => {
    // A Schema Builder collection whose label is not its slug's words.
    await expect(
      refusalMessageFor("read", "press", "all", { named: true })
    ).resolves.toBe("You can't see newsroom.");
  });

  it("reads the registries on the refusing gate's own transaction", async () => {
    const tx = { transaction: "the gate's own" };
    await refusalMessageFor("read", "press", "all", {
      named: true,
      executor: tx,
    });
    expect(readOn.get("press")).toBe(tx);
  });

  it("names a thing server code named by its words, where nothing holds a label", async () => {
    // Server code names a collection or Single it knows; no URL reaches here.
    await expect(
      refusalMessageFor("read", "builder-notes", "all", { named: true })
    ).resolves.toBe("You can't see builder notes.");
    await expect(
      refusalMessageFor("read", "builder-notes", "one", { named: true })
    ).resolves.toBe("You can't see this entry.");
    // A request's slug is never said in words, however it is asked.
    await expect(refusalMessageFor("read", "builder-notes")).resolves.toBe(
      "You can't do that."
    );
  });
});

describe("a refusal's log line", () => {
  it("is never why a refusal goes unanswered", () => {
    const failing = {
      debug: vi.fn(),
      info: vi.fn(() => {
        throw new Error("the log transport is down");
      }),
      warn: vi.fn(),
      error: vi.fn(),
    };
    expect(() =>
      logRefusal(failing, { status: 403, reason: "a reason" })
    ).not.toThrow();
    expect(failing.info).toHaveBeenCalled();
  });
});
