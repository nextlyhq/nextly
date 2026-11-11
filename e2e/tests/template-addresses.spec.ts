/**
 * A collection made in the Schema Builder is served at the template address
 * set in the admin, with no restart, and only someone allowed to manage
 * template routing may set it.
 *
 * The collection is made through the two calls the Schema Builder makes, its
 * template through the REST API the editor writes with, and its address in
 * the template's own form, as an author sets it. An anonymous visitor then
 * reads the entry at `<address>/<slug>`. A role that may update templates but
 * not change routing sees the address read-only.
 *
 * A production build turns the Schema Builder off and refuses its calls, so
 * this runs on the dev server (`DEV_SPECS` in `playwright.config.ts`).
 *
 * @module tests/template-addresses
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import {
  createEntry,
  createRuntimeCollection,
  expectOk,
  removeMigrationsOf,
} from "./support/runtime-collection";

// Makes a collection at runtime, as the Schema Builder specs do.
test.describe.configure({ lock: [LOCK.schema, LOCK.usersRoles] });

const RUN = Date.now().toString(36);

/** The template: the entry's title as its heading. */
const TEMPLATE = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    {
      id: "entry-title",
      type: "core/heading",
      version: 1,
      props: { text: "Untitled", level: "h1" },
      bindings: { text: { $bind: "title", fallback: "Untitled" } },
    },
  ],
};

/** A draft template for `collection`, answering its id. */
async function draftTemplate(
  api: APIRequestContext,
  collection: string
): Promise<string> {
  const created = await api.post("/admin/api/collections/templates/entries", {
    data: {
      title: `Template ${RUN}`,
      collection,
      content: TEMPLATE,
      status: "draft",
    },
  });
  await expectOk(created, "creating the template");
  return String(((await created.json()) as { item: { id: string } }).item.id);
}

/**
 * Give the public role read of `collection`, as a runtime collection starts
 * closed to visitors and its entries are served to them. Answers how to take
 * it back.
 */
async function letVisitorsRead(
  api: APIRequestContext,
  collection: string
): Promise<() => Promise<void>> {
  const roles = await api.get("/admin/api/roles?limit=100");
  await expectOk(roles, "listing the roles");
  const { items } = (await roles.json()) as {
    items: { id: string; builtIn?: string }[];
  };
  const publicRole = items.find(role => role.builtIn === "public");
  if (!publicRole) throw new Error("[e2e] No Public role.");
  const held = await api.get(`/admin/api/roles/${publicRole.id}/permissions`);
  await expectOk(held, "reading the Public role");
  const before = (
    (await held.json()) as { permissions: { id: string }[] }
  ).permissions.map(permission => permission.id);
  const list = await api.get("/admin/api/permissions?page=1&limit=1000");
  await expectOk(list, "listing the permissions");
  const read = (
    (await list.json()) as { items: { id: string; slug: string }[] }
  ).items.find(permission => permission.slug === `read-${collection}`);
  if (!read) throw new Error(`[e2e] No read permission for ${collection}.`);
  const store = async (permissionIds: string[]): Promise<void> => {
    const stored = await api.patch(`/admin/api/roles/${publicRole.id}`, {
      data: { permissionIds },
    });
    await expectOk(stored, "changing the Public role");
  };
  await store([...before, read.id]);
  return () => store(before);
}

/** The template form's address input. */
const addressInput = (page: Page) =>
  page.getByRole("textbox", { name: "Address", exact: true });

test("serves a Schema Builder collection's entries at the address set in the admin, with no restart", async ({
  page,
  request,
}) => {
  // A collection name is lowercase letters, digits and underscores.
  const slug = `happenings_${RUN}`;
  const address = `/happenings-${RUN}`;
  const api = page.request;
  let takeBackRead: (() => Promise<void>) | undefined;
  try {
    await createRuntimeCollection(api, slug, [
      { name: "summary", type: "text", label: "Summary" },
    ]);
    // Saved before the address is set: the template's publish claims it.
    const before = { title: `Opening night ${RUN}`, slug: `opening-${RUN}` };
    await createEntry(api, slug, before);
    const template = await draftTemplate(api, slug);
    takeBackRead = await letVisitorsRead(api, slug);

    // The Templates item sits in the page builder's menu.
    await gotoAdmin(page, "/collections/templates");
    await page.getByRole("link", { name: "Plugins", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Templates", exact: true }).first()
    ).toBeVisible();

    // The address, set and published in the template's own form.
    await gotoAdmin(page, `/collections/templates/${template}`);
    const input = addressInput(page);
    await expect(input).toBeEditable();
    await input.fill(address);
    await page
      .getByRole("button", { name: /^Publish/ })
      .first()
      .click();
    await expect
      .poll(async () => {
        const read = await api.get(
          `/admin/api/collections/templates/entries/${template}`
        );
        // A read by id answers the entry itself, without an envelope.
        const body = (await read.json()) as {
          address?: unknown;
          status?: unknown;
        };
        return [body.address, body.status];
      })
      .toEqual([address, "published"]);

    // Saved after the address was set: held there by its own save.
    const after = { title: `Closing night ${RUN}`, slug: `closing-${RUN}` };
    await createEntry(api, slug, after);

    for (const entry of [before, after]) {
      const response = await request.get(`${address}/${entry.slug}`, {
        headers: { cookie: "" },
      });
      expect(response.status(), `${address}/${entry.slug}`).toBe(200);
      expect(await response.text()).toContain(entry.title);
    }
  } finally {
    await takeBackRead?.();
    await removeMigrationsOf(slug);
  }
});

test("shows the address read-only to someone who may update templates but not change routing", async ({
  page,
  browser,
  playwright,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const slug = `routed_${RUN}`;
  const api = page.request;
  try {
    await createRuntimeCollection(api, slug, [
      { name: "summary", type: "text", label: "Summary" },
    ]);
    const template = await draftTemplate(api, slug);
    const admin = await playwright.request.newContext({
      baseURL,
      storageState: await page.context().storageState(),
    });
    const limited = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-templates",
      "update-templates",
    ]).finally(() => admin.dispose());
    try {
      const other = await limited.context.newPage();
      await gotoAdmin(other, `/collections/templates/${template}`);
      const input = addressInput(other);
      await expect(input).toBeVisible();
      await expect(input).not.toBeEditable();
      await expect(
        other.getByText(
          "Only someone allowed to manage template routing can set or change this address."
        )
      ).toBeVisible();
    } finally {
      await limited.context.close();
    }
  } finally {
    await removeMigrationsOf(slug);
  }
});
