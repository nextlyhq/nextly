/**
 * A translated document a workflow holds, in a real browser: the Languages panel says each
 * language's stage beside its status, and the side panel is held to WCAG 2.2 AA in light and
 * dark. The playground's `reviewed-pages` collection has a workflow of its own, so this spec
 * shares nothing with the notes' review workflow and holds no lock.
 */
import { expect } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/reviewed-pages/entries";

for (const theme of ["light", "dark"] as const satisfies readonly Theme[]) {
  test(`the Languages panel says the stage each language stands in (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now().toString(36);
    // Written in English alone: English stands in Drafting, and no other language has any of
    // its own to review yet.
    const created = await page.request.post(PAGES, {
      data: {
        title: `Workflow page ${stamp}`,
        summary: `What changes for readers, ${stamp}.`,
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { item } = (await created.json()) as { item: { id: string } };

    await gotoAdmin(page, `/collections/reviewed-pages/${item.id}`, theme);
    const languages = page.getByRole("list", {
      name: "Languages in this document",
    });
    await expect(languages).toBeVisible({ timeout: 30_000 });
    const english = languages
      .getByRole("listitem")
      .filter({ hasText: "English" });
    await expect(english.locator("[data-review-stage]")).toHaveText(/Drafting/);
    await expectNoAxeViolations(page, {
      include: '[data-testid="document-panel-sections"]',
    });
  });
}
