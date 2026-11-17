/**
 * The Page Builder card on an entry's form, in a real browser.
 *
 * - It stays inside the form's column on a laptop screen, with the admin's
 *   sidebar and the document panel open or folded, and its "Open in builder"
 *   is on screen without scrolling sideways.
 * - Its picture of the page draws the page's images, the header's logo among
 *   them, as the builder's canvas draws them.
 * - Its list of sections is folded under "Sections (N)", and opens a section
 *   in the builder from the keyboard alone.
 * - On an entry never saved it offers "Save draft and open builder", which
 *   saves the draft under the form's own rules and then opens the builder, or
 *   leaves the author on the form with the errors when the rules refuse it.
 *
 * Every entry is made here, through the admin API, with its own stamp, so the
 * spec shares no document with any other.
 *
 * @module tests/page-builder-card-on-the-form
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { uploadImage } from "./support/media-upload";
import { test } from "./support/test";

const API = "/admin/api";
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

/** Where the admin keeps the document panel folded ("1") or shown ("0"). */
const DOCUMENT_PANEL_KEY = "nextly:admin:entry-rail-collapsed";
/** Where the admin keeps the pages screens' sidebar open ("1"). */
const SIDEBAR_KEY = "nextly:panel-open:collections/pages";

const SECTION_TITLES = ["Welcome", "Our work", "Pricing", "Contact"];

interface Seeded {
  pageId: string;
  /** The ids of the page's sections, in order. */
  sections: string[];
}

let seeded: Seeded | undefined;

async function idOf(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  what: string
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

function image(id: string, mediaId: string, alt: string) {
  return {
    id,
    type: "core/image",
    version: 1,
    props: { mediaId, alt, loading: "eager" },
  };
}

/** A section with a heading, and an image where one is given. */
function section(id: string, title: string, mediaId?: string) {
  return {
    id,
    type: "core/section",
    version: 1,
    props: {},
    slots: {
      children: [
        {
          id: `${id}-h`,
          type: "core/heading",
          version: 1,
          props: { text: title, level: "h2" },
        },
        ...(mediaId === undefined
          ? []
          : [image(`${id}-img`, mediaId, `${title} picture`)]),
      ],
    },
  };
}

/**
 * A page drawn inside a published header & footer set whose header shows a
 * logo, with an image block in its second section.
 */
async function seed(api: APIRequestContext): Promise<Seeded> {
  if (seeded !== undefined) return seeded;
  const logo = await uploadImage(api, `card-logo-${STAMP}`);
  const picture = await uploadImage(api, `card-picture-${STAMP}`);
  const header = await idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: `Card header ${STAMP}`,
        slug: `card-header-${STAMP}`,
        area: "header",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [image("logo", logo.id, "Site logo")],
        },
        status: "published",
      },
    }),
    "creating the header"
  );
  const layout = await idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: `Card set ${STAMP}`,
        slug: `card-set-${STAMP}`,
        areas: [{ area: "header", component: header }],
        status: "published",
      },
    }),
    "creating the header & footer set"
  );
  const sections = SECTION_TITLES.map((_, i) => `s${i + 1}`);
  const pageId = await idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `Card page ${STAMP}`,
        slug: `card-page-${STAMP}`,
        layout,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: SECTION_TITLES.map((title, i) =>
            section(sections[i]!, title, i === 1 ? picture.id : undefined)
          ),
        },
      },
    }),
    "creating the page"
  );
  seeded = { pageId, sections };
  return seeded;
}

/** The card, by the field's label region the admin draws around it. */
function card(page: Page): Locator {
  return page.locator('[data-slot="page-builder-card"]');
}

function openInBuilder(page: Page): Locator {
  return card(page).getByRole("link", { name: "Open in builder", exact: true });
}

/** Open the page's form with the sidebar shown and the panel as asked. */
async function openForm(
  page: Page,
  pageId: string,
  panel: "open" | "folded"
): Promise<void> {
  await page.addInitScript(
    ([panelKey, folded, sidebarKey]) => {
      window.localStorage.setItem(panelKey, folded);
      window.localStorage.setItem(sidebarKey, "1");
    },
    [DOCUMENT_PANEL_KEY, panel === "folded" ? "1" : "0", SIDEBAR_KEY] as const
  );
  await gotoAdmin(page, `/collections/pages/${pageId}`);
  await expect(openInBuilder(page)).toBeAttached({ timeout: 30_000 });
  const documentPanel = page.getByRole("complementary", {
    name: "Document panel",
  });
  if (panel === "folded") {
    await expect(documentPanel).toHaveCount(0);
    return;
  }
  // Below the width it docks at, the panel waits to be asked for.
  if (!(await documentPanel.isVisible())) {
    await page.getByRole("button", { name: "Show document panel" }).click();
  }
  await expect(documentPanel).toBeVisible();
}

/** A box's right edge, rounded so sub-pixel layout never reads as overflow. */
async function rightOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, "the element has no box").not.toBeNull();
  return Math.round(box!.x + box!.width);
}

for (const width of [1280, 1440]) {
  for (const panel of ["open", "folded"] as const) {
    test(`the card fits its column at ${width}px with the document panel ${panel}`, async ({
      page,
    }) => {
      const { pageId } = await seed(page.request);
      await page.setViewportSize({ width, height: 900 });
      await openForm(page, pageId, panel);

      // The card is no wider than the column the form gives it.
      const column = await card(page)
        .locator("xpath=..")
        .evaluate(element => element.getBoundingClientRect().right);
      expect(await rightOf(card(page))).toBeLessThanOrEqual(
        Math.round(column) + 1
      );

      // Nothing inside the card runs past it, and the page does not scroll
      // sideways.
      const spill = await card(page).evaluate(
        element => element.scrollWidth - element.clientWidth
      );
      expect(spill).toBeLessThanOrEqual(0);
      const pageSpill = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(pageSpill).toBeLessThanOrEqual(0);

      // "Open in builder" is wholly on screen once scrolled to vertically.
      const button = openInBuilder(page);
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport({ ratio: 1 });
      expect(await rightOf(button)).toBeLessThanOrEqual(Math.round(column) + 1);
      // Where the panel stands beside the fields, nothing of the card runs
      // under it; where it floats over them it is the panel's to cover.
      const documentPanel = page.getByRole("complementary", {
        name: "Document panel",
      });
      if (
        panel === "open" &&
        (await documentPanel.getAttribute("data-document-panel")) === "docked"
      ) {
        const beside = await documentPanel.boundingBox();
        expect(await rightOf(card(page))).toBeLessThanOrEqual(
          Math.round(beside!.x) + 1
        );
      }
    });
  }
}

/** How many images in `scope` have loaded a picture. */
async function drawnImages(scope: Locator): Promise<number> {
  return scope
    .locator("img")
    .evaluateAll(
      images =>
        images.filter(
          img =>
            (img as HTMLImageElement).complete &&
            (img as HTMLImageElement).naturalWidth > 0
        ).length
    );
}

test("the card's picture draws the page's images, the header's logo too, as the canvas does", async ({
  page,
}) => {
  const { pageId } = await seed(page.request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page, pageId, "open");

  const picture = card(page).locator('[data-slot="page-miniature"]');
  await picture.scrollIntoViewIfNeeded();
  // The logo and the section's picture.
  await expect.poll(() => drawnImages(picture), { timeout: 30_000 }).toBe(2);

  await openInBuilder(page).click();
  await expect(page).toHaveURL(/\/builder\?field=content$/);
  const canvas = canvasFrame(page).locator(".nx-canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => drawnImages(canvas), { timeout: 30_000 }).toBe(2);
});

test("the sections are folded under their count, and the keyboard opens the third", async ({
  page,
}) => {
  const { pageId, sections } = await seed(page.request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page, pageId, "open");

  const toggle = card(page).getByRole("button", {
    name: `Sections (${SECTION_TITLES.length})`,
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    card(page).getByRole("link", { name: /^Edit section 3,/ })
  ).toHaveCount(0);

  // From the Title field, by Tab alone, to the fold.
  await page
    .locator("main")
    .getByRole("textbox", { name: "Title", exact: true })
    .focus();
  for (let presses = 0; presses < 80; presses += 1) {
    if (await toggle.evaluate(element => element === document.activeElement)) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // On to the third section's row, and in.
  const third = card(page).getByRole("link", { name: /^Edit section 3,/ });
  for (let presses = 0; presses < 10; presses += 1) {
    if (await third.evaluate(element => element === document.activeElement)) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(third).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(
    new RegExp(
      `/admin/collections/pages/${pageId}/builder\\?field=content&section=${sections[2]}$`
    )
  );
});

/** A new post, its body set to the Page Builder so the card shows. */
async function newPostWithTheCard(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/collections/posts/create");
  await page.getByRole("combobox", { name: "Editor" }).click();
  await page.getByRole("option", { name: "Page Builder" }).click();
  const action = card(page).getByRole("button", {
    name: "Save draft and open builder",
    exact: true,
  });
  await expect(action).toBeEnabled({ timeout: 30_000 });
  return action;
}

test("a new post saves its draft and opens the builder", async ({ page }) => {
  const action = await newPostWithTheCard(page);
  const name = `Card post ${STAMP}`;
  await page
    .locator("main")
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(name);
  await action.click();

  await expect(page).toHaveURL(
    /\/admin\/collections\/posts\/(?!create)[^/?#]+\/builder\?field=sections$/,
    { timeout: 30_000 }
  );
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });

  // Saved as a draft under the title typed.
  const id = /\/posts\/([^/?#]+)\/builder/.exec(page.url())![1]!;
  const stored = await page.request.get(
    `${API}/collections/posts/entries/${id}`
  );
  expect(stored.ok()).toBe(true);
  const { item } = (await stored.json()) as {
    item: { title: string; status: string };
  };
  expect(item.title).toBe(name);
  expect(item.status).toBe("draft");
});

test("a new post the form's rules refuse stays on the form, with the errors shown", async ({
  page,
}) => {
  const action = await newPostWithTheCard(page);
  // The title is required, and left empty.
  await action.click();

  const title = page
    .locator("main")
    .getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/create$/);
  // Still the form, still offering the way in.
  await expect(action).toBeEnabled();
});
