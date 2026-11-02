/**
 * Two people and one entry: the collection entry editor keeps the document's
 * soft lock.
 *
 * The second person sees the entry read-only, named as held by the first, and
 * can ask for access; a takeover moves the entry to them, and the first
 * person's unsaved edit is still theirs, on screen, for when they take it back
 * (`support/lock-cases`). Each test writes a post of its own, so nothing here
 * shares a document with another spec.
 *
 * @module tests/entry-lock
 */
import type { Page } from "@playwright/test";

import { test } from "./support/test";
import { uniqueTag } from "./support/accounts";
import { EVERY_DIALECT } from "./support/every-dialect";
import {
  secondEditorFindsItHeld,
  takeoverKeepsUnsavedEdits,
  type LockedScreen,
} from "./support/lock-cases";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";

// Creates a second editor's account; see support/locks.ts for what each lock
// guards.
test.describe.configure({ lock: [LOCK.usersRoles] });

/** A post of the test's own, edited through its Excerpt, a plain field. */
const POST: LockedScreen = {
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

// Run on every dialect: the lease the two editors share lives in the database.
test.describe("two editors on one entry", { tag: EVERY_DIALECT }, () => {
  // Two sessions, and a lock heartbeat each side waits on: the holder learns
  // of a request, and the displaced editor of a takeover, only at its next
  // beat, which the cases allow 45 seconds for.
  test.describe.configure({ timeout: 120_000 });

  test("a second editor sees the entry read-only and named, and can ask for access", async ({
    page,
    browser,
    baseURL,
  }) => {
    await secondEditorFindsItHeld(POST, { page, browser, baseURL });
  });

  test("a takeover keeps the displaced editor's unsaved edits", async ({
    page,
    browser,
    baseURL,
  }) => {
    await takeoverKeepsUnsavedEdits(POST, { page, browser, baseURL });
  });
});
