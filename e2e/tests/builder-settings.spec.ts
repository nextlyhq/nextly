/**
 * Settings, in a browser: the rail opens it, the page's own fields and a
 * share preview are in "This page", Enter in a field saves nothing, and the
 * site's breakpoints are edited in "Site", where a breakpoint added shows as a
 * device at once. The top bar no longer edits breakpoints.
 *
 * @module tests/builder-settings.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { storeSiteBreakpoints } from "./support/site-breakpoints";
import { test } from "./support/test";

// The site's breakpoints are stored and cleared here.
test.describe.configure({ lock: [LOCK.siteStyle], timeout: 180_000 });

const ENTRIES = "/admin/api/collections/pages/entries";

async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Settings ${stamp}`,
      slug: `settings-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          { id: "t1", type: "core/text", version: 1, props: { text: "Hello" } },
        ],
      },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openSettings(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

test.describe("Settings", () => {
  test("holds the page's fields and a share preview, and Enter saves nothing", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openSettings(page, id);
    const dialog = page.getByRole("dialog", { name: "Settings" });

    // The top bar's breakpoint editor is gone: breakpoints live in Settings.
    await expect(
      page.getByRole("button", { name: /^Breakpoints:/ })
    ).toHaveCount(0);

    await expect(dialog.getByRole("tab", { name: "This page" })).toBeVisible();
    await expect(
      dialog.getByRole("figure", { name: "Share preview" })
    ).toContainText("Settings ");
    await expect(
      dialog.getByText("Approximate: your site's metadata may differ.")
    ).toBeVisible();

    let wrote = false;
    page.on("request", request => {
      if (
        new URL(request.url()).pathname.endsWith(`/entries/${id}`) &&
        ["PATCH", "PUT"].includes(request.method())
      ) {
        wrote = true;
      }
    });
    const title = dialog.getByRole("textbox").first();
    await title.click();
    await title.press("Enter");
    await page.waitForTimeout(1500);
    expect(wrote, "Enter in a Settings field must not save the page").toBe(
      false
    );
    await expect(dialog).toBeVisible();
  });

  test("adds a breakpoint in Site, and it shows as a device at once", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    try {
      await openSettings(page, id);
      const dialog = page.getByRole("dialog", { name: "Settings" });
      await dialog.getByRole("tab", { name: "Site" }).click();
      await expect(
        dialog.getByText("Changes here apply to the live site immediately.")
      ).toBeVisible();

      await dialog.getByRole("button", { name: "Edit breakpoints" }).click();
      await dialog
        .getByRole("button", { name: "Add breakpoint" })
        .first()
        .click();
      await dialog
        .getByLabel("Name", { exact: true })
        .last()
        .fill("Wide phone");
      await dialog.getByLabel("Up to", { exact: true }).last().fill("700");
      const saved = page.waitForResponse(
        response =>
          new URL(response.url()).pathname.endsWith("/site/breakpoints") &&
          response.ok()
      );
      await dialog.getByRole("button", { name: "Save breakpoints" }).click();
      await saved;
      await expect(
        dialog.getByRole("status").filter({ hasText: "Saved" })
      ).toBeVisible();
      await expect(
        dialog.getByRole("listitem").filter({ hasText: "Wide phone" })
      ).toContainText("up to 700 pixels");

      await dialog.getByRole("button", { name: "Close" }).click();
      // The new device is offered for styling: as a button when it is one of
      // the widest, otherwise in the menu beside them.
      const button = page
        .getByRole("radiogroup", { name: "Device" })
        .getByRole("radio", { name: /Wide phone/ });
      if ((await button.count()) > 0) {
        await expect(button).toBeVisible();
      } else {
        await page.getByRole("button", { name: /^More devices/ }).click();
        await expect(
          page.getByRole("menuitemradio", { name: /Wide phone/ })
        ).toBeVisible();
      }
    } finally {
      await storeSiteBreakpoints(page.request, null);
    }
  });
});
