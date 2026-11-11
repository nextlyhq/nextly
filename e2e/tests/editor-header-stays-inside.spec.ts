/**
 * The document's own verbs stay in reach when the preview pane narrows the
 * editor. They are drawn in the admin's one top bar, which spans the editor and
 * the preview, so narrowing the editor takes no width from them: each control
 * stays inside the bar, on its one row, and inside the window.
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";

test("keeps Save draft and Publish inside the bar while the preview narrows the editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  // A collection with a preview, so the editor can be narrowed beside one.
  const created = await page.request.post(
    "/admin/api/collections/block-pages/entries",
    { data: { title: "Narrow editor", slug: `narrow-editor-${Date.now()}` } }
  );
  expect(created.ok()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  await gotoAdmin(page, `/collections/block-pages/${item.id}`);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true })
  ).toHaveValue("Narrow editor", { timeout: 30_000 });

  await page.getByRole("button", { name: "Show preview", exact: true }).click();
  const divider = page.getByRole("separator", { name: /^Resize the editor/ });
  await divider.focus();
  // The editor at the narrowest the divider allows.
  await page.keyboard.press("Home");

  const bar = page
    .getByRole("banner")
    .filter({ has: page.getByTestId("document-bar") });
  const controls = page.getByRole("button", {
    name: /^(Save draft|Publish|More actions)$/,
  });
  await expect(controls).toHaveCount(3);
  // Each control lies within the bar, on its row, and within the window.
  await expect
    .poll(async () => {
      const box = await bar.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      const edges = await controls.evaluateAll(elements =>
        elements.map(el => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        })
      );
      return edges.every(
        edge =>
          edge.left >= box.left - 1 &&
          edge.right <= Math.min(box.right, 1024) + 1 &&
          edge.top >= box.top - 1 &&
          edge.bottom <= box.bottom + 1
      );
    })
    .toBe(true);
});
