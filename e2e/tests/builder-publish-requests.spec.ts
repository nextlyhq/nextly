/**
 * What saving and publishing from the builder asks of the server: one write,
 * at most one read of the entry afterwards, and no media reads, with the
 * canvas left as drawn when the read matches what is on screen.
 *
 * Counted from the press of the top bar's primary button until the editor
 * says the page is saved and the requests it started have settled. The
 * document's lock and the autosave of the working copy are left out: both run
 * on their own schedule, not because of the press.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-publish-requests.spec
 */
import { expect, type Page, type Request } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock, canvasFrame } from "./support/canvas-frame";
import { uploadImage } from "./support/media-upload";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const LEAD = "00000000-0000-4000-8000-0000000c0101";
const IMAGE = "00000000-0000-4000-8000-0000000c0102";

/** A page with a heading and an image, published or a draft. */
async function seed(
  page: Page,
  status: "published" | "draft"
): Promise<string> {
  const run = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const media = await uploadImage(page.request, run);
  const created = await page.request.post(PAGES, {
    data: {
      title: `Publish requests ${run}`,
      slug: `publish-requests-${run}`,
      status,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: LEAD,
            type: "core/heading",
            version: 1,
            props: { text: "A page to publish", level: "h2" },
          },
          {
            id: IMAGE,
            type: "core/image",
            version: 1,
            props: { mediaId: media.id, alt: "A swatch" },
          },
        ],
      },
    },
  });
  expect(
    created.ok(),
    `seeding the page: ${created.status()} ${await created.text()}`
  ).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** Every admin API request the page sends once `start` is called. */
function apiRequests(page: Page): { sent: string[]; start: () => void } {
  const sent: string[] = [];
  let counting = false;
  page.on("request", (request: Request) => {
    if (!counting) return;
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/admin/api/")) return;
    // Taken and renewed on its own schedule.
    if (url.pathname.endsWith("/document-lock")) return;
    // The working copy's autosave runs a pause after an edit, not on a press.
    if (url.pathname.endsWith("/versions/autosave")) return;
    sent.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  return {
    sent,
    start: () => {
      counting = true;
    },
  };
}

/** Change the lead's text through the sidebar, and leave the field. */
async function editLead(page: Page, text: string): Promise<void> {
  await canvasBlock(page, LEAD).click();
  const field = page
    .getByTestId("inspector")
    .locator('[data-content-control="textarea"] textarea')
    .first();
  await field.fill(text);
  await page.keyboard.press("Tab");
  await expect(canvasBlock(page, LEAD)).toHaveText(text);
}

/**
 * Counts the elements the canvas adds or removes from now on: a canvas drawn
 * again from a read of the entry replaces its blocks, and an image replaced
 * loads again.
 */
async function watchCanvas(page: Page): Promise<() => Promise<number>> {
  const handle = await canvasFrame(page).locator(".nx-canvas").elementHandle();
  if (handle === null) throw new Error("[e2e] the canvas is not drawn");
  await handle.evaluate(canvas => {
    const seen = { changed: 0 };
    (window as unknown as { __canvasChanges: typeof seen }).__canvasChanges =
      seen;
    new MutationObserver(records => {
      for (const record of records) {
        seen.changed += record.addedNodes.length + record.removedNodes.length;
      }
    }).observe(canvas, { childList: true, subtree: true });
  });
  return () =>
    handle.evaluate(
      () =>
        (window as unknown as { __canvasChanges: { changed: number } })
          .__canvasChanges.changed
    );
}

/** The editor says the page is saved and has nothing left to save. */
async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("save-state-indicator")).toHaveAttribute(
    "data-tone",
    "saved",
    { timeout: 30_000 }
  );
  await expect(
    page.locator('[data-publish-split] [data-primary="true"]')
  ).toBeDisabled();
}

for (const status of ["published", "draft"] as const) {
  test(`a ${status} page's save writes once and reads the entry at most once`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await gotoAdmin(page, "/");
    const id = await seed(page, status);
    const { sent, start } = apiRequests(page);
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(canvasBlock(page, LEAD)).toBeVisible({ timeout: 60_000 });
    await expect(canvasBlock(page, IMAGE).locator("img")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await editLead(page, "A page published once");
    await page.waitForLoadState("networkidle");
    const changes = await watchCanvas(page);
    start();
    await page.locator('[data-publish-split] [data-primary="true"]').click();
    await expectSaved(page);
    await page.waitForLoadState("networkidle");
    console.log(`[${status}]`, JSON.stringify(sent, null, 2));
    console.log(`[${status}] canvas changes`, await changes());

    const entryPath = `${PAGES}/${id}`;
    const onEntry = (method: string) =>
      sent.filter(line => {
        const [m, url = ""] = line.split(" ");
        return m === method && url.split("?")[0] === entryPath;
      });
    expect(onEntry("PATCH"), "writes of the entry").toHaveLength(1);
    expect(
      onEntry("GET").length,
      "reads of the entry after the write"
    ).toBeLessThanOrEqual(1);
    const media = sent.filter(line =>
      (line.split(" ")[1] ?? "").startsWith("/admin/api/media")
    );
    expect(media, "media reads").toEqual([]);
    // The read matches what is shown: the canvas keeps its drawn blocks.
    expect(await changes(), "canvas elements replaced").toBe(0);
  });
}
