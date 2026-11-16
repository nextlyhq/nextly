/**
 * A plugin's screen declares the data it reads as it opens, and a fresh tab
 * that opens on that screen asks for it in its first round, inside the
 * startup request, and never asks for it again.
 *
 * The screen is the playground's `startup-read-fixture`: one page whose one
 * read, a route of its own plugin, is declared as its startup read, and which
 * draws what that read answers. Every admin request the tab makes is
 * recorded from its very first: the startup request must be the first, it
 * must name the screen's read, and no request of the read's own may follow,
 * while the screen draws the read's answer, which then can only have come
 * from the startup request.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

/** The fixture's page, under its plugin's namespace, as the admin addresses it. */
const SCREEN = "/plugins/startup-read-fixture/greeting";
/** The admin API path of the screen's one read, as its plugin route answers. */
const READ = "/plugins/startup-read-fixture/greeting";
/** What the read answers, which only the screen draws. */
const GREETING = "Hello from the startup read fixture";

test("a plugin screen's declared read is sent in the first round, inside the startup request, once", async ({
  page,
}) => {
  const sent: URL[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/admin/api/")) sent.push(url);
  });

  await gotoAdmin(page, SCREEN);
  await expect(page.getByText(GREETING)).toBeVisible({ timeout: 30_000 });

  // The first admin request of the tab is the startup request, and it names
  // the screen's read beside what every screen needs.
  const [first] = sent;
  expect(first?.pathname).toBe("/admin/api/startup");
  const named = first?.searchParams.getAll("path") ?? [];
  expect(named).toContain(READ);
  expect(named).toContain("/auth/session");

  // Sent once: there is no request of the read's own, and no second startup
  // request.
  expect(
    sent.filter(url => url.pathname === `/admin/api${READ}`).map(String)
  ).toEqual([]);
  expect(
    sent.filter(url => url.pathname === "/admin/api/startup")
  ).toHaveLength(1);
});
