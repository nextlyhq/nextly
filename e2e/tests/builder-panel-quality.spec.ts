/**
 * The block panel (the inspector) holds still, works by keyboard and fits.
 *
 * - **Keyboard order:** from the block card, Tab reaches the tab list once,
 *   then "Find a setting", "Only changed" and "Panel options", then the tab's
 *   own controls. The tab panel is no stop of its own: its first control is.
 *   Shift+Tab walks the same stops back.
 * - **Nothing above moves:** setting a value marks it changed (its dot), and
 *   no control above or beside it moves.
 * - **Names and colours:** axe finds nothing at WCAG 2.2 AA on each tab, in
 *   light and dark.
 * - **Widths:** at the panel's narrowest, 320px and its widest, with classic
 *   scrollbars, no tab scrolls sideways and nothing ends past its edge.
 * - **Hit areas:** every switch and toggle answers a pointer over at least
 *   24 by 24 pixels.
 * - **Focus returns:** a menu or popover closed with Escape gives focus back
 *   to what opened it.
 *
 * Each test makes its own page, named uniquely, and reads through its own
 * account, so no lock is needed.
 *
 * @module tests/builder-panel-quality.spec
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { settleTransitions } from "./support/axe-scan.mjs";
import { canvasBlock } from "./support/canvas-frame";
import { ownSeat, test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const HEADING = "00000000-0000-4000-8000-00000000d201";
const TABS = ["Content", "Style", "Advanced"] as const;

/** A draft page holding one heading, and its id. */
async function createPage(page: Page): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Panel quality ${stamp}`,
      slug: `panel-quality-${stamp}`,
      status: "draft",
      // Without the site's header and footer, whose regions on the canvas
      // would take the click meant for the heading.
      noHeaderFooter: true,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "A heading to style", level: "h2" },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** Open the builder on a new page and select its heading. */
async function openHeading(
  page: Page,
  scheme: "light" | "dark" = "light"
): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = await createPage(page);
  await gotoAdmin(
    page,
    `/collections/pages/${id}/builder?field=content`,
    scheme
  );
  await expect(canvasBlock(page, HEADING).first()).toBeVisible({
    timeout: 60_000,
  });
  await canvasBlock(page, HEADING).first().click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.locator("[data-block-card]")).toBeVisible();
  return inspector;
}

async function chooseTab(inspector: Locator, name: string): Promise<void> {
  const tab = inspector.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/**
 * The focused element as a stop: its role and accessible name, as the
 * browser's accessibility tree gives them.
 */
async function focusedStop(page: Page): Promise<string> {
  const snapshot = await page.locator("*:focus").first().ariaSnapshot();
  const first = snapshot.split("\n")[0] ?? "";
  const match = /^- ([a-z]+)(?: "([^"]*)")?/.exec(first);
  return match === null ? first : `${match[1]} ${match[2] ?? ""}`.trim();
}

/** The first `count` stops Tab reaches from the block card's menu. */
async function walkFromCard(page: Page, inspector: Locator, count: number) {
  await inspector.getByRole("button", { name: /^Actions for / }).focus();
  const stops = [await focusedStop(page)];
  for (let step = 1; step < count; step++) {
    await page.keyboard.press("Tab");
    stops.push(await focusedStop(page));
  }
  return stops;
}

/**
 * Open every section of the tab shown, so each control is on screen: its
 * section headers only, never a control's own popover.
 */
async function openSections(inspector: Locator): Promise<void> {
  const closed = inspector.locator(
    ".nx-style-inspector__section-trigger[aria-expanded=false]"
  );
  for (let open = 0; open < 30 && (await closed.count()) > 0; open++) {
    const header = closed.first();
    if (!(await header.isVisible())) break;
    await header.click();
  }
}

/** Every scrollbar a classic one, as Windows and a Mac set to "Always" draw them. */
async function forceClassicScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }",
  });
}

/** Drag the canvas and inspector divider until the inspector is `width` wide, or as near as its bounds allow. */
async function setInspectorWidth(
  page: Page,
  inspector: Locator,
  width: number
): Promise<number> {
  const handle = page.getByRole("separator", { name: "Canvas and inspector" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = (await inspector.boundingBox())?.width ?? 0;
    const grip = await handle.boundingBox();
    if (grip === null) throw new Error("the divider has no box");
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - (width - now), y, { steps: 6 });
    await page.mouse.up();
  }
  return Math.round((await inspector.boundingBox())?.width ?? 0);
}

/** What overflows the inspector sideways: its own scroll, and boxes past its edge. */
async function overflowOf(inspector: Locator) {
  return inspector.evaluate(root => {
    const edge = root.getBoundingClientRect().right;
    const scroller = [root, ...root.querySelectorAll("*")].filter(
      element =>
        element.scrollWidth > element.clientWidth + 1 &&
        ["auto", "scroll"].includes(getComputedStyle(element).overflowX)
    );
    const past = [...root.querySelectorAll("*")]
      .filter(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.right > edge + 1;
      })
      .map(
        element =>
          `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}`
      );
    return {
      scrolls: scroller.map(
        element =>
          `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}`
      ),
      past: [...new Set(past)].slice(0, 10),
    };
  });
}

test.describe("the block panel", () => {
  test.describe.configure({ timeout: 240_000 });

  test.describe("keyboard order", () => {
    ownSeat(1);
    test("walks card, tabs, find, only changed, panel options, then the tab's controls", async ({
      page,
    }) => {
      const inspector = await openHeading(page);
      for (const tab of TABS) {
        await chooseTab(inspector, tab);
        const stops = await walkFromCard(page, inspector, 6);
        expect(stops.slice(0, 5), `${tab}: the panel's head`).toEqual([
          "button Actions for Heading",
          `tab ${tab}`,
          "searchbox Find a setting",
          "button Only changed",
          "button Panel options",
        ]);
        // The sixth stop is a control of the tab, never the tab panel itself.
        expect(stops[5], `${tab}: the first control`).not.toMatch(/^tabpanel/);
        // Shift+Tab walks the same stops back.
        const back = [await focusedStop(page)];
        for (let step = 0; step < 5; step++) {
          await page.keyboard.press("Shift+Tab");
          back.push(await focusedStop(page));
        }
        expect(back.reverse(), `${tab}: Shift+Tab`).toEqual(stops);
      }
    });
  });

  test.describe("focus returns", () => {
    ownSeat(7);
    test("a menu or popover closed with Escape gives focus back to what opened it", async ({
      page,
    }) => {
      const inspector = await openHeading(page);
      await chooseTab(inspector, "Style");
      for (const name of [/^Panel options$/, /^Editing: /, /^State: /]) {
        const opener = inspector.getByRole("button", { name });
        await opener.focus();
        await page.keyboard.press("Enter");
        await expect(opener).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(opener).toHaveAttribute("aria-expanded", "false");
        await expect(opener, `${String(name)} has focus back`).toBeFocused();
      }
    });
  });

  test.describe("nothing above moves", () => {
    ownSeat(2);
    test("a value set on Style moves nothing above or beside it", async ({
      page,
    }) => {
      const inspector = await openHeading(page);
      await chooseTab(inspector, "Style");
      const text = inspector.getByRole("button", { name: /^Text\b/ }).first();
      if ((await text.getAttribute("aria-expanded")) !== "true")
        await text.click();
      const field = inspector.getByRole("textbox", { name: /^Font size\b/ });
      await expect(field).toBeVisible();
      const boxes = async () =>
        inspector.evaluate(root =>
          [
            ...root.querySelectorAll(
              "button, input, [role=radio], [role=switch], [role=combobox], [role=tab]"
            ),
          ]
            .filter(element => element.getBoundingClientRect().height > 0)
            .map(element => {
              const box = element.getBoundingClientRect();
              return {
                key: `${element.tagName}:${element.getAttribute("aria-label") ?? element.id ?? ""}:${(element.textContent ?? "").trim().slice(0, 30)}`,
                top: Math.round(box.top),
                left: Math.round(box.left),
                width: Math.round(box.width),
              };
            })
        );
      const fieldTop = Math.round((await field.boundingBox())?.y ?? 0);
      const before = (await boxes()).filter(box => box.top < fieldTop - 2);
      await field.fill("28");
      await field.press("Enter");
      await expect(field).toHaveValue("28");
      // The changed mark arrives, and the panel settles.
      await page.waitForTimeout(300);
      const after = new Map((await boxes()).map(box => [box.key, box]));
      const moved = before.filter(box => {
        const now = after.get(box.key);
        return (
          now !== undefined &&
          (now.top !== box.top ||
            now.left !== box.left ||
            now.width !== box.width)
        );
      });
      expect(moved, "controls above the changed field that moved").toEqual([]);
    });
  });

  for (const [index, scheme] of (["light", "dark"] as const).entries()) {
    test.describe(`axe, ${scheme}`, () => {
      ownSeat(3 + index);
      test(`finds nothing on each tab, ${scheme}`, async ({ page }) => {
        const inspector = await openHeading(page, scheme);
        for (const tab of TABS) {
          await chooseTab(inspector, tab);
          // Every section open, so each control is scanned.
          await openSections(inspector);
          if (tab === "Advanced") {
            // The block's own CSS is scanned with the rest: the section is
            // drawn for a person who may change site code, as this one may.
            await expect(
              inspector.locator(".nx-style-inspector__section-trigger", {
                hasText: "Custom CSS",
              })
            ).toBeVisible();
          }
          // Scrolled back to the top, so no control sits under the panel's
          // sticky head while it is judged.
          await inspector.evaluate(root => {
            for (const element of [root, ...root.querySelectorAll("*")]) {
              if (element.scrollTop > 0) element.scrollTop = 0;
            }
          });
          await settleTransitions(page);
          const results = await new AxeBuilder({ page })
            .include('[aria-label="Inspector"]')
            .withTags(AA_TAGS)
            .analyze();
          expect(results.passes.length).toBeGreaterThan(10);
          const findings = results.violations.map(violation => ({
            id: violation.id,
            summary: violation.nodes
              .map(node => node.failureSummary)
              .slice(0, 3),
            targets: violation.nodes
              .flatMap(node => node.target.map(String))
              .slice(0, 5),
          }));
          expect.soft(findings, `${tab}, ${scheme}`).toEqual([]);
        }
      });
    });
  }

  test.describe("widths", () => {
    ownSeat(5);
    test("no tab scrolls sideways at the narrowest, 320px and the widest, with classic scrollbars", async ({
      page,
    }) => {
      const inspector = await openHeading(page);
      await forceClassicScrollbars(page);
      // Asked for less than the panel allows: it stops at its narrowest.
      const narrowest = await setInspectorWidth(page, inspector, 200);
      expect(narrowest).toBeLessThanOrEqual(320);
      for (const target of [narrowest, 320, 520]) {
        const width = await setInspectorWidth(page, inspector, target);
        for (const tab of TABS) {
          await chooseTab(inspector, tab);
          await openSections(inspector);
          expect(await overflowOf(inspector), `${tab} at ${width}px`).toEqual({
            scrolls: [],
            past: [],
          });
        }
      }
    });
  });

  test.describe("hit areas", () => {
    ownSeat(6);
    test("every switch and toggle answers over at least 24 by 24 pixels", async ({
      page,
    }) => {
      const inspector = await openHeading(page);
      const small: string[] = [];
      for (const tab of TABS) {
        await chooseTab(inspector, tab);
        await openSections(inspector);
        small.push(
          ...(
            await inspector.evaluate(root =>
              [
                ...root.querySelectorAll(
                  "[role=switch], button[aria-pressed], [role=radio]"
                ),
              ]
                .filter(element => element.getBoundingClientRect().height > 0)
                .filter(element => {
                  // The area a pointer answers on: the control, or the label
                  // wrapping it, whichever is larger.
                  const own = element.getBoundingClientRect();
                  const label = element
                    .closest("label")
                    ?.getBoundingClientRect();
                  const width = Math.max(own.width, label?.width ?? 0);
                  const height = Math.max(own.height, label?.height ?? 0);
                  return width < 24 || height < 24;
                })
                .map(element => {
                  const box = element.getBoundingClientRect();
                  return `${element.getAttribute("role") ?? "button"} "${element.getAttribute("aria-label") ?? element.textContent?.trim()}" ${Math.round(box.width)}x${Math.round(box.height)}`;
                })
            )
          ).map(entry => `${tab}: ${entry}`)
        );
      }
      expect(small).toEqual([]);
    });
  });
});
