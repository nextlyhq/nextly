/**
 * Asking for changes, and the writer answering them, in a real browser. The reviewer's Request
 * changes asks for a comment first, the comment taking focus and the send held while it is
 * empty; sent, the note goes back to Drafting with the comment, which the writer reads on the
 * note before changing it and submitting it again. The dialog and the editor on each side are
 * held to WCAG 2.2 AA.
 */
import { expect } from "@playwright/test";

import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import {
  expectEditorAccessible,
  expectStage,
  leading,
  NOTES,
  openNote,
  resetReviewSettings,
  reviewedNote,
  signInAs,
  statusLine,
  step,
  stepControl,
  type SignedInPerson,
} from "./support/workflow";

// Its people hold the review workflow's steps, which every note's "waiting for" names.
test.describe.configure({ lock: [LOCK.reviewWorkflow] });

const COMMENT = "Shorten the intro to two sentences.";

test("a reviewer asks for changes with a comment, and the writer changes the note and submits it again", async ({
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
    const reviewer = await signInAs(
      browser,
      page.request,
      baseURL ?? "",
      "reviewer"
    );
    people.push(reviewer);

    const stamp = Date.now().toString(36);
    const id = await reviewedNote(writer, stamp);
    await step(writer, id, "submit");

    // The reviewer asks for changes: a comment is asked for first.
    await openNote(reviewer.page, id);
    await stepControl(reviewer.page, "requestChanges").click();
    const dialog = reviewer.page.getByRole("dialog", {
      name: "Request changes",
    });
    await expect(dialog).toBeVisible();
    const comment = dialog.getByRole("textbox", { name: "Comment" });
    // The dialog takes focus, on the comment it asks for.
    await expect(comment).toBeFocused();
    const send = dialog.getByRole("button", { name: "Request changes" });
    // Nothing to send yet: a request for changes always says what.
    await expect(send).toBeDisabled();
    await comment.fill("   ");
    await expect(send).toBeDisabled();
    await expectNoAxeViolations(reviewer.page, { include: '[role="dialog"]' });
    await comment.fill(COMMENT);
    await send.click();
    await expect(dialog).toBeHidden();
    await expectStage(reviewer, id, "drafting");
    await expect(statusLine(reviewer.page)).toHaveText(/^Draft · Drafting\b/);

    // The writer reads the comment on the note, in the side panel's Review section.
    await openNote(writer.page, id);
    const review = writer.page.getByRole("region", { name: "Review" });
    await expect(review).toContainText(`“${COMMENT}”`);
    await expectEditorAccessible(writer.page);

    // Changes it, saves it, and submits it again.
    const summary = writer.page.getByRole("textbox", { name: "Summary" });
    await summary.fill(`Two sentences now, ${stamp}.`);
    await writer.page.locator('[data-action="save"]').click();
    await expect
      .poll(
        async () => {
          const read = await page.request.get(`${NOTES}/${id}?status=all`);
          return ((await read.json()) as { summary?: string }).summary;
        },
        { message: "the change is saved", timeout: 30_000 }
      )
      .toBe(`Two sentences now, ${stamp}.`);
    await expect(leading(writer.page)).toHaveAttribute(
      "data-action",
      "review-step:submit"
    );
    await expect(leading(writer.page)).toBeEnabled();
    await leading(writer.page).click();
    await expectStage(writer, id, "inReview");
    await expect(statusLine(writer.page)).toContainText(
      "Draft · In review · waiting for "
    );
  } finally {
    for (const person of people) await person.close();
  }
});
