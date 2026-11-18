/**
 * Starter pages in a browser, from the playground's test starter
 * ("Welcome": a Heading in the brand colour, an empty Image and a Button):
 *
 * - the New page dialog's "Start from" lists it beside Blank, its preview
 *   drawn in the site's own colours after the Primary colour is changed;
 * - a page made from it holds a copy of its blocks under new ids, with the
 *   header and footer the dialog chose;
 * - an empty page in the builder starts from it on the start area's row,
 *   and one Undo empties the page again;
 * - made and opened with every other site out of reach, no image is broken
 *   and nothing is asked of another site.
 *
 * @module tests/builder-starter-pages.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.siteStyle] });

const ENTRIES = "/admin/api/collections/pages/entries";
const SITE_STYLE = "/admin/api/singles/site-style";

/** The playground's test starter, as `apps/playground/src/starter-pages.ts` writes it. */
const STARTER = {
  label: "Welcome",
  heading: "Welcome to our site",
  ids: ["welcome", "welcome-title", "welcome-image", "welcome-button"],
};

/** The Primary colour the site is changed to, and how a browser reads it. */
const CHANGED_PRIMARY = { value: "#c2185b", rgb: "rgb(194, 24, 91)" };

const dialog = (page: Page) => page.getByRole("dialog", { name: "New page" });

/** The site's stored variables, to put back once the suite is done. */
async function storedTokens(request: APIRequestContext): Promise<unknown> {
  const response = await request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  return ((body.item ?? body) as Record<string, unknown>).tokens ?? null;
}

async function writeTokens(
  request: APIRequestContext,
  tokens: unknown
): Promise<void> {
  // A variable's removal is refused until every page is counted.
  await countEveryPage(request);
  const written = await request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

/** One stored page by id, every status. */
async function storedById(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  const response = await request.get(`${ENTRIES}/${id}?status=all`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as Record<string, unknown> & {
    item?: Record<string, unknown>;
  };
  return body.item ?? body;
}

/** Every node id in a stored page body. */
function idsIn(content: unknown): string[] {
  const document = (
    typeof content === "string" ? JSON.parse(content) : content
  ) as { nodes?: unknown[] };
  const ids: string[] = [];
  const walk = (nodes: unknown[]) => {
    for (const node of nodes as {
      id: string;
      slots?: Record<string, unknown[]>;
    }[]) {
      ids.push(node.id);
      for (const children of Object.values(node.slots ?? {})) walk(children);
    }
  };
  walk(document.nodes ?? []);
  return ids;
}

/** An empty page, made through the entries API. */
async function emptyPage(request: APIRequestContext, title: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title,
      slug: `starter-${stamp}`,
      status: "draft",
      content: { formatVersion: 1, kind: "page", nodes: [] },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** The kinds of request a page's blocks load what they show by. */
const LOADED: ReadonlySet<string> = new Set(["image", "media", "document"]);

/**
 * Every request the page makes to another site is refused, as an offline
 * browser would refuse it, and those a page's blocks would show (a picture,
 * a video, an embedded frame) are recorded.
 */
async function cutOffOtherSites(page: Page, origin: string): Promise<string[]> {
  const asked: string[] = [];
  await page.context().route("**/*", async route => {
    try {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("blob:")) {
        await route.continue();
        return;
      }
      if (new URL(url).origin === origin) {
        await route.continue();
        return;
      }
      // What a page draws from: a picture, a video, an embedded frame.
      if (LOADED.has(route.request().resourceType())) asked.push(url);
      await route.abort("internetdisconnected");
    } catch {
      // A page closed mid-request has nothing left to answer.
    }
  });
  return asked;
}

test.describe("starter pages", () => {
  let tokensBefore: unknown = null;

  test.beforeAll(async ({ request }) => {
    tokensBefore = await storedTokens(request);
  });

  test.afterAll(async ({ request }) => {
    await writeTokens(request, tokensBefore);
  });

  test("the dialog previews the starter in the site's changed colour, and a page made from it is a copy with the chosen header and footer", async ({
    page,
  }) => {
    await writeTokens(page.request, {
      tokens: [
        {
          name: "color.primary",
          kind: "color",
          values: { light: CHANGED_PRIMARY.value },
        },
      ],
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoAdmin(page, "/collections/pages", "light");
    await page.getByRole("button", { name: /^New / }).click();
    const form = dialog(page);
    const row = form.getByRole("group", { name: "Start from" });
    await expect(row.getByRole("radio", { name: "Blank" })).toBeChecked();
    const welcome = row.getByRole("radio", { name: STARTER.label });
    await expect(welcome).toBeVisible();
    await expect(welcome).toHaveAccessibleDescription(
      "A heading in your brand colour, an image to add and a button."
    );

    // The preview is the starter's own blocks, drawn in the site's colour.
    const preview = form.locator('[data-starter="e2e-welcome"] .nx-picture');
    const heading = preview.getByText(STARTER.heading);
    await expect(heading).toBeAttached({ timeout: 30_000 });
    await expect(heading).toHaveCSS("color", CHANGED_PRIMARY.rgb);

    const title = `From a starter ${Date.now()}`;
    await form.getByRole("textbox", { name: "Title" }).fill(title);
    // The radio is drawn as its tile: the tile is what a person clicks.
    await row.locator('[data-starter="e2e-welcome"]').click();
    await expect(welcome).toBeChecked();
    await form.getByRole("combobox", { name: "Header & footer" }).click();
    await page.getByRole("option", { name: /^None/ }).click();
    await form.getByRole("button", { name: "Create and open builder" }).click();
    await expect(page).toHaveURL(
      /\/collections\/pages\/([^/]+)\/builder\?field=content$/,
      { timeout: 60_000 }
    );
    const id = /\/collections\/pages\/([^/]+)\/builder/.exec(page.url())?.[1];
    expect(id).toBeDefined();

    // The body is the starter's blocks under new ids; the header and footer
    // are the dialog's choice.
    const stored = await storedById(page.request, id as string);
    expect(stored).toMatchObject({ noHeaderFooter: true });
    const ids = idsIn(stored.content);
    expect(ids).toHaveLength(STARTER.ids.length);
    for (const each of ids) expect(STARTER.ids).not.toContain(each);
    await expect(
      (await canvasRoot(page)).getByText(STARTER.heading)
    ).toBeVisible({ timeout: 60_000 });
  });

  test("an empty page starts from the starter in the builder, and one Undo empties it", async ({
    page,
  }) => {
    const title = `Empty ${Date.now()}`;
    const id = await emptyPage(page.request, title);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    const area = page.locator(".nx-page-start");
    await expect(area.getByText("or start from a page")).toBeVisible({
      timeout: 60_000,
    });
    await area.getByRole("button", { name: STARTER.label }).click();

    const canvas = await canvasRoot(page);
    await expect(canvas.getByText(STARTER.heading)).toBeVisible();
    await expect(area).toHaveCount(0);

    // One step: a single Undo, and the page is empty again.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(canvas.getByText(STARTER.heading)).toHaveCount(0);
    await expect(
      page.locator(".nx-page-start").getByText("or start from a page")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  test("with every other site out of reach, a page made from the starter shows no broken image and asks nothing of another site", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoAdmin(page, "/collections/pages", "light");
    const asked = await cutOffOtherSites(page, new URL(page.url()).origin);
    await page.getByRole("button", { name: /^New / }).click();
    const form = dialog(page);
    await form
      .getByRole("textbox", { name: "Title" })
      .fill(`Offline ${Date.now()}`);
    const row = form.getByRole("group", { name: "Start from" });
    await row.locator('[data-starter="e2e-welcome"]').click();
    await expect(row.getByRole("radio", { name: STARTER.label })).toBeChecked();
    await form.getByRole("button", { name: "Create and open builder" }).click();
    await expect(page).toHaveURL(/\/builder\?field=content$/, {
      timeout: 60_000,
    });
    const canvas = await canvasRoot(page);
    await expect(canvas.getByText(STARTER.heading)).toBeVisible({
      timeout: 60_000,
    });

    // The Image shows its empty state, never a broken picture.
    await expect(page.getByText("Add an image").first()).toBeVisible();
    const broken = await canvas
      .locator("img")
      .evaluateAll(
        images =>
          images.filter(
            image =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth === 0
          ).length
      );
    expect(broken).toBe(0);
    expect(asked).toEqual([]);
  });
});
