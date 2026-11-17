/**
 * The Form block's hidden spam trap, on a published page in a real browser.
 *
 * The block's own tests pin the trap's attributes. What only a browser can
 * say is what a visitor meets: nothing. The trap is not drawn where anyone
 * sees it, the keyboard never lands in it, a screen reader is not given it
 * (axe finds no fault in the form, and the accessibility tree has no field
 * for it), and filling the form in leaves it empty.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module form-spam-trap.spec
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** A published page holding one simple form: its slug. */
async function seed(page: Page): Promise<string> {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const slug = `form-trap-${stamp}`;
  const created = await page.request.post(PAGES, {
    data: {
      title: `Form trap ${stamp}`,
      slug,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "contact",
            type: "core/form",
            version: 1,
            props: {
              action: "https://hooks.example.com/contact",
              submitText: "Send",
              fields: [
                { label: "Name", name: "name", required: true },
                {
                  label: "Email",
                  name: "email",
                  type: "email",
                  required: true,
                },
              ],
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  return slug;
}

test("a visitor never meets the spam trap", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const slug = await seed(page);
  const response = await page.goto(`/${slug}`);
  expect(response?.status()).toBe(200);

  const form = page.locator("form").filter({ has: page.getByLabel("Name") });
  const trap = form.locator('input[name="_hp"]');
  await expect(trap).toHaveCount(1);

  // Off screen: wholly outside the viewport and the form, with no size to see.
  const box = await trap.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const container = element.parentElement?.getBoundingClientRect();
    return {
      right: rect.right,
      containerWidth: container?.width ?? -1,
      containerHeight: container?.height ?? -1,
    };
  });
  expect(box.right).toBeLessThan(0);
  expect(box.containerWidth).toBeLessThanOrEqual(1);
  expect(box.containerHeight).toBeLessThanOrEqual(1);

  // The keyboard goes from the last field straight to the button.
  await page.getByLabel("Name").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Send" })).toBeFocused();

  // A screen reader is given the two fields, and no trap: roles are read
  // from the accessibility tree, which leaves out what is hidden from it.
  await expect(form.getByRole("textbox")).toHaveCount(2);
  // The control: counted with hidden elements, the trap is there.
  await expect(form.getByRole("textbox", { includeHidden: true })).toHaveCount(
    3
  );

  // axe finds nothing wrong with the form, the hidden trap included.
  const results = await new AxeBuilder({ page })
    .include("form")
    .withTags(AA_TAGS)
    .analyze();
  // A scan that reached nothing passes exactly as a clean one does.
  expect(results.passes.length).toBeGreaterThan(3);
  expect(results.violations.map(violation => violation.id)).toEqual([]);

  // Closed to the browser's autofill, and left empty by a person filling the
  // form in.
  await expect(trap).toHaveAttribute("autocomplete", "off");
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await expect(trap).toHaveValue("");
});
