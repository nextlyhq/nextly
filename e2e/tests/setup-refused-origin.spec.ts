/**
 * First-run setup opened at an address the app does not accept says so, and
 * links to the address it does.
 *
 * Before, the setup form was refused with 403 `CSRF_FAILED` ("Invalid request
 * origin") and looked exactly as it did before the click. A new user could be
 * stuck at the very first step with nothing to say why.
 *
 * The page is opened at `setup.localhost`, served by the same dev server,
 * while the app's own address is `localhost`. Every `*.localhost` name reaches
 * this machine, and the origin check refuses it however the loopback names are
 * treated: it is none of `localhost`, `127.0.0.1` or `[::1]`. It is also one
 * of the few names `next dev` serves a working page to at all. Its dev server
 * refuses the hot-reload connection from any other host unless
 * `allowedDevOrigins` lists it, and without that connection the page reloads
 * without end instead of rendering.
 *
 * Needs an empty database, so it starts its own playground server rather than
 * the suite's, which seeds a user and signs in on its own.
 */
import { writeFileSync } from "node:fs";

import { expect } from "@playwright/test";

import { test } from "./support/test";
import {
  cleanUpNextWrites,
  startEmptyPlayground,
  type EmptyPlayground,
} from "../support/playground-dev-server";

test.describe("first-run setup at an address the app does not accept", () => {
  // One server, built and booted once, for the one flow below.
  test.describe.configure({ mode: "serial", timeout: 6 * 60 * 1000 });

  const removeNextWrites = cleanUpNextWrites();
  let playground: EmptyPlayground | undefined;
  let appPort = 0;
  let log = "";

  test.beforeAll(async () => {
    playground = await startEmptyPlayground("setup-origin");
    appPort = playground.port;
  });

  test.afterAll(async () => {
    await playground?.close();
    removeNextWrites();
  });

  test("says which address to use, and the link there works", async ({
    page,
  }, testInfo) => {
    const opened = `http://setup.localhost:${appPort}`;
    const appAddress = `http://localhost:${appPort}`;
    // What the browser saw go wrong, beside the server's output, for a failure.
    page.on("console", message => {
      if (message.type() === "error") log += `\n[browser] ${message.text()}`;
    });
    page.on("requestfailed", request => {
      log += `\n[browser] failed ${request.url()}: ${request.failure()?.errorText ?? ""}`;
    });
    try {
      await page.goto(`${opened}/admin/setup`);
      // The first compile of the admin under a fresh build directory is slow.
      await expect(page.getByPlaceholder(/full name/i)).toBeVisible({
        timeout: 3 * 60 * 1000,
      });
      await page.getByPlaceholder(/full name/i).fill("Ada Admin");
      await page.getByPlaceholder(/email address/i).fill("ada@example.com");
      await page
        .getByPlaceholder(/create a strong password/i)
        .fill("Str0ng!Passw0rd#2026");
      await page
        .getByPlaceholder(/confirm your password/i)
        .fill("Str0ng!Passw0rd#2026");
      await page.getByRole("button", { name: /create admin account/i }).click();

      const notice = page.getByRole("alert").filter({
        hasText: "This page is open at a different address",
      });
      await expect(notice).toBeVisible();
      await expect(notice).toContainText(opened);
      await expect(notice).toContainText(appAddress);
      const link = notice.getByRole("link", {
        name: `Open this page at ${appAddress}`,
      });
      await expect(link).toHaveAttribute("href", `${appAddress}/admin/setup`);

      // The link is the fix: at the app's own address, setup goes through.
      await link.click();
      await page.waitForURL(`${appAddress}/admin/setup`);
      await page.getByPlaceholder(/full name/i).fill("Ada Admin");
      await page.getByPlaceholder(/email address/i).fill("ada@example.com");
      await page
        .getByPlaceholder(/create a strong password/i)
        .fill("Str0ng!Passw0rd#2026");
      await page
        .getByPlaceholder(/confirm your password/i)
        .fill("Str0ng!Passw0rd#2026");
      await page.getByRole("button", { name: /create admin account/i }).click();
      await page.waitForURL(`${appAddress}/admin`, { timeout: 60_000 });
    } catch (error) {
      // The server's own output is the evidence a failure here needs.
      const logFile = testInfo.outputPath("next-dev.log");
      writeFileSync(logFile, `${playground?.output() ?? ""}${log}`);
      await testInfo.attach("next-dev.log", { path: logFile });
      throw error;
    }
  });
});
