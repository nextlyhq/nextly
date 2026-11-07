/**
 * Site code runs on the public site and nowhere in the admin.
 *
 * The playground mounts `<SiteCode>` in its root layout, the one the admin
 * shares, which is the worst place a site could put it: the code must still
 * run on a public page and never in the admin, in the editor's canvas or in
 * a preview, each of which is served from the site's own origin and could
 * otherwise read and drive the admin.
 *
 * Black box like the rest of `e2e/`: the code is saved through the route
 * Settings uses, and only what pages run is read.
 */
import {
  expect,
  type APIRequestContext,
  type Frame,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame, CANVAS_FRAME } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { olderPreviewToken } from "./support/preview-links";
import { test } from "./support/test";

// The site's code is one per site, and the canvas check opens the homepage.
test.describe.configure({ lock: [LOCK.siteCode, LOCK.homepage] });

const ROUTE = "/admin/api/plugins/@nextlyhq/plugin-page-builder/site/code";
const PAGES = "/admin/api/collections/block-pages/entries";
const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

/** What the saved code sets each time it runs. */
const MARKER = "__nxSiteCodeRan";
const CODE = `<script>window.${MARKER} = (window.${MARKER} || 0) + 1</script>`;

/** Save the site's code through its route, signed in, and fail loudly if refused. */
async function saveSiteCode(
  request: APIRequestContext,
  head: string
): Promise<void> {
  const csrf = await request.get("/admin/api/auth/csrf");
  const { token } = (await csrf.json()) as { token: string };
  // A plugin route checks a cookie-authenticated write's origin, which a
  // browser sends and an API request does not: named here as the site's own.
  const origin = new URL(csrf.url()).origin;
  // A save names the version it read, so it never replaces one it didn't see.
  const read = await request.get(ROUTE);
  const { version } = (await read.json()) as { version: string | null };
  const saved = await request.post(ROUTE, {
    data: { head, body: "", ...(version === null ? {} : { version }) },
    headers: { "x-csrf-token": token, origin },
  });
  expect(
    saved.ok(),
    `saving the site code: ${saved.status()} ${await saved.text()}`
  ).toBe(true);
}

/** How many times the saved code ran in a page or frame; none is `undefined`. */
function ran(target: Page | Frame): Promise<number | undefined> {
  return target.evaluate(
    marker => (window as unknown as Record<string, number | undefined>)[marker],
    MARKER
  );
}

/** A draft page of this run's own, and a preview link to it. */
async function draftPreview(request: APIRequestContext): Promise<string> {
  const slug = `site-code-draft-${Date.now().toString(36)}`;
  const response = await request.post(PAGES, {
    data: {
      title: "Site code draft",
      slug,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "00000000-0000-4000-8000-000000071172",
            type: "core/text",
            version: 1,
            props: { text: "Site code draft body" },
          },
        ],
      },
    },
  });
  expect(response.ok(), `creating the draft: ${response.status()}`).toBe(true);
  const { item } = (await response.json()) as { item: { id: string } };
  const session = await request.get("/admin/api/auth/session");
  const { user } = (await session.json()) as { user: { id: string } };
  return `/api/preview?token=${olderPreviewToken({
    collection: "block-pages",
    entryId: item.id,
    minter: user.id,
    generation: 0,
    ttlSeconds: 60 * 60,
  })}`;
}

test("site code runs on a public page, and never in the admin, the canvas or a preview", async ({
  page,
}) => {
  await saveSiteCode(page.request, CODE);
  try {
    // A public page runs it once. The page may be served from before the
    // save until its cache is refreshed, so it is loaded again until then.
    await expect
      .poll(
        async () => {
          await page.goto("/");
          return ran(page);
        },
        { timeout: 30_000 }
      )
      .toBe(1);
    await expect(page.locator("html")).toHaveAttribute(
      "data-nx-site-code-head",
      "started"
    );

    // Into the admin through the site's own link, without a document load:
    // the page loads the admin afresh, so the code that ran is gone.
    await page.goto("/e2e-site");
    await expect.poll(() => ran(page)).toBe(1);
    await page.getByRole("link", { name: "Open the admin" }).click();
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Dashboard" })
    ).toBeVisible({ timeout: 30_000 });
    expect(await ran(page)).toBeUndefined();

    // The admin, which shares the layout carrying it: never.
    await gotoAdmin(page, "/");
    expect(await ran(page)).toBeUndefined();
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-nx-site-code-head",
      "started"
    );

    // The editor's canvas, a page of the site framed by the admin: never,
    // in the frame or the admin around it.
    await gotoAdmin(page, "/singles/homepage");
    await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
    await expect(canvasFrame(page).locator(".nx-canvas")).toBeVisible({
      timeout: 30_000,
    });
    const frame = await (
      await page.locator(CANVAS_FRAME).elementHandle()
    )?.contentFrame();
    if (frame === null || frame === undefined) {
      throw new Error("[e2e] The canvas frame has no document.");
    }
    expect(await ran(frame)).toBeUndefined();
    expect(await ran(page)).toBeUndefined();

    // A preview, in draft mode: not even written to the page.
    await page.goto(await draftPreview(page.request));
    await expect(page.getByText("Site code draft body")).toBeVisible();
    await expect(page.locator("script[data-nx-site-code]")).toHaveCount(0);
    expect(await ran(page)).toBeUndefined();
  } finally {
    await saveSiteCode(page.request, "");
  }
});
