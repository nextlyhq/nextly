/**
 * "Make this a setting of the component", from a placement inside a list.
 *
 * A Card's kicker is not one of its settings. From the placement's panel the
 * kicker's text is made a setting named after the field picked, each post's
 * Title: the canvas shows every post's own title at once, and the page's
 * Publish writes the setting to the Card and publishes both, so a visitor
 * sees the titles too. A refused component write takes the binding back off,
 * says why, and "Save again" stores the page without it.
 *
 * @module tests/builder-make-component-setting.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const POSTS = "/admin/api/collections/bound-entries/entries";
const COMPONENTS = "/admin/api/collections/components/entries";

const LIST = "00000000-0000-4000-8000-0000002008a1";
const PLACEMENT = "00000000-0000-4000-8000-0000002008a2";

async function created(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<string> {
  const response = await api.post(endpoint, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/**
 * Two published posts of this run, a published Card whose kicker is no
 * setting yet, and a draft page whose posts list places the Card.
 */
async function seed(
  api: APIRequestContext,
  mark: string
): Promise<{ page: string; card: string; slug: string; posts: string[] }> {
  const posts = ["Alder", "Birch"].map(name => `${mark} post ${name}`);
  for (const title of posts) {
    await created(api, POSTS, { title, status: "published" });
  }
  const card = await created(api, COMPONENTS, {
    title: `${mark} card`,
    slug: `make-setting-card-${mark.toLowerCase()}`,
    status: "published",
    content: {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "card-heading",
          type: "core/heading",
          version: 1,
          props: { text: "Plain card", level: "h3" },
        },
        {
          id: "card-kicker",
          type: "core/heading",
          name: "Kicker",
          version: 1,
          props: { text: "New", level: "h4" },
        },
      ],
      exposed: [
        {
          id: "headline",
          label: "Headline",
          nodeId: "card-heading",
          propPath: "text",
          type: "text",
        },
      ],
    },
  });
  const slug = `make-setting-${mark.toLowerCase()}`;
  const page = await created(api, PAGES, {
    title: `${mark} make setting page`,
    slug,
    status: "draft",
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: LIST,
          type: "core/collection-loop",
          version: 1,
          props: {
            collection: "bound-entries",
            limit: 10,
            sort: "title",
            filters: [{ field: "title", op: "contains", value: mark }],
          },
          slots: {
            children: [
              {
                id: PLACEMENT,
                type: "nextly/component-instance",
                version: 1,
                props: { componentId: card },
              },
            ],
          },
        },
      ],
    },
  });
  return { page, card, slug, posts };
}

/** The Card's kickers the canvas draws, in order. */
async function kickers(page: Page): Promise<string[]> {
  const root = await canvasRoot(page);
  return root
    .locator(
      `[data-nx-instance="${PLACEMENT}"] h4, h4[data-nx-instance="${PLACEMENT}"]`
    )
    .allTextContents();
}

/** Open the page, select the placement and make the kicker each post's title. */
async function makeKickerTheTitle(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect
    .poll(() => kickers(page), { timeout: 60_000 })
    .toEqual(["New", "New"]);
  const root = await canvasRoot(page);
  await root
    .locator(
      `[data-nx-instance="${PLACEMENT}"] h3, h3[data-nx-instance="${PLACEMENT}"]`
    )
    .first()
    .click();
  const section = page.getByRole("region", {
    name: "Make this a setting of the component",
  });
  await section
    .getByRole("button", {
      name: "Make Kicker · Text a setting, bound to a field",
    })
    .click();
  await page
    .getByRole("listbox", { name: "Fields for Kicker · Text" })
    .getByRole("group", { name: "Each blog post in the list" })
    .getByRole("option", { name: /^Title/ })
    .click();
  await expect(section.getByRole("status")).toContainText("is a setting of");
}

/** A stored document's content, as the admin reads it, drafts included. */
async function stored(
  api: APIRequestContext,
  endpoint: string,
  id: string
): Promise<{ exposed?: { label: string }[]; nodes: unknown[] }> {
  const read = await api.get(`${endpoint}/${id}?status=all`);
  expect(read.ok()).toBe(true);
  const body = (await read.json()) as {
    item?: { content?: unknown };
    content?: unknown;
  };
  return (body.item?.content ?? body.content) as {
    exposed?: { label: string }[];
    nodes: unknown[];
  };
}

test.describe("making a component's block a setting from a placement", () => {
  test.describe.configure({ timeout: 300_000 });

  test("the canvas shows each post's title at once, and Publish writes the setting and shows it to visitors", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `M${Date.now().toString(36)}`;
    const seeded = await seed(page.request, mark);
    await makeKickerTheTitle(page, seeded.page);
    // Drawn from the planned Card before anything is written.
    await expect
      .poll(() => kickers(page), { timeout: 30_000 })
      .toEqual(seeded.posts);
    expect(
      (await stored(page.request, COMPONENTS, seeded.card)).exposed?.map(
        each => each.label
      )
    ).toEqual(["Headline"]);

    await page
      .locator('[data-topbar="end"]')
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await stored(page.request, COMPONENTS, seeded.card)).exposed?.map(
            each => each.label
          ),
        { timeout: 30_000 }
      )
      .toEqual(["Headline", "Title"]);

    await page.goto(`/${seeded.slug}`);
    const titles = page.locator(".nx-pb-page h4");
    await expect(titles.first()).toBeVisible({ timeout: 60_000 });
    await expect(titles).toHaveText(seeded.posts);
  });

  test("a refused write takes the binding back off, says why, and Save again stores the page without it", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `R${Date.now().toString(36)}`;
    const seeded = await seed(page.request, mark);
    // The plan is answered; the write is refused as a component changed since.
    await page.route(/\/components\/[^/]+\/definition/, async route => {
      try {
        const body = route.request().postDataJSON() as { dryRun?: boolean };
        if (body.dryRun === true) {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "CONFLICT",
              message: "This component was changed since it was read.",
            },
          }),
        });
      } catch {
        await route.fallback();
      }
    });
    await makeKickerTheTitle(page, seeded.page);
    await expect
      .poll(() => kickers(page), { timeout: 30_000 })
      .toEqual(seeded.posts);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    const refusal = page.getByText(
      /wasn't added to .* card, so this page's binding to it was taken off/
    );
    await expect(refusal).toBeVisible({ timeout: 30_000 });
    // Taken back off: the kicker shows the Card's own text again.
    await expect
      .poll(() => kickers(page), { timeout: 30_000 })
      .toEqual(["New", "New"]);

    await page.getByRole("button", { name: "Save again" }).click();
    await expect
      .poll(
        async () => {
          const content = await stored(page.request, PAGES, seeded.page);
          const list = content.nodes[0] as {
            slots?: { children?: { bindings?: unknown }[] };
          };
          return list.slots?.children?.[0] ?? null;
        },
        { timeout: 30_000 }
      )
      .toMatchObject({ props: { componentId: seeded.card } });
    const content = await stored(page.request, PAGES, seeded.page);
    const list = content.nodes[0] as {
      slots: { children: { bindings?: unknown }[] };
    };
    expect(list.slots.children[0]?.bindings).toBeUndefined();
    expect(
      (await stored(page.request, COMPONENTS, seeded.card)).exposed?.map(
        each => each.label
      )
    ).toEqual(["Headline"]);
  });
});
