/**
 * The document's own verbs stay inside the editor when the preview pane
 * narrows it. On a desktop screen no control folds into the document's menu,
 * so every one is drawn; with the divider at its narrowest the editor is too
 * narrow for them on one line. They wrap within the editor as the header's
 * controls around them do, rather than running past its edge, where Save draft
 * would sit behind the navigation and out of reach.
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";

test("keeps Save draft and Publish inside an editor narrowed by the preview", async ({
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

  const editorPane = page.locator(
    `[id="${await divider.getAttribute("aria-controls")}"]`
  );
  const controls = page.getByRole("button", {
    name: /^(Save draft|Publish|More actions)$/,
  });
  await expect(controls).toHaveCount(3);
  // Each control lies within the editor pane, on both sides.
  await expect
    .poll(async () => {
      const pane = await editorPane.evaluate(el => {
        const box = el.getBoundingClientRect();
        return { left: box.left, right: box.right };
      });
      const edges = await controls.evaluateAll(elements =>
        elements.map(el => {
          const box = el.getBoundingClientRect();
          return { left: box.left, right: box.right };
        })
      );
      return edges.every(
        edge => edge.left >= pane.left - 1 && edge.right <= pane.right + 1
      );
    })
    .toBe(true);
});
