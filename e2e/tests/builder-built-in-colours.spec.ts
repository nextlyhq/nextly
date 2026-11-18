/**
 * "Show built-in colours" at the end of the Colours tab, in the browser.
 *
 * - Turned off on a site where only Primary is used, the Colours list and a
 *   block's colour picker show Primary, marked "Built-in", and the site's
 *   own colours; the other built-in colours are gone. It is saved at once,
 *   a second author sees the same, and Undo and Redo reverse it.
 * - It is reached and changed with the keyboard alone.
 * - At the panel's narrowest it fits, in light and dark, and the Colours tab
 *   passes the accessibility scan.
 * - A role that may read Design but not change it sees it and can't change
 *   it, and the site style write refuses it.
 */
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  clickBlock,
  OPEN_BUILDER_ACTION,
  openEditorWith,
  PAGE_BUILDER_CARD,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage, writeHeaders } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const HOMEPAGE = "/admin/api/singles/homepage";
const PAGES = "/admin/api/collections/pages/entries";

/** The site's own colour, beside the built-in ones. */
const OWN = {
  name: "color.own-accent",
  label: "Own accent",
  group: "Mine",
  kind: "color",
  values: { light: "#7a3b10" },
};

/** The built-in colours, by code name and by the name the list shows. */
const BUILT_INS: Readonly<Record<string, string>> = {
  "color.primary": "Primary",
  "color.text": "Text",
  "color.background": "Background",
  "color.surface": "Surface",
  "color.border": "Border",
  "color.border-strong": "Strong border",
  "color.muted": "Muted text",
};

/** The homepage's one block, coloured Primary: the site's one use of one. */
const NODES = [
  {
    id: "built-in-text",
    type: "core/text",
    version: 1,
    props: { text: "A page using Primary" },
    styles: { base: { base: { color: { $token: "color.primary" } } } },
  },
];

const SETTING = "Show built-in colours";
const HINT = "Hidden colours still work where core blocks use them";

interface StoredSet {
  tokens?: unknown[];
  builtInColoursShown?: boolean;
}

async function storedTokens(api: APIRequestContext): Promise<StoredSet | null> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const raw = item.tokens ?? null;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredSet | null;
}

/** Whether the stored site style shows the built-in colours: unset is yes. */
async function storedShown(api: APIRequestContext): Promise<boolean> {
  return (await storedTokens(api))?.builtInColoursShown !== false;
}

async function seedTokens(page: Page, tokens: unknown): Promise<void> {
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

/**
 * The site with its own colour and the homepage using Primary, counted, so
 * the usage the list reads is whole.
 */
async function seed(page: Page): Promise<void> {
  await seedTokens(page, { tokens: [OWN] });
  const stored = await page.request.patch(HOMEPAGE, {
    data: {
      layout: { formatVersion: 1, kind: "page", nodes: NODES },
      _overwrite: true,
    },
  });
  expect(stored.ok(), `seeding the homepage: ${stored.status()}`).toBe(true);
  await countEveryPage(page.request);
}

/**
 * The site the criterion names, where of the built-in colours only Primary
 * is used: the playground's own seeded pages use the others, so the usage
 * read is answered as the server answers it, with every other built-in
 * colour's uses taken away. The site's own colours keep the server's answer.
 */
async function onlyPrimaryUsed(context: BrowserContext): Promise<void> {
  await context.route("**/variables/usage?**", async route => {
    try {
      const response = await route.fetch();
      const body = (await response.json()) as {
        variables: Record<string, Record<string, unknown>>;
      };
      for (const [id, reach] of Object.entries(body.variables)) {
        if (!(id in BUILT_INS) || id === "color.primary") continue;
        Object.assign(reach, {
          documents: 0,
          byKind: { pages: 0, components: 0, patterns: 0, layouts: 0 },
          sharedStyles: [],
          variables: [],
          siteText: [],
          complete: true,
        });
      }
      await route.fulfill({ response, json: body });
    } catch {
      await route.abort();
    }
  });
}

/** The Design panel's Colours tab, opened. */
async function openColours(page: Page): Promise<Locator> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: /^Colours/ }).click();
  return panel;
}

/** The colour rows the Colours tab lists, by the name shown. */
function listed(panel: Locator): Promise<string[]> {
  return panel
    .locator('[data-group="colours"] .nx-vars__row .nx-vars__name')
    .allTextContents();
}

/** The colours a block's colour picker offers, by the text of each option. */
async function offered(page: Page): Promise<string[]> {
  await clickBlock(page, "built-in-text");
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  const text = inspector.getByRole("button", {
    name: /^Text(\s?has changes)?$/,
  });
  if ((await text.getAttribute("aria-expanded")) !== "true") {
    await text.click();
  }
  await expect(text).toHaveAttribute("aria-expanded", "true");
  await inspector.getByRole("button", { name: /^Colour for Colou?r/ }).click();
  const list = page.getByRole("listbox", { name: "Colour variables" });
  await expect(list).toBeVisible();
  const options = await list.getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  return options;
}

/** The names among `options` that each start with one of `names`. */
function namedIn(options: readonly string[], names: readonly string[]) {
  return names.filter(name =>
    options.some(option => option.trim().startsWith(name))
  );
}

test("turned off where only Primary is used, the list and a block's picker show Primary and the site's own; every author sees it, and Undo and Redo reverse it", async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  const baseURL = test.info().project.use.baseURL ?? "";
  const before = await storedTokens(page.request);
  const second = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
    "read-site-style",
    "update-site-style",
  ]);
  let created: string | undefined;
  try {
    await seed(page);
    await onlyPrimaryUsed(page.context());
    await onlyPrimaryUsed(second.context);
    const hiddenNames = Object.values(BUILT_INS).filter(
      name => name !== "Primary"
    );

    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "built-in-text");
    const panel = await openColours(page);
    const setting = panel.getByRole("checkbox", { name: SETTING });
    await expect(setting).toHaveAttribute("aria-checked", "true");
    await expect(setting).toHaveAccessibleDescription(HINT);
    // The control: on, every built-in colour is listed and offered.
    await expect
      .poll(() => listed(panel))
      .toEqual([...Object.values(BUILT_INS), "Own accent"]);
    expect(namedIn(await offered(page), hiddenNames)).toEqual(hiddenNames);

    await (await openColours(page))
      .getByRole("checkbox", { name: SETTING })
      .click();
    await expect(setting).toHaveAttribute("aria-checked", "false");
    // Saved at once, with no other step.
    await expect.poll(() => storedShown(page.request)).toBe(false);
    await expect.poll(() => listed(panel)).toEqual(["Primary", "Own accent"]);
    await expect(
      panel.getByRole("button", { name: /^Primary, built-in/ })
    ).toContainText("Built-in");
    const options = await offered(page);
    expect(namedIn(options, ["Primary", "Own accent"])).toEqual([
      "Primary",
      "Own accent",
    ]);
    expect(namedIn(options, hiddenNames)).toEqual([]);

    // Undo shows them again, and Redo hides them once more.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => storedShown(page.request)).toBe(true);
    await openColours(page);
    await expect
      .poll(() => listed(panel))
      .toEqual([...Object.values(BUILT_INS), "Own accent"]);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(() => storedShown(page.request)).toBe(false);
    await expect.poll(() => listed(panel)).toEqual(["Primary", "Own accent"]);

    // A second author, on a page of their own, sees the site's setting.
    const made = await page.request.post(PAGES, {
      data: {
        title: "Built-in colours, second author",
        slug: `built-in-colours-second-${Date.now()}`,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "second-text",
              type: "core/text",
              version: 1,
              props: { text: "The second author's page" },
            },
          ],
        },
      },
    });
    expect(made.ok(), await made.text()).toBe(true);
    created = ((await made.json()) as { item: { id: string } }).item.id;
    const view = await second.context.newPage();
    await view.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(
      view,
      `/collections/pages/${created}/builder?field=content`
    );
    await expect(view.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 30_000,
    });
    const theirs = await openColours(view);
    await expect(
      theirs.getByRole("checkbox", { name: SETTING })
    ).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => listed(theirs)).toEqual(["Primary", "Own accent"]);
  } finally {
    if (created !== undefined) await page.request.delete(`${PAGES}/${created}`);
    await second.context.close();
    await seedTokens(page, before);
  }
});

test("is reached and changed with the keyboard alone", async ({ page }) => {
  test.setTimeout(240_000);
  const before = await storedTokens(page.request);
  try {
    await seed(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "built-in-text");
    const panel = await openColours(page);
    const setting = panel.getByRole("checkbox", { name: SETTING });
    // Tab from the add row that ends the list reaches the setting.
    await panel.getByRole("button", { name: "Add colour" }).last().focus();
    for (let step = 0; step < 6; step += 1) {
      if (await setting.evaluate(box => box === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(setting).toBeFocused();
    await page.keyboard.press("Space");
    await expect(setting).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => storedShown(page.request)).toBe(false);
    await expect(setting).toBeFocused();
    await page.keyboard.press("Space");
    await expect(setting).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => storedShown(page.request)).toBe(true);
  } finally {
    await seedTokens(page, before);
  }
});

test("at the panel's narrowest it fits, in light and dark, and passes the accessibility scan", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const before = await storedTokens(page.request);
  try {
    await seed(page);
    await onlyPrimaryUsed(page.context());
    // Hidden, so the "Built-in" mark is drawn and scanned too.
    await seedTokens(page, { tokens: [OWN], builtInColoursShown: false });
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openEditorWith(page, NODES, "built-in-text");
      if (theme === "dark") {
        await gotoAdmin(page, "/singles/homepage", "dark");
        await page
          .locator(PAGE_BUILDER_CARD)
          .getByRole("link", { name: OPEN_BUILDER_ACTION })
          .click();
      }
      const panel = await openColours(page);
      const divider = page.getByRole("separator", { name: "Panel and canvas" });
      await divider.focus();
      await page.keyboard.press("Home");
      await expect
        .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
        .toBeLessThanOrEqual(240);
      const setting = panel.getByRole("checkbox", { name: SETTING });
      await setting.scrollIntoViewIfNeeded();
      await expect(setting).toBeVisible();
      await expect(panel.getByText(HINT)).toBeVisible();
      await expect(panel.getByText("Built-in", { exact: true })).toBeVisible();
      // The checkbox's target is at least 24 by 24.
      const target = await setting.evaluate(element => {
        const before = getComputedStyle(element, "::before");
        return {
          width: Number.parseFloat(before.width),
          height: Number.parseFloat(before.height),
        };
      });
      expect(target.width).toBeGreaterThanOrEqual(24);
      expect(target.height).toBeGreaterThanOrEqual(24);
      const sideways = await panel.evaluate(element => {
        const scrolled = [element, ...element.querySelectorAll("*")].find(
          each =>
            each.scrollWidth > each.clientWidth + 1 &&
            getComputedStyle(each).overflowX !== "visible" &&
            getComputedStyle(each).textOverflow !== "ellipsis"
        );
        return scrolled === undefined ? null : scrolled.className;
      });
      expect(
        sideways,
        "nothing in the Colours tab scrolls sideways"
      ).toBeNull();
      // The hint and the label stay inside the panel.
      const panelBox = await panel.boundingBox();
      const hintBox = await panel.getByText(HINT).boundingBox();
      expect(panelBox).not.toBeNull();
      expect(hintBox).not.toBeNull();
      if (panelBox !== null && hintBox !== null) {
        expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(
          panelBox.x + panelBox.width + 1
        );
      }
      await expectNoAxeViolations(page, {
        include: '[aria-label="Design panel"]',
      });
    }
  } finally {
    await seedTokens(page, before);
  }
});

test("a role that may read Design but not change it sees the setting and can't change it, and the write refuses it", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const baseURL = test.info().project.use.baseURL ?? "";
  const before = await storedTokens(page.request);
  const reader = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
    "read-site-style",
  ]);
  let created: string | undefined;
  try {
    await seed(page);
    const made = await page.request.post(PAGES, {
      data: {
        title: "Built-in colours read-only",
        slug: `built-in-colours-read-only-${Date.now()}`,
        content: { formatVersion: 1, kind: "page", nodes: NODES },
      },
    });
    expect(made.ok(), await made.text()).toBe(true);
    created = ((await made.json()) as { item: { id: string } }).item.id;
    const view = await reader.context.newPage();
    await view.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(
      view,
      `/collections/pages/${created}/builder?field=content`
    );
    await expect(view.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 30_000,
    });
    const panel = await openColours(view);
    const setting = panel.getByRole("checkbox", { name: SETTING });
    await expect(setting).toHaveAttribute("aria-checked", "true");
    await expect(setting).toBeDisabled();

    const refused = await reader.context.request.patch(SITE_STYLE, {
      headers: await writeHeaders(reader.context.request),
      data: {
        tokens: { tokens: [OWN], builtInColoursShown: false },
        _overwrite: true,
      },
    });
    expect(refused.status(), await refused.text()).toBe(403);
    expect(await storedShown(page.request)).toBe(true);
  } finally {
    if (created !== undefined) await page.request.delete(`${PAGES}/${created}`);
    await reader.context.close();
    await seedTokens(page, before);
  }
});
