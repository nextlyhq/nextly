/**
 * The workbench's Data panel against a real server, at phone, tablet and
 * desktop widths: a template declaring a list of order lines gets a row per
 * line, a row added and filled in reaches the preview as the server renders
 * it, and nothing scrolls sideways. Set `WORKBENCH_SHOTS_DIR` to keep a
 * screenshot of the panel at each width.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.email] });

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

const ORDER_EMAIL = {
  subject: "Your order",
  htmlContent:
    "<ul>{% for line in lines %}<li>{{ line.title }}: {{ line.price }}</li>{% endfor %}</ul>",
  variables: [
    {
      name: "lines",
      description: "The order's lines",
      required: true,
      type: "list",
      label: "Order lines",
      fields: [
        { name: "title", type: "text", label: "Title" },
        { name: "price", type: "money", label: "Price" },
      ],
      example: [{ title: "Tea", price: 4 }],
    },
  ],
};

/** The rendered email, as the preview's frame holds it. */
async function previewHtml(page: Page): Promise<string> {
  return (
    (await page
      .locator('iframe[title="Email preview"]')
      .filter({ visible: true })
      .first()
      .getAttribute("srcdoc")) ?? ""
  );
}

async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

for (const size of WIDTHS) {
  test(`edits a list of order lines and sees the preview follow, at ${size.width}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const created = await page.request.post("/admin/api/email-templates", {
      data: {
        ...ORDER_EMAIL,
        name: `Order lines ${size.width}`,
        slug: `data-panel-${Date.now()}-${size.width}`,
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { item } = (await created.json()) as { item: { id: string } };

    try {
      await page.setViewportSize(size);
      await gotoAdmin(page, `/email/messages/edit/${item.id}`);
      await expect(page.getByTestId("workbench-header")).toBeVisible({
        timeout: 30_000,
      });
      const phone = size.width < 640;
      await (
        phone
          ? page.getByRole("tab", { name: "Data" })
          : page.getByRole("button", { name: "Data", exact: true })
      ).click();

      // A row for the example line, and one added and filled in.
      const panel = page.getByTestId("data-fields");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByTestId("row-lines")).toHaveCount(1);
      await panel
        .getByRole("button", { name: "Add a row to Order lines" })
        .click();
      const added = panel.getByTestId("row-lines").nth(1);
      await added.getByLabel("Title").fill("Scones");
      await added.getByLabel("Price").fill("6.5");

      expect(await scrollsSideways(page), `at ${size.width}`).toBe(false);
      const shot = await page.screenshot({ fullPage: true });
      const name = `data-panel-${size.width}`;
      await testInfo.attach(name, { body: shot, contentType: "image/png" });
      const dir = process.env.WORKBENCH_SHOTS_DIR;
      if (dir) writeFileSync(path.join(dir, `${name}.png`), shot);

      // The preview is the server's render of exactly that data.
      if (phone) await page.getByRole("tab", { name: "Preview" }).click();
      await expect
        .poll(() => previewHtml(page), { timeout: 30_000 })
        .toContain("Scones: 6.5");
      expect(await previewHtml(page)).toContain("Tea: 4");
    } finally {
      await page.request.delete(`/admin/api/email-templates/${item.id}`);
    }
  });
}
