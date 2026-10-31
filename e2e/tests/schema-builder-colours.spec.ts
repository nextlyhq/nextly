/**
 * The Schema Builder's save confirmation is red only when the save deletes
 * stored values, against a real server and in a real browser.
 *
 * The colour compared is the one the browser paints: the confirm button's
 * computed fill, set against probe elements carrying the theme's primary and
 * destructive fills in the same place. A pixel baseline would compare fonts and
 * antialiasing that differ between machines; the computed fill is the property
 * a person reads as "this deletes", and it is the same on every runner. A
 * screenshot of each confirmation is attached to the report for the reader.
 *
 * Each test seeds its own collection through the admin API, as the Builder
 * would have saved it. Safe to write against: the suite owns its database and
 * empties it before every run.
 */
import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

const API = "/admin/api";

/**
 * The collection slug for this attempt of a test. A retry runs against the
 * database the first attempt wrote, where a collection of the same slug
 * already exists, so each attempt has its own.
 */
function slugFor(base: string, testInfo: TestInfo): string {
  return testInfo.retry === 0 ? base : `${base}_r${testInfo.retry}`;
}

/** A translated collection of two text fields and one entry holding both. */
async function seedStories(page: Page, slug: string): Promise<void> {
  const created = await page.request.post(`${API}/collections`, {
    data: {
      name: slug,
      labels: { singular: "Story", plural: "Stories" },
      localized: true,
      fields: [
        { name: "headline", type: "text", label: "Headline", localized: true },
        { name: "summary", type: "text", label: "Summary" },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const entry = await page.request.post(`${API}/collections/${slug}/entries`, {
    data: { headline: "Hello", summary: "Kept until deleted" },
  });
  expect(entry.ok(), await entry.text()).toBe(true);
}

/** The open confirmation's confirming button: the last one in its footer. */
function confirmingButton(page: Page): Locator {
  return page.getByRole("alertdialog").getByRole("button").last();
}

/**
 * Which of the theme's two fills the button is painted with, compared in the
 * page: a probe of each fill is placed beside the button, where the same
 * styles and colour scheme apply, and read back.
 */
async function paintedFill(
  button: Locator
): Promise<"primary" | "destructive" | "neither"> {
  // Nothing hovers the button, so the resting fill is the one read.
  await button.page().mouse.move(0, 0);
  return button.evaluate(element => {
    const fillOf = (className: string): string => {
      const probe = document.createElement("span");
      probe.className = className;
      element.parentElement?.append(probe);
      const fill = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return fill;
    };
    const painted = getComputedStyle(element).backgroundColor;
    const primary = fillOf("bg-primary");
    const destructive = fillOf("bg-destructive-solid");
    if (primary === destructive) return "neither";
    if (painted === destructive) return "destructive";
    if (painted === primary) return "primary";
    return "neither";
  });
}

test("the save confirmation is primary without a deletion and destructive with one", async ({
  page,
}, testInfo) => {
  const slug = slugFor("e2e_colour_stories", testInfo);
  await seedStories(page, slug);
  await gotoAdmin(page, `/builder/collections/${slug}`);

  // No deletion: a translated field made shared moves its other languages'
  // values to the archive, which the preview flags as needing care but which
  // deletes nothing.
  // Exact: the field row's own button names its actions too ("… Edit headline …").
  await page
    .getByRole("button", { name: "Edit headline", exact: true })
    .click();
  await page.getByRole("tab", { name: "Advanced" }).click();
  await page.getByRole("switch", { name: "Localized" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await testInfo.attach("save without a deletion", {
    body: await page.getByRole("alertdialog").screenshot(),
    contentType: "image/png",
  });
  expect(await paintedFill(confirmingButton(page))).toBe("primary");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  // A deletion: removing a field that holds a value deletes that value.
  await page.getByRole("button", { name: "Edit summary", exact: true }).click();
  await page.getByRole("button", { name: /delete field/i }).click();
  const deleteConfirm = page.getByRole("alertdialog");
  await expect(deleteConfirm).toBeVisible();
  expect(await paintedFill(confirmingButton(page))).toBe("destructive");
  await confirmingButton(page).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await testInfo.attach("save with a deletion", {
    body: await page.getByRole("alertdialog").screenshot(),
    contentType: "image/png",
  });
  expect(await paintedFill(confirmingButton(page))).toBe("destructive");
});
