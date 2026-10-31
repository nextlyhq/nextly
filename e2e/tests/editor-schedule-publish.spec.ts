/**
 * Scheduling a document from its editor, in a real browser: the Publish
 * split's arrow offers Schedule publish… and Add to release…, the dialog
 * sends one request that makes a release holding only this document at the
 * chosen time, and the release then shows in the scheduled-release banner and
 * in the panel's Publishing section.
 *
 * A person who may not create releases finds Schedule publish… held, with
 * the reason on its row.
 */
import { expect, type Page, type Response } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { cancel, post } from "./support/releases-api";
import { test } from "./support/test";

/** A post of this spec's own, opened in its editor with the panel shown. */
async function openPost(page: Page, title: string, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/posts/${id}`);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true })
  ).toHaveValue(title, { timeout: 30_000 });
}

test("schedules a post from the Publish split, and shows the release in the banner and the panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const id = await post(page, stamp);
  const title = `Release e2e ${stamp}`;
  await page.addInitScript(() =>
    window.localStorage.setItem("nextly:admin:entry-rail-collapsed", "0")
  );
  await openPost(page, title, id);

  const arrow = page.getByRole("button", { name: "More ways to publish" });
  await arrow.click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Schedule publish…",
    "Add to release…",
  ]);
  await page.getByRole("menuitem", { name: "Schedule publish…" }).click();

  const dialog = page.getByRole("dialog", { name: "Schedule publish" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Date and time")).toBeFocused();
  await expect(dialog.getByTestId("schedule-readback")).toContainText(
    "Goes live"
  );

  const sent = page.waitForRequest(
    request =>
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/releases/schedule-document")
  );
  const answered = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/releases/schedule-document")
  );
  await dialog.getByRole("button", { name: "Schedule publish" }).click();
  const response = await answered;
  // The release's id before any assertion: once the server has answered, a
  // release may exist, and a failure from here on must still cancel it, or
  // it stays scheduled in the database the rest of the suite shares.
  const releaseId = await scheduledReleaseId(response);

  try {
    const body = (await sent).postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({
      into: "own",
      document: {
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: id,
        action: "publish",
      },
      title,
    });
    expect(response.ok(), await response.text()).toBe(true);
    expect(releaseId).toBeDefined();

    await expect(dialog).toHaveCount(0);
    // Back where the person reached for it.
    await expect(arrow).toBeFocused();

    // The banner says the post now changes on its own, and with which release.
    const banner = page
      .getByRole("status")
      .filter({ hasText: "This document goes live" });
    await expect(banner).toContainText(title);

    // The panel's Publishing section names the release and when.
    const publishing = page
      .getByRole("complementary", { name: "Document panel" })
      .getByRole("region", { name: "Publishing" });
    await expect(publishing.getByRole("link", { name: title })).toBeVisible();
    await expect(publishing).toContainText("Goes live");
    await expect(publishing).not.toContainText("Not scheduled.");
  } finally {
    if (releaseId !== undefined) await cancel(page, releaseId);
  }
});

/** The id of the release a schedule made, or undefined when it made none. */
async function scheduledReleaseId(
  response: Response
): Promise<string | undefined> {
  if (!response.ok()) return undefined;
  const answer = (await response.json().catch(() => null)) as {
    item?: { release?: { id?: unknown } };
  } | null;
  const id = answer?.item?.release?.id;
  return typeof id === "string" ? id : undefined;
}

test.describe("without permission to create releases", () => {
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

  test("holds Schedule publish…, saying why on its row", async ({ page }) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const id = await post(page, stamp);
    const readerPage = await reader.context.newPage();
    await readerPage.setViewportSize({ width: 1440, height: 900 });
    try {
      await openPost(readerPage, `Release e2e ${stamp}`, id);
      await readerPage
        .getByRole("button", { name: "More ways to publish" })
        .click();
      const item = readerPage.getByRole("menuitem", {
        name: /Schedule publish…/,
      });
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toContainText(
        "You do not have permission to schedule releases."
      );
    } finally {
      await readerPage.close();
    }
  });
});
