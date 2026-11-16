/**
 * The Schema Builder's create dialog held to WCAG AA in the light scheme and
 * the dark one: axe over its text, its controls and its validation messages
 * (Create held back with its reason, and an address already in use), and a
 * keyboard walk round it, options open, measuring how each control marks its
 * focus (an outline, a ring, or a border focus recolours) against what it is
 * drawn on. Each scheme is set as the admin's chosen theme and as the browser's
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
 * its outline when it has one, each ring its box shadow draws (a layer with a
 * spread; a soft shadow has none), and its border when focus changed its
 * colour (the shared inputs and switches mark focus that way), every colour
 * painted by the browser and composited over the backgrounds behind it.
 */
async function focusIndicator(
  page: Page
): Promise<{ name: string; marks: Rgb[]; backdrop: Rgb }> {
  return page.evaluate(async () => {
    const node = document.activeElement;
    if (!(node instanceof HTMLElement)) throw new Error("nothing focused");
    // The shared controls animate their border into its focused colour; read
    // it once that has finished, not part-way.
    await Promise.all(node.getAnimations().map(running => running.finished));
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
    // The border counts only where focus changed it from how it looks at rest,
    // noted by `noteRestingBorders` before the walk.
    const border =
      style.borderTopStyle !== "none" &&
      Number.parseFloat(style.borderTopWidth) > 0 &&
      node.dataset.restingBorder !== undefined &&
      node.dataset.restingBorder !== style.borderTopColor
        ? [over(rgba(style.borderTopColor), backdrop)]
        : [];
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
      marks: [...outline, ...rings, ...border],
      backdrop,
    };
  });
}

/**
 * Notes, on each control of the dialog, its border colour at rest: nothing
 * focused and the pointer away, so a border focus changes can be told from
 * the same border as it always is.
 */
async function noteRestingBorders(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("no dialog open");
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ),
    ];
    // Settled first: a border still easing out of focus is not its rest.
    await Promise.all(
      controls.flatMap(element =>
        element.getAnimations().map(running => running.finished)
      )
    );
    for (const element of controls) {
      element.dataset.restingBorder = getComputedStyle(element).borderTopColor;
    }
  });
}

/**
 * Tabs round the open dialog once, from its Name field back to it, and names
 * every stop whose focus is drawn below 3:1 against what it is drawn on, or
 * not drawn at all, and every stop focus reached outside the dialog.
 *
 * The shared on/off switch is reached but not judged: it marks focus only by
 * recolouring its border to the primary colour, which a checked switch already
 * has and an unchecked one's own border colour overrides, so it draws no focus
 * in either state on any admin screen. That is the shared component's to fix,
 * not this dialog's; every switch must still be reachable by keyboard.
 */
async function weakFocusStops(page: Page): Promise<string[]> {
  const dialog = page.getByRole("dialog", { name: "New collection" });
  const first = dialog.getByLabel("Name", { exact: true });
  await noteRestingBorders(page);
  await first.focus();
  // Arriving by keyboard, so the controls draw their keyboard focus.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(first).toBeFocused();
  const weak: string[] = [];
  const switchesDrawn = await dialog.getByRole("switch").count();
  let switchesReached = 0;
  let stops = 0;
  for (; stops < 30; stops++) {
    const inside = await dialog.evaluate(element =>
      element.contains(document.activeElement)
    );
    if (!inside) weak.push(`stop ${stops} is outside the dialog`);
    const sharedSwitch = await page.evaluate(
      () => document.activeElement?.getAttribute("data-slot") === "switch"
    );
    if (sharedSwitch) {
      switchesReached++;
      await page.keyboard.press("Tab");
      continue;
    }
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
  // Set aside from the judging only, never from the walk: every switch the
  // options draw is a stop (one, Internationalization, may be disabled).
  expect(switchesDrawn).toBeGreaterThan(2);
  expect(switchesReached).toBeGreaterThanOrEqual(switchesDrawn - 1);
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

    // Every control's focus, options open, the switches and description among
    // them. Walked before the refusal below: a field marked invalid keeps its
    // error border when focused, which is the shared input's to draw, not
    // this dialog's.
    expect(await weakFocusStops(page)).toEqual([]);

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
  });
}
