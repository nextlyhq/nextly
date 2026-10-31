/**
 * The Singles list marks a Single removed from code, with the step its state
 * names read out beside it.
 *
 * That list is the Schema Builder's (`/admin/builder/singles`), which a
 * production build does not serve unless the app turns the builder on, so
 * this runs on the dev server (`DEV_SPECS` in `playwright.config.ts`). The
 * navigation's mark and the entity's own screens, which every build serves,
 * are checked in `removed-from-code.spec.ts`.
 *
 * The removed Singles are staged in the suite's database
 * (`support/removed-from-code.ts`), as a deploy of an edited configuration
 * leaves them.
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import {
  REMOVED_STATES,
  stageRemovedEntities,
  stepFor,
  unstageRemovedEntities,
  type StagedRun,
} from "./support/removed-from-code";

// Registry rows and migration files are the schema's shared state.
test.describe.configure({ mode: "serial", lock: [LOCK.schema] });

// Unique to this attempt: a retry runs `beforeAll` again.
const RUN = `sl${Date.now().toString(36)}`;

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

for (const state of REMOVED_STATES) {
  test(`the Singles list marks a Single removed from code, ${state}, with its step`, async ({
    page,
  }) => {
    const entry = staged?.states.find(s => s.state === state);
    if (entry === undefined) throw new Error(`[e2e] ${state} was not staged`);

    await gotoAdmin(page, "/builder/singles");
    const listed = page
      .locator("main")
      .getByText(entry.single.label, { exact: true })
      .filter({ visible: true })
      .first();
    await expect(listed).toBeVisible({ timeout: 30_000 });
    await expect(
      listed.locator("xpath=..").getByTestId("removed-from-code-mark")
    ).toHaveText("Removed");
    await expect(
      page
        .locator("main")
        .getByText(new RegExp(escape(stepFor(entry))))
        .first()
    ).toBeAttached();
  });
}

/** `text` as a literal in a regular expression. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
