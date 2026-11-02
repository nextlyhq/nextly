/**
 * Two people and one Single: a Single's edit form keeps the document's soft
 * lock, on the playground's `site-settings`.
 *
 * The second person sees the Single read-only, named as held by the first, and
 * can ask for access; a takeover moves it to them, and the first person's
 * unsaved edit is still theirs, on screen, for when they take it back
 * (`support/lock-cases`).
 *
 * `site-settings`, not `homepage`: the homepage's form has no field of its own
 * to edit (its title is fixed by the Single's config, and its layout is edited
 * on the Page Builder screen), so its lock is held there, by
 * `builder-lock.spec.ts`.
 *
 * @module tests/single-lock
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { uniqueTag } from "./support/accounts";
import { EVERY_DIALECT } from "./support/every-dialect";
import {
  secondEditorFindsItHeld,
  takeoverKeepsUnsavedEdits,
  type LockedScreen,
} from "./support/lock-cases";
import { LOCK } from "./support/locks";

// Writes the site settings and claims them, and creates a second editor's
// account; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.siteSettings, LOCK.usersRoles] });

const SITE_SETTINGS_API = "/admin/api/singles/site-settings";

/** The site settings, edited through their Tagline, a plain field. */
const SITE_SETTINGS: LockedScreen = {
  field: (page: Page) =>
    page.locator("main").getByRole("textbox", { name: "Tagline", exact: true }),
  async prepare(api) {
    const stored = `Stored tagline ${uniqueTag()}`;
    const written = await api.patch(SITE_SETTINGS_API, {
      data: { tagline: stored },
    });
    expect(written.ok(), await written.text()).toBe(true);
    // A Single's read is the bare document, not a mutation's `{ item }`.
    const read = await api.get(SITE_SETTINGS_API);
    expect(read.ok(), await read.text()).toBe(true);
    const { id } = (await read.json()) as { id: string };
    return {
      document: { scopeKind: "single", slug: "site-settings", entryId: id },
      address: "/singles/site-settings",
      stored,
    };
  },
};

// Run on every dialect: the lease the two editors share lives in the database.
test.describe("two editors on one Single", { tag: EVERY_DIALECT }, () => {
  // As `entry-lock.spec.ts`: each side waits on a heartbeat.
  test.describe.configure({ timeout: 120_000 });

  test("a second editor sees the Single read-only and named, and can ask for access", async ({
    page,
    browser,
    baseURL,
  }) => {
    await secondEditorFindsItHeld(SITE_SETTINGS, { page, browser, baseURL });
  });

  test("a takeover keeps the displaced editor's unsaved edits", async ({
    page,
    browser,
    baseURL,
  }) => {
    await takeoverKeepsUnsavedEdits(SITE_SETTINGS, { page, browser, baseURL });
  });
});
