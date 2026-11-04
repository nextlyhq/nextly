/**
 * A post of the test's own on the collection entry editor, edited through its
 * Excerpt, a plain field: the screen the entry lock specs hold.
 *
 * @module tests/support/locked-post
 */
import type { Page } from "@playwright/test";

import { uniqueTag } from "./accounts";
import type { LockedScreen } from "./lock-cases";
import { createEntry } from "./runtime-collection";

export const LOCKED_POST: LockedScreen = {
  field: (page: Page) =>
    page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true }),
  async prepare(api) {
    const tag = uniqueTag();
    const stored = `Stored excerpt ${tag}`;
    const id = await createEntry(api, "posts", {
      title: `Entry lock ${tag}`,
      slug: `entry-lock-${tag}`,
      excerpt: stored,
    });
    return {
      document: { scopeKind: "collection", slug: "posts", entryId: id },
      address: `/collections/posts/${id}`,
      stored,
    };
  },
};
