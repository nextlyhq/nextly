/**
 * Messages with many emails: two hundred of the site's own beside core's and
 * the plugins', all shown in one grouped list. It must still draw promptly,
 * and search and the filters must still find any one of them.
 */
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { expectOk } from "./support/runtime-collection";
import { test } from "./support/test";
import { LOCK } from "./support/locks";

const COUNT = 200;
const RUN = Date.now().toString(36);
const nameOf = (i: number) => `Bulk ${RUN} ${String(i).padStart(3, "0")}`;

// One seeding for the whole file.
// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ mode: "serial", lock: [LOCK.email, LOCK.heavy] });

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
const created: string[] = [];

test.beforeAll(async ({ browser }, testInfo) => {
  // Two hundred creates through a dev server.
  test.setTimeout(300_000);
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  context = await browser.newContext({ baseURL, storageState: STORAGE_STATE });
  page = await context.newPage();
  await gotoAdmin(page, "");
  api = page.request;
  // In batches, so the seeding stays quick without flooding the dev server.
  for (let start = 0; start < COUNT; start += 20) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(20, COUNT - start) }, (_, k) => {
        const i = start + k;
        return api.post("/admin/api/email-templates", {
          data: {
            name: nameOf(i),
            slug: `bulk-${RUN}-${i}`,
            subject: `Bulk ${i}`,
            htmlContent: `<p>Bulk ${i}</p>`,
          },
        });
      })
    );
    for (const response of batch) {
      await expectOk(response, "create an email");
      created.push(
        ((await response.json()) as { item: { id: string } }).item.id
      );
    }
  }
});

test.afterAll(async () => {
  for (const id of created) {
    await api.delete(`/admin/api/email-templates/${id}`);
  }
  await context?.close();
});

test("draws two hundred emails promptly, grouped by owner", async () => {
  const started = Date.now();
  await gotoAdmin(page, "/email");
  const table = page.getByRole("table", { name: "Emails" });
  await expect(table.getByText(nameOf(COUNT - 1))).toBeVisible({
    timeout: 30_000,
  });
  const drawn = Date.now() - started;
  // Generous for a dev server, which compiles on demand; the point is that
  // the list does not grind, not a benchmark.
  expect(drawn, `drawn in ${drawn}ms`).toBeLessThan(20_000);
  await expect(
    table.getByRole("columnheader", {
      name: new RegExp(`^This site · ${COUNT}`),
    })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    )
  ).toBe(false);
});

test("search finds any one of them at once", async () => {
  await gotoAdmin(page, "/email");
  const table = page.getByRole("table", { name: "Emails" });
  await expect(table.getByText(nameOf(0))).toBeVisible({ timeout: 30_000 });

  const target = nameOf(173);
  const started = Date.now();
  await page.getByRole("searchbox", { name: "Search emails" }).fill(target);
  await expect(table.getByText(target)).toBeVisible();
  await expect(table.getByText(nameOf(172))).toHaveCount(0);
  const answered = Date.now() - started;
  expect(answered, `answered in ${answered}ms`).toBeLessThan(2_000);
});

test("the owner filter keeps only that owner's emails", async () => {
  await gotoAdmin(page, "/email");
  const table = page.getByRole("table", { name: "Emails" });
  await expect(table.getByText(nameOf(0))).toBeVisible({ timeout: 30_000 });

  await page.getByRole("combobox", { name: "Owner" }).click();
  await page.getByRole("option", { name: "Nextly" }).click();
  await expect(table.getByText(nameOf(0))).toHaveCount(0);
  await expect(
    table.getByRole("link", { name: "Welcome Email", exact: true })
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Owner" }).click();
  await page.getByRole("option", { name: "This site" }).click();
  await expect(table.getByText(nameOf(COUNT - 1))).toBeVisible();
  await expect(
    table.getByRole("link", { name: "Welcome Email", exact: true })
  ).toHaveCount(0);
});
