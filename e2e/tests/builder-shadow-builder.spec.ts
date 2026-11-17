/**
 * Shadows built with fields in the Design panel, in the browser.
 *
 * - "+ Add shadow" opens a shadow with X offset, Y offset, Blur, Spread,
 *   Colour and Inside, and a preview; each field saves the stored CSS.
 * - A layer coloured by a colour variable with a dark value shows a dark
 *   preview too, and "+ Add layer", moving and removing layers save.
 * - "Edit as CSS" reads typed CSS back into the fields, keeps CSS it can't
 *   show as fields as typed, saying so, and refuses a shadow CSS can't draw.
 * - At the panel's narrowest the shadow fits without sideways scrolling, in
 *   light and dark; its accessibility scan waits on the scan measuring a
 *   Design popup at all.
 */
import { expect, type Page } from "@playwright/test";

import { openEditorWith } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const NODES = [
  {
    id: "shadow-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the shadow builder" },
  },
];
const CARD = "0 2px 4px rgba(0, 0, 0, 0.2)";
const TOKENS = [
  {
    name: "color.text",
    kind: "color",
    values: { light: "#111111", dark: "#eeeeee" },
  },
  { name: "shadow.card", kind: "shadow", values: { light: CARD } },
];

interface StoredSet {
  tokens?: { name: string; values: { light: string } }[];
}

async function storedTokens(page: Page): Promise<StoredSet | null> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return (item.tokens ?? null) as StoredSet | null;
}

/** One variable's light value, as stored. */
async function storedValue(page: Page, name: string): Promise<unknown> {
  const set = await storedTokens(page);
  return set?.tokens?.find(token => token.name === name)?.values.light;
}

async function seed(page: Page, tokens: unknown): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

async function openSpacing(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: /^Spacing/ }).click();
}

/** Types into a field and presses Enter. */
async function enter(field: ReturnType<Page["getByLabel"]>, value: string) {
  await field.fill(value);
  await field.press("Enter");
}

test("a new shadow is built with fields and layers, and its preview follows a colour's dark value", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const before = await storedTokens(page);
  try {
    await seed(page, { tokens: TOKENS });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "shadow-text");
    await openSpacing(page);
    const panel = page.getByRole("region", { name: "Design panel" });
    await panel.getByRole("button", { name: "Add shadow" }).click();
    const editor = page.getByRole("dialog", { name: "Edit New shadow" });
    const light = editor.getByRole("group", { name: "Light", exact: true });
    const first = light.getByRole("group", { name: "Layer 1" });
    for (const label of ["X offset", "Y offset", "Blur", "Spread"]) {
      await expect(first.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(first.getByRole("switch", { name: "Inside" })).toBeVisible();

    await enter(first.getByLabel("Blur", { exact: true }), "16");
    await expect
      .poll(() => storedValue(page, "shadow.new-shadow"))
      .toBe("0 4px 16px rgba(0, 0, 0, 0.12)");

    // Coloured by a variable with a dark value: a dark preview joins.
    await first.getByRole("button", { name: "Colour for layer 1" }).click();
    await page
      .getByRole("listbox", { name: "Colour variables" })
      .getByRole("option", { name: /^Text/ })
      .click();
    await expect
      .poll(() => storedValue(page, "shadow.new-shadow"))
      .toBe("0 4px 16px var(--site-color-text)");
    await expect(light.locator(".nx-shadow__card")).toHaveCount(2);
    await expect(light.locator('.nx-shadow__card[data-mode="dark"]')).toHaveCSS(
      "box-shadow",
      /rgb\(238, 238, 238\)/
    );

    await editor.getByRole("button", { name: "+ Add layer" }).click();
    await expect
      .poll(() => storedValue(page, "shadow.new-shadow"))
      .toBe(
        "0 4px 16px var(--site-color-text), 0 4px 12px rgba(0, 0, 0, 0.12)"
      );
    await editor.getByRole("button", { name: "Move layer 2 up" }).click();
    await expect
      .poll(() => storedValue(page, "shadow.new-shadow"))
      .toBe(
        "0 4px 12px rgba(0, 0, 0, 0.12), 0 4px 16px var(--site-color-text)"
      );
    await editor.getByRole("button", { name: "Remove layer 1" }).click();
    await expect
      .poll(() => storedValue(page, "shadow.new-shadow"))
      .toBe("0 4px 16px var(--site-color-text)");
  } finally {
    await seed(page, before);
  }
});

test("Edit as CSS reads typed CSS back into fields, keeps what can't be fields, and refuses what CSS can't draw", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  try {
    await seed(page, { tokens: TOKENS });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "shadow-text");
    await openSpacing(page);
    const panel = page.getByRole("region", { name: "Design panel" });
    await panel.getByRole("button", { name: /^Card,/ }).click();
    const editor = page.locator(".nx-vars-editor");
    const light = editor.getByRole("group", { name: "Light", exact: true });

    await light.getByRole("button", { name: "Edit as CSS" }).click();
    const layered = "inset 0 1px 0 rgba(255,255,255,.2), 0 2px 4px #0003";
    await enter(light.getByRole("textbox", { name: "Light as CSS" }), layered);
    await expect.poll(() => storedValue(page, "shadow.card")).toBe(layered);
    await expect(
      light
        .getByRole("group", { name: "Layer 1" })
        .getByRole("switch", { name: "Inside" })
    ).toBeChecked();
    await expect(light.getByRole("group", { name: "Layer 2" })).toBeVisible();

    await light.getByRole("button", { name: "Edit as CSS" }).click();
    const computed = "calc(1px + 1px) 2px 4px #000";
    const css = light.getByRole("textbox", { name: "Light as CSS" });
    await enter(css, computed);
    await expect.poll(() => storedValue(page, "shadow.card")).toBe(computed);
    await expect(
      light.getByText("Shown as CSS because it can't be shown as fields")
    ).toBeVisible();
    await expect(css).toHaveValue(computed);

    await enter(css, "0 4px 12pxred");
    await expect(css).toHaveAttribute("aria-invalid", "true");
    await expect(light.getByRole("alert")).toContainText(
      '"12pxred", which is not a size or a colour'
    );
    expect(await storedValue(page, "shadow.card")).toBe(computed);
  } finally {
    await seed(page, before);
  }
});

test("at the panel's narrowest a shadow fits without sideways scrolling, in light and dark", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await storedTokens(page);
  try {
    await seed(page, {
      tokens: [
        ...TOKENS,
        {
          name: "shadow.raised",
          kind: "shadow",
          values: {
            light: "0 1px 2px #0002, 0 8px 24px var(--site-color-text)",
          },
        },
      ],
    });
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openEditorWith(page, NODES, "shadow-text");
      if (theme === "dark") {
        await gotoAdmin(page, "/singles/homepage", "dark");
        await page
          .getByRole("link", {
            name: /^(?:Build this page|Open Page Builder|Open in builder)$/,
          })
          .click();
      }
      await openSpacing(page);
      const panel = page.getByRole("region", { name: "Design panel" });
      const divider = page.getByRole("separator", { name: "Panel and canvas" });
      await divider.focus();
      await page.keyboard.press("Home");
      await expect
        .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
        .toBeLessThanOrEqual(240);
      await panel.getByRole("button", { name: /^Raised,/ }).click();
      const editor = page.locator(".nx-vars-editor");
      await expect(
        editor.getByRole("group", { name: "Layer 2" })
      ).toBeVisible();
      const sideways = await editor.evaluate(element => {
        const scrolled = [element, ...element.querySelectorAll("*")].find(
          each =>
            each.scrollWidth > each.clientWidth + 1 &&
            getComputedStyle(each).overflowX !== "visible"
        );
        return scrolled === undefined ? null : scrolled.className;
      });
      expect(sideways, "nothing in the shadow scrolls sideways").toBeNull();
      const box = await editor.boundingBox();
      expect(box).not.toBeNull();
      if (box !== null) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1280);
      }
      await page.keyboard.press("Escape");
    }
  } finally {
    await seed(page, before);
  }
});

// While any Design popup is open, axe measures no contrast anywhere on the
// page, a variable's own editor included, so a scan of the shadow's editor
// proves nothing yet and is refused as empty. Enabled once the scan measures
// the popup.
test.fixme(
  "a shadow's editor passes the accessibility scan in light and dark",
  async ({ page }) => {
    test.setTimeout(240_000);
    const before = await storedTokens(page);
    try {
      await seed(page, { tokens: TOKENS });
      for (const theme of ["light", "dark"] as const) {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openEditorWith(page, NODES, "shadow-text");
        if (theme === "dark") {
          await gotoAdmin(page, "/singles/homepage", "dark");
          await page
            .getByRole("link", {
              name: /^(?:Build this page|Open Page Builder|Open in builder)$/,
            })
            .click();
        }
        await openSpacing(page);
        const panel = page.getByRole("region", { name: "Design panel" });
        await panel.getByRole("button", { name: /^Card,/ }).click();
        await expectNoAxeViolations(page, { include: ".nx-vars-editor" });
        await page.keyboard.press("Escape");
      }
    } finally {
      await seed(page, before);
    }
  }
);
