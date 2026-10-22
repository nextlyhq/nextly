/**
 * The email workbench against a real server, at phone, tablet and desktop
 * widths, light and dark: the preview keeps its width beside the side sheet,
 * nothing scrolls sideways, a phone gets its tabs and its fixed bar, the
 * Liquid editor completes and checks what an author types on a phone, axe
 * finds nothing at AA, and an owner's email is overridden, reset and the
 * reset undone. Set `WORKBENCH_SHOTS_DIR` to keep a screenshot of each width
 * in each theme.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin, type Theme } from "./support/admin";

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

/** Whether the page scrolls sideways, which no width may make it do. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

/** Open core's Welcome email in the workbench, from the Messages list. */
async function openWelcome(page: Page, theme: Theme = "light"): Promise<void> {
  await gotoAdmin(page, "/email", theme);
  // Below tablet width the list is cards; either way the name links in.
  await page
    .getByRole("link", { name: "Welcome Email", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/email\/messages\/edit\//, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("workbench-header")).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * A Liquid field: CodeMirror's text area, named by the field's label. The
 * editor loads on demand, so the first lookup waits for it.
 */
function liquidField(page: Page, name: string) {
  return page.getByRole("textbox", { name, exact: true });
}

/** Put Welcome back to core's version, whatever an earlier run left. */
async function resetIfCustomised(page: Page): Promise<void> {
  const reset = page.getByRole("button", { name: "Reset to Nextly's version" });
  if (await reset.isVisible()) {
    await reset.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reset", exact: true })
      .click();
    await expect(
      page.getByText(/Nextly keeps this email up to date/)
    ).toBeVisible({ timeout: 30_000 });
  }
}

async function box(page: Page, testId: string) {
  const found = await page.getByTestId(testId).boundingBox();
  expect(found, testId).not.toBeNull();
  return found!;
}

for (const theme of ["light", "dark"] as const)
  for (const size of WIDTHS) {
    test(`the workbench fits ${size.width} wide, beside its preview (${theme})`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      await openWelcome(page, theme);
      await expect(liquidField(page, "From")).toBeVisible({ timeout: 30_000 });

      if (size.width < 640) {
        // A phone: one pane at a time, the actions in a bar at the bottom.
        for (const tab of ["Edit", "Preview", "Data", "Details"]) {
          await expect(page.getByRole("tab", { name: tab })).toBeVisible();
        }
        const bar = page.getByTestId("workbench-phone-bar");
        await expect(bar).toBeVisible();
        await expect(bar.getByRole("button", { name: "Save" })).toBeVisible();
        const barBox = await bar.boundingBox();
        expect(barBox!.y + barBox!.height).toBeCloseTo(size.height, 0);

        await page.getByRole("tab", { name: "Preview" }).click();
        await expect(page.getByTestId("workbench-phone-preview")).toBeVisible();
      } else {
        // The envelope card keeps its height: a shrunk card clips its own
        // fields, which a visibility check can't see.
        const envelope = await box(page, "workbench-envelope");
        const from = await liquidField(page, "From").boundingBox();
        expect(
          from!.y + from!.height,
          "From inside its card"
        ).toBeLessThanOrEqual(envelope.y + envelope.height);

        await page.getByRole("button", { name: "Details" }).click();
        await expect(page.getByTestId("workbench-sheet")).toBeVisible();
        const preview = await box(page, "workbench-preview");
        const sheet = await box(page, "workbench-sheet");
        // The sheet makes room beside the preview; it never covers it.
        const overlap =
          Math.min(preview.x + preview.width, sheet.x + sheet.width) -
          Math.max(preview.x, sheet.x);
        expect(overlap, "sheet over preview").toBeLessThanOrEqual(0);
        expect(
          preview.width,
          "preview width with the sheet open"
        ).toBeGreaterThan(size.width < 1180 ? size.width / 2 - 40 : 300);
      }

      expect(await scrollsSideways(page), `at ${size.width}`).toBe(false);
      const shot = await page.screenshot({ fullPage: true });
      const name = `workbench-${size.width}-${theme}`;
      await testInfo.attach(name, { body: shot, contentType: "image/png" });
      const dir = process.env.WORKBENCH_SHOTS_DIR;
      if (dir) writeFileSync(path.join(dir, `${name}.png`), shot);
    });
  }

test("completes and checks Liquid as an author types, on a phone", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openWelcome(page);

  // From is the site's on any email, so it takes typing without an override.
  const from = liquidField(page, "From");
  await expect(from).toBeVisible({ timeout: 30_000 });
  await from.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("{{ ");
  await page.keyboard.press("Control+Space");
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options.first()).toBeVisible();
  expect(await options.count()).toBeGreaterThan(0);
  expect(await scrollsSideways(page), "with completion open").toBe(false);
  const shot = await page.screenshot();
  await testInfo.attach("workbench-390-completion", {
    body: shot,
    contentType: "image/png",
  });
  const dir = process.env.WORKBENCH_SHOTS_DIR;
  if (dir) writeFileSync(path.join(dir, "workbench-390-completion.png"), shot);
  await page.keyboard.press("Escape");

  // A filter the server doesn't have is named under the field as it's typed.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("{{ appName | shout }}");
  await expect(
    page.getByRole("alert").filter({ hasText: /shout/ })
  ).toBeVisible({ timeout: 10_000 });

  // And goes when it's fixed.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("{{ appName | upcase }}");
  await expect(
    page.getByRole("alert").filter({ hasText: /shout/ })
  ).toHaveCount(0, { timeout: 10_000 });
});

test("keeps every part of an email in reach", async ({ page }, testInfo) => {
  // What the workbench did before its redesign, each reached through the
  // controls it has now: a part that went missing fails here by name.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWelcome(page);
  const dir = process.env.WORKBENCH_SHOTS_DIR;
  const keep = async (name: string, shot: Buffer) => {
    await testInfo.attach(name, { body: shot, contentType: "image/png" });
    if (dir) writeFileSync(path.join(dir, `${name}.png`), shot);
  };

  // The name, the envelope, both bodies and the preview.
  await expect(page.getByRole("textbox", { name: "Email name" })).toBeVisible();
  for (const name of ["Subject", "Preview text", "From", "Reply-To"]) {
    await expect(liquidField(page, name)).toBeVisible({ timeout: 30_000 });
  }
  await expect(liquidField(page, "HTML body")).toBeVisible();
  await page.getByRole("button", { name: "Plain text", exact: true }).click();
  await expect(liquidField(page, "Plain text body")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  await expect(page.getByTestId("workbench-preview")).toBeVisible();

  // Sample data.
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await expect(liquidField(page, "Sample data")).toBeVisible({
    timeout: 30_000,
  });
  await keep("workbench-data", await page.screenshot());

  // Slug, provider, layout, active, attachments and declared variables.
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const sheet = page.getByTestId("workbench-sheet");
  for (const text of [
    "Slug",
    "Provider",
    "Use layout",
    "Active",
    "Attachments",
    "Declared variables",
  ]) {
    const label = sheet.getByText(text, { exact: true }).first();
    await label.scrollIntoViewIfNeeded();
    await expect(label, text).toBeVisible();
  }
  await sheet.getByText("Slug", { exact: true }).scrollIntoViewIfNeeded();
  await keep("workbench-details", await page.screenshot());

  // Duplicate, from the menu.
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
  await keep("workbench-menu", await page.screenshot());
  await page.keyboard.press("Escape");

  // Test send opens its dialog; nothing is sent.
  await page
    .getByTestId("workbench-header")
    .getByRole("button", { name: "Send test" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Send test email")).toBeVisible();
  await keep("workbench-send-test", await page.screenshot());
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

/** WCAG 2.2 AA and the levels under it, as the builder's scan states them. */
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const [theme, size] of [
  ["light", { width: 1440, height: 900 }],
  ["dark", { width: 390, height: 844 }],
] as const) {
  test(`axe finds nothing at AA in the workbench, ${size.width} wide (${theme})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await openWelcome(page, theme);
    await expect(liquidField(page, "From")).toBeVisible({ timeout: 30_000 });

    const results = await new AxeBuilder({ page })
      .include('[data-testid="workbench-header"]')
      .include("main")
      .withTags(AA_TAGS)
      .analyze();
    // A scan of nothing reports nothing, as a clean page does.
    expect(results.passes.length, "axe scanned nothing").toBeGreaterThan(10);
    expect(
      results.violations.map(violation => ({
        id: violation.id,
        nodes: violation.nodes.map(node => ({
          target: node.target.map(String),
          html: node.html.slice(0, 160),
          why: node.failureSummary,
        })),
      }))
    ).toEqual([]);
  });
}

test("overrides an owner's email, resets it, and undoes the reset", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWelcome(page);
  await resetIfCustomised(page);

  // Core's email: read-only content, with Override.
  const subject = liquidField(page, "Subject");
  await expect(subject).toHaveAttribute("aria-readonly", "true", {
    timeout: 30_000,
  });
  await page
    .getByTestId("workbench-header")
    .getByRole("button", { name: "Override" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Override", exact: true })
    .click();
  await expect(subject).not.toHaveAttribute("aria-readonly", "true", {
    timeout: 30_000,
  });

  // Reset gives it back to core, and Undo puts the site's version back.
  await page.getByRole("button", { name: "Reset to Nextly's version" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reset", exact: true })
    .click();
  await expect(subject).toHaveAttribute("aria-readonly", "true", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(subject).not.toHaveAttribute("aria-readonly", "true", {
    timeout: 30_000,
  });

  // Leave it as a fresh install has it.
  await resetIfCustomised(page);
});
