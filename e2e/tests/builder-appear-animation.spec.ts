/**
 * "Animation when it appears" in the editor, in a real browser: set on the
 * Style tab's Effects, per device, with the CSS it writes on hover, stored as
 * set, and played on the canvas only once, on that block, when it changes or
 * Play is pressed; otherwise the canvas shows every block as it ends.
 *
 * The site's default breakpoints are read (Mobile up to 640px), so the
 * site-style lock is held. Each test makes its own page, named uniquely.
 *
 * @module builder-appear-animation.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.siteStyle], timeout: 180_000 });

const PAGES = "/admin/api/collections/pages/entries";
const SECTION = "00000000-0000-4000-8000-0000000a9901";

/** A section already rising into view, below a tall one, for the scroll. */
const LOWER = "00000000-0000-4000-8000-0000000a9902";

/** A draft page of its own holding one section (and `extra` after it): its id. */
async function seed(page: Page, extra: unknown[] = []): Promise<string> {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const created = await page.request.post(PAGES, {
    data: {
      title: `Appear setting ${stamp}`,
      slug: `appear-setting-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: SECTION,
            type: "core/section",
            version: 1,
            props: { as: "section", contained: true },
            styles: { base: { base: { minHeight: "160px" } } },
            slots: {
              children: [
                {
                  id: `${SECTION}-h`,
                  type: "core/heading",
                  version: 1,
                  props: { text: "A section that rises", level: "h2" },
                },
              ],
            },
          },
          ...extra,
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** The setting's own part of the Style tab. */
function setting(page: Page): Locator {
  return page.getByTestId("inspector").locator('[data-property="appear"]');
}

/** One of the setting's rows, by its name. */
function row(page: Page, name: string): Locator {
  return setting(page)
    .locator(".nx-inspector__field")
    .filter({
      has: page.locator(".nx-style-inspector__field-label-text", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .first();
}

/** Choose a value from one of the setting's menus. */
async function choose(page: Page, name: string, option: string): Promise<void> {
  await row(page, name).getByRole("combobox").click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(row(page, name).getByRole("combobox")).toContainText(option);
}

async function chooseDevice(page: Page, name: RegExp): Promise<void> {
  const devices = page.getByRole("radiogroup", { name: "Device" });
  await devices.getByRole("radio", { name }).click();
  await expect(
    devices.getByRole("radio", { checked: true })
  ).toHaveAccessibleName(name);
}

/** What the section on the canvas is doing: its animations and opacity. */
async function onCanvas(page: Page) {
  return canvasBlock(page, SECTION)
    .first()
    .evaluate(element => ({
      running: element.getAnimations().length,
      opacity: getComputedStyle(element).opacity,
    }));
}

/** The section's stored styles, read back from the entry. */
async function storedStyles(page: Page, id: string): Promise<unknown> {
  const response = await page.request.get(`${PAGES}/${id}?status=all`);
  expect(response.ok(), `reading the page: ${response.status()}`).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as {
    content: { nodes: { styles?: unknown }[] };
  };
  return item.content.nodes[0]?.styles;
}

test("sets an animation per device, says what it writes, and leaves the canvas still", async ({
  page,
}) => {
  const id = await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await canvasBlock(page, SECTION)
    .first()
    .click({ position: { x: 4, y: 4 } });
  await expect(page.locator("[data-block-card]")).toBeVisible();
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style", exact: true }).click();
  const effects = inspector.getByRole("button", {
    name: /^Effects(has changes)?$/,
  });
  if ((await effects.getAttribute("aria-expanded")) !== "true") {
    await effects.click();
  }
  await expect(setting(page)).toContainText("Animation when it appears");

  // Desktop: Rise, 600 milliseconds, when scrolled into view.
  await choose(page, "Effect", "Rise");
  const duration = row(page, "Duration").getByRole("textbox");
  await duration.fill("600");
  await duration.press("Enter");
  await choose(page, "Start", "When scrolled into view");

  // Hovering the effect says the CSS it writes.
  await row(page, "Effect").hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("animation-name");
  await page.keyboard.press("Escape");

  // Once a change has played, the canvas shows the section where it ends.
  await expect
    .poll(() => onCanvas(page), { timeout: 10_000 })
    .toEqual({ running: 0, opacity: "1" });

  // Mobile: None.
  await chooseDevice(page, /^Mobile/);
  await choose(page, "Effect", "None");

  await pressSave(page);
  await expect
    .poll(() => storedStyles(page, id), { timeout: 30_000 })
    .toMatchObject({
      base: {
        base: {
          minHeight: "160px",
          appear: { effect: "rise", duration: 600, start: "scroll" },
        },
        mobile: { appear: { effect: "none" } },
      },
    });

  // Still still with reduced motion asked for, at every device.
  await chooseDevice(page, /^Desktop/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await onCanvas(page)).toEqual({ running: 0, opacity: "1" });
});

/**
 * The sections' entrance animations as they start in the frame, counted per
 * block id from here on, with how long each one runs.
 */
async function countStarts(page: Page): Promise<void> {
  await canvasBlock(page, SECTION)
    .first()
    .evaluate(element => {
      const view = element.ownerDocument.defaultView as Window & {
        nxStarts?: { id: string | null; duration: unknown }[];
      };
      view.nxStarts = [];
      element.ownerDocument.addEventListener(
        "animationstart",
        event => {
          const target = event.target as Element;
          const started = target
            .getAnimations()
            .find(
              animation =>
                (animation as CSSAnimation).animationName ===
                event.animationName
            );
          view.nxStarts?.push({
            id: target.getAttribute("data-nx-node"),
            duration: started?.effect?.getTiming().duration,
          });
        },
        true
      );
    });
}

/** Every start counted since {@link countStarts}. */
async function starts(
  page: Page
): Promise<{ id: string | null; duration: unknown }[]> {
  return canvasBlock(page, SECTION)
    .first()
    .evaluate(
      element =>
        (
          element.ownerDocument.defaultView as Window & {
            nxStarts?: { id: string | null; duration: unknown }[];
          }
        ).nxStarts ?? []
    );
}

/** Whether a block on the canvas is still: no animation, fully shown. */
async function stillAt(page: Page, id: string) {
  return canvasBlock(page, id)
    .first()
    .evaluate(element => ({
      running: element.getAnimations().length,
      opacity: getComputedStyle(element).opacity,
    }));
}

/** Scroll the canvas frame to its end and back. */
async function scrollCanvas(page: Page): Promise<void> {
  await canvasBlock(page, SECTION)
    .first()
    .evaluate(async element => {
      const view = element.ownerDocument.defaultView;
      if (view === null) return;
      const frame = (): Promise<void> =>
        new Promise(resolve => view.requestAnimationFrame(() => resolve()));
      const end = element.ownerDocument.documentElement.scrollHeight;
      for (const top of [end / 2, end, end / 2, 0]) {
        view.scrollTo(0, top);
        await frame();
        await frame();
      }
    });
}

test("plays a changed animation once on its block, replays it on Play, and is otherwise still", async ({
  page,
}) => {
  const id = await seed(page, [
    {
      id: `${SECTION}-tall`,
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true },
      styles: { base: { base: { minHeight: "1600px" } } },
    },
    {
      id: LOWER,
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true },
      styles: {
        base: {
          base: {
            minHeight: "160px",
            appear: { effect: "rise", start: "scroll" },
          },
        },
      },
    },
  ]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await canvasBlock(page, SECTION)
    .first()
    .click({ position: { x: 4, y: 4 } });
  await expect(page.locator("[data-block-card]")).toBeVisible();
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style", exact: true }).click();
  const effects = inspector.getByRole("button", {
    name: /^Effects(has changes)?$/,
  });
  if ((await effects.getAttribute("aria-expanded")) !== "true") {
    await effects.click();
  }
  await expect(setting(page)).toContainText("Animation when it appears");
  await countStarts(page);

  // Fade in: it plays once on that block, then the block is still and shown.
  await choose(page, "Effect", "Fade in");
  await expect
    .poll(() => starts(page))
    .toEqual([{ id: SECTION, duration: 600 }]);
  await expect
    .poll(() => stillAt(page, SECTION), { timeout: 10_000 })
    .toEqual({ running: 0, opacity: "1" });

  // A slower duration plays once more, slower.
  const duration = row(page, "Duration").getByRole("textbox");
  await duration.fill("1500");
  await duration.press("Enter");
  await expect
    .poll(() => starts(page))
    .toEqual([
      { id: SECTION, duration: 600 },
      { id: SECTION, duration: 1500 },
    ]);
  await expect
    .poll(() => stillAt(page, SECTION), { timeout: 10_000 })
    .toEqual({ running: 0, opacity: "1" });

  // Play replays it.
  const play = setting(page).getByRole("button", { name: "Play", exact: true });
  await play.click();
  await expect.poll(() => starts(page)).toHaveLength(3);
  expect((await starts(page))[2]).toEqual({ id: SECTION, duration: 1500 });
  await expect
    .poll(() => stillAt(page, SECTION), { timeout: 10_000 })
    .toEqual({ running: 0, opacity: "1" });

  // Scrolling animates nothing: the lower section, set to rise as it is
  // scrolled into view, is shown as it ends, and so is every other block.
  await scrollCanvas(page);
  expect(await stillAt(page, LOWER)).toEqual({ running: 0, opacity: "1" });
  expect(await stillAt(page, SECTION)).toEqual({ running: 0, opacity: "1" });
  expect(await starts(page)).toHaveLength(3);

  // Reduced motion wins: neither a change nor Play animates.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await duration.fill("900");
  await duration.press("Enter");
  await expect(duration).toHaveValue("900");
  await play.click();
  // Long enough for a start to have been counted, were there one.
  await page.waitForTimeout(500);
  expect(await starts(page)).toHaveLength(3);
  expect(await stillAt(page, SECTION)).toEqual({ running: 0, opacity: "1" });
});
