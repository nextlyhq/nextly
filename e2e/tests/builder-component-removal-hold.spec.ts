/**
 * Publishing a component that removes a field counts again: when more
 * documents place the component than the removal dialog said, the designer
 * is asked again with the new count, and nothing is published until they
 * agree.
 *
 * Each test makes its own component and pages through the admin API, so
 * nothing here reads or writes what another spec owns.
 *
 * @module tests/builder-component-removal-hold
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { block } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const COMPONENTS = `${API}/collections/components/entries`;
const PAGES = `${API}/collections/pages/entries`;

const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const HEADING = {
  id: "rh-heading",
  type: "core/heading",
  version: 1,
  props: { text: "A heading", level: "h2" },
};

const HEADLINE = {
  id: "headline",
  label: "Headline",
  nodeId: "rh-heading",
  propPath: "text",
  type: "text",
};

/** A published component exposing its headline; answers its id. */
async function publishedComponent(api: APIRequestContext): Promise<string> {
  const tag = stamp();
  const created = await api.post(COMPONENTS, {
    data: {
      title: `Removal ${tag}`,
      slug: `removal-${tag}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: [HEADING],
        exposed: [HEADLINE],
      },
    },
  });
  expect(created.ok(), `creating the component: ${created.status()}`).toBe(
    true
  );
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** A published page placing the component with its headline set. */
async function pagePlacing(
  api: APIRequestContext,
  componentId: string
): Promise<void> {
  const tag = stamp();
  const created = await api.post(PAGES, {
    data: {
      title: `Placing ${tag}`,
      slug: `placing-${tag}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "rh-place",
            type: "nextly/component-instance",
            version: 1,
            props: { componentId, overrides: { headline: "Set here" } },
          },
        ],
      },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
}

/** The ids the component's LIVE definition exposes. */
async function liveFields(
  api: APIRequestContext,
  id: string
): Promise<string[]> {
  const read = await api.get(`${COMPONENTS}/${id}?status=published`);
  expect(read.ok(), `reading the component: ${read.status()}`).toBe(true);
  type Stored = { content?: { exposed?: { id: string }[] } };
  const body = (await read.json()) as Stored & { item?: Stored };
  return ((body.item ?? body).content?.exposed ?? []).map(field => field.id);
}

/** Open the component, remove its headline, and hand back the dialog's words. */
async function removeHeadline(page: Page, id: string): Promise<string> {
  await gotoAdmin(page, `/collections/components/${id}/builder`);
  await expect(await block(page, "rh-heading")).toBeVisible({
    timeout: 30_000,
  });
  const list = page.getByRole("region", { name: "Fields" });
  await list.getByRole("button", { name: "Remove the field Headline" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Remove the field “Headline”?",
  });
  await expect(dialog).toContainText(
    /placed directly in (at least )?1 document/
  );
  const words = (await dialog.textContent()) ?? "";
  await dialog.getByRole("button", { name: "Remove field" }).click();
  await expect(dialog).toHaveCount(0);
  return words;
}

/**
 * Publish from the top bar: the leading action where it is Publish, else the
 * menu on the leading action's arrow, where a component with unsaved edits
 * keeps it.
 */
async function pressPublish(page: Page): Promise<void> {
  const bar = page.locator('[data-topbar="end"]');
  const leading = bar.getByRole("button", { name: /^Publish( changes)?$/ });
  if ((await leading.count()) > 0) {
    await leading.click();
    return;
  }
  await bar
    .getByRole("button", { name: /^More (ways to publish|document actions)$/ })
    .click();
  await page.getByRole("menuitem", { name: /^Publish( changes)?$/ }).click();
}

test.describe("publishing a component's removed field", () => {
  test.describe.configure({ timeout: 180_000 });

  test("asks again when more documents place it than the dialog said", async ({
    page,
  }) => {
    const id = await publishedComponent(page.request);
    await pagePlacing(page.request, id);
    await removeHeadline(page, id);
    // Placed once more after the designer was told.
    await pagePlacing(page.request, id);

    await pressPublish(page);

    const asked = page.getByRole("alertdialog", {
      name: "More documents use this component now",
    });
    await expect(asked).toBeVisible();
    await expect(asked).toContainText(
      /was placed directly in (at least )?1 document\. It is now placed in (at least )?2 documents\./
    );
    // Nothing went live while the designer is asked.
    expect(await liveFields(page.request, id)).toEqual(["headline"]);

    await asked.getByRole("button", { name: "Publish and remove" }).click();
    await expect(asked).toHaveCount(0);
    await expect
      .poll(() => liveFields(page.request, id), { timeout: 15_000 })
      .toEqual([]);
  });

  test("publishes nothing when the designer cancels", async ({ page }) => {
    const id = await publishedComponent(page.request);
    await pagePlacing(page.request, id);
    await removeHeadline(page, id);
    await pagePlacing(page.request, id);

    await pressPublish(page);
    const asked = page.getByRole("alertdialog", {
      name: "More documents use this component now",
    });
    await asked.getByRole("button", { name: "Cancel" }).click();

    await expect(asked).toHaveCount(0);
    expect(await liveFields(page.request, id)).toEqual(["headline"]);
  });
});
