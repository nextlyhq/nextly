/**
 * Needs your attention draws the open work waiting for its reader, and only
 * while something is.
 *
 * A stopped and an overdue release are left as the release runner would leave
 * them. The card then draws a critical row for each, with its reason, and each
 * Review opens Releases' Needs attention tab narrowed to that row's part. A
 * reader who may not read releases has nothing waiting, so their dashboard
 * draws no card at all, rather than one that says all is clear.
 *
 * Other specs leave their own stopped and overdue releases in the shared
 * database, so the spec finds its rows by label and reads no exact count.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import {
  leaveReleasesAsTheRunnerWould,
  type RunnerOutcome,
} from "./support/release-states";
import { cancel, post, release, schedule } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.releases] });

const CARD = "core/needs-attention";
const DAY = 24 * 60 * 60 * 1000;

test("rows for stopped and overdue releases, each with its reason and Review; no card for a reader of no releases", async ({
  page,
  browser,
  baseURL,
}) => {
  const stamp = Date.now().toString(36);
  const postId = await post(page, stamp);
  const seeded: Array<{ id: string; outcome: RunnerOutcome }> = [];
  for (const outcome of ["overdue", "stopped"] as const) {
    const id = await release(page, `Attention e2e ${outcome} ${stamp}`, postId);
    await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
    seeded.push({ id, outcome });
  }
  await leaveReleasesAsTheRunnerWould(page, seeded);

  try {
    await gotoAdmin(page, "");
    const card = page.getByTestId(`widget-cell-${CARD}`);
    await expect(card).toBeVisible();
    const row = (label: string) =>
      card.getByTestId("needs-attention-item").filter({ hasText: label });

    const stopped = row("Releases that stopped");
    await expect(stopped).toContainText("A scheduled publish failed.");
    await expect(stopped.getByTestId("needs-attention-critical")).toBeVisible();
    const overdue = row("Overdue releases");
    await expect(overdue).toContainText("Still scheduled after its time.");
    await expect(overdue.getByTestId("needs-attention-critical")).toBeVisible();
    // Nothing on the card dismisses an item.
    await expect(
      card.getByRole("button", { name: /dismiss|mark/i })
    ).toHaveCount(0);

    await overdue
      .getByRole("link", { name: "Review overdue releases" })
      .click();
    await expect(page).toHaveURL(
      /\/admin\/releases\?tab=attention&reason=overdue$/
    );

    // A reader of posts only: no release kind is theirs, and no plugin item
    // is declared, so nothing waits for them and the card is not drawn.
    const reader = await signInAsLimitedUser(
      browser,
      page.request,
      baseURL ?? "",
      ["read-posts"]
    );
    try {
      const theirs = await reader.context.newPage();
      await gotoAdmin(theirs, "");
      // Their dashboard has drawn: a card every reader is shown is there.
      await expect(
        theirs.getByTestId("widget-cell-core/recently-edited")
      ).toBeVisible();
      await expect(theirs.getByTestId(`widget-cell-${CARD}`)).toBeHidden();
      await expect(theirs.getByText("All clear")).toHaveCount(0);
    } finally {
      await reader.context.close();
    }
  } finally {
    // Left as they were found: a stopped or overdue release of this spec's
    // would show the card on every later spec's dashboard.
    for (const { id } of seeded) await cancel(page, id);
  }
});
