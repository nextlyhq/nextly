/**
 * Adding an email provider against a real server: choose, connect, and send a
 * real test, with each built-in type. Nothing here reaches the internet: the
 * Log provider sends nothing, SMTP is pointed at a closed local port so its
 * check is refused as unreachable, and the API providers are taken as far as
 * their own fields.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const RUN = Date.now().toString(36);

async function choose(page: Page, type: RegExp) {
  await gotoAdmin(page, "/email/sending/create");
  await page.getByRole("radio", { name: type }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

async function identify(page: Page, name: string) {
  await page.getByLabel(/Provider Name/).fill(name);
  await page.getByLabel(/From Email/).fill("dev@example.com");
}

/** Whether the page scrolls sideways, which no width may make it do. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

test("sets up the Log provider: logged, not sent, then turned on", async ({
  page,
}) => {
  const name = `Dev log ${RUN}`;
  await choose(page, /^Log/);
  await identify(page, name);
  await page.getByRole("button", { name: "Continue" }).click();

  // Saved off: the last step offers to turn it on.
  await expect(page.getByRole("heading", { name: "Send a test" })).toBeVisible({
    timeout: 30_000,
  });
  const turnOn = page.getByRole("switch", { name: "Turn on" });
  await expect(turnOn).toHaveAttribute("aria-checked", "false");

  await page.getByRole("button", { name: "Send a test" }).click();
  await expect(
    page.getByText("The test email was logged, not sent.")
  ).toBeVisible({ timeout: 30_000 });
  await expect(turnOn).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/admin\/email\/sending$/, { timeout: 30_000 });
  // Rows render as buttons: the whole row opens the provider.
  const row = page.getByRole("button", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Off")).toHaveCount(0);
});

test("refuses SMTP settings at the check, says what to check, and saves nothing", async ({
  page,
}) => {
  const name = `Closed SMTP ${RUN}`;
  await choose(page, /^SMTP/);
  await identify(page, name);
  // A loopback host needs no sign-in, and port 1 has nothing listening.
  await page.getByLabel("SMTP Host").fill("127.0.0.1");
  await page.getByLabel("SMTP Port").fill("1");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Nextly couldn't reach SMTP.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/host and port/)).toBeVisible();
  // Still connecting: nothing was saved.
  await expect(
    page.getByRole("heading", { name: /Connect SMTP/ })
  ).toBeVisible();
  await gotoAdmin(page, "/email/sending");
  await expect(
    page.getByRole("button", { name: new RegExp(name) })
  ).toHaveCount(0);
});

for (const [label, fields] of [
  ["Resend", ["API Key"]],
  ["SendLayer", ["API Key"]],
] as const) {
  test(`connects ${label} with only its own settings`, async ({ page }) => {
    await choose(page, new RegExp(`^${label}`));
    await expect(
      page.getByRole("heading", { name: `Connect ${label}` })
    ).toBeVisible({ timeout: 30_000 });
    for (const field of fields) {
      await expect(page.getByLabel(field)).toBeVisible();
    }
    // No other type's settings, and no type picker: the type was chosen.
    await expect(page.getByLabel("SMTP Host")).toHaveCount(0);
    await expect(page.getByText("Provider Type")).toHaveCount(0);
  });
}

for (const size of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const) {
  test(`the setup and the Sending tab fit at ${size.width}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);

    await gotoAdmin(page, "/email/sending");
    await expect(
      page.getByRole("heading", { name: "Default sender" })
    ).toBeVisible({ timeout: 30_000 });
    expect(await scrollsSideways(page), `Sending at ${size.width}`).toBe(false);
    await testInfo.attach(`sending-${size.width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await gotoAdmin(page, "/email/sending/create");
    await expect(page.getByRole("radio").first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await scrollsSideways(page), `Choose at ${size.width}`).toBe(false);
    await testInfo.attach(`setup-choose-${size.width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await page.getByRole("radio", { name: /^Log/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel(/Provider Name/)).toBeVisible();
    expect(await scrollsSideways(page), `Connect at ${size.width}`).toBe(false);
    await testInfo.attach(`setup-connect-${size.width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}
