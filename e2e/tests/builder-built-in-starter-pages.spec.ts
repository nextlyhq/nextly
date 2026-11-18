/**
 * The page builder's own starter pages, as a visitor gets them: a page made
 * from each, published, and drawn at 1440 pixels wide in light and in dark.
 *
 * Each capture is attached to the run for a person to look at. What a
 * browser can judge is held here: the page's own heading shows, no picture
 * is broken, nothing is asked of another site, and the heading's text stands
 * out from what is behind it in both schemes.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-built-in-starter-pages.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

test.describe.configure({ timeout: 120_000 });

const API = "/admin/api";
const ENTRIES = `${API}/collections/pages/entries`;
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

/** Each starter page, by id, with the heading a page made from it opens on. */
const STARTERS = [
  { id: "landing", label: "Landing", heading: "Your books, done by Friday." },
  {
    id: "about",
    label: "About",
    heading: "Bookkeeping should take an afternoon, not a weekend.",
  },
  { id: "contact", label: "Contact", heading: "Talk to us" },
  {
    id: "pricing",
    label: "Pricing",
    heading: "One price per studio, no surprises",
  },
  {
    id: "coming-soon",
    label: "Coming soon",
    heading: "Shared books are coming this spring.",
  },
] as const;

/** A page made from `starter` through the New page route, then published. */
async function publishedFrom(page: Page, starter: string): Promise<string> {
  await gotoAdmin(page, "/");
  const csrf = (await (await page.request.get(`${API}/auth/csrf`)).json()) as {
    token: string;
  };
  const slug = `built-in-${starter}-${STAMP}`;
  const created = await page.request.post(`${PLUGIN}/pages`, {
    headers: { "x-csrf-token": csrf.token, origin: new URL(page.url()).origin },
    data: { collection: "pages", title: `${starter} ${STAMP}`, slug, starter },
  });
  expect(
    created.ok(),
    `creating from ${starter}: ${created.status()} ${await created.text()}`
  ).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  const published = await page.request.patch(`${ENTRIES}/${id}`, {
    data: { status: "published" },
  });
  expect(
    published.ok(),
    `publishing ${starter}: ${published.status()} ${await published.text()}`
  ).toBe(true);
  return slug;
}

/** Every request to another site is refused, and the ones made are recorded. */
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
      asked.push(url);
      await route.abort("internetdisconnected");
    } catch {
      // A page closed mid-request has nothing left to answer.
    }
  });
  return asked;
}

/**
 * The contrast between the main heading's text and the first colour painted
 * behind it, as WCAG measures it.
 */
async function headingContrast(page: Page): Promise<number> {
  return page
    .locator("h1")
    .first()
    .evaluate(heading => {
      const channels = (colour: string) =>
        (colour.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
      const luminance = ([r = 0, g = 0, b = 0]: number[]) => {
        const lin = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      let behind: number[] = [255, 255, 255];
      for (
        let element: Element | null = heading;
        element !== null;
        element = element.parentElement
      ) {
        const painted = channels(getComputedStyle(element).backgroundColor);
        if (painted.length === 3 || (painted[3] ?? 0) > 0) {
          behind = painted;
          break;
        }
      }
      const text = luminance(channels(getComputedStyle(heading).color));
      const ground = luminance(behind);
      const [light, dark] = text > ground ? [text, ground] : [ground, text];
      return (light + 0.05) / (dark + 0.05);
    });
}

for (const starter of STARTERS) {
  test(`${starter.label}: a page made from it is finished at 1440 wide, in light and in dark`, async ({
    page,
  }, testInfo) => {
    const slug = await publishedFrom(page, starter.id);
    const origin = new URL(page.url()).origin;
    const asked = await cutOffOtherSites(page, origin);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/${slug}`);
      await expect(
        page.getByRole("heading", { level: 1, name: starter.heading })
      ).toBeVisible({ timeout: 30_000 });
      const broken = await page
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
      expect(broken, `${starter.id} ${scheme}: broken pictures`).toBe(0);
      expect(
        await headingContrast(page),
        `${starter.id} ${scheme}: heading contrast`
      ).toBeGreaterThanOrEqual(3);
      await testInfo.attach(`${starter.id}-1440-${scheme}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
    expect(asked, `${starter.id}: requests to other sites`).toEqual([]);
  });
}
