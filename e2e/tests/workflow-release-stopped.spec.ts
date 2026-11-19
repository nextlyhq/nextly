/**
 * A release stopped by a withdrawn approval, in a real browser. A scheduled release holds an
 * approved note; an edit to the note saved in the editor withdraws its approval, and the
 * release is checked again as the save commits and stopped before its moment, its page naming
 * the note as not approved. Nothing goes live. The release page is held to WCAG 2.2 AA.
 *
 * The stop is the release runner's own, made by the save: nothing here writes a release's
 * state to the database (as `./support/release-states` does for the other release specs).
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { cancel, readRelease, release, schedule } from "./support/releases-api";
import { test } from "./support/test";
import {
  expectStage,
  NOTES,
  openNote,
  resetReviewSettings,
  REVIEWED_NOTES,
  reviewedNote,
  step,
} from "./support/workflow";

// It schedules a release, which the runner a Publish now elsewhere starts would see, and works
// the review workflow.
test.describe.configure({ lock: [LOCK.releases, LOCK.reviewWorkflow] });

const HOUR = 60 * 60 * 1000;

test("an edit that withdraws an approval stops the release holding the note, before its moment", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetReviewSettings(page);
  const stamp = Date.now().toString(36);
  const id = await reviewedNote(page, stamp);
  await step(page, id, "submit");
  await step(page, id, "approve");
  await expectStage(page, id, "approved");

  const title = `Workflow release ${stamp}`;
  const releaseId = await release(page, title, id, REVIEWED_NOTES);
  try {
    // Approved, so nothing stands in the way of scheduling it.
    await schedule(page, releaseId, new Date(Date.now() + HOUR), "UTC");
    expect((await readRelease(page, releaseId)).state).toBe("scheduled");

    // An edit saved in the editor withdraws the approval.
    await openNote(page, id);
    await page
      .getByRole("textbox", { name: "Summary" })
      .fill(`Changed after the release was scheduled, ${stamp}.`);
    await page.locator('[data-action="save"]').click();
    await expectStage(page, id, "inReview");

    // The save has the release checked again, and the runner stops it.
    await expect
      .poll(async () => (await readRelease(page, releaseId)).state, {
        message: "the release is stopped",
        timeout: 30_000,
      })
      .toBe("blocked");

    await gotoAdmin(page, `/releases/${releaseId}`);
    await expect(page.getByText("Stopped").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Not approved/).first()).toBeVisible();
    await expectNoAxeViolations(page);

    // Nothing went live.
    const read = await page.request.get(`${NOTES}/${id}?status=all`);
    expect(((await read.json()) as { status?: string }).status).toBe("draft");
  } finally {
    // A stopped release of this spec's would show in every later spec's strip.
    await cancel(page, releaseId).catch(() => undefined);
  }
});
