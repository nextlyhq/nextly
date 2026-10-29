/**
 * A collection and a Single removed from code are still listed in the admin,
 * marked as removed, and their screens name them, say they are no longer in
 * the configuration and give the next step for where their retirement stands:
 *
 * - their tables kept and no migration dropping them: `nextly migrate:create`,
 *   then `nextly migrate`;
 * - a written drop not yet applied: `nextly migrate`, naming the file;
 * - half-retired (an applied migration dropped the main table, the registry
 *   row remains): an earlier release left it part-retired, and `nextly prune`.
 *
 * Each state is checked on the navigation, the list screen and the edit
 * screen, for a collection and a Single, and the edit screens offer nothing
 * that would write. Only a browser shows this whole: the mark, the notice and
 * the withheld controls are drawn by different components from the server's
 * answer.
 *
 * The removed entities are staged in the suite's database
 * (`support/removed-from-code.ts`), as a deploy of an edited configuration
 * leaves them.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import {
  stageRemovedEntities,
  stepFor,
  unstageRemovedEntities,
  type StagedRun,
  type StagedState,
} from "./support/removed-from-code";

// Registry rows and migration files are the schema's shared state.
test.describe.configure({ mode: "serial", lock: [LOCK.schema] });

// Unique to this attempt: a retry runs `beforeAll` again.
const RUN = Date.now().toString(36);

let staged: StagedRun | undefined;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  try {
    staged = await stageRemovedEntities(admin, RUN);
  } finally {
    await admin.dispose();
  }
});

test.afterAll(async () => {
  await unstageRemovedEntities(staged);
});

const NOT_IN_CONFIGURATION = "is no longer in the configuration";

function stateOf(state: StagedState["state"]): StagedState {
  const found = staged?.states.find(s => s.state === state);
  if (found === undefined) throw new Error(`[e2e] ${state} was not staged`);
  return found;
}

/** The notice on the screen, waited for before anything is read from it. */
async function expectNotice(
  page: Page,
  staged: StagedState,
  label: string
): Promise<void> {
  const notice = page.getByTestId("removed-from-code-notice").first();
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText(`“${label}” ${NOT_IN_CONFIGURATION}`);
  await expect(notice).toContainText(stepFor(staged));
}

/** Nothing on an editor that would write: no leading action, no save. */
async function expectNoWrites(page: Page): Promise<void> {
  await expect(page.locator('[data-primary="true"]')).toHaveCount(0);
  await expect(page.locator('[data-action="save"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^publish/i })).toHaveCount(0);
}

for (const state of ["kept", "pending", "half"] as const) {
  test.describe(`removed from code, ${state}`, () => {
    test("the collection is marked in the navigation, with its step", async ({
      page,
    }) => {
      const { collection } = stateOf(state);
      await gotoAdmin(page, `/collections/${collection.slug}`);
      const link = contentPanel(page).getByRole("link", {
        name: collection.label,
        exact: true,
      });
      await expect(link).toBeVisible({ timeout: 30_000 });
      await expect(link).toContainText("Removed");
      await expect(link).toHaveAccessibleDescription(
        new RegExp(escape(stepFor(stateOf(state))))
      );
    });

    test("the collection's list names it and its step, and offers no New", async ({
      page,
    }) => {
      const staged = stateOf(state);
      await gotoAdmin(page, `/collections/${staged.collection.slug}`);
      await expectNotice(page, staged, staged.collection.label);
      await expect(page.getByRole("button", { name: /^new /i })).toHaveCount(0);
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      if (state !== "half") {
        // Its entry is still listed: reads are served while the table exists.
        await expect(
          page.getByRole("cell", { name: `Removed tag ${RUN}` })
        ).toBeVisible();
      }
    });

    test("the collection's edit screen names it and its step, and offers nothing that writes", async ({
      page,
    }) => {
      const staged = stateOf(state);
      await gotoAdmin(
        page,
        `/collections/${staged.collection.slug}/${staged.collection.entryId}`
      );
      await expectNotice(page, staged, staged.collection.label);
      await expectNoWrites(page);
      if (state !== "half") {
        await expect(
          page.locator("main").getByRole("textbox").first()
        ).not.toBeEditable();
      }
    });

    test("the Single is marked in the navigation and the Singles list, with its step", async ({
      page,
    }) => {
      const staged = stateOf(state);
      await gotoAdmin(page, "/singles");
      const link = contentPanel(page).getByRole("link", {
        name: staged.single.label,
        exact: true,
      });
      await expect(link).toBeVisible({ timeout: 30_000 });
      await expect(link).toContainText("Removed");
      await expect(link).toHaveAccessibleDescription(
        new RegExp(escape(stepFor(staged)))
      );
      // The Singles list (the builder's, where Singles are listed) marks it
      // too, with the step read out beside it.
      await gotoAdmin(page, "/builder/singles");
      const listed = page
        .locator("main")
        .getByText(staged.single.label, { exact: true })
        .filter({ visible: true })
        .first();
      await expect(listed).toBeVisible({ timeout: 30_000 });
      await expect(
        listed.locator("xpath=..").getByTestId("removed-from-code-mark")
      ).toHaveText("Removed");
      await expect(
        page
          .locator("main")
          .getByText(new RegExp(escape(stepFor(staged))))
          .first()
      ).toBeAttached();
    });

    test("the Single's edit screen names it and its step, and offers nothing that writes", async ({
      page,
    }) => {
      const staged = stateOf(state);
      await gotoAdmin(page, `/singles/${staged.single.slug}`);
      await expectNotice(page, staged, staged.single.label);
      await expectNoWrites(page);
    });
  });
}

/** The sidebar's Content panel, where the collections and Singles are listed. */
function contentPanel(page: Page) {
  return page
    .getByRole("complementary")
    .filter({ has: page.getByRole("navigation", { name: "Content type" }) });
}

/** `text` as a literal in a regular expression. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
