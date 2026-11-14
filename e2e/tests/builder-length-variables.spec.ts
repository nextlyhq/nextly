/**
 * A type size from Design, chosen in the inspector, end to end: the author
 * picks "Display" for a heading's font size from the field's variables, the
 * page stores a reference to it, and changing the variable's size in Design
 * resizes the heading without the block being touched again.
 *
 * @module builder-length-variables.spec
 */
import { expect, type Page } from "@playwright/test";

import {
  block,
  clickBlock,
  emptyHomepage,
  openEditorWith,
  pressSave,
  selection,
} from "./canvas/editor-driver";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

// The homepage is reseeded and saved, and the site's variables are changed
// and restored, as the other builder files do.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const HOMEPAGE = "/admin/api/singles/homepage";
const HEADING = "length-variables-heading";
const NODES = [
  {
    id: HEADING,
    type: "core/heading",
    version: 1,
    props: { text: "A heading sized by a variable", level: "h2" },
  },
];

/**
 * A type size and its line height under one name, as Design's "Add type
 * size" makes them. Both are lengths, so a font size field that offered every
 * length would list "Display" twice.
 */
const TYPE_SCALE = [
  { name: "font-size.display", kind: "dimension", values: { light: "48px" } },
  { name: "line-height.display", kind: "dimension", values: { light: "56px" } },
];

async function storedTokens(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

function styleWrite(page: Page) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname === SITE_STYLE &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

/** The heading's font size as the canvas computes it. */
async function headingSize(page: Page): Promise<string> {
  return (await block(page, HEADING)).evaluate(
    element => getComputedStyle(element).fontSize
  );
}

/** Show the Design panel, whether or not the editor restored it open. */
async function openDesign(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  const open = await panel.isVisible();
  if (!open) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await expect(panel).toBeVisible();
}

test("a type size picked for a heading is stored as a reference, and follows the variable", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  try {
    // Dropping a variable is refused until every page is counted.
    await countEveryPage(page.request);
    const seeded = await page.request.patch(SITE_STYLE, {
      data: { tokens: { tokens: TYPE_SCALE }, _overwrite: true },
    });
    expect(seeded.ok(), `seeding the type scale: ${seeded.status()}`).toBe(
      true
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, HEADING);

    await clickBlock(page, HEADING);
    const inspector = page.getByTestId("inspector");
    await inspector.getByRole("tab", { name: "Style" }).click();
    // Named by its label, which also carries where the value comes from.
    const fontSize = inspector.getByRole("textbox", { name: /^Font size/ });
    if (!(await fontSize.isVisible())) {
      await inspector.getByRole("button", { name: /^Typography/ }).click();
    }
    await expect(fontSize).toBeVisible();

    // An empty field shows its ◇ at rest, the sign that a variable can be
    // chosen, and Tab reaches it from the field.
    const choose = inspector.getByRole("button", {
      name: "Variables for Font size",
    });
    await expect(choose).toHaveCSS("opacity", "1");
    await fontSize.focus();
    for (let step = 0; step < 3; step += 1) {
      if (await choose.evaluate(element => element === document.activeElement))
        break;
      await page.keyboard.press("Tab");
    }
    await expect(choose).toBeFocused();
    await expect(choose).toHaveCSS("opacity", "1");

    // Enter opens the list on the type size, named as Design names it, and
    // only once: its line height is not offered for a font size.
    await page.keyboard.press("Enter");
    const list = page.getByRole("listbox", { name: "Variables" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("option", { name: /^Display/ })).toHaveCount(1);
    const display = list.getByRole("option", { name: "Display 48px" });
    await expect(display).toBeVisible();
    await expectNoAxeViolations(page, {
      include: '[data-slot="popover-content"]',
    });
    await display.click();
    await expect(list).toHaveCount(0);

    // The field shows the variable by name on one line, never its code
    // path, and the canvas draws it.
    const chip = inspector.getByRole("group", { name: /^Font size/ });
    await expect(chip).toContainText("Display");
    await expect(chip).not.toContainText("font-size.display");
    const lines = await chip
      .locator(".nx-variable-chip__text")
      .evaluate(element => {
        const style = getComputedStyle(element);
        return (
          element.getBoundingClientRect().height /
          Number.parseFloat(style.lineHeight)
        );
      });
    expect(lines).toBeLessThan(1.5);
    await expect.poll(() => headingSize(page)).toBe("48px");

    // What the page stores is the reference, not the size it resolves to.
    const saved = page.waitForRequest(
      request =>
        new URL(request.url()).pathname === HOMEPAGE &&
        ["PATCH", "PUT"].includes(request.method())
    );
    await pressSave(page);
    const request = await saved;
    expect((await request.response())?.ok()).toBe(true);
    expect(JSON.stringify(request.postDataJSON())).toContain(
      '"fontSize":{"$token":"font-size.display"}'
    );
    await expect(page.locator('[data-topbar="end"]')).not.toContainText(
      /Saving/
    );

    // Design changes the variable's size; the heading follows, untouched.
    await openDesign(page);
    await page
      .getByRole("button", { name: /^Display/ })
      .first()
      .click();
    const editor = page.getByRole("dialog", { name: "Edit Display" });
    const size = editor.getByLabel("Size, light", { exact: true });
    const written = styleWrite(page);
    await size.fill("40px");
    await size.press("Enter");
    await written;
    await page.keyboard.press("Escape");
    await expect.poll(() => headingSize(page)).toBe("40px");
  } finally {
    // Off the homepage first: a variable still in use cannot be removed.
    await emptyHomepage(page);
    // Dropping a variable is refused until every page is counted.
    await countEveryPage(page.request);
    const restored = await page.request.patch(SITE_STYLE, {
      data: { tokens: before, _overwrite: true },
    });
    expect(restored.ok(), `restoring the variables: ${restored.status()}`).toBe(
      true
    );
  }
});

test("Escape closes an open picker and leaves the selection, and the next one goes up", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const before = await storedTokens(page);
  try {
    // Dropping a variable is refused until every page is counted.
    await countEveryPage(page.request);
    const seeded = await page.request.patch(SITE_STYLE, {
      data: { tokens: { tokens: TYPE_SCALE }, _overwrite: true },
    });
    expect(seeded.ok(), `seeding the type scale: ${seeded.status()}`).toBe(
      true
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(
      page,
      [
        {
          id: "escape-section",
          type: "core/section",
          version: 1,
          props: { as: "section", contained: true },
          slots: { children: NODES },
        },
      ],
      HEADING
    );
    const inspector = page.getByTestId("inspector");
    const pickers = [
      {
        open: inspector.getByRole("button", {
          name: "Variables for Font size",
        }),
        list: page.getByRole("listbox", { name: "Variables" }),
      },
      {
        open: inspector.getByRole("button", { name: /^Colour for Colou?r/ }),
        list: page.getByRole("listbox", { name: "Colour variables" }),
      },
    ];
    for (const picker of pickers) {
      await clickBlock(page, HEADING);
      await expect.poll(() => selection(page)).toEqual([HEADING]);
      await inspector.getByRole("tab", { name: "Style" }).click();
      // Opened by its own state rather than by what is visible this instant:
      // a section read while the inspector redraws would be toggled shut.
      const typography = inspector.getByRole("button", { name: /^Typography/ });
      if ((await typography.getAttribute("aria-expanded")) !== "true") {
        await typography.click();
      }
      await expect(typography).toHaveAttribute("aria-expanded", "true");
      await expect(picker.open).toBeVisible();
      await picker.open.focus();
      await page.keyboard.press("Enter");
      await expect(picker.list).toBeVisible();

      // One press closes the list, and only the list.
      await page.keyboard.press("Escape");
      await expect(picker.list).toHaveCount(0);
      expect(await selection(page)).toEqual([HEADING]);

      // With it closed, Escape is the editor's again: up to the section.
      await page.keyboard.press("Escape");
      await expect.poll(() => selection(page)).toEqual(["escape-section"]);
    }
  } finally {
    // Off the homepage first: a variable still in use cannot be removed.
    await emptyHomepage(page);
    // Dropping a variable is refused until every page is counted.
    await countEveryPage(page.request);
    const restored = await page.request.patch(SITE_STYLE, {
      data: { tokens: before, _overwrite: true },
    });
    expect(restored.ok(), `restoring the variables: ${restored.status()}`).toBe(
      true
    );
  }
});
