/**
 * In development, first-run setup sent from a page at `127.0.0.1` succeeds for
 * an app whose own address is `localhost`.
 *
 * Under `next dev` the server reads its own address as the configured host,
 * so the origin check refused a page on another loopback name of the same
 * machine and port: a new user who opened `127.0.0.1` could not create the
 * first admin. The check now accepts, in development only, a loopback page
 * submitting to exactly the address it was sent to.
 *
 * The requests are the ones such a page sends: the CSRF token from
 * `127.0.0.1`, then the setup sent to `127.0.0.1` with that page's `Origin`.
 * They are made directly rather than by driving the form, because the
 * playground's page does not render at `127.0.0.1` under `next dev`: its dev
 * server refuses the hot-reload connection from that host unless
 * `allowedDevOrigins` lists it, and the page then reloads without end. The
 * server's answer, which is what changed, is the same either way.
 *
 * What stays refused is held by the origin check's unit tests and by
 * `setup-refused-origin.spec.ts`, which opens setup at `setup.localhost` and
 * is still refused.
 */
import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  cleanUpNextWrites,
  startEmptyPlayground,
  type EmptyPlayground,
} from "../support/playground-dev-server";

test.describe("first-run setup at 127.0.0.1 for an app at localhost", () => {
  test.describe.configure({ mode: "serial", timeout: 6 * 60 * 1000 });

  const removeNextWrites = cleanUpNextWrites();
  let playground: EmptyPlayground | undefined;

  test.beforeAll(async () => {
    playground = await startEmptyPlayground("setup-loopback");
  });

  test.afterAll(async () => {
    await playground?.close();
    removeNextWrites();
  });

  test("creates the first admin", async ({ request }, testInfo) => {
    const opened = `http://127.0.0.1:${playground?.port}`;
    try {
      // The token and its cookie, from the address the page is open at.
      const csrf = await request.get(`${opened}/admin/api/auth/csrf`);
      expect(csrf.ok()).toBe(true);
      const { token } = (await csrf.json()) as { token: string };

      const setup = await request.post(`${opened}/admin/api/auth/setup`, {
        headers: { origin: opened, "x-csrf-token": token },
        data: {
          name: "Ada Admin",
          email: "ada@example.com",
          password: "Str0ng!Passw0rd#2026",
          csrfToken: token,
        },
      });
      expect(setup.status(), await setup.text()).toBeLessThan(300);

      // Set up: the first-run status now says so.
      const status = await request.get(`${opened}/admin/api/auth/setup-status`);
      expect(((await status.json()) as { isSetup?: unknown }).isSetup).toBe(
        true
      );
    } catch (error) {
      const logFile = testInfo.outputPath("next-dev.log");
      writeFileSync(logFile, playground?.output() ?? "");
      await testInfo.attach("next-dev.log", { path: logFile });
      throw error;
    }
  });
});
