/**
 * Publishing without review, in a real browser. A person holding `publish-without-review` is
 * offered it from "Ready to publish?", asked for a reason (the publish held while there is
 * none), and the note goes live with the reason kept in its history. A publisher without that
 * permission is never offered it. "Ready to publish?" and the reason step are held to
 * WCAG 2.2 AA.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import {
  leaveNote,
  NOTES,
  openNote,
  resetReviewSettings,
  reviewedNote,
  signInAs,
  type SignedInPerson,
} from "./support/workflow";

// Its people hold the review workflow's steps, which every note's "waiting for" names.
test.describe.configure({ lock: [LOCK.reviewWorkflow] });

const REASON =
  "The embargo lifts at noon and legal approved the copy by phone.";

/** Opens "Choose what to publish…" from the arrow beside the leading action. */
async function readyToPublish(page: Page) {
  await page.getByRole("button", { name: "More ways to publish" }).click();
  await page.getByRole("menuitem", { name: "Choose what to publish…" }).click();
  const dialog = page.locator("[data-publish-parts-dialog]");
  await expect(
    dialog.getByRole("region", { name: "Ready to publish?" })
  ).toBeVisible();
  return dialog;
}

test("a person who may publish without review gives a reason and publishes; a publisher who may not is never offered it", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
  await resetReviewSettings(page);
  const people: SignedInPerson[] = [];
  try {
    const emergency = await signInAs(
      browser,
      page.request,
      baseURL ?? "",
      "emergency"
    );
    people.push(emergency);
    const publisher = await signInAs(
      browser,
      page.request,
      baseURL ?? "",
      "publisher"
    );
    people.push(publisher);

    const stamp = Date.now().toString(36);
    // In Drafting: nothing of it has been submitted, let alone approved.
    const id = await reviewedNote(page, stamp);

    // A publisher without the permission sees what holds the note, and no way past it.
    await openNote(publisher.page, id);
    const refused = await readyToPublish(publisher.page);
    await expect(refused).toContainText("not approved");
    await expect(
      refused.getByRole("button", { name: "Publish without review…" })
    ).toHaveCount(0);
    await expectNoAxeViolations(publisher.page, {
      include: "[data-publish-parts-dialog]",
    });
    // The publisher leaves, so the next person finds the note free.
    await leaveNote(publisher, page, id);

    // The person who holds it is offered it, and asked why.
    await openNote(emergency.page, id);
    const dialog = await readyToPublish(emergency.page);
    await dialog
      .getByRole("button", { name: "Publish without review…" })
      .click();
    const reason = dialog.getByRole("textbox", { name: "Reason" });
    await expect(reason).toBeVisible();
    const publish = dialog.getByRole("button", {
      name: "Publish without review",
      exact: true,
    });
    // No reason, no publish: whitespace is no reason either.
    await expect(publish).toBeDisabled();
    await reason.fill("   ");
    await expect(publish).toBeDisabled();
    await expectNoAxeViolations(emergency.page, {
      include: "[data-publish-parts-dialog]",
    });
    await reason.fill(REASON);
    await publish.click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const read = await page.request.get(`${NOTES}/${id}`);
          return ((await read.json()) as { status?: string }).status;
        },
        { message: "the note is live", timeout: 30_000 }
      )
      .toBe("published");

    // The history keeps the publish past the workflow, with its reason.
    await gotoAdmin(
      emergency.page,
      `/collections/reviewed-notes/${id}?history=1`
    );
    const history = emergency.page
      .locator("[data-history-panel]")
      .getByRole("list", { name: "History, newest first" });
    await expect(history).toBeVisible({ timeout: 30_000 });
    await expect(history).toContainText(/published without review/i);
    await expect(history).toContainText(REASON);
  } finally {
    for (const person of people) await person.close();
  }
});
