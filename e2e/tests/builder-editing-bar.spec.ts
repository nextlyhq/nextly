/**
 * The Style tab's editing bar, in the real editor.
 *
 * - The bar is one line of chips: the target, the device and the state. It
 *   keeps its height, and the controls under it keep their place, when a
 *   value changes, a block style or a shared style is applied, or a font is
 *   picked; only choosing a shared style as the target adds its line.
 * - "Save as shared style…" runs from the target chip's menu, the dialog
 *   keeps focus, and the new style is listed there with Detach and Remove;
 *   choosing it turns the chip green and adds its line.
 * - The tab row and the bar stay on screen while a long Style tab scrolls,
 *   and keep their place in the keyboard order.
 * - Editing Hover tints the sections and says so, in light and dark; axe
 *   finds nothing on the bar or the tinted sections in either theme, its
 *   contrast rule included.
 *
 * @module builder-editing-bar.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import {
  clickBlock,
  emptyHomepage,
  openEditorWith,
} from "./canvas/editor-driver";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage Single is reseeded and edited here, as the other builder files
// do, and the site's shared styles are changed and restored.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const BUTTON = "editing-bar-button";
const HEADING = "editing-bar-heading";

/** The shared style the button is given from the bar's menu. */
const CARD = {
  id: "e2e-editing-bar-card",
  slug: "editing-bar-card",
  label: "Bar card",
  orderIndex: 90,
  styles: { base: { base: { color: "#112233" } } },
};

/** The stored `classes` section, as the site style holds it. */
async function storedClasses(page: Page): Promise<unknown[]> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return (item.classes as unknown[] | undefined) ?? [];
}

/** Store the site's shared styles. */
async function storeClasses(page: Page, classes: unknown): Promise<void> {
  const stored = await page.request.patch(SITE_STYLE, {
    data: { classes, _overwrite: true },
  });
  expect(
    stored.ok(),
    `storing the shared styles: ${stored.status()} ${await stored.text()}`
  ).toBe(true);
}

const inspector = (page: Page) => page.getByTestId("inspector");
const bar = (page: Page) =>
  inspector(page).getByRole("region", { name: "What you're editing" });
const targetChip = (page: Page) =>
  bar(page).getByRole("button", { name: /^Editing: / });

/** Open the Style tab on a block, every section open. */
async function styleTab(page: Page, id: string): Promise<void> {
  await clickBlock(page, id);
  await inspector(page).getByRole("tab", { name: "Style" }).click();
  await inspector(page).getByRole("button", { name: "Panel options" }).click();
  await page.getByRole("menuitem", { name: "Expand all" }).click();
}

/** A box's top and height, rounded to the pixel. */
async function box(locator: Locator): Promise<{ y: number; h: number }> {
  const found = await locator.boundingBox();
  expect(found, "a box drawn").not.toBeNull();
  return { y: Math.round(found?.y ?? 0), h: Math.round(found?.height ?? 0) };
}

/** The panel's own scroll, so boxes are compared in one frame of reference. */
async function scrollPanelTop(page: Page): Promise<void> {
  await page.locator(".nx-inspector").evaluate(panel => {
    panel.scrollTop = 0;
  });
}

test.describe("the editing bar", () => {
  test.describe.configure({ timeout: 180_000 });

  let before: unknown[] = [];
  test.beforeEach(async ({ page }) => {
    before = await storedClasses(page);
    await storeClasses(page, [
      ...before.filter(entry => (entry as { id?: string }).id !== CARD.id),
      CARD,
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test.afterEach(async ({ page }) => {
    // Off the homepage first: a shared style still in use cannot be removed.
    // The library is restored even when that fails, and neither failure
    // hides the other.
    const failures: unknown[] = [];
    await emptyHomepage(page).catch((error: unknown) => failures.push(error));
    await storeClasses(page, before).catch((error: unknown) =>
      failures.push(error)
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "the editing bar spec's cleanup");
    }
  });

  test("keeps one line and its height through edits; a shared target adds its line", async ({
    page,
  }) => {
    await openEditorWith(
      page,
      [
        {
          id: BUTTON,
          type: "core/button",
          version: 1,
          props: { label: "Bar button", href: "/" },
        },
      ],
      BUTTON
    );
    await styleTab(page, BUTTON);
    await expect(targetChip(page)).toHaveAccessibleName("Editing: This block");
    await expect(bar(page).locator("[data-edit-device]")).toHaveText("Desktop");
    await expect(bar(page).locator("[data-edit-state]")).toHaveText("Normal");

    // The first section header under the bar stands for every control below.
    const header = inspector(page)
      .locator(
        ".nx-style-inspector [data-section] .nx-style-inspector__section-trigger"
      )
      .first();
    await scrollPanelTop(page);
    const start = { bar: await box(bar(page)), header: await box(header) };
    const unmoved = async (after: string) => {
      await scrollPanelTop(page);
      expect(await box(bar(page)), `the bar after ${after}`).toEqual(start.bar);
      expect(await box(header), `the controls after ${after}`).toEqual(
        start.header
      );
    };

    // Save is listed and held before the first edit, with its reason.
    await targetChip(page).click();
    const save = page.getByRole("menuitem", { name: /^Save as shared style…/ });
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");

    // A value changed.
    const opacity = inspector(page).getByRole("textbox", { name: /^Opacity/ });
    await opacity.fill("0.8");
    await opacity.press("Enter");
    await unmoved("a value change");
    // Save is enabled in the same place; nothing came into the panel.
    await targetChip(page).click();
    await expect(save).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");

    // A font picked.
    await inspector(page)
      .getByRole("button", { name: /^Font,/ })
      .click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: "System UI" })
      .click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await unmoved("a font picked");

    // A block style applied, when the button has any.
    const looks = inspector(page).getByRole("radiogroup", {
      name: "Block style",
    });
    if ((await looks.count()) > 0) {
      await looks.getByRole("radio", { checked: false }).first().click();
      await unmoved("a block style applied");
    }

    // A shared style applied, from the target chip's menu.
    await targetChip(page).click();
    await page
      .getByRole("menuitem", { name: /^Apply a shared style…/ })
      .click();
    const search = page.getByRole("combobox", { name: "Search shared styles" });
    await expect(search).toBeFocused();
    await search.fill(CARD.label);
    await search.press("Enter");
    await expect(search).toHaveCount(0);
    // Focus comes back to the chip that opened the picker.
    await expect(targetChip(page)).toBeFocused();
    await unmoved("a shared style applied");

    // Choosing it as the target is the one change that adds a line.
    await targetChip(page).click();
    await page
      .getByRole("menuitemradio", { name: new RegExp(`^${CARD.label}`) })
      .click();
    await expect(targetChip(page)).toHaveAccessibleName(
      `Editing: shared style ${CARD.label}`
    );
    await expect(bar(page).locator("[data-shared-reach]")).toContainText(
      /^Shared style · .*Changes here change all of them\.$/
    );
    await scrollPanelTop(page);
    const shared = await box(bar(page));
    expect(shared.y).toBe(start.bar.y);
    expect(shared.h).toBeGreaterThan(start.bar.h);
  });

  test("saves a block's look as a shared style from the target chip's menu, then edits it", async ({
    page,
  }) => {
    await openEditorWith(
      page,
      [
        {
          id: BUTTON,
          type: "core/button",
          version: 1,
          props: { label: "Bar button", href: "/" },
          styles: { base: { base: { opacity: 0.8 } } },
        },
      ],
      BUTTON
    );
    await styleTab(page, BUTTON);
    await targetChip(page).click();
    await page
      .getByRole("menuitem", { name: /^Save as shared style…/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Save as shared style" });
    await expect(dialog).toBeVisible();
    // The dialog keeps focus: the menu that opened it doesn't take it back.
    const name = dialog.getByRole("textbox", { name: "Name" });
    await expect(name).toBeFocused();
    await name.fill("Bar saved");
    await dialog.getByRole("button", { name: "Save shared style" }).click();
    await expect(dialog).toHaveCount(0);

    // Listed in the same menu, with Detach and Remove under it; choosing it
    // turns the chip green and adds the line that says what an edit reaches.
    await targetChip(page).click();
    await expect(
      page.getByRole("menuitem", { name: /^Detach\s*Bar saved/ })
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /^Remove\s*Bar saved/ })
    ).toBeVisible();
    await page.getByRole("menuitemradio", { name: /^Bar saved/ }).click();
    await expect(targetChip(page)).toHaveAccessibleName(
      "Editing: shared style Bar saved"
    );
    await expect(targetChip(page)).toHaveText(/◆\s*Bar saved/);
    await expect(bar(page).locator("[data-shared-reach]")).toContainText(
      "Changes here change all of them."
    );
  });

  test("keeps the tab row and the bar on screen while a long Style tab scrolls", async ({
    page,
  }) => {
    await openEditorWith(
      page,
      [
        {
          id: HEADING,
          type: "core/heading",
          version: 1,
          props: { text: "Bar heading", level: "h2" },
        },
      ],
      HEADING
    );
    // A short window, so the Style tab is longer than the panel.
    await page.setViewportSize({ width: 1440, height: 640 });
    await styleTab(page, HEADING);
    const panel = page.locator(".nx-inspector");
    const scrolled = await panel.evaluate(element => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    expect(scrolled, "the Style tab is long enough to scroll").toBeGreaterThan(
      100
    );

    const frame = await box(panel);
    const tabs = inspector(page).locator(".nx-inspector__tabrow");
    for (const [name, part] of [
      ["the tab row", tabs],
      ["the bar", bar(page)],
    ] as const) {
      const found = await box(part);
      // A pixel either way, for the rounding of both boxes.
      expect(found.y, `${name} below the panel's top`).toBeGreaterThanOrEqual(
        frame.y - 1
      );
      expect(
        found.y + found.h,
        `${name} above the panel's bottom`
      ).toBeLessThanOrEqual(frame.y + frame.h + 1);
    }
    // Drawn over what scrolls under it, the bar below the tab row.
    const tabsBox = await box(tabs);
    const barBox = await box(bar(page));
    expect(barBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.h);
    expect(
      await targetChip(page).evaluate(chip => {
        const at = chip.getBoundingClientRect();
        const top = chip.ownerDocument.elementFromPoint(
          at.left + at.width / 2,
          at.top + at.height / 2
        );
        return top !== null && chip.contains(top);
      }),
      "the target chip is on top, not covered"
    ).toBe(true);
    // The block card scrolled away.
    const card = await box(inspector(page).locator("[data-block-card]"));
    expect(card.y + card.h).toBeLessThan(frame.y);

    // The keyboard order is the document's: tabs, then the bar's chips.
    const order = await inspector(page).evaluate(root => {
      const tab = root.querySelector('[role="tab"]');
      const chip = root.querySelector(".nx-editing-bar__target");
      return tab !== null && chip !== null
        ? tab.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0;
    });
    expect(order).toBeGreaterThan(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`tints the sections while Hover is edited and says so, in ${scheme}`, async ({
      page,
    }) => {
      await openEditorWith(
        page,
        [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "Bar heading", level: "h2" },
          },
        ],
        HEADING
      );
      // The admin's palette hangs off `.nextly-admin.dark`, as its theme
      // switch sets it; the editor opens light, so dark is set here.
      await page.evaluate(dark => {
        for (const root of document.querySelectorAll(".nextly-admin")) {
          root.classList.toggle("dark", dark);
        }
      }, scheme === "dark");
      await styleTab(page, HEADING);
      const body = inspector(page).locator(".nx-style-tab__body");
      const ground = () =>
        body.evaluate(element => {
          // The colour drawn behind the sections: their own, or the panel's.
          for (let at: Element | null = element; at; at = at.parentElement) {
            const colour = getComputedStyle(at).backgroundColor;
            if (colour !== "rgba(0, 0, 0, 0)") return colour;
          }
          return "none";
        });
      const normal = await ground();
      // The control: the sections as they read untinted.
      await expectNoAxeViolations(page, { include: ".nx-style-tab__body" });
      await expect(
        inspector(page).locator("[data-editing-state-line]")
      ).toHaveCount(0);

      await bar(page)
        .getByRole("button", { name: /^State: / })
        .click();
      await page.getByRole("menuitemradio", { name: /^Hover/ }).click();
      await expect(bar(page).locator("[data-edit-state]")).toHaveText("Hover");
      await expect(
        inspector(page).locator("[data-editing-state-line]")
      ).toHaveText("You are editing the Hover look. Normal stays as it is.");
      expect(await ground(), "the sections are tinted").not.toBe(normal);
      // The state chip is drawn in the state's colour, unlike the device.
      const [state, device] = await Promise.all([
        bar(page)
          .locator(".nx-editing-bar__state-chip .nx-state-menu")
          .evaluate(el => getComputedStyle(el).backgroundColor),
        bar(page)
          .locator(".nx-editing-bar__device")
          .evaluate(el => getComputedStyle(el).backgroundColor),
      ]);
      expect(state, "the state chip's colour").not.toBe(device);
      // Contrast and every other rule, on the chips and the tinted sections.
      await expectNoAxeViolations(page, { include: ".nx-editing-bar" });
      await expectNoAxeViolations(page, { include: ".nx-style-tab__body" });
    });
  }
});
