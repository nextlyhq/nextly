/**
 * An edit after approval, in a real browser. An approval covers exactly the content approved:
 * a writer who changes an approved note and saves it sends it back to In review, the
 * publisher's Publish is held again, and the history says the approval was withdrawn by that
 * edit. A save that changes nothing keeps the approval. The editor and its history, with the
 * workflow's events in it, are held to WCAG 2.2 AA.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import {
  expectEditorAccessible,
  expectStage,
  expectPublishHeldForReview,
  NOTES,
  openNote,
  resetReviewSettings,
  reviewedNote,
  sharedPartOf,
  signInAs,
  statusLine,
  step,
  type SignedInPerson,
} from "./support/workflow";

// Its people hold the review workflow's steps, which every note's "waiting for" names.
test.describe.configure({ lock: [LOCK.reviewWorkflow] });

test("an edit to an approved note sends it back to review and holds Publish, and the history says so", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
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
    const publisher = await signInAs(
      browser,
      page.request,
      baseURL ?? "",
      "publisher"
    );
    people.push(publisher);

    const stamp = Date.now().toString(36);
    const id = await reviewedNote(writer, stamp);
    await step(writer, id, "submit");
    // The file's own account approves: it holds every step.
    await step(page, id, "approve");
    await expectStage(page, id, "approved");

    // The writer changes the approved note and saves it.
    await openNote(writer.page, id);
    await expect(statusLine(writer.page)).toHaveText("Draft · Approved");
    await writer.page
      .getByRole("textbox", { name: "Summary" })
      .fill(`Changed after the approval, ${stamp}.`);
    await writer.page.locator('[data-action="save"]').click();
    await expectStage(writer, id, "inReview");
    await expect(statusLine(writer.page)).toContainText(
      "Draft · In review · waiting for "
    );
    expect((await sharedPartOf(writer, id)).approval).toBeNull();

    // The publisher's Publish is held again, with why.
    await openNote(publisher.page, id);
    await expectPublishHeldForReview(
      publisher.page,
      /^Needs approval: In review\b/
    );

    // The history names the withdrawal among the workflow's events.
    await gotoAdmin(writer.page, `/collections/reviewed-notes/${id}?history=1`);
    const history = writer.page
      .locator("[data-history-panel]")
      .getByRole("list", { name: "History, newest first" });
    await expect(history).toBeVisible({ timeout: 30_000 });
    await expect(history).toContainText(/approval withdrawn/i);
    await expectNoAxeViolations(writer.page, {
      include: "[data-history-panel]",
    });
    await expectEditorAccessible(writer.page);

    // Approved again, a save that changes nothing keeps the approval.
    await step(page, id, "approve");
    await expectStage(page, id, "approved");
    const current = await page.request.get(`${NOTES}/${id}?status=all`);
    const { title, summary } = (await current.json()) as {
      title: string;
      summary: string;
    };
    const saved = await writer.request.patch(`${NOTES}/${id}`, {
      data: { title, summary },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const after = await sharedPartOf(writer, id);
    expect(after.stage).toBe("approved");
    expect(after.approval).not.toBeNull();
  } finally {
    for (const person of people) await person.close();
  }
});
