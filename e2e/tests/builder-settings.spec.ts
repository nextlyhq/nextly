/**
 * Settings, in a browser: the rail opens it, the page's own fields and a
 * share preview are in "This page", Enter in a field saves nothing, and the
 * site's breakpoints are edited in "Site", where a breakpoint added shows as a
 * device at once. The top bar no longer edits breakpoints.
 *
 * Breakpoints are renamed and removed there too. Removing the one being
 * edited moves the editor to the next wider breakpoint, where a style then
 * lands. A fourth breakpoint added there is chosen from the menu beside the
 * device buttons, styled and published. A role that may not manage the site's
 * settings is offered no Site tab.
 *
 * A breakpoint is removed here only while nothing is styled under it: the
 * styles stored under a removed breakpoint are not cleared by its removal.
 *
 * @module tests/builder-settings.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { block, clickBlock, pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { storeSiteBreakpoints } from "./support/site-breakpoints";
import { test } from "./support/test";

// The site's breakpoints are stored and cleared here.
test.describe.configure({ lock: [LOCK.siteStyle], timeout: 180_000 });

const ENTRIES = "/admin/api/collections/pages/entries";

/** The text block every page here holds, and its text. */
const TEXT_ID = "t1";
const BLUE = "rgb(17, 85, 204)";

async function createPage(
  request: APIRequestContext,
  status: "draft" | "published" = "draft"
): Promise<{ id: string; slug: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `settings-${stamp}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Settings ${stamp}`,
      slug,
      status,
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
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Open Settings from the rail, in the editor already on screen. */
async function showSettings(page: Page): Promise<Locator> {
  await page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openSettings(page: Page, id: string): Promise<void> {
  await openEditor(page, id);
  await showSettings(page);
}

/** Settings' Site tab, with its breakpoints open for editing. */
async function editBreakpoints(page: Page): Promise<Locator> {
  const dialog = await showSettings(page);
  await dialog.getByRole("tab", { name: "Site" }).click();
  await dialog.getByRole("button", { name: "Edit breakpoints" }).click();
  return dialog;
}

/** Save the breakpoints being edited, and wait for the route to store them. */
async function saveBreakpoints(page: Page, dialog: Locator): Promise<void> {
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
}

/** The device buttons, by their group's name. */
function devices(page: Page): Locator {
  return page.getByRole("radiogroup", { name: "Device" });
}

/** Colour the text block blue, at the device being edited. */
async function paintText(page: Page): Promise<void> {
  await expect(await block(page, TEXT_ID)).toBeVisible({ timeout: 30_000 });
  await clickBlock(page, TEXT_ID);
  await page.getByRole("tab", { name: "Style" }).click();
  // Colour sits in Typography, which starts closed for a text block.
  const section = page.getByRole("button", {
    name: "Typography",
    exact: true,
  });
  if ((await section.getAttribute("aria-expanded")) !== "true") {
    await section.click();
  }
  const color = page
    .getByRole("region", { name: /^Typography/ })
    .getByRole("textbox", { name: "Colour", exact: true });
  await color.fill("#1155cc");
  await color.press("Enter");
  await expect(await block(page, TEXT_ID)).toHaveCSS("color", BLUE);
}

/** The write of one entry, and not the other requests under its path. */
function entryWrite(page: Page, id: string) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

/** The text block's stored styles, read back through the entries API. */
async function storedTextStyles(
  request: APIRequestContext,
  id: string
): Promise<Record<string, Record<string, unknown> | undefined>> {
  const response = await request.get(`${ENTRIES}/${id}?status=all`);
  expect(response.ok(), `reading the page: ${response.status()}`).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as {
    content?: string | { nodes?: Record<string, unknown>[] };
  };
  const content =
    typeof item.content === "string"
      ? (JSON.parse(item.content) as { nodes?: Record<string, unknown>[] })
      : item.content;
  const node = content?.nodes?.find(entry => entry.id === TEXT_ID);
  const styles = node?.styles as
    | { base?: Record<string, Record<string, unknown> | undefined> }
    | undefined;
  return styles?.base ?? {};
}

test.describe("Settings", () => {
  test("holds the page's fields and a share preview, and Enter saves nothing", async ({
    page,
  }) => {
    const { id } = await createPage(page.request);
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
    const { id } = await createPage(page.request);
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
  test("renames and removes a breakpoint in Site", async ({ page }) => {
    // A breakpoint of its own, so nothing anywhere is styled under it.
    await storeSiteBreakpoints(page.request, {
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 1024 },
        { id: "wide-phone", label: "Wide phone", maxWidth: 800 },
        { id: "mobile", label: "Mobile", maxWidth: 640 },
      ],
      container: [],
    });
    try {
      const { id } = await createPage(page.request);
      await openEditor(page, id);
      await expect(
        devices(page).getByRole("radio", { name: /^Wide phone/ })
      ).toBeVisible();

      let dialog = await editBreakpoints(page);
      await dialog
        .getByLabel("Name", { exact: true })
        .and(page.locator('[value="Wide phone"]'))
        .fill("Large phone");
      await saveBreakpoints(page, dialog);
      await expect(
        dialog.getByRole("listitem").filter({ hasText: "Large phone" })
      ).toContainText("up to 800 pixels");
      await expect(
        dialog.getByRole("listitem").filter({ hasText: "Wide phone" })
      ).toHaveCount(0);
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(
        devices(page).getByRole("radio", { name: /^Large phone/ })
      ).toBeVisible();
      await expect(
        devices(page).getByRole("radio", { name: /^Wide phone/ })
      ).toHaveCount(0);

      dialog = await editBreakpoints(page);
      await dialog.getByRole("button", { name: "Remove Large phone" }).click();
      await saveBreakpoints(page, dialog);
      await expect(
        dialog.getByRole("listitem").filter({ hasText: "Large phone" })
      ).toHaveCount(0);
      // The others are kept.
      await expect(
        dialog.getByRole("listitem").filter({ hasText: "Tablet" })
      ).toContainText("up to 1024 pixels");
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(
        devices(page).getByRole("radio", { name: /^Large phone/ })
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^More devices/ })
      ).toHaveCount(0);
      await expect(devices(page).getByRole("radio")).toHaveCount(3);
    } finally {
      await storeSiteBreakpoints(page.request, null);
    }
  });

  test("removing the breakpoint being edited moves to the next wider one, where a style then lands", async ({
    page,
  }) => {
    // Wide phone sits between Mobile and Tablet, so the next wider one,
    // Tablet, is neither the base nor the narrower neighbour.
    await storeSiteBreakpoints(page.request, {
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 1024 },
        { id: "wide-phone", label: "Wide phone", maxWidth: 800 },
        { id: "mobile", label: "Mobile", maxWidth: 640 },
      ],
      container: [],
    });
    try {
      const { id } = await createPage(page.request);
      await openEditor(page, id);
      await devices(page)
        .getByRole("radio", { name: /^Wide phone/ })
        .click();
      await expect(
        devices(page).getByRole("radio", { checked: true })
      ).toHaveAccessibleName(/^Wide phone/);

      const dialog = await editBreakpoints(page);
      await dialog.getByRole("button", { name: "Remove Wide phone" }).click();
      await saveBreakpoints(page, dialog);
      await dialog.getByRole("button", { name: "Close" }).click();

      // The device chosen is now Tablet, shown as the active button.
      const chosen = devices(page).getByRole("radio", { checked: true });
      await expect(chosen).toHaveAccessibleName(/^Tablet/);
      await expect(chosen).toHaveText("Tablet · 1024px");

      await paintText(page);
      const saved = entryWrite(page, id);
      await pressSave(page);
      await saved;

      const styles = await storedTextStyles(page.request, id);
      expect(JSON.stringify(styles.tablet ?? {}).toLowerCase()).toContain(
        "1155cc"
      );
      expect(styles.base).toBeUndefined();
      expect(styles["wide-phone"]).toBeUndefined();
    } finally {
      await storeSiteBreakpoints(page.request, null);
    }
  });

  test("a fourth breakpoint added in Site is chosen from the menu, styled and published", async ({
    page,
  }) => {
    const { id, slug } = await createPage(page.request, "published");
    try {
      await openEditor(page, id);
      // The site's own three: Desktop, Tablet and Mobile, and no menu.
      await expect(devices(page).getByRole("radio")).toHaveCount(3);
      const labels = await devices(page).getByRole("radio").allTextContents();

      const dialog = await editBreakpoints(page);
      await dialog
        .getByRole("button", { name: "Add breakpoint" })
        .first()
        .click();
      await dialog
        .getByLabel("Name", { exact: true })
        .last()
        .fill("Small phone");
      await dialog.getByLabel("Up to", { exact: true }).last().fill("400");
      await saveBreakpoints(page, dialog);
      await dialog.getByRole("button", { name: "Close" }).click();

      // The narrowest goes in the menu; the three buttons are unchanged.
      await expect(devices(page).getByRole("radio")).toHaveCount(3);
      expect(await devices(page).getByRole("radio").allTextContents()).toEqual(
        labels
      );
      const more = page.getByRole("button", { name: /^More devices/ });
      await more.click();
      await page.getByRole("menuitemradio", { name: /^Small phone/ }).click();
      await expect(more).toHaveAccessibleName(
        "More devices, styling Small phone, up to 400 pixels"
      );

      await paintText(page);
      const saved = entryWrite(page, id);
      await pressSave(page);
      await saved;
      const published = entryWrite(page, id);
      await page
        .getByRole("button", { name: "Publish changes", exact: true })
        .click();
      await published;

      // The published page: blue at that width, and not at a desktop one.
      const visitor = await page.context().newPage();
      try {
        await visitor.setViewportSize({ width: 400, height: 800 });
        const response = await visitor.goto(`/${slug}`);
        expect(response?.status()).toBe(200);
        const text = visitor.getByText("Hello");
        await expect(text).toBeVisible({ timeout: 60_000 });
        await expect(text).toHaveCSS("color", BLUE);
        await visitor.setViewportSize({ width: 1440, height: 900 });
        await expect(text).not.toHaveCSS("color", BLUE);
      } finally {
        await visitor.close();
      }
    } finally {
      // The page holds the only styles under the new breakpoint, so it goes
      // before the breakpoint does.
      const removed = await page.request.delete(`${ENTRIES}/${id}`);
      expect(removed.ok(), `deleting the page: ${removed.status()}`).toBe(true);
      await storeSiteBreakpoints(page.request, null);
    }
  });

  test("offers no Site tab to a role that may not manage the site's settings", async ({
    browser,
    page,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const { id } = await createPage(page.request);
    const author = await signInAsLimitedUser(browser, page.request, baseURL, [
      "read-pages",
      "update-pages",
    ]);
    try {
      const authorPage = await author.context.newPage();
      await openSettings(authorPage, id);
      const dialog = authorPage.getByRole("dialog", { name: "Settings" });
      await expect(
        dialog.getByRole("tab", { name: "This page" })
      ).toBeVisible();
      await expect(dialog.getByRole("tab", { name: "Site" })).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Edit breakpoints" })
      ).toHaveCount(0);
      // Nor does the top bar offer a way round it.
      await expect(
        authorPage.getByRole("button", { name: "Edit breakpoints" })
      ).toHaveCount(0);
      // And the route that stores them refuses this role's write.
      const csrf = await author.context.request.get("/admin/api/auth/csrf");
      const { token } = (await csrf.json()) as { token: string };
      const refused = await author.context.request.post(
        "/admin/api/plugins/@nextlyhq/plugin-page-builder/site/breakpoints",
        {
          data: { breakpoints: null },
          headers: {
            "x-csrf-token": token,
            origin: new URL(csrf.url()).origin,
          },
        }
      );
      expect(refused.status()).toBe(403);
    } finally {
      await author.context.close();
    }
  });
});
