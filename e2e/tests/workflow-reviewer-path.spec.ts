/**
 * The reviewer's path, in a real browser. A reviewer who may approve but never change the
 * content opens a submitted note read-only, with nothing to save, and Approve leading; approving
 * it moves it to Approved. A reviewer opens a changed, published note at its changes, compared
 * with the published version, and approves what they read; the publisher's Publish then runs.
 * The read-only editor and the changes are held to WCAG 2.2 AA.
 */
import { expect } from "@playwright/test";

import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import {
  expectEditorAccessible,
  expectStage,
  leading,
  leaveNote,
  NOTES,
  openNote,
  publishControl,
  resetReviewSettings,
  reviewedNote,
  signInAs,
  statusLine,
  step,
  type SignedInPerson,
} from "./support/workflow";

// Its people hold the review workflow's steps, which every note's "waiting for" names.
test.describe.configure({ lock: [LOCK.reviewWorkflow] });

test("a reviewer who may only read and approve opens the note read-only and approves it", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await resetReviewSettings(page);
  const reviewer = await signInAs(
    browser,
    page.request,
    baseURL ?? "",
    "readAndApprove"
  );
  try {
    const stamp = Date.now().toString(36);
    const id = await reviewedNote(page, stamp);
    await step(page, id, "submit");

    await openNote(reviewer.page, id);
    // Read-only: the fields can't be changed, and there is nothing to save.
    await expect(
      reviewer.page.getByRole("textbox", { name: "Summary" })
    ).not.toBeEditable();
    await expect(reviewer.page.locator('[data-action="save"]')).toHaveCount(0);
    // A step stores nothing of the form, so it leads for a reviewer who may not edit.
    await expect(leading(reviewer.page)).toHaveAttribute(
      "data-action",
      "review-step:approve"
    );
    await expect(leading(reviewer.page)).toHaveText("Approve");
    await expectEditorAccessible(reviewer.page);

    await leading(reviewer.page).click();
    await expectStage(reviewer, id, "approved");
    await expect(statusLine(reviewer.page)).toHaveText("Draft · Approved");
  } finally {
    await reviewer.close();
  }
});

test("a reviewer opens a submitted note at its changes and approves what they read", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await resetReviewSettings(page);
  const people: SignedInPerson[] = [];
  try {
    const reviewer = await signInAs(
      browser,
      page.request,
      baseURL ?? "",
      "reviewer"
    );
    people.push(reviewer);
    const publisher = await signInAs(
      browser,
      page.request,
      baseURL ?? "",
      "publisher"
    );
    people.push(publisher);

    // A note approved and published once, then changed and sent for review again: the change
    // is what the reviewer judges, against the published version.
    const stamp = Date.now().toString(36);
    const id = await reviewedNote(page, stamp, {
      summary: `The published summary, ${stamp}.`,
    });
    await step(page, id, "submit");
    await step(page, id, "approve");
    const published = await page.request.patch(`${NOTES}/${id}`, {
      // A write names the version it changes; seeding replaces whatever is stored.
      data: { status: "published", _overwrite: true },
    });
    expect(published.ok(), await published.text()).toBe(true);
    await expectStage(page, id, null);
    const changed = await page.request.patch(`${NOTES}/${id}`, {
      data: {
        summary: `The summary under review, ${stamp}.`,
        _overwrite: true,
      },
    });
    expect(changed.ok(), await changed.text()).toBe(true);
    await step(page, id, "submit");

    // The reviewer opens it at its changes, compared with the published version.
    await openNote(reviewer.page, id);
    const changes = reviewer.page.getByRole("region", {
      name: "Changes to review",
    });
    await expect(changes).toBeVisible();
    await expect(
      changes.getByText("Changes since the published version.")
    ).toBeVisible();
    // The comparison draws the changed summary, word by word: its new words are on screen.
    const comparison = changes
      .getByText("under review", { exact: false })
      .first();
    await expect(comparison).toBeVisible();
    await expectNoAxeViolations(reviewer.page, {
      include: 'section[aria-labelledby="review-changes-heading"]',
    });
    // The comparison can be put away and brought back.
    await changes.getByRole("button", { name: "Hide changes" }).click();
    await expect(comparison).toBeHidden();
    await changes.getByRole("button", { name: "Show changes" }).click();
    await expect(
      changes.getByText("under review", { exact: false }).first()
    ).toBeVisible();

    // What they read is what they approve.
    await expect(leading(reviewer.page)).toHaveAttribute(
      "data-action",
      "review-step:approve"
    );
    await leading(reviewer.page).click();
    await expectStage(reviewer, id, "approved");
    await expect(statusLine(reviewer.page)).toHaveText(
      "Published · Changes approved"
    );

    // The reviewer leaves, so the publisher finds the note free; approved,
    // the publisher's Publish is no longer held.
    await leaveNote(reviewer, page, id);
    await openNote(publisher.page, id);
    const publish = publishControl(publisher.page);
    await expect(publish).toBeVisible();
    await expect(publish).not.toHaveAttribute("data-review-held");
    await expectEditorAccessible(publisher.page);
  } finally {
    for (const person of people) await person.close();
  }
});
