/**
 * The builder's chrome says exactly the decided words, and none of the
 * retired ones.
 *
 * Each surface is drawn and each of its words found where an author reads
 * it: the start area and its picker, an empty component, the Add panel's
 * line through every kind of place, the "+" between blocks and in an empty
 * Section, Page settings, the preview width, Save and Publish through their
 * states, Preview's menu and the visitor strip, the page data meter, the
 * page switcher, a lock, the side-panel toggles and Help's shortcuts.
 *
 * On every surface drawn, the chrome's text, names, tooltips and
 * placeholders hold none of the retired words: "Modified", "Apply
 * conditions", "reads" as the meter's unit, "Start your page", "Add
 * section", "Drop a block here, or click to add one". A surface whose words
 * drifted back to an old label fails on the surface itself, and a test that
 * never drew a surface fails finding its words, rather than passing on a
 * check of nothing.
 *
 * Each test makes its own pages, named uniquely, so no lock is needed.
 *
 * @module tests/builder-chrome-words.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import {
  created,
  createPage,
  openBuilder,
  openWithMeter,
  readingLists,
  revealGapAdd,
  stamp,
  topBar,
} from "./support/builder-chrome";
import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { ownSeat, test } from "./support/test";

const HERO = "00000000-0000-4000-8000-0000001980c1";
const HERO_TITLE = "00000000-0000-4000-8000-0000001980c2";
const PRICING = "00000000-0000-4000-8000-0000001980c3";
const EMPTY = "00000000-0000-4000-8000-0000001980c4";
const MEMBERS = "00000000-0000-4000-8000-0000001980c5";

/** Words that left the chrome and must not come back. */
const RETIRED: readonly [string, RegExp][] = [
  ["Modified", /\bModified\b/],
  ["Apply conditions", /Apply conditions/i],
  // The meter's count is "Page data: N of N", never a count of reads.
  ['"reads" as the meter\'s unit', /\b\d+\s+(?:of\s+\d+\s+)?reads\b/i],
  ["Start your page", /Start your page/i],
  ["Add section", /\bAdd section\b/i],
  [
    "Drop a block here, or click to add one",
    /Drop a block here, or click to add one/i,
  ],
];

/** A page: Hero (holding a heading), Pricing, an empty Section, and a conditioned text. */
function content(): object[] {
  const section = (id: string, name: string, children: object[]) => ({
    id,
    type: "core/section",
    version: 1,
    name,
    props: { as: "section", contained: true },
    styles: { base: { base: { minHeight: "120px" } } },
    slots: { children },
  });
  return [
    section(HERO, "Hero", [
      {
        id: HERO_TITLE,
        type: "core/heading",
        version: 1,
        name: "Welcome",
        props: { text: "Welcome", level: "h1" },
      },
    ]),
    section(PRICING, "Pricing", []),
    section(EMPTY, "Empty band", []),
    {
      id: MEMBERS,
      type: "core/text",
      version: 1,
      name: "Member pack",
      props: { text: "For members only." },
      // Shown only on a page whose title mentions members, which this one's
      // doesn't, so "Preview as visitor" has a block to hide.
      visibility: {
        conditions: [[{ field: "title", op: "contains", value: "Members" }]],
      },
    },
  ];
}

/**
 * What the chrome says on screen right now: its text, and every name,
 * description, tooltip and placeholder it carries, in the admin's
 * document (the canvas's page is the author's own words, not the chrome's).
 */
async function chromeWords(page: Page): Promise<string> {
  return page.evaluate(() => {
    const said: string[] = [document.body.innerText];
    for (const element of document.body.querySelectorAll("*")) {
      for (const name of [
        "aria-label",
        "aria-description",
        "title",
        "placeholder",
      ]) {
        const value = element.getAttribute(name);
        if (value !== null) said.push(value);
      }
    }
    return said.join("\n");
  });
}

/** The retired words the chrome says on screen now. */
async function retiredSaid(page: Page, where: string): Promise<string[]> {
  const words = await chromeWords(page);
  return RETIRED.filter(([, pattern]) => pattern.test(words)).map(
    ([word]) => `${where}: ${word}`
  );
}

/** The Add panel, opened from the rail. */
async function openAdd(page: Page): Promise<void> {
  const add = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true });
  if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
  await expect(add).toHaveAttribute("aria-pressed", "true");
}

/** The Add panel's line saying where a block goes. */
function placement(page: Page): Locator {
  return page.locator(".nx-insert-panel__placement").first();
}

/** An Add panel tile, by its block's name. */
function tile(page: Page, name: string): Locator {
  return page.getByRole("option", { name, exact: true });
}

/**
 * A button whose words follow its mark, drawn as an icon: "＋ Add a block"
 * is a plus and "Add a block", "✓ Saved" a tick and "Saved".
 */
async function expectMarkedWords(
  button: Locator,
  words: string
): Promise<void> {
  await expect(button).toHaveText(words);
  expect(
    await button.evaluate(element => {
      const first = [...element.childNodes].find(
        node => node.nodeType !== Node.TEXT_NODE || node.textContent !== ""
      );
      return (
        first instanceof SVGElement || first?.firstChild instanceof SVGElement
      );
    }),
    `"${words}" starts with its mark`
  ).toBe(true);
}

test.describe("the chrome's words", () => {
  test.describe.configure({ timeout: 300_000 });

  test.describe("an empty page and an empty component", () => {
    ownSeat(1);
    test("say the start area's and the picker's words", async ({ page }) => {
      const retired: string[] = [];
      const title = `Our story ${stamp()}`;
      const { id } = await createPage(page.request, { title });
      await openBuilder(page, id, { width: 1440, height: 900 });
      const start = page.locator(".nx-page-start");
      await expect(start).toBeVisible({ timeout: 60_000 });
      await expect(start.getByRole("heading")).toHaveText(
        `Start building ${title}`
      );
      await expectMarkedWords(
        start.getByRole("button", { name: "Add a block" }),
        "Add a block"
      );
      await expect(
        start.getByRole("button", { name: "Insert a saved section" })
      ).toHaveText("Insert a saved section");
      await expect(start).toContainText("or drag a block here");
      retired.push(...(await retiredSaid(page, "the start area")));

      await start.getByRole("button", { name: "Add a block" }).click();
      const picker = page.getByRole("dialog", { name: "Add a block" });
      await expect(picker).toBeVisible();
      await expect(picker).toHaveAccessibleDescription(
        "Adding at the end of the page"
      );
      await expect(
        picker.getByRole("combobox", { name: "Search blocks" })
      ).toHaveAttribute("placeholder", "Search blocks");
      await expect(
        picker.getByRole("button", { name: "Browse all blocks and sections →" })
      ).toBeVisible();
      retired.push(...(await retiredSaid(page, "the picker")));
      await page.keyboard.press("Escape");

      // A component holds no page, so its start area asks for its first block.
      const t = stamp();
      const component = await created(
        page.request,
        "/admin/api/collections/components/entries",
        {
          title: `Card ${t}`,
          slug: `card-${t}`,
          status: "draft",
          content: { formatVersion: 1, kind: "component", nodes: [] },
        }
      );
      await gotoAdmin(
        page,
        `/collections/components/${component}/builder?field=content`
      );
      const componentStart = page.locator(".nx-page-start");
      await expect(componentStart).toBeVisible({ timeout: 60_000 });
      await expect(componentStart.getByRole("heading")).toHaveText(
        "Add the first block"
      );
      retired.push(...(await retiredSaid(page, "an empty component")));
      expect(retired).toEqual([]);
    });
  });

  test.describe("the Add panel, the “+” and Page settings", () => {
    ownSeat(2);
    test("name each place a block goes", async ({ page }) => {
      const retired: string[] = [];
      const { id } = await createPage(page.request, { nodes: content() });
      await openBuilder(page, id, { width: 1440, height: 900 });
      await expect(canvasBlock(page, HERO_TITLE)).toBeVisible({
        timeout: 60_000,
      });

      // Nothing selected: Page settings, and the end of the page.
      const inspector = page.getByRole("complementary", { name: "Inspector" });
      await expect(
        inspector.getByRole("heading", { name: "Page settings" })
      ).toBeVisible();
      await expect(
        inspector.getByRole("button", { name: "All page settings…" })
      ).toBeVisible();
      await openAdd(page);
      await expect(placement(page)).toHaveText("Adding at the end of the page");
      retired.push(...(await retiredSaid(page, "nothing selected")));

      // A Section selected: inside it, at the end; a leaf: after it.
      await canvasBlock(page, HERO).click({ position: { x: 4, y: 4 } });
      await expect(placement(page)).toHaveText(
        "Adding inside Hero, at the end"
      );
      await tile(page, "Heading").hover();
      await expect(placement(page)).toHaveText(
        "Heading goes inside Hero, at the end"
      );
      await tile(page, "Section").hover();
      await expect(placement(page)).toHaveText("Section goes after Hero");
      await page.mouse.move(0, 0);
      await canvasBlock(page, HERO_TITLE).click();
      await expect(placement(page)).toHaveText(
        "Adding after Welcome, inside Hero"
      );
      retired.push(...(await retiredSaid(page, "a block selected")));

      // The "+" between two Sections, carried on to the panel.
      const gap = page.getByRole("button", {
        name: "Add a block between Hero and Pricing",
        exact: true,
      });
      await revealGapAdd(page, gap);
      await gap.click();
      const picker = page.getByRole("dialog", { name: "Add a block" });
      await expect(picker).toHaveAccessibleDescription(
        "Adding between Hero and Pricing"
      );
      await picker
        .getByRole("button", { name: "Browse all blocks and sections →" })
        .click();
      await expect(placement(page)).toHaveText(
        "Adding between Hero and Pricing"
      );

      // An empty Section's words.
      await expectMarkedWords(
        page.getByRole("button", {
          name: "Add a block, or drop one here, in Empty band",
        }),
        "Add a block, or drop one here"
      );
      retired.push(...(await retiredSaid(page, "the “+”")));
      expect(retired).toEqual([]);
    });
  });

  test.describe("the top bar", () => {
    ownSeat(3);
    test("says Save, Publish, Preview, the width, the meter and the switcher's words", async ({
      page,
    }) => {
      const retired: string[] = [];
      const { id } = await createPage(page.request, {
        nodes: [
          ...content(),
          ...readingLists("00000000-0000-4000-8000-0000001980d"),
        ],
      });
      const { count, limit } = await openWithMeter(page, id, {
        width: 1600,
        height: 900,
      });
      await expect(canvasBlock(page, HERO_TITLE)).toBeVisible({
        timeout: 60_000,
      });
      const bar = topBar(page);
      const save = bar.locator('[data-action="save"]');
      const publish = bar.locator('[data-action="publish"]');
      await expectMarkedWords(save, "Saved");
      await expect(publish).toHaveText("Publish");

      // The meter, near its limit, says what it counts and how to learn more.
      const meter = bar.locator('.nx-read-meter[data-place="bar"]');
      await expect(meter).toHaveText(
        `Page data: ${count} of ${limit} · what's this?`
      );
      // The panel it opens counts in the same words.
      await meter.click();
      await expect(page.locator(".nx-read-panel")).toBeVisible();
      retired.push(...(await retiredSaid(page, "the page data panel")));
      await page.keyboard.press("Escape");
      await expect(page.locator(".nx-read-panel")).toBeHidden();

      // An edit: Save, and Publish's preview line saying it saves first.
      await canvasBlock(page, HERO_TITLE).dblclick();
      await page.keyboard.press("End");
      await page.keyboard.type(" home");
      await page.keyboard.press("Escape");
      await expect(save).toHaveText("Save");
      await bar.getByRole("button", { name: "Preview options" }).click();
      const menu = page.getByRole("menu");
      await expect(
        menu.getByRole("menuitem", { name: "Preview this version" })
      ).toHaveAccessibleDescription("Saves a draft first");
      await expect(
        menu.getByRole("menuitemcheckbox", { name: "Preview as visitor" })
      ).toHaveAccessibleDescription(
        "Hides blocks whose conditions don’t match"
      );
      retired.push(...(await retiredSaid(page, "Preview's menu")));
      await menu
        .getByRole("menuitemcheckbox", { name: "Preview as visitor" })
        .click();
      const strip = page.locator("[data-visitor-preview]");
      await expect(strip).toContainText("Previewing as a visitor");
      await expect(strip.getByRole("button", { name: /Stop/ })).toHaveText(
        "Stop"
      );
      retired.push(...(await retiredSaid(page, "the visitor strip")));
      await strip.getByRole("button", { name: /Stop/ }).click();
      await expect(
        bar.getByRole("button", { name: "Preview", exact: true })
      ).toBeVisible();

      // Saving, held a moment so its words can be read.
      await page.route(
        "**/admin/api/collections/pages/entries/**",
        async route => {
          try {
            if (route.request().method() !== "GET") {
              await new Promise(resolve => setTimeout(resolve, 1_500));
            }
            await route.fallback();
          } catch {
            // The page let the request go meanwhile: nothing to hold.
          }
        }
      );
      await save.click();
      await expect(save).toHaveText("Saving…");
      await expect(save).toHaveText("Saved", { timeout: 30_000 });
      await expectMarkedWords(save, "Saved");
      await publish.click();
      await expect(publish).toHaveText("Publishing…");
      await expect(publish).toHaveText("Published", { timeout: 30_000 });
      await page.unrouteAll({ behavior: "wait" });

      // Live and edited: Publish changes; a save refused: Retry save.
      await canvasBlock(page, HERO_TITLE).dblclick();
      await page.keyboard.press("End");
      await page.keyboard.type("!");
      await page.keyboard.press("Escape");
      await expect(publish).toHaveText("Publish changes");
      await page.route(
        "**/admin/api/collections/pages/entries/**",
        async route => {
          try {
            await (route.request().method() === "GET"
              ? route.fallback()
              : route.fulfill({
                  status: 500,
                  json: { error: { code: "INTERNAL", message: "Down" } },
                }));
          } catch {
            // The page let the request go meanwhile.
          }
        }
      );
      await save.click();
      await expect(save).toHaveText(/Retry save/);
      await page.unrouteAll({ behavior: "wait" });
      retired.push(...(await retiredSaid(page, "Save and Publish")));

      // The width typed in, and Reset.
      await bar.locator("[data-nx-active-width]").click();
      const width = page.getByRole("spinbutton", { name: "Preview width" });
      await width.fill("900");
      await width.press("Enter");
      await expect(page.locator(".nx-preview-width__notice")).toHaveText(
        "Previewing at 900px · still editing Desktop styles"
      );
      await expect(bar.getByRole("button", { name: "Reset" })).toHaveText(
        "Reset"
      );
      retired.push(...(await retiredSaid(page, "the preview width")));

      // The page switcher's way to a new page.
      await bar.getByRole("button", { name: /: switch page$/ }).click();
      await expect(
        page.getByRole("menuitem", { name: "+ New page…" })
      ).toBeVisible();
      retired.push(...(await retiredSaid(page, "the page switcher")));
      await page.keyboard.press("Escape");

      // The left panel's toggle says what a press does, either way round.
      const left = bar.getByRole("button", { name: "Left panel", exact: true });
      const said = (shown: boolean) =>
        shown ? "Hide the left panel" : "Show the left panel";
      for (let press = 0; press < 2; press++) {
        const shown = (await left.getAttribute("aria-pressed")) === "true";
        await left.hover();
        await expect(page.getByRole("tooltip")).toHaveText(said(shown));
        await left.click();
        await expect(left).toHaveAttribute("aria-pressed", String(!shown));
        await page.mouse.move(0, 0);
        await expect(page.getByRole("tooltip")).toBeHidden();
      }
      expect(retired).toEqual([]);
    });
  });

  test.describe("a lock and Help", () => {
    ownSeat(4);
    test("say Locked, Unlock and Add a block here", async ({ page }) => {
      const retired: string[] = [];
      const nodes = content().map(node =>
        (node as { id: string }).id === HERO ? { ...node, locked: true } : node
      );
      const { id } = await createPage(page.request, { nodes });
      await openBuilder(page, id, { width: 1440, height: 900 });
      await expect(canvasBlock(page, HERO_TITLE)).toBeVisible({
        timeout: 60_000,
      });
      await canvasBlock(page, HERO).click({ position: { x: 4, y: 4 } });
      const toolbar = page
        .locator("[data-nx-canvas-layer]")
        .getByRole("toolbar", { name: "Block actions" });
      await expect(
        toolbar.getByRole("button", { name: "Unlock", exact: true })
      ).toBeVisible();
      const layers = page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Layers", exact: true });
      if ((await layers.getAttribute("aria-pressed")) !== "true")
        await layers.click();
      await expect(
        page.getByRole("tree", { name: "Layers" }).getByRole("treeitem").first()
      ).toContainText("Locked");
      retired.push(...(await retiredSaid(page, "a locked block")));

      await page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Help", exact: true })
        .click();
      const shortcuts = page
        .getByRole("dialog", { name: "Help" })
        .getByRole("region", { name: "Keyboard shortcuts" });
      await expect(shortcuts).toContainText("Add a block here");
      retired.push(...(await retiredSaid(page, "Help")));
      expect(retired).toEqual([]);
    });
  });
});
