/**
 * A submission's own page against a real server: opened from a form's list,
 * it reads at its own address, says where it sits in that list, and Older
 * and Newer move through the same list, keeping its filter.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

const API = "/admin/api";

test("moves through the list it was opened from", async ({ page }) => {
  const stamp = Date.now().toString(36);
  await gotoAdmin(page, "/collections/form-submissions");
  const form = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/forms/entries`, {
      data: {
        name: `Page ${stamp}`,
        slug: `page-${stamp}`,
        status: "published",
        fields: [
          { type: "text", name: "name", label: "Full name", required: true },
          { type: "email", name: "email", label: "Email" },
        ],
      },
    })
  );
  // Oldest first. The server stamps each when it arrives, to the second, so
  // they are sent a little over a second apart and the list reads Chen,
  // Bilal, Ana. (Rows sent within one second tie on the time and are ordered
  // by id: the integration test of the neighbour queries covers that.)
  const names = ["Ana", "Bilal", "Chen"].map(name => `${name} ${stamp}`);
  for (const [index, name] of names.entries()) {
    if (index > 0) await page.waitForTimeout(1_100);
    await ok(
      await page.request.post(`${API}/collections/form-submissions/entries`, {
        data: {
          form: form.item.id,
          data: {
            name,
            email: `${name.split(" ")[0]!.toLowerCase()}@example.com`,
          },
        },
      })
    );
  }

  await gotoAdmin(page, `/collections/form-submissions?form=${form.item.id}`);
  await page.getByText(names[1]!).filter({ visible: true }).first().click();

  const scope = `\\?status=all&form=${form.item.id}$`;
  await expect(page).toHaveURL(new RegExp(scope));
  await expect(page.getByRole("heading", { name: names[1] })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("2 of 3")).toBeVisible();

  await page.getByRole("button", { name: "Older submission" }).click();
  await expect(page.getByRole("heading", { name: names[0] })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(new RegExp(scope));
  await expect(page.getByText("3 of 3")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Older submission" })
  ).toBeDisabled();

  await page.getByRole("button", { name: "Newer submission" }).click();
  await expect(page.getByRole("heading", { name: names[1] })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Newer submission" }).click();
  await expect(page.getByRole("heading", { name: names[2] })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("1 of 3")).toBeVisible();
});
