/**
 * A container with a content width of its own boxes its content to that
 * width, and a Boxed container inside it still boxes to the site's.
 *
 * Layout is the claim, so it is measured in a real browser on a real published
 * page: a unit test can check the CSS text, not where a heading lands.
 *
 * Safe to write against: the suite owns its database and empties it before
 * every run.
 */
import { expect, type APIResponse, type Page } from "@playwright/test";

import { fileAccount, test } from "./support/test";

test.describe.configure({ mode: "serial" });

const ENTRIES = "/admin/api/collections/block-pages/entries";
const SLUG = "own-content-width";

/** A window wide enough that every width here is narrower than the page. */
const WIDE = { width: 1600, height: 900 };

/** The width the outer section states for itself. */
const OWN = 1400;

const id = (suffix: string) => `00000000-0000-4000-8000-0000000002${suffix}`;

const text = (suffix: string, words: string) => ({
  id: id(suffix),
  type: "core/text",
  version: 1,
  props: { text: words },
});

const block = (
  suffix: string,
  type: string,
  props: Record<string, unknown>,
  children: unknown[]
) => ({
  id: id(suffix),
  type,
  version: 1,
  props,
  slots: { children },
});

const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    block(
      "01",
      "core/section",
      { as: "section", contained: true, contentWidth: `${OWN}px` },
      [
        text("02", "Own width band"),
        block("03", "core/box", { as: "div", contained: true }, [
          text("04", "Boxed inside the band"),
        ]),
      ]
    ),
    block(
      "05",
      "core/section",
      {
        as: "section",
        contained: true,
        contentWidth: { $token: "content.no-such-width" },
      },
      [text("06", "Missing variable band")]
    ),
    block("07", "core/section", { as: "section", contained: true }, [
      text("08", "Site width band"),
    ]),
  ],
};

async function expectOk(response: APIResponse, what: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${await response.text()}`
    );
  }
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    const created = await api.post(ENTRIES, {
      data: {
        title: "Own content width",
        slug: SLUG,
        content: DOCUMENT,
        status: "published",
      },
    });
    // A rerun against a kept database finds the row already there.
    if (created.status() !== 409) await expectOk(created, "seeding the page");
  } finally {
    await api.dispose();
  }
});

/** Where a text's own element starts and ends. */
async function edges(
  page: Page,
  words: string
): Promise<{ left: number; right: number }> {
  return page.getByText(words, { exact: true }).evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  });
}

/** A site length, resolved by the browser. */
async function length(page: Page, value: string): Promise<number> {
  return page.evaluate(css => {
    const probe = document.createElement("div");
    probe.style.width = css;
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  }, value);
}

const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(1);

async function open(page: Page) {
  await page.setViewportSize(WIDE);
  const response = await page.goto(`/blocks/${SLUG}`);
  expect(response?.status()).toBe(200);
  const pageWidth = await page.evaluate(
    () => document.documentElement.clientWidth
  );
  const site = await length(page, "var(--site-content-width)");
  const gutter = await length(page, "var(--site-space-gutter)");
  // The site's width must resolve and be narrower than the section's own,
  // or the two would box alike and prove nothing.
  expect(site).toBeGreaterThan(0);
  expect(site).toBeLessThan(OWN - 2 * gutter);
  expect(OWN).toBeLessThan(pageWidth - 2 * gutter);
  return { pageWidth, site };
}

test("a section with a width of its own boxes its content to it", async ({
  page,
}) => {
  const { pageWidth } = await open(page);
  const own = await edges(page, "Own width band");
  near(own.left, (pageWidth - OWN) / 2);
  near(own.right, pageWidth - (pageWidth - OWN) / 2);
});

test("a Boxed block inside it boxes to the site's width, not the section's", async ({
  page,
}) => {
  const { pageWidth, site } = await open(page);
  const inner = await edges(page, "Boxed inside the band");
  near(inner.left, (pageWidth - site) / 2);
  near(inner.right, pageWidth - (pageWidth - site) / 2);
});

test("a width naming a variable the site doesn't have boxes to the site's width", async ({
  page,
}) => {
  const { pageWidth, site } = await open(page);
  const missing = await edges(page, "Missing variable band");
  near(missing.left, (pageWidth - site) / 2);
  // CONTROL: a section stating no width boxes to the same.
  near((await edges(page, "Site width band")).left, (pageWidth - site) / 2);
});
