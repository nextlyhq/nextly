/**
 * Two people and one Single: the Single's edit form keeps the document's soft
 * lock, on the playground's `homepage`.
 *
 * The second person sees the Single read-only, named as held by the first, and
 * can ask for access; a takeover moves it to them, and the first person's
 * unsaved edit is still theirs, on screen, for when they take it back
 * (`support/lock-cases`). Its Page Builder screen is `builder-lock.spec.ts`.
 *
 * @module tests/single-lock
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { uniqueTag } from "./support/accounts";
import { EVERY_DIALECT } from "./support/every-dialect";
import { twoEditorsOn } from "./support/lock-cases";
import { LOCK } from "./support/locks";

// Writes the homepage and claims it, and creates a second editor's account;
// see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.homepage, LOCK.usersRoles] });

const HOMEPAGE_API = "/admin/api/singles/homepage";

/** The homepage's Title, on its edit form. */
const title = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Title", exact: true });

// Run on every dialect: the lease the two editors share lives in the database.
test.describe("two editors on one Single", { tag: EVERY_DIALECT }, () => {
  // As `entry-lock.spec.ts`: each side waits on a heartbeat.
  test.describe.configure({ timeout: 120_000 });

  twoEditorsOn({
    noun: "Single",
    field: title,
    async prepare(api) {
      const stored = `Stored title ${uniqueTag()}`;
      const written = await api.patch(HOMEPAGE_API, {
        data: { title: stored },
      });
      expect(written.ok(), await written.text()).toBe(true);
      // A Single's read is the bare document, not a mutation's `{ item }`.
      const read = await api.get(HOMEPAGE_API);
      expect(read.ok(), await read.text()).toBe(true);
      const { id } = (await read.json()) as { id: string };
      return {
        document: { scopeKind: "single", slug: "homepage", entryId: id },
        address: "/singles/homepage",
        stored,
      };
    },
  });
});
