/**
 * Variables in the Design panel, end to end: an author creates a variable with
 * a dark value, it is in the panel after a reload, and the compiled sheet
 * applies its dark value when the device prefers dark — and only then.
 */
import { expect, type Page } from "@playwright/test";

import { openEditorWith } from "./canvas/editor-driver";
import { expectNoAxeViolations } from "./support/axe";
import { canvasFrame } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage Single is reseeded and the site's variables are changed and
// restored, as the other builder files do.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const LIGHT = "#1b7f5c";
const DARK = "#8fe3c0";
const PROPERTY = "--site-color-sea";
const NODES = [
  {
    id: "variables-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the site's variables" },
  },
];

/**
 * The dark block a device preference applies, guarded so the light marker can
 * still pin light. Spelled out rather than imported: the marker is published
 * contract, so a rename on the engine side must fail here.
 */
const DEVICE_DARK_OPENING =
  /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-nx-theme="light"\]\)\{[^{}]*$/;

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

/**
 * Show the Design panel. The editor remembers the open panel per author, and
 * the rail button toggles, so after a reload it may already be open.
 */
async function openDesign(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  // A remembered panel is restored with the editor; give it the chance.
  const restored = await panel
    .waitFor({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (restored) return;
  await page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Design", exact: true })
    .click();
  await expect(panel).toBeVisible();
}

/** Fill one field of the open editor and wait for the save it makes. */
async function commit(
  page: Page,
  field: ReturnType<Page["getByLabel"]>,
  value: string
): Promise<void> {
  const saved = styleWrite(page);
  await field.fill(value);
  await field.press("Enter");
  await saved;
}

test("a new variable with a dark value is kept, and the sheet applies it on a dark device", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const before = await storedTokens(page);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    // On the editor's blank page, which states the canvas's colour scheme from
    // the nearest theme marker below. A page the site serves states its own,
    // as it does published, so the site's canvas route is answered as missing
    // and the editor falls back to the blank page.
    await page.route("**/page-builder-canvas", async route => {
      // A thrown handler prints the request, headers and all; answer instead.
      try {
        await route.fulfill({
          status: 404,
          contentType: "text/html",
          body: "<!doctype html><html><body><main>Not found</main></body></html>",
        });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    await openEditorWith(page, NODES, "variables-text");
    await openDesign(page);

    // "+" opens the new variable's editor with focus on its name.
    const added = styleWrite(page);
    await page.getByRole("button", { name: "Add colour" }).click();
    await added;
    await expect(
      page.getByRole("dialog", { name: "Edit New colour" })
    ).toBeVisible();
    // Addressed without its name from here, since naming it renames it.
    const editor = page.getByRole("dialog");
    const name = editor.getByLabel("Name", { exact: true });
    await expect(name).toBeFocused();
    await commit(page, name, "Sea");
    await commit(page, editor.getByLabel("Light", { exact: true }), LIGHT);
    const darkAdded = styleWrite(page);
    await editor.getByRole("button", { name: "Add dark value" }).click();
    await darkAdded;
    await commit(page, editor.getByLabel("Dark", { exact: true }), DARK);
    // Closing names its code after the label it was given.
    const named = styleWrite(page);
    await page.keyboard.press("Escape");
    await named;

    const row = () =>
      page.getByRole("button", {
        name: `Sea, light ${LIGHT}, dark ${DARK}`,
      });
    await expect(row()).toBeVisible();
    expect(JSON.stringify(await storedTokens(page))).toContain('"color.sea"');

    // Kept across a reload.
    await page.reload();
    await openDesign(page);
    await expect(row()).toBeVisible();

    // By keyboard: Enter on the row opens its editor on Name, and Escape
    // closes it back onto the row.
    await row().focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Edit Sea" }).getByLabel("Name", {
        exact: true,
      })
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row()).toBeFocused();

    // The editor meets WCAG AA in the admin's light and dark themes, its
    // destructive Remove included.
    await row().click();
    await expect(page.getByRole("dialog", { name: "Edit Sea" })).toBeVisible();
    await expectNoAxeViolations(page, { include: ".nx-vars-editor" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    try {
      await expectNoAxeViolations(page, { include: ".nx-vars-editor" });
    } finally {
      await page.evaluate(() =>
        document.documentElement.classList.remove("dark")
      );
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The compiled sheet carries the dark value under the guarded device
    // block, and the browser applies it only when the device prefers dark.
    // In the canvas's own document, where the page and its sheet are drawn.
    const canvasRoot = canvasFrame(page).locator("html");
    const sheet = await canvasRoot.evaluate(root =>
      [...root.ownerDocument.querySelectorAll("style")]
        .map(style => style.textContent ?? "")
        .join("\n")
    );
    const at = sheet.indexOf(`${PROPERTY}:${DARK}`);
    expect(at).toBeGreaterThan(-1);
    expect(sheet.slice(sheet.lastIndexOf("}", at) + 1, at)).toMatch(
      DEVICE_DARK_OPENING
    );
    const resolved = () =>
      canvasRoot.evaluate(
        (root, property) =>
          getComputedStyle(root).getPropertyValue(property).trim(),
        PROPERTY
      );
    expect(await resolved()).toBe(LIGHT);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(resolved).toBe(DARK);

    // A light marker below the root pins light there, on a dark device: the
    // sheet declares the light values at the marked element itself.
    const wrapperValue = () =>
      canvasRoot.evaluate((root, property) => {
        const wrapper = root.ownerDocument.createElement("div");
        wrapper.dataset.nxTheme = "light";
        root.ownerDocument.body.append(wrapper);
        const value = getComputedStyle(wrapper)
          .getPropertyValue(property)
          .trim();
        wrapper.remove();
        return value;
      }, PROPERTY);
    expect(await wrapperValue()).toBe(LIGHT);
    expect(await resolved()).toBe(DARK);

    // The canvas's scheme follows the NEAREST marker, as its token values do,
    // through three alternations: light > dark > light above the canvas, then
    // with the nearest flipped to dark.
    const canvas = canvasFrame(page).locator(".nx-canvas");
    const canvasMode = () =>
      canvas.evaluate((element, property) => {
        const style = getComputedStyle(element);
        return {
          scheme: style.colorScheme,
          value: style.getPropertyValue(property).trim(),
        };
      }, PROPERTY);
    const markAbove = (modes: readonly string[]) =>
      canvas.evaluate((element, chain) => {
        const holders = [
          element.ownerDocument.documentElement,
          element.ownerDocument.body,
          element.parentElement,
        ];
        holders.forEach((holder, at) => {
          const mode = chain[at];
          if (holder === null) return;
          if (mode === undefined) holder.removeAttribute("data-nx-theme");
          else holder.setAttribute("data-nx-theme", mode);
        });
      }, modes);
    try {
      await markAbove(["light", "dark", "light"]);
      await expect.poll(canvasMode).toEqual({ scheme: "light", value: LIGHT });
      await markAbove(["light", "dark", "dark"]);
      await expect.poll(canvasMode).toEqual({ scheme: "dark", value: DARK });
    } finally {
      await markAbove([]);
    }
  } finally {
    const restored = await page.request.patch(SITE_STYLE, {
      data: { tokens: before },
    });
    expect(restored.ok(), `restoring the variables: ${restored.status()}`).toBe(
      true
    );
  }
});

/**
 * The marker blocks a scoped sheet writes, as `emitTokenBlocks` writes them for
 * the scope `.scope` (pinned there by a unit test). Spelled out because the
 * marker is published contract.
 */
const SCOPED_DARK =
  ':is(.scope)[data-nx-theme="dark"],[data-nx-theme="dark"] :is(.scope):not([data-nx-theme="light"],[data-nx-theme="dark"] [data-nx-theme="light"] *)';
const SCOPED_LIGHT =
  ':is(.scope)[data-nx-theme="light"],[data-nx-theme="light"] :is(.scope):not([data-nx-theme="dark"],[data-nx-theme="light"] [data-nx-theme="dark"] *)';

test("the nearest marker decides which mode a scoped sheet applies", async ({
  page,
}) => {
  // Each probe holds text, so it is a visible element the suite's locators
  // can find.
  await page.setContent(`
    <div data-nx-theme="light"><div data-nx-theme="dark"><div data-testid="dark-nearer" class="scope">probe</div></div></div>
    <div data-nx-theme="dark"><div data-nx-theme="light"><div data-testid="light-nearer" class="scope">probe</div></div></div>
    <div data-nx-theme="light"><div data-testid="self-dark" class="scope" data-nx-theme="dark">probe</div></div>
  `);
  // Each probe found by its test id, and asked which sheet's selector it
  // matches. Each holds a word, so it has a box: the suite finds by test id
  // only what is visible.
  const modeOf = (id: string) =>
    page.getByTestId(id).evaluate(
      (element, [dark, light]) => ({
        dark: element.matches(dark ?? ""),
        light: element.matches(light ?? ""),
      }),
      [SCOPED_DARK, SCOPED_LIGHT]
    );
  expect(await modeOf("dark-nearer")).toEqual({ dark: true, light: false });
  expect(await modeOf("light-nearer")).toEqual({ dark: false, light: true });
  expect(await modeOf("self-dark")).toEqual({ dark: true, light: false });
});
