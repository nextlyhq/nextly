/**
 * The Schema Builder's create dialog held to WCAG AA in the light scheme and
 * the dark one: axe over its text, its controls and its validation messages
 * (Create held back with its reason, and an address already in use), and a
 * keyboard walk round it measuring every focus ring against what it is drawn
 * on. Each scheme is set as the admin's chosen theme and as the browser's
 * preference, as the visual check sets both.
 *
 * Nothing is created: the dialog is opened, filled and scanned, never sent.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { contrastRatio, gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";

type Rgb = [number, number, number];

/**
 * What the focused element draws to show its focus, and what it is drawn on:
 * its outline when it has one, and each ring its box shadow draws (a layer
 * with a spread; a soft shadow has none), every colour painted by the browser
 * and composited over the backgrounds behind it.
 */
async function focusIndicator(
  page: Page
): Promise<{ name: string; marks: Rgb[]; backdrop: Rgb }> {
  return page.evaluate(() => {
    const node = document.activeElement;
    if (!(node instanceof HTMLElement)) throw new Error("nothing focused");
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    type Rgba = [number, number, number, number];
    const rgba = (color: string): Rgba => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: Rgba, under: Rgb): Rgb =>
      [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])) as Rgb;
    const layers: Rgba[] = [];
    for (let at = node.parentElement; at !== null; at = at.parentElement) {
      const layer = rgba(getComputedStyle(at).backgroundColor);
      if (layer[3] === 0) continue;
      layers.push(layer);
      if (layer[3] === 1) break;
    }
    let backdrop: Rgb = [255, 255, 255];
    for (const layer of layers.reverse()) backdrop = over(layer, backdrop);
    const style = getComputedStyle(node);
    const outline =
      style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0
        ? [over(rgba(style.outlineColor), backdrop)]
        : [];
    const rings =
      style.boxShadow === "none"
        ? []
        : style.boxShadow
            .split(/,(?![^(]*\))/)
            .map(layer => {
              const color =
                /^\s*([a-z-]+\([^)]*\)|#[0-9a-f]+|[a-z]+)/i.exec(layer)?.[1] ??
                "";
              const lengths =
                layer
                  .slice(layer.indexOf(color) + color.length)
                  .match(/-?[\d.]+px/g) ?? [];
              return { color, spread: Number.parseFloat(lengths[3] ?? "0") };
            })
            .filter(layer => layer.color !== "" && layer.spread > 0)
            .map(layer => over(rgba(layer.color), backdrop));
    const name =
      node.getAttribute("aria-label") ??
      (node.id
        ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`)
            ?.textContent
        : null) ??
      node.textContent?.trim() ??
      node.tagName;
    return {
      name: name || node.tagName,
      marks: [...outline, ...rings],
      backdrop,
    };
  });
}

/**
 * Tabs round the open dialog once, from its Name field back to it, and names
 * every stop whose focus is drawn below 3:1 against what it is drawn on, or
 * not drawn at all, and every stop focus reached outside the dialog.
 */
async function weakFocusStops(page: Page): Promise<string[]> {
  const dialog = page.getByRole("dialog", { name: "New collection" });
  const first = dialog.getByLabel("Name", { exact: true });
  await first.focus();
  // Arriving by keyboard, so the controls draw their keyboard focus.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(first).toBeFocused();
  const weak: string[] = [];
  let stops = 0;
  for (; stops < 30; stops++) {
    const inside = await dialog.evaluate(element =>
      element.contains(document.activeElement)
    );
    if (!inside) weak.push(`stop ${stops} is outside the dialog`);
    const { name, marks, backdrop } = await focusIndicator(page);
    const best = Math.max(
      0,
      ...marks.map(mark => contrastRatio(mark, backdrop))
    );
    if (best < 3) weak.push(`${name}: focus drawn at ${best.toFixed(2)}:1`);
    await page.keyboard.press("Tab");
    if (stops > 0 && (await first.evaluate(e => e === document.activeElement)))
      break;
  }
  // The control: the walk went round, through more than the one field.
  expect(stops, "the walk never came back to the Name field").toBeLessThan(30);
  expect(stops).toBeGreaterThan(3);
  return weak;
}

/** Opens the create dialog in `scheme`, chosen and preferred both. */
async function openDialogIn(page: Page, scheme: Theme) {
  await page.emulateMedia({ colorScheme: scheme });
  await gotoAdmin(page, "/builder/collections/new", scheme);
  const dialog = page.getByRole("dialog", { name: "New collection" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

for (const scheme of ["light", "dark"] as const) {
  test(`the create dialog meets AA in ${scheme}: its text, controls, validation messages and focus rings`, async ({
    page,
  }) => {
    const dialog = await openDialogIn(page, scheme);
    const scope = { include: '[role="dialog"]' };

    // Empty: Create is held back, saying why.
    await expect(dialog.getByText("Add a name.")).toBeVisible();
    await expectNoAxeViolations(page, scope);

    // Its options open, so their switches and the description are scanned.
    await dialog.getByRole("button", { name: /^More options/ }).click();
    await expect(dialog.getByLabel("Description")).toBeVisible();
    await expectNoAxeViolations(page, scope);

    // An address already in use: the refusal, drawn as an error.
    await dialog.getByLabel("Name", { exact: true }).fill("Posts again");
    await dialog.getByLabel("API address").fill("posts");
    await expect(
      dialog.getByText("A collection or Single already uses this address.")
    ).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByLabel("API address")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    await expect(dialog.getByText("Choose another address.")).toBeVisible();
    await expectNoAxeViolations(page, scope);

    expect(await weakFocusStops(page)).toEqual([]);
  });
}
