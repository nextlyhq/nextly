/**
 * The reviewer's path, in a real browser. A reviewer who may approve but never change the
 * content opens a submitted note read-only, with nothing to save, and Approve leading; approving
 * it moves it to Approved. The read-only editor is held to WCAG 2.2 AA.
 */
import { expect } from "@playwright/test";

import { LOCK } from "./support/locks";
import { test } from "./support/test";
import {
  expectEditorAccessible,
  expectStage,
  leading,
  openNote,
  resetReviewSettings,
  reviewedNote,
  signInAs,
  statusLine,
  step,
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

// The changes a reviewer is asked to approve, compared with the last published version, are
// not drawn on the editor yet; this path is written once they are.
test.fixme(
  "a reviewer opens a submitted note at its changes and approves what they read",
  () => {}
);
