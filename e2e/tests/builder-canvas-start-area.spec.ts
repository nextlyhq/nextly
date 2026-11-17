/**
 * The start area an empty page shows, in the real editor, and the panels
 * around it.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - On an empty page with a header and a footer, the start area holds the
 *   page's own heading, both buttons and the line about dragging, and sits
 *   in the body: below the header's box and above the footer's, with no
 *   overlap, at Fit and at 100%, its text the same size at both. A card
 *   centred on the screen lands on the footer.
 * - "＋ Add a block" opens the picker by the button and adds at the page's
 *   top level, with the left side open and hidden; "Insert a saved section"
 *   opens Add on its Saved sections tab with focus in its search, and a
 *   saved section clicked there lands at the top level.
 * - A Heading dragged from Add onto the start area lands at the top level,
 *   and the area shows as where it drops while it is dragged.
 * - By keyboard alone: Tab to "＋ Add a block", Enter, Enter, and the caret
 *   is in the new Heading.
 * - An empty page opens on Add, though Layers was last open; with the left
 *   side hidden, it stays hidden. Selecting, deselecting and emptying a page
 *   neither opens nor closes a side, nor changes the canvas's width.
 * - The published empty page draws no start area.
 *
 * Each test makes its own pages, named uniquely, so no lock is needed: the
 * Layout is the page's own choice, not the site's default.
 *
 * @module tests/builder-canvas-start-area.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { canvasRoot, structure } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const PAGES = `${API}/collections/pages/entries`;
const PATTERNS = `${API}/collections/patterns/entries`;

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function created(
  request: APIRequestContext,
  url: string,
  data: Record<string, unknown>
): Promise<string> {
  const answer = await request.post(url, { data });
  expect(answer.ok(), `seeding ${url}: ${await answer.text()}`).toBe(true);
  return ((await answer.json()) as { item: { id: string } }).item.id;
}

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

/** A Layout with a header and a footer, each a component of one heading. */
async function createLayout(request: APIRequestContext): Promise<string> {
  const t = stamp();
  const part = (area: string) =>
    created(request, `${API}/collections/components/entries`, {
      title: `Start ${area} ${t}`,
      slug: `start-${area}-${t}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: [heading(`${area}-h`, `The ${area}`)],
      },
    });
  const header = await part("header");
  const footer = await part("footer");
  return created(request, `${API}/collections/layouts/entries`, {
    title: `Start layout ${t}`,
    slug: `start-layout-${t}`,
    areas: [
      { area: "header", component: header },
      { area: "footer", component: footer },
    ],
    status: "published",
  });
}

/** An empty page titled "About us …", in its own Layout, and its title. */
async function createEmptyPage(
  request: APIRequestContext,
  nodes: readonly object[] = []
): Promise<{ id: string; title: string }> {
  const t = stamp();
  const layout = await createLayout(request);
  const title = `About us ${t}`;
  const id = await created(request, PAGES, {
    title,
    slug: `about-us-${t}`,
    status: "draft",
    layout,
    content: { formatVersion: 1, kind: "page", nodes },
  });
  return { id, title };
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

function startArea(page: Page): Locator {
  return page.locator(".nx-page-start");
}

function addBlock(page: Page): Locator {
  return startArea(page).getByRole("button", { name: "Add a block" });
}

function savedSection(page: Page): Locator {
  return startArea(page).getByRole("button", {
    name: "Insert a saved section",
  });
}

function picker(page: Page): Locator {
  return page.getByRole("dialog", { name: "Add a block" });
}

function railButton(page: Page, name: string): Locator {
  return page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name, exact: true });
}

function leftToggle(page: Page): Locator {
  return page.getByRole("button", { name: "Left panel", exact: true });
}

/** Hide the left side with its own toggle, as an author would. */
async function hideLeft(page: Page): Promise<void> {
  if ((await leftToggle(page).getAttribute("aria-pressed")) === "true") {
    await leftToggle(page).click();
  }
  await expect(leftToggle(page)).toHaveAttribute("aria-pressed", "false");
}

/** The page's top-level blocks, in page order. */
async function topLevel(page: Page): Promise<string[]> {
  return (await structure(page)).filter(entry => !entry.includes(">"));
}

async function chooseZoom(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: /^Canvas zoom:/ }).click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}

test.describe("the start area of an empty page", () => {
  test.describe.configure({ timeout: 240_000 });

  test("sits in the body between the header and the footer, at Fit and at 100%", async ({
    page,
  }) => {
    const { id, title } = await createEmptyPage(page.request);
    await openBuilder(page, id);
    const area = startArea(page);
    await expect(
      area.getByRole("heading", { name: `Start building ${title}` })
    ).toBeVisible();
    await expect(addBlock(page)).toBeVisible();
    await expect(savedSection(page)).toBeVisible();
    await expect(area.getByText("or drag a block here")).toBeVisible();

    const root = await canvasRoot(page);
    const header = root.locator('[data-nx-region="header"]');
    const footer = root.locator('[data-nx-region="footer"]');
    const sizes: string[] = [];
    for (const zoom of ["Fit", "100%"]) {
      if (zoom !== "Fit") await chooseZoom(page, zoom);
      await footer.scrollIntoViewIfNeeded();
      await expect
        .poll(async () => {
          const [a, h, f] = await Promise.all([
            area.boundingBox(),
            header.boundingBox(),
            footer.boundingBox(),
          ]);
          if (a === null || h === null || f === null) return "unmeasured";
          return a.y >= h.y + h.height - 1 && a.y + a.height <= f.y + 1
            ? "between"
            : `area ${a.y}–${a.y + a.height}, header ends ${h.y + h.height}, footer starts ${f.y}`;
        }, zoom)
        .toBe("between");
      sizes.push(
        await area
          .getByRole("heading")
          .evaluate(element => getComputedStyle(element).fontSize)
      );
    }
    // At the builder's own size whatever the zoom.
    expect(sizes[0]).toBe(sizes[1]);
    // Back to Fit, which the author's preferences keep for the next test.
    await chooseZoom(page, "Fit");
  });

  test("adds a block at the top level through the picker, with the left side open and hidden", async ({
    page,
  }) => {
    for (const hidden of [false, true]) {
      const { id } = await createEmptyPage(page.request);
      await openBuilder(page, id);
      if (hidden) await hideLeft(page);
      await addBlock(page).click();
      await expect(picker(page)).toHaveAccessibleDescription(
        "Adding at the end of the page"
      );
      // Beside the button it opened from.
      const [button, box] = await Promise.all([
        addBlock(page).boundingBox(),
        picker(page).boundingBox(),
      ]);
      if (button !== null && box !== null) {
        expect(Math.abs(box.y - (button.y + button.height))).toBeLessThan(
          box.height + button.height + 32
        );
      }
      await picker(page).getByRole("gridcell", { name: "Heading" }).click();
      await expect.poll(() => topLevel(page)).toHaveLength(1);
      await expect(startArea(page)).toHaveCount(0);
    }
  });

  test("inserts a saved section from its own tab, with the left side open and hidden", async ({
    page,
  }) => {
    const t = stamp();
    const name = `Pricing band ${t}`;
    await created(page.request, PATTERNS, {
      title: name,
      slug: `pricing-band-${t}`,
      granularity: "section",
      status: "published",
      content: {
        formatVersion: 1,
        kind: "pattern",
        nodes: [heading("band", "A saved band")],
      },
    });
    for (const hidden of [false, true]) {
      const { id } = await createEmptyPage(page.request);
      await openBuilder(page, id);
      if (hidden) await hideLeft(page);
      await savedSection(page).click();
      await expect(
        page.getByRole("tab", { name: "Saved sections" })
      ).toHaveAttribute("aria-selected", "true");
      const search = page.getByRole("combobox", { name: "Insert a block" });
      await expect(search).toBeFocused();
      await search.fill(name);
      await page.getByRole("option", { name: new RegExp(name) }).click();
      await expect.poll(async () => (await topLevel(page)).length).toBe(1);
    }
  });

  test("takes a Heading dragged onto it at the top level, shown as where it drops", async ({
    page,
  }) => {
    const { id } = await createEmptyPage(page.request);
    await openBuilder(page, id);
    if (
      (await railButton(page, "Add").getAttribute("aria-pressed")) !== "true"
    ) {
      await railButton(page, "Add").click();
    }
    await startArea(page).scrollIntoViewIfNeeded();
    const from = await page
      .getByRole("option", { name: "Heading", exact: true })
      .boundingBox();
    const to = await startArea(page).boundingBox();
    if (from === null || to === null) throw new Error("[e2e] no boxes");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
    // The drag under way: the area shows as where it drops.
    await expect(startArea(page)).toHaveAttribute("data-drop-target", "");
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect.poll(() => topLevel(page)).toHaveLength(1);
  });

  test("adds a first block by keyboard alone, the caret then in it", async ({
    page,
  }) => {
    const { id } = await createEmptyPage(page.request);
    await openBuilder(page, id);
    const add = addBlock(page);
    for (let press = 0; press < 120; press += 1) {
      if (await add.evaluate(element => element === document.activeElement)) {
        break;
      }
      await page.keyboard.press("Tab");
    }
    await expect(add).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      picker(page).getByRole("combobox", { name: "Search blocks" })
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => topLevel(page)).toHaveLength(1);
    const [added] = await topLevel(page);
    await expect
      .poll(async () =>
        (await canvasRoot(page)).evaluate(root => {
          const active = root.ownerDocument.activeElement;
          return (
            active?.closest("[data-nx-node]")?.getAttribute("data-nx-node") ??
            null
          );
        })
      )
      .toBe(added);
  });
});

test.describe("the panels around an empty page", () => {
  test.describe.configure({ timeout: 240_000 });

  test("an empty page opens on Add though Layers was last open, and a hidden left side stays hidden", async ({
    page,
  }) => {
    // Layers left open on a page with a block.
    const full = await createEmptyPage(page.request, [
      heading("00000000-0000-4000-8000-0000000c7001", "A block"),
    ]);
    await openBuilder(page, full.id);
    if (
      (await railButton(page, "Layers").getAttribute("aria-pressed")) !== "true"
    ) {
      await railButton(page, "Layers").click();
    }
    await expect(railButton(page, "Layers")).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    const empty = await createEmptyPage(page.request);
    await openBuilder(page, empty.id);
    await expect(railButton(page, "Add")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(
      page.getByRole("combobox", { name: "Insert a block" })
    ).toBeVisible();

    // Hidden by the author, it stays hidden on the next empty page; the
    // start area still offers both ways in.
    await hideLeft(page);
    const next = await createEmptyPage(page.request);
    await openBuilder(page, next.id);
    await expect(leftToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("combobox", { name: "Insert a block" })
    ).toBeHidden();
    await expect(addBlock(page)).toBeVisible();
    await expect(savedSection(page)).toBeVisible();
  });

  test("selecting, deselecting and emptying a page opens or closes no side", async ({
    page,
  }) => {
    const BLOCK = "00000000-0000-4000-8000-0000000c7002";
    const { id } = await createEmptyPage(page.request, [
      heading(BLOCK, "Only block"),
    ]);
    await openBuilder(page, id);
    const sides = async () => ({
      left: await leftToggle(page).getAttribute("aria-pressed"),
      inspector: await page
        .getByRole("button", { name: "Inspector", exact: true })
        .getAttribute("aria-pressed"),
      width: Math.round(
        (await page.getByRole("region", { name: "Canvas" }).boundingBox())
          ?.width ?? 0
      ),
    });
    const before = await sides();
    const block = (await canvasRoot(page)).locator(`[data-nx-node="${BLOCK}"]`);
    await block.click();
    expect(await sides()).toEqual(before);
    await page.keyboard.press("Escape");
    expect(await sides()).toEqual(before);
    // Emptied: the block selected again and deleted.
    await block.click();
    await page.keyboard.press("Delete");
    await expect(startArea(page)).toBeVisible();
    expect(await sides()).toEqual(before);
  });
});

test("the published empty page draws no start area", async ({ page }) => {
  const t = stamp();
  const slug = `empty-start-${t}`;
  await created(page.request, `${API}/collections/block-pages/entries`, {
    title: `Empty start ${t}`,
    slug,
    status: "published",
    content: { formatVersion: 1, kind: "page", nodes: [] },
  });
  const response = await page.goto(`/blocks/${slug}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText(/^Start building/)).toHaveCount(0);
  await expect(page.locator(".nx-page-start")).toHaveCount(0);
  // Nothing holds an empty body open for visitors.
  expect(
    await page.evaluate(
      () => document.querySelector("[style*='--nx-canvas-start-room']") !== null
    )
  ).toBe(false);
});
