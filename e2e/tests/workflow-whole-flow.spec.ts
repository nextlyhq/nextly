/**
 * A note through the review workflow, each step taken in a real browser by the person whose
 * step it is: a writer submits it, a reviewer approves it, and a publisher publishes it. The
 * header leads with each person's next step, the line under the title says where the note
 * stands, and the publisher's Publish is held, with why, until the note is approved. Each
 * screen on the way is held to WCAG 2.2 AA.
 */
import { expect } from "@playwright/test";

import { LOCK } from "./support/locks";
import { test } from "./support/test";
import {
  expectEditorAccessible,
  expectPublishHeldForReview,
  expectStage,
  leading,
  leaveNote,
  NOTES,
  openNote,
  publishControl,
  resetReviewSettings,
  reviewAnnouncer,
  reviewedNote,
  signInAs,
  statusLine,
  stepControl,
  type SignedInPerson,
} from "./support/workflow";

// Its people hold the review workflow's steps, which every note's "waiting for" names.
test.describe.configure({ lock: [LOCK.reviewWorkflow] });

test("a writer submits, a reviewer approves, and a publisher publishes, Publish held until the approval", async ({
  page,
  browser,
  baseURL,
}) => {
  // Three people signed in, and each opens the note at least once.
  test.setTimeout(180_000);
  await resetReviewSettings(page);
  const people: SignedInPerson[] = [];
  try {
    const writer = await signInAs(
      browser,
      page.request,
      baseURL ?? "",
      "writer"
    );
    people.push(writer);
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

    const stamp = Date.now().toString(36);
    const id = await reviewedNote(writer, stamp);

    // The writer: the note is drafting, and Submit for review leads.
    await openNote(writer.page, id);
    // Drafting waits for whoever may submit it, so the line names them too.
    await expect(statusLine(writer.page)).toHaveText(/^Draft · Drafting\b/);
    // The stage is words with the shape of its kind, never a button.
    await expect(
      statusLine(writer.page).locator('[data-stage-shape="drafting"]')
    ).toHaveText("Drafting");
    await expect(statusLine(writer.page).getByRole("button")).toHaveCount(0);
    await expect(leading(writer.page)).toHaveAttribute(
      "data-action",
      "review-step:submit"
    );
    await expect(leading(writer.page)).toHaveText("Submit for review");
    // A writer may not publish, so Publish is not drawn at all.
    await expect(publishControl(writer.page)).toHaveCount(0);
    await expectEditorAccessible(writer.page);
    await leading(writer.page).click();
    await expect(reviewAnnouncer(writer.page)).toHaveText(
      "Submit for review: done."
    );
    await expectStage(writer, id, "inReview");
    await expect(statusLine(writer.page)).toContainText(
      "Draft · In review · waiting for "
    );
    // Each person leaves the note before the next opens it, which would
    // otherwise find it held and open it read-only.
    await leaveNote(writer, page, id);

    // The publisher, before the approval: Publish leads, held with the stage and who it waits for.
    await openNote(publisher.page, id);
    await expect(publishControl(publisher.page)).toHaveAttribute(
      "data-primary",
      "true"
    );
    await expectEditorAccessible(publisher.page);
    await expectPublishHeldForReview(
      publisher.page,
      /^Needs approval: In review, waiting for /
    );
    await leaveNote(publisher, page, id);

    // The reviewer: Approve leads, with Request changes beside it.
    await openNote(reviewer.page, id);
    await expect(leading(reviewer.page)).toHaveAttribute(
      "data-action",
      "review-step:approve"
    );
    await expect(stepControl(reviewer.page, "requestChanges")).toBeVisible();
    await expectEditorAccessible(reviewer.page);
    await leading(reviewer.page).click();
    // Said to assistive technology, not only in a toast.
    await expect(reviewAnnouncer(reviewer.page)).toHaveText("Approve: done.");
    await expectStage(reviewer, id, "approved");
    // Approved allows publishing, so nobody is waited for any more.
    await expect(statusLine(reviewer.page)).toHaveText("Draft · Approved");
    await leaveNote(reviewer, page, id);

    // The publisher, once it is approved: Publish leads and runs.
    await openNote(publisher.page, id, "dark");
    await expect(statusLine(publisher.page)).toHaveText("Draft · Approved");
    const publish = publishControl(publisher.page);
    await expect(publish).toBeEnabled();
    await expectEditorAccessible(publisher.page);
    await publish.click();
    await expect
      .poll(
        async () => {
          const read = await page.request.get(`${NOTES}/${id}`);
          return ((await read.json()) as { status?: string }).status;
        },
        { message: "the note is live", timeout: 30_000 }
      )
      .toBe("published");
    // Live with nothing waiting: no stage, and no line under the title.
    await expectStage(page, id, null);
    await expect(statusLine(publisher.page)).toHaveCount(0);
  } finally {
    for (const person of people) await person.close();
  }
});
