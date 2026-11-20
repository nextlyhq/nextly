/**
 * What the builder chrome's quality specs share: a page of their own, the
 * editor opened on it at a window size and theme, and the page data meter
 * shown in the top bar.
 *
 * Each spec makes its own pages, named uniquely, so no lock is needed.
 *
 * @module tests/support/builder-chrome
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin, type Theme } from "./admin";

const API = "/admin/api";
export const PAGES = `${API}/collections/pages/entries`;

/** A suffix no other run's records share. */
export function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A record of the run's own, through the REST API, and its id. */
export async function created(
  request: APIRequestContext,
  url: string,
  data: Record<string, unknown>
): Promise<string> {
  const answer = await request.post(url, { data });
  expect(answer.ok(), `seeding ${url}: ${await answer.text()}`).toBe(true);
  return ((await answer.json()) as { item: { id: string } }).item.id;
}

/**
 * A title as long as an author's real ones get, so the bar has to shorten
 * it: a launch page named in full.
 */
export function longTitle(): string {
  return `Spring collection launch: new linen shirts, summer dresses and sandals ${stamp()}`;
}

/** A draft page holding `nodes`, without the site's header and footer. */
export async function createPage(
  request: APIRequestContext,
  options: { title?: string; nodes?: readonly object[] } = {}
): Promise<{ id: string; title: string }> {
  const t = stamp();
  const title = options.title ?? `Chrome quality ${t}`;
  const id = await created(request, PAGES, {
    title,
    slug: `chrome-quality-${t}`,
    status: "draft",
    // No header or footer, whose regions would take the canvas's room and
    // clicks: each test seeds what it reads.
    noHeaderFooter: true,
    content: { formatVersion: 1, kind: "page", nodes: options.nodes ?? [] },
  });
  return { id, title };
}

/** Open the builder on a page at a window size and theme. */
export async function openBuilder(
  page: Page,
  id: string,
  options: { width?: number; height?: number; theme?: Theme } = {}
): Promise<void> {
  await page.setViewportSize({
    width: options.width ?? 1280,
    height: options.height ?? 800,
  });
  await gotoAdmin(
    page,
    `/collections/pages/${id}/builder?field=content`,
    options.theme ?? "light"
  );
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 90_000,
  });
}

/**
 * The page builder's page data limit as the admin is told it, lowered to
 * `limit`, so a small test page nears it and the top bar shows its meter.
 * The limit is the site's (`pageBuilder({ maxQueries })`), sent to the
 * editor in the admin's metadata, so it is changed there and nowhere else:
 * the count itself is made as for any page. The admin reads that metadata
 * on its own and inside its batched start-up read, so both are rewritten.
 */
export async function lowerPageDataLimit(
  page: Page,
  limit: number
): Promise<void> {
  await page.route(/\/admin\/api\/(startup|admin-meta)\b/, async route => {
    // A request the page has given up on (a navigation away) fails here,
    // and a thrown handler would print the request; it is let go instead.
    let response;
    let body: unknown;
    try {
      response = await route.fetch();
      body = (await response.json()) as unknown;
    } catch {
      await route.fallback().catch(() => undefined);
      return;
    }
    const lower = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(lower);
        return;
      }
      if (value === null || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      const config = record.clientConfig;
      if (
        record.name === "@nextlyhq/plugin-page-builder" &&
        config !== null &&
        typeof config === "object"
      ) {
        (config as Record<string, unknown>).maxQueries = limit;
      }
      Object.values(record).forEach(lower);
    };
    lower(body);
    await route.fulfill({ response, json: body }).catch(() => undefined);
  });
}

/**
 * Lists that each read the page's entries when it is published, so the page
 * data meter has a count of several to show. Plain headings inside, bound
 * to nothing, so each list is one read whatever the collection holds.
 */
export function readingLists(prefix: string): object[] {
  return [1, 2, 3, 4, 5].map(index => ({
    id: `${prefix}${index}0`,
    type: "core/collection-loop",
    version: 1,
    props: { collection: "bound-entries", limit: 3, sort: "title" },
    slots: {
      children: [
        {
          id: `${prefix}${index}1`,
          type: "core/heading",
          version: 1,
          props: { text: `List ${index}`, level: "h3" },
        },
      ],
    },
  }));
}

/**
 * Open the builder on a page with the page data meter showing in the top
 * bar: the page's own count is read from Page settings, then the site's
 * limit is lowered to it, so the page is at its limit and the bar shows the
 * meter, near it. The count is the page's, whatever the list reads.
 */
export async function openWithMeter(
  page: Page,
  id: string,
  options: { width?: number; height?: number; theme?: Theme } = {}
): Promise<{ count: number; limit: number }> {
  await openBuilder(page, id, options);
  const settingsLine = page.locator('.nx-read-meter[data-place="settings"]');
  await expect(settingsLine).toHaveText(/^Page data: \d+ of \d+/, {
    timeout: 60_000,
  });
  const count = Number(
    /Page data: (\d+) of/.exec((await settingsLine.textContent()) ?? "")?.[1]
  );
  // One past the count: near the limit (80% or more of it), with every read
  // the page makes still allowed, so the meter is "near", never "over".
  const limit = count + 1;
  expect(
    count / limit,
    `${count} reads near a limit of ${limit}`
  ).toBeGreaterThanOrEqual(0.8);
  await lowerPageDataLimit(page, limit);
  await page.reload();
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    topBar(page).locator('.nx-read-meter[data-place="bar"]')
  ).toBeVisible({
    timeout: 60_000,
  });
  return { count, limit };
}

/**
 * Bring a "+" between blocks out by moving the pointer near its gap, along
 * the gap's line away from the "+" itself, as an author reaching for it does.
 */
export async function revealGapAdd(page: Page, add: Locator): Promise<void> {
  const spot = await add.boundingBox();
  if (spot === null) throw new Error("[e2e] the + is not laid out");
  const line = await add.evaluate(
    element =>
      element.closest("[data-line]")?.getAttribute("data-line") ?? "across"
  );
  const x = spot.x + spot.width / 2;
  const y = spot.y + spot.height / 2;
  const shown = () =>
    add.evaluate(element => getComputedStyle(element).opacity);
  await page.mouse.move(
    line === "down" ? x - 3 : x - 160,
    line === "down" ? y - 40 : y - 3,
    { steps: 4 }
  );
  // Near the gap may still be outside a narrow container's gap: then onto
  // the "+" itself, which brings it out as well.
  if ((await shown()) !== "1") await page.mouse.move(x, y, { steps: 4 });
  await expect.poll(shown).toBe("1");
}

/** The editor's top bar. */
export function topBar(page: Page) {
  return page.locator('header[aria-label="Editor actions"]');
}
