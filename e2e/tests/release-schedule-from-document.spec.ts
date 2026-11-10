/**
 * Scheduling a document from its editor, in a real browser: the Publish
 * split's arrow offers Publish now and Schedule…, and one dialog puts the
 * document on its own at a time, with an existing release, or in a new one,
 * to go live or come down. The banner above the document then lists each
 * release holding it, with what the reader may do to each.
 *
 * Each test writes releases of its own, named with a stamp, and cancels what
 * it scheduled, so the database the suite shares is left as it was found.
 */
import { expect, type Page, type Response } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import {
  cancel,
  membersOf,
  ok,
  post,
  readRelease,
  release,
  schedule,
  scheduleDocument,
} from "./support/releases-api";
import { test } from "./support/test";

const API = "/admin/api";

/** A stamp of this test's own. */
const stamped = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** A post of this spec's own, opened in its editor. */
async function openPost(page: Page, title: string, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/posts/${id}`);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true })
  ).toHaveValue(title, { timeout: 30_000 });
}

/** Opens Schedule… from the Publish split's arrow. */
async function openSchedule(page: Page, title: string) {
  await page.getByRole("button", { name: "More ways to publish" }).click();
  await page.getByRole("menuitem", { name: "Schedule…" }).click();
  const dialog = page.getByRole("dialog", { name: `Schedule “${title}”` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The schedule-document answer, awaited from the click that sends it. */
function scheduleAnswer(page: Page): Promise<Response> {
  return page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/releases/schedule-document")
  );
}

/** The id of the release a schedule made or joined, or undefined. */
async function releaseIdOf(response: Response): Promise<string | undefined> {
  if (!response.ok()) return undefined;
  const answer = (await response.json().catch(() => null)) as {
    item?: { release?: { id?: unknown } };
  } | null;
  const id = answer?.item?.release?.id;
  return typeof id === "string" ? id : undefined;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("offers Publish now and Schedule… on the Publish split", async ({
  page,
}) => {
  const stamp = stamped();
  const id = await post(page, stamp);
  await openPost(page, `Release e2e ${stamp}`, id);
  await page.getByRole("button", { name: "More ways to publish" }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Publish now",
    "Schedule…",
  ]);
  await page.keyboard.press("Escape");
  // Add to release no longer sits in More.
  await page.getByRole("button", { name: /more actions/i }).click();
  await expect(
    page.getByRole("menuitem", { name: /add to release/i })
  ).toHaveCount(0);
});

test("holds focus in the Schedule dialog, gives it back on Escape, and passes axe", async ({
  page,
}) => {
  const stamp = stamped();
  const id = await post(page, stamp);
  const title = `Release e2e ${stamp}`;
  await openPost(page, title, id);
  const arrow = page.getByRole("button", { name: "More ways to publish" });
  const dialog = await openSchedule(page, title);
  await expect
    .poll(() =>
      dialog.evaluate(element => element.contains(document.activeElement))
    )
    .toBe(true);
  await expectNoAxeViolations(page, { include: '[role="dialog"]' });

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Back where the reader was: the arrow that opened the menu it came from.
  await expect(arrow).toBeFocused();
});

test("schedules the post on its own, named after its saved title", async ({
  page,
}) => {
  const stamp = stamped();
  const id = await post(page, stamp);
  const title = `Release e2e ${stamp}`;
  await openPost(page, title, id);
  const dialog = await openSchedule(page, title);
  await expect(dialog.getByTestId("schedule-readback")).toContainText(
    "Goes live"
  );

  const answered = scheduleAnswer(page);
  await dialog.getByRole("button", { name: /^Schedule for/ }).click();
  const response = await answered;
  const releaseId = await releaseIdOf(response);
  try {
    expect(response.ok(), await response.text()).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({
      into: "own",
      document: { entryId: id, action: "publish" },
      title,
    });
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "This document goes live" })
    ).toContainText("on its own");
  } finally {
    if (releaseId !== undefined) await cancel(page, releaseId);
  }
});

test("adds the post to an existing draft release, to come down", async ({
  page,
}) => {
  const stamp = stamped();
  const id = await post(page, stamp);
  const title = `Release e2e ${stamp}`;
  const autumn = `Autumn ${stamp}`;
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/releases`, { data: { title: autumn } })
  );
  try {
    await openPost(page, title, id);
    const dialog = await openSchedule(page, title);
    await dialog
      .getByRole("radio", { name: "With an existing release" })
      .click();
    await dialog.getByLabel("Find a release").fill(stamp);
    await dialog.getByRole("radio", { name: new RegExp(autumn) }).click();
    await dialog.getByRole("radio", { name: "Comes down" }).click();
    const answered = scheduleAnswer(page);
    await dialog.getByRole("button", { name: `Add to ${autumn}` }).click();
    const response = await answered;
    expect(response.ok(), await response.text()).toBe(true);
    await expect(dialog).toHaveCount(0);

    expect(await membersOf(page, item.id)).toEqual([
      expect.objectContaining({ entryId: id, action: "unpublish" }),
    ]);
    expect((await readRelease(page, item.id)).state).toBe("draft");
  } finally {
    await cancel(page, item.id);
  }
});

test("makes a new release named in the dialog, and adds the post", async ({
  page,
}) => {
  const stamp = stamped();
  const id = await post(page, stamp);
  const title = `Release e2e ${stamp}`;
  await openPost(page, title, id);
  const dialog = await openSchedule(page, title);
  await dialog.getByRole("radio", { name: "In a new release" }).click();
  await dialog.getByLabel("Name").fill(`New ${stamp}`);
  await dialog.getByLabel(/Description/).fill("Made from the editor");
  const answered = scheduleAnswer(page);
  await dialog.getByRole("button", { name: "Create release and add" }).click();
  const response = await answered;
  const releaseId = await releaseIdOf(response);
  try {
    expect(response.ok(), await response.text()).toBe(true);
    expect(releaseId).toBeDefined();
    const made = await readRelease(page, releaseId as string);
    expect(made).toMatchObject({
      title: `New ${stamp}`,
      description: "Made from the editor",
      state: "draft",
    });
    expect(await membersOf(page, releaseId as string)).toEqual([
      expect.objectContaining({ entryId: id, action: "publish" }),
    ]);
  } finally {
    if (releaseId !== undefined) await cancel(page, releaseId);
  }
});

test("lists a post in two releases, says which one wins, and takes it out of each", async ({
  page,
}) => {
  const stamp = stamped();
  const id = await post(page, stamp);
  const title = `Release e2e ${stamp}`;
  const at = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  at.setUTCSeconds(0, 0);
  // A and B publish the post at one moment; B is scheduled second, so it is
  // the one whose version readers get. S takes the post down a day later, on
  // its own.
  const a = await release(page, `A ${stamp}`, id);
  const b = await release(page, `B ${stamp}`, id);
  const opened: string[] = [a, b];
  try {
    await schedule(page, a, at, "UTC");
    await schedule(page, b, at, "UTC");
    const s = await scheduleDocument(page, id, "unpublish", {
      into: "own",
      title,
      at: new Date(at.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      timezone: "UTC",
    });
    opened.push(s);

    await openPost(page, title, id);
    // Found by B, which holds the post throughout: the locator is evaluated at each use, and A
    // and the single-document release are taken out along the way.
    const banner = page.getByRole("status").filter({ hasText: `B ${stamp}` });
    await expect(banner.getByRole("listitem")).toHaveCount(3);
    await expect(banner).toContainText(
      `B ${stamp} was scheduled last, so its version is the one readers get.`
    );

    // Out of A: confirmed, and A no longer holds it while B does.
    await banner
      .getByRole("button", { name: `Remove from A ${stamp}…` })
      .click();
    const confirmA = page.getByRole("alertdialog");
    await expect(confirmA).toContainText(
      "Remove this document from this release?"
    );
    await confirmA.getByRole("button", { name: "Remove" }).click();
    await expect(confirmA).toHaveCount(0);
    expect(await membersOf(page, a)).toEqual([]);
    expect(await membersOf(page, b)).toHaveLength(1);

    // Out of its single-document release: that release is cancelled.
    await banner.getByRole("button", { name: `Remove from ${title}…` }).click();
    const confirmS = page.getByRole("alertdialog");
    await expect(confirmS).toContainText(
      "Remove this document and cancel this release?"
    );
    await confirmS
      .getByRole("button", { name: "Remove and cancel release" })
      .click();
    await expect(confirmS).toHaveCount(0);
    expect((await readRelease(page, s)).state).toBe("cancelled");
    await expect(banner.getByRole("listitem")).toHaveCount(1);
  } finally {
    for (const each of opened) {
      await cancel(page, each).catch(() => undefined);
    }
  }
});

test.describe("a reader who may create releases but not schedule or cancel them", () => {
  let reader: LimitedUser;

  test.beforeAll(async ({ browser, playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const admin = await playwright.request.newContext({
      baseURL,
      storageState: STORAGE_STATE,
    });
    try {
      reader = await signInAsLimitedUser(browser, admin, baseURL, [
        "read-content-releases",
        "create-content-releases",
        "read-posts",
        "update-posts",
        "publish-posts",
        "unpublish-posts",
      ]);
    } finally {
      await admin.dispose();
    }
  });

  test.afterAll(async () => {
    await reader?.context.close();
  });

  test("finds On its own held, and no Remove on the post's single-document release", async ({
    page,
  }) => {
    const stamp = stamped();
    const id = await post(page, stamp);
    const title = `Release e2e ${stamp}`;
    const s = await scheduleDocument(page, id, "publish", {
      into: "own",
      title,
      at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      timezone: "UTC",
    });
    const readerPage = await reader.context.newPage();
    await readerPage.setViewportSize({ width: 1440, height: 900 });
    try {
      await openPost(readerPage, title, id);
      const banner = readerPage
        .getByRole("status")
        .filter({ hasText: "on its own" });
      await expect(banner).toBeVisible();
      await expect(
        banner.getByRole("button", { name: /^Remove from/ })
      ).toHaveCount(0);

      const dialog = await openSchedule(readerPage, title);
      await expect(
        dialog.getByRole("radio", { name: "On its own, at a time" })
      ).toBeDisabled();
      await expect(dialog).toContainText(
        "Scheduling on its own needs permission to schedule releases."
      );
    } finally {
      await readerPage.close();
      await cancel(page, s);
    }
  });
});

test.describe("a reader who may not create releases", () => {
  let reader: LimitedUser;

  test.beforeAll(async ({ browser, playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const admin = await playwright.request.newContext({
      baseURL,
      storageState: STORAGE_STATE,
    });
    try {
      reader = await signInAsLimitedUser(browser, admin, baseURL, [
        "read-content-releases",
        "read-posts",
        "update-posts",
        "publish-posts",
        "unpublish-posts",
      ]);
    } finally {
      await admin.dispose();
    }
  });

  test.afterAll(async () => {
    await reader?.context.close();
  });

  test("is offered no Schedule…, so the Publish split has no arrow", async ({
    page,
  }) => {
    const stamp = stamped();
    const id = await post(page, stamp);
    const readerPage = await reader.context.newPage();
    await readerPage.setViewportSize({ width: 1440, height: 900 });
    try {
      await openPost(readerPage, `Release e2e ${stamp}`, id);
      await expect(
        readerPage.getByRole("button", { name: "More ways to publish" })
      ).toHaveCount(0);
    } finally {
      await readerPage.close();
    }
  });
});
