/**
 * Workflows by keyboard alone, one person at a time, with focus shown at every stop:
 *
 * - a writer reaches Submit for review by Tab and submits with Enter;
 * - a reviewer assigns the note to themself and unassigns it from the Review section, focus
 *   staying on the press that replaces the one pressed; opens Request changes, leaves it with
 *   Escape (focus back on the press), then sends a comment, focus landing in the editor;
 * - a publisher reaches the held Publish, hears why it is held, opens "Ready to publish?" with
 *   Enter and leaves it with Escape; once the note is approved, publishes it with Enter;
 * - a person who may publish without review opens "Choose what to publish…" from the arrow's
 *   menu, gives a reason and publishes.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { LOCK } from "./support/locks";
import { test } from "./support/test";
import {
  expectStage,
  leaveNote,
  NOTES,
  openNote,
  publishControl,
  resetReviewSettings,
  reviewAnnouncer,
  reviewedNote,
  signInAs,
  step,
  stepControl,
  type SignedInPerson,
} from "./support/workflow";

// Its people hold the review workflow's steps, which every note's "waiting for" names.
test.describe.configure({ lock: [LOCK.reviewWorkflow] });

/** What has the keyboard's focus, by its accessible name or text, for a failure's trail. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    return (
      element?.getAttribute("aria-label") ??
      element?.textContent?.trim().slice(0, 40) ??
      ""
    );
  });
}

/** Whether `target` holds the keyboard's focus now. */
async function focused(target: Locator): Promise<boolean> {
  if ((await target.count()) === 0) return false;
  return target
    .first()
    .evaluate(node => node === document.activeElement, undefined, {
      timeout: 2_000,
    });
}

/** Tab (or Shift+Tab) until `target` has focus, and check focus is shown there. */
async function tabTo(
  page: Page,
  target: Locator,
  direction: "forward" | "back" = "forward"
): Promise<void> {
  const key = direction === "forward" ? "Tab" : "Shift+Tab";
  // The last stops, so a failure says where focus went instead.
  const trail: string[] = [];
  for (let presses = 0; presses < 150; presses += 1) {
    if (await focused(target)) {
      await expectFocusShown(page);
      return;
    }
    trail.push(await focusedName(page));
    await page.keyboard.press(key);
  }
  throw new Error(
    `Tab never reached ${target.toString()}; last stops: ${trail.slice(-12).join(" | ")}`
  );
}

/** Starts the keyboard from the top of the page, as a person arriving would. */
async function fromTheTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

/** The focused element shows it: it matches `:focus-visible`, as a keyboard move leaves it. */
async function expectFocusShown(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.matches(":focus-visible") ?? false
      )
    )
    .toBe(true);
}

/** Focus is somewhere in the editor's header or side panel, never dropped to the page. */
async function expectFocusKeptInEditor(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const element = document.activeElement;
        if (element === null || element === document.body) return false;
        return (
          element.closest(
            '[data-testid="document-bar"], [data-testid="document-panel-sections"]'
          ) !== null
        );
      })
    )
    .toBe(true);
}

/** Polls the note until it is live. */
async function expectLive(by: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const read = await by.request.get(`${NOTES}/${id}`);
        return ((await read.json()) as { status?: string }).status;
      },
      { message: `the note ${id} is live`, timeout: 30_000 }
    )
    .toBe("published");
}

const COMMENT = "Name the source of the figure in the second paragraph.";
const REASON = "The correction must be live before the morning briefing.";

test("each person's part of a workflow is done by keyboard alone, with focus shown and kept", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await resetReviewSettings(page);
  const people: SignedInPerson[] = [];
  const signIn = async (who: Parameters<typeof signInAs>[3]) => {
    const person = await signInAs(browser, page.request, baseURL ?? "", who);
    people.push(person);
    return person;
  };
  try {
    const writer = await signIn("writer");
    const reviewer = await signIn("reviewer");
    const publisher = await signIn("publisher");
    const emergency = await signIn("emergency");
    const stamp = Date.now().toString(36);

    // The writer submits by keyboard.
    const id = await reviewedNote(writer, `keys ${stamp}`);
    await openNote(writer.page, id);
    await fromTheTop(writer.page);
    await tabTo(writer.page, stepControl(writer.page, "submit"));
    await writer.page.keyboard.press("Enter");
    await expect(reviewAnnouncer(writer.page)).toHaveText(
      "Submit for review: done."
    );
    await expectStage(writer, id, "inReview");
    await leaveNote(writer, page, id);

    // The reviewer assigns the note to themself, then unassigns it, from the Review section.
    await openNote(reviewer.page, id);
    const review = reviewer.page.getByRole("region", { name: "Review" });
    await fromTheTop(reviewer.page);
    await tabTo(
      reviewer.page,
      review.getByRole("button", { name: "Assign to me" })
    );
    await reviewer.page.keyboard.press("Enter");
    const unassign = review.getByRole("button", { name: "Unassign" });
    await expect(unassign).toBeVisible();
    // The press gave way to the one that undoes it, and focus went with it.
    await expect.poll(() => focused(unassign)).toBe(true);
    await reviewer.page.keyboard.press("Enter");
    const assign = review.getByRole("button", { name: "Assign to me" });
    await expect(assign).toBeVisible();
    await expect.poll(() => focused(assign)).toBe(true);

    // Request changes: opened and left with Escape, focus back on it; then sent with a comment.
    const requestChanges = stepControl(reviewer.page, "requestChanges");
    await tabTo(reviewer.page, requestChanges, "back");
    await reviewer.page.keyboard.press("Enter");
    const dialog = reviewer.page.getByRole("dialog", {
      name: "Request changes",
    });
    await expect(dialog).toBeVisible();
    const comment = dialog.getByRole("textbox", { name: "Comment" });
    await expect(comment).toBeFocused();
    await reviewer.page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => focused(requestChanges)).toBe(true);
    await reviewer.page.keyboard.press("Enter");
    await expect(comment).toBeFocused();
    await reviewer.page.keyboard.type(COMMENT);
    await tabTo(
      reviewer.page,
      dialog.getByRole("button", { name: "Request changes" })
    );
    await reviewer.page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expectStage(reviewer, id, "drafting");
    // The press that opened it is gone with the stage: focus lands in the editor, not the page.
    await expectFocusKeptInEditor(reviewer.page);
    await leaveNote(reviewer, page, id);

    // The publisher, on a note in review: the held Publish is reached and says why.
    const held = await reviewedNote(writer, `keys held ${stamp}`);
    await step(writer, held, "submit");
    await openNote(publisher.page, held);
    const publish = publishControl(publisher.page);
    await fromTheTop(publisher.page);
    await tabTo(publisher.page, publish);
    await expect(publish).toHaveAccessibleDescription(/^Needs approval: /);
    await publisher.page.keyboard.press("Enter");
    const ready = publisher.page
      .locator("[data-publish-parts-dialog]")
      .getByRole("region", { name: "Ready to publish?" });
    await expect(ready).toBeVisible();
    await publisher.page.keyboard.press("Escape");
    await expect(ready).toBeHidden();
    await expect.poll(() => focused(publish)).toBe(true);
    await leaveNote(publisher, page, held);

    // Approved, Publish runs with Enter.
    await step(reviewer, held, "approve");
    await expectStage(page, held, "approved");
    await openNote(publisher.page, held);
    await fromTheTop(publisher.page);
    await tabTo(publisher.page, publishControl(publisher.page));
    await expect(publishControl(publisher.page)).not.toHaveAttribute(
      "data-review-held"
    );
    await publisher.page.keyboard.press("Enter");
    await expectLive(page, held);
    await leaveNote(publisher, page, held);

    // Publishing without review: from the arrow's menu, with a reason.
    const urgent = await reviewedNote(writer, `keys urgent ${stamp}`);
    await openNote(emergency.page, urgent);
    await fromTheTop(emergency.page);
    await tabTo(
      emergency.page,
      emergency.page.getByRole("button", { name: "More ways to publish" })
    );
    await emergency.page.keyboard.press("Enter");
    const choose = emergency.page.getByRole("menuitem", {
      name: "Choose what to publish…",
    });
    await expect(choose).toBeVisible();
    for (let presses = 0; presses < 12 && !(await focused(choose)); presses++) {
      await emergency.page.keyboard.press("ArrowDown");
    }
    await expect.poll(() => focused(choose)).toBe(true);
    await emergency.page.keyboard.press("Enter");
    const parts = emergency.page.locator("[data-publish-parts-dialog]");
    await expect(
      parts.getByRole("region", { name: "Ready to publish?" })
    ).toBeVisible();
    await tabTo(
      emergency.page,
      parts.getByRole("button", { name: "Publish without review…" })
    );
    await emergency.page.keyboard.press("Enter");
    const reason = parts.getByRole("textbox", { name: "Reason" });
    await expect(reason).toBeVisible();
    await tabTo(emergency.page, reason);
    await emergency.page.keyboard.type(REASON);
    await tabTo(
      emergency.page,
      parts.getByRole("button", {
        name: "Publish without review",
        exact: true,
      })
    );
    await emergency.page.keyboard.press("Enter");
    await expectLive(page, urgent);
  } finally {
    for (const person of people) await person.close();
  }
});
