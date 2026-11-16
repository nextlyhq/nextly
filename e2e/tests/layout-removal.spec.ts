/**
 * "Remove Layout…" on a Layout's edit screen: the dialog's three states, and
 * that it is the one way a Layout is taken down. With pages in the way it
 * offers only to move them to the site default first; the move itself is the
 * unit and integration suites'.
 *
 * Seeded through the admin API under unique names: a Layout no page uses, one
 * a page names, and the site's default as it stands. Nothing here changes the
 * default; the lock keeps a spec that does from changing it mid-test.
 *
 * @module tests/layout-removal.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.siteDefaultLayout] });

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const UNUSED = `Unused ${STAMP}`;
const USED = `Used ${STAMP}`;
const PAGE_TITLE = `Uses it ${STAMP}`;

interface Seeded {
  unused: string;
  used: string;
  pageId: string;
  defaultLayout: string;
}

let seeded: Seeded | undefined;

async function idOf(
  response: {
    ok(): boolean;
    status(): number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  },
  what: string
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function layout(api: APIRequestContext, title: string): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title,
        slug: title.toLowerCase().replaceAll(" ", "-"),
        areas: [],
        status: "published",
      },
    }),
    `creating ${title}`
  );
}

async function seed(page: Page): Promise<Seeded> {
  if (seeded !== undefined) return seeded;
  await gotoAdmin(page, "/");
  const api = page.request;
  const choices = (await (
    await api.get(`${PLUGIN}/layouts/choices`)
  ).json()) as { meta: { defaultLayout: string | null } };
  const defaultLayout = choices.meta.defaultLayout;
  expect(defaultLayout, "the site has a default Layout").not.toBeNull();
  const unused = await layout(api, UNUSED);
  const used = await layout(api, USED);
  const pageId = await idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: PAGE_TITLE,
        slug: `uses-it-${STAMP}`,
        layout: used,
      },
    }),
    "creating the page"
  );
  seeded = { unused, used, pageId, defaultLayout: String(defaultLayout) };
  return seeded;
}

/** Open a Layout's edit screen and its Remove Layout dialog. */
async function openRemove(page: Page, id: string) {
  await gotoAdmin(page, `/collections/layouts/${id}`);
  await page.getByRole("button", { name: "Remove Layout…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Remove Layout" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("refuses the site's default, saying why, with nothing to confirm", async ({
  page,
}) => {
  const { defaultLayout } = await seed(page);

  const dialog = await openRemove(page, defaultLayout);

  await expect(
    dialog.getByText(
      "This Layout is the site's default. Choose another default first."
    )
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Delete Layout" })
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("lists the pages that use a Layout, each opening the page, and offers only to move them first", async ({
  page,
}) => {
  const { used, pageId } = await seed(page);

  const dialog = await openRemove(page, used);

  await expect(
    dialog.getByText(
      /^1 page uses this Layout\. Move it to the site default, .+, and then delete or unpublish it, or close and choose another Layout for it yourself\.$/
    )
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Move 1 page, then delete" })
  ).toBeVisible();
  const link = dialog.getByRole("link", { name: PAGE_TITLE });
  await expect(link).toHaveAttribute(
    "href",
    `/admin/collections/pages/${pageId}`
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(
    dialog.getByRole("button", { name: "Delete Layout" })
  ).toHaveCount(0);
});

test("is the only way: the Layout's own delete is refused, naming it", async ({
  page,
}) => {
  const { unused } = await seed(page);
  await gotoAdmin(page, "/");
  const csrf = (await (await page.request.get(`${API}/auth/csrf`)).json()) as {
    token: string;
  };

  const refused = await page.request.delete(
    `${API}/collections/layouts/entries/${unused}`,
    {
      headers: {
        "x-csrf-token": csrf.token,
        origin: new URL(page.url()).origin,
      },
    }
  );

  expect(refused.status()).toBe(409);
  expect(await refused.text()).toContain(
    "Use Remove Layout… on the Layout's screen to take it down safely."
  );
});

test("deletes a Layout no page uses, after a confirm, and returns to the list", async ({
  page,
}) => {
  const { unused } = await seed(page);

  const dialog = await openRemove(page, unused);
  await expect(dialog.getByText(/No page uses this Layout\./)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Unpublish" })).toBeVisible();
  await dialog.getByRole("button", { name: "Delete Layout" }).click();

  await expect(page).toHaveURL(/\/admin\/collections\/layouts$/, {
    timeout: 30_000,
  });
  const gone = await page.request.get(
    `${API}/collections/layouts/entries/${unused}`
  );
  expect(gone.status()).toBe(404);
});
