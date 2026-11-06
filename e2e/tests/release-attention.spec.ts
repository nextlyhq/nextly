/**
 * What a stopped or overdue release asks of people, in a real browser: the
 * strip at the top of the Releases page names each one, linked to its page,
 * and leads to the Needs attention tab; and the owner of an overdue release is
 * told in their own bell, where nobody else's notices appear.
 *
 * Releases are left as the release runner would leave them (see
 * `./support/release-states`), and the notices are the runner's own: a pass of
 * it tells each overdue release's owner before it runs anything.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import {
  leaveReleasesAsTheRunnerWould,
  type RunnerOutcome,
} from "./support/release-states";
import {
  cancel,
  post,
  publishNow,
  release,
  schedule,
} from "./support/releases-api";
import { test } from "./support/test";

// Publish now runs the release runner, which runs every overdue release it
// finds, and this spec both leaves overdue releases and runs a pass.
test.describe.configure({ lock: [LOCK.releases] });

const DAY = 24 * 60 * 60 * 1000;

/**
 * What an owner of a release needs to make one of posts and to read the
 * notices about it: a release notice is shown only to a reader of releases.
 */
const OWNER = [
  "read-content-releases",
  "create-content-releases",
  "read-posts",
  "update-posts",
  "publish-posts",
  "unpublish-posts",
];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("the Releases page's strip names each stopped and overdue release, linked, and leads to Needs attention", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const postId = await post(page, stamp);
  const seeded: Array<{ id: string; outcome: RunnerOutcome; title: string }> =
    [];
  for (const outcome of ["overdue", "stopped"] as const) {
    const title = `Strip e2e ${outcome} ${stamp}`;
    const id = await release(page, title, postId);
    await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
    seeded.push({ id, outcome, title });
  }
  await leaveReleasesAsTheRunnerWould(page, seeded);

  try {
    await gotoAdmin(page, "/releases");
    const strip = page.getByRole("region", {
      name: /^\d+ releases? needs? attention$/,
    });
    await expect(strip).toBeVisible();
    for (const { id, outcome, title } of seeded) {
      const named = strip.getByRole("link", { name: title });
      await expect(named).toHaveAttribute(
        "href",
        new RegExp(`/admin/releases/${id}$`)
      );
      // `has` is asked inside each item, so it names the link from the page.
      await expect(
        strip
          .getByRole("listitem")
          .filter({ has: page.getByRole("link", { name: title }) })
      ).toContainText(outcome === "stopped" ? "Stopped" : "Overdue");
    }

    await strip
      .getByRole("link", { name: "View all in Needs attention" })
      .click();
    await expect(page).toHaveURL(/\/admin\/releases\?tab=attention$/);
    await expect(
      page.getByRole("tab", { name: /^Needs attention/ })
    ).toHaveAttribute("aria-selected", "true");
  } finally {
    // Left as they were found: a stopped or overdue release of this spec's
    // would show in every later spec's strip and card.
    for (const { id } of seeded) await cancel(page, id).catch(() => undefined);
  }
});

/** Opens a person's bell on their dashboard and answers its "For you" section. */
async function forYouOf(owner: LimitedUser): Promise<{
  page: Page;
  forYou: ReturnType<Page["getByRole"]>;
}> {
  const page = await owner.context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "");
  await page.getByTestId("notification-bell").click();
  const forYou = page.getByRole("region", { name: "For you" });
  await expect(forYou).toBeVisible();
  return { page, forYou };
}

test("each owner of an overdue release is told in their own bell, and sees no one else's notice", async ({
  page,
  browser,
  baseURL,
}) => {
  // Two people signed in, two releases, a pass of the runner, two bells.
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const owners: LimitedUser[] = [];
  const seeded: Array<{ id: string; title: string; owner: LimitedUser }> = [];
  try {
    for (let n = 1; n <= 2; n += 1) {
      owners.push(
        await signInAsLimitedUser(browser, page.request, baseURL ?? "", OWNER)
      );
    }
    for (const [index, owner] of owners.entries()) {
      const postId = await post(page, `${stamp}-${index + 1}`);
      const title = `Notice e2e ${index + 1} ${stamp}`;
      // Made by its owner, who is the one a notice about it goes to.
      const id = await release(
        { request: owner.context.request },
        title,
        postId
      );
      seeded.push({ id, title, owner });
    }
    // Scheduled by the super-admin, as the owners may not schedule: who
    // schedules a release does not change whose it is.
    for (const { id } of seeded) {
      await schedule(page, id, new Date(Date.now() + 40 * DAY), "UTC");
    }
    await leaveReleasesAsTheRunnerWould(
      page,
      seeded.map(({ id }) => ({ id, outcome: "overdue" as const }))
    );

    // A pass of the runner tells each overdue release's owner before it runs
    // anything, and Publish now runs one.
    const trigger = await release(
      page,
      `Notice e2e pass ${stamp}`,
      await post(page, `${stamp}-pass`)
    );
    await publishNow(page, trigger);

    for (const [index, mine] of seeded.entries()) {
      const theirs = seeded[1 - index];
      const { page: ownerPage, forYou } = await forYouOf(mine.owner);
      await expect(
        forYou.getByRole("link", {
          name: new RegExp(`“${mine.title}” missed its time`),
        })
      ).toHaveAttribute("href", new RegExp(`/admin/releases/${mine.id}$`));
      await expect(forYou).not.toContainText(theirs.title);
      await ownerPage.close();
    }
  } finally {
    for (const { id } of seeded) await cancel(page, id).catch(() => undefined);
    for (const owner of owners) await owner.context.close();
  }
});
