/**
 * The builder's Pages panel beyond its pages, in a real browser on the dev
 * server: a header & footer set made the site default from its row's menu,
 * and a collection template opened from its row.
 *
 * Each test puts back what it changed: the site default it replaced, and the
 * template it made.
 *
 * @module builder-pages-panel-sets.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;

/** A run's own stamp, so what a test looks for is its own. */
const stamp = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The item an API write answered. */
async function itemOf(
  answer: Awaited<ReturnType<Page["request"]["post"]>>,
  what: string
): Promise<{ id: string }> {
  expect(
    answer.ok(),
    `${what}: ${answer.status()} ${await answer.text()}`
  ).toBe(true);
  const body = (await answer.json()) as { item?: { id?: unknown } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error(`${what} answered no id`);
  return { id };
}

/** A plugin route write, with the session's CSRF token, as the admin sends. */
async function writePlugin(page: Page, path: string, data: unknown) {
  const csrf = (await (await page.request.get(`${API}/auth/csrf`)).json()) as {
    token: string;
  };
  return page.request.post(`${PLUGIN}${path}`, {
    headers: { "x-csrf-token": csrf.token, origin: new URL(page.url()).origin },
    data,
  });
}

/** A published page to open the builder on. */
async function makePage(page: Page, title: string): Promise<string> {
  const created = await itemOf(
    await page.request.post(`${API}/collections/pages/entries`, {
      data: {
        title,
        slug: `panel-${stamp()}`,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "00000000-0000-4000-8000-00000000e001",
              type: "core/heading",
              version: 1,
              props: { text: title, level: "h2" },
            },
          ],
        },
      },
    }),
    "creating the page"
  );
  return created.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Opens the Pages panel from the rail, unless it is open already. */
async function openPagesPanel(page: Page): Promise<void> {
  const item = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Pages" });
  if ((await item.getAttribute("aria-pressed")) !== "true") await item.click();
  await expect(
    page.getByRole("button", { name: /^Header & footer, \d+$/ })
  ).toBeVisible();
}

test.describe("the Pages panel's sets and templates", () => {
  test.describe.configure({ timeout: 180_000 });

  test("makes a header & footer set the site default from its row's menu", async ({
    page,
  }) => {
    const run = stamp();
    const title = `Panel default ${run}`;
    await gotoAdmin(page, "/");
    const before = (await (
      await page.request.get(`${PLUGIN}/site/settings`)
    ).json()) as { defaultLayout: string | null };
    const header = await itemOf(
      await page.request.post(`${API}/collections/components/entries`, {
        data: {
          title: `Header ${run}`,
          slug: `header-${run}`,
          status: "published",
          content: {
            formatVersion: 1,
            kind: "component",
            nodes: [
              {
                id: "hdr",
                type: "core/heading",
                version: 1,
                props: { text: `Header ${run}`, level: "h2" },
              },
            ],
          },
        },
      }),
      "creating the header"
    );
    const set = await itemOf(
      await page.request.post(`${API}/collections/layouts/entries`, {
        data: {
          title,
          slug: `panel-default-${run}`,
          areas: [{ area: "header", component: header.id }],
          status: "published",
        },
      }),
      "creating the set"
    );
    try {
      await openBuilder(page, await makePage(page, `Panel page ${run}`));
      await openPagesPanel(page);
      const sets = page.getByRole("list", { name: "Header & footer sets" });
      await expect(
        sets.getByRole("link", { name: new RegExp(`^${title}`) })
      ).toBeVisible();
      await page.getByRole("button", { name: `More for ${title}` }).click();
      await page.getByRole("menuitem", { name: "Make site default" }).click();
      // Its row now names it the site default.
      await expect(
        sets.getByRole("link", { name: new RegExp(`^${title}`) })
      ).toContainText("Site default");
    } finally {
      if (before.defaultLayout !== null && before.defaultLayout !== set.id) {
        const back = await writePlugin(
          page,
          `/layouts/${encodeURIComponent(before.defaultLayout)}/make-default`,
          {}
        );
        expect(back.ok(), `putting the default back: ${back.status()}`).toBe(
          true
        );
      }
    }
  });

  test("opens a collection template in the builder from its row", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const choices = (await (
      await page.request.get(`${PLUGIN}/templates/collection-choices`)
    ).json()) as { items: Array<{ slug: string; label: string }> };
    const listed = (await (
      await page.request.get(`${PLUGIN}/templates/panel`)
    ).json()) as { items: Array<{ collection: string }> };
    const taken = new Set(listed.items.map(item => item.collection));
    const free = choices.items.find(choice => !taken.has(choice.slug));
    test.skip(free === undefined, "Every collection already has a template.");
    if (free === undefined) return;
    const made = await writePlugin(page, "/templates/actions", {
      action: { kind: "create-template", collection: free.slug },
    });
    expect(made.ok(), `making the template: ${made.status()}`).toBe(true);
    const id = ((await made.json()) as { item: { template: { id: string } } })
      .item.template.id;
    try {
      await openBuilder(page, await makePage(page, `Template page ${stamp()}`));
      await openPagesPanel(page);
      const templates = page.getByRole("list", {
        name: "Collection templates",
      });
      await templates
        .getByRole("button")
        .filter({ hasText: "Used by" })
        .first()
        .waitFor();
      await templates
        .getByRole("listitem")
        .filter({ hasText: "Draft" })
        .getByRole("button")
        .first()
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/collections/templates/${id}/builder`)
      );
    } finally {
      const removed = await writePlugin(page, "/templates/actions", {
        action: { kind: "delete-template", id },
      });
      expect(removed.ok(), `removing the template: ${removed.status()}`).toBe(
        true
      );
    }
  });
});
