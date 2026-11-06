/**
 * Leaving an entry hands its claim back: closing the tab, or following a link
 * out of the admin, frees the entry for a colleague waiting on it within one
 * of their beats, not one lease later. A reload hands it back and claims it
 * again, and leaves it with the editor who reloaded.
 *
 * And the release cannot be sent from another site: a page elsewhere that
 * knows the claim's token is refused by the browser itself (the session
 * cookie is `SameSite=Lax`, and a cross-site `DELETE` needs a preflight the
 * admin's API does not grant), while the same request from the admin's own
 * address is let through.
 *
 * @module tests/entry-lock-leave
 */
import { expect, type Browser, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCKED_POST as POST } from "./support/locked-post";
import { LOCK } from "./support/locks";
import {
  claimedBy,
  claimToken,
  expectFree,
  expectHeldBy,
  SECOND_EDITOR,
  secondEditor,
} from "./support/two-editors";

// Creates a second editor's account; see support/locks.ts for what each lock
// guards.
test.describe.configure({ lock: [LOCK.usersRoles] });

/**
 * One lock heartbeat (15 seconds), and a little more: how long a locked-out
 * editor takes to ask again, and so to find a document that was handed back.
 */
const ONE_BEAT = 20_000;

/**
 * The first editor holds a post of the test's own in a tab of its own, and a
 * second editor is waiting on it, read-only. `leave` takes the first tab away.
 */
async function leaveWhileAColleagueWaits(
  {
    page,
    browser,
    baseURL,
  }: { page: Page; browser: Browser; baseURL: string | undefined },
  leave: (tab: Page) => Promise<void>
): Promise<void> {
  const { document, address, stored } = await POST.prepare(page.request);
  const tab = await page.context().newPage();
  await gotoAdmin(tab, address);
  await expect(POST.field(tab)).toHaveValue(stored, { timeout: 30_000 });
  const first = await claimedBy(page.request, document);

  const other = await secondEditor(browser, page, baseURL);
  try {
    await gotoAdmin(other.page, address);
    await expect(
      other.page.getByText(`${first} is editing this document.`)
    ).toBeVisible({ timeout: 30_000 });
    await expect(POST.field(other.page)).not.toBeEditable();

    await leave(tab);

    // 🔴 Within a beat, not a lease. Kept, the claim would hold the waiting
    // editor out for the rest of its lease, minutes rather than seconds.
    await expect(POST.field(other.page)).toBeEditable({ timeout: ONE_BEAT });
    await expectHeldBy(page.request, document, SECOND_EDITOR);
  } finally {
    await other.context.close();
  }
}

/**
 * Sends the lock route a release of `claim` from whatever page `from` shows,
 * as a page's own script would, and says what came of it.
 */
function releaseFrom(
  from: Page,
  target: string,
  claim: Record<string, string>
): Promise<string> {
  return from.evaluate(
    async ({ target, claim }) => {
      try {
        const answer = await fetch(target, {
          method: "DELETE",
          credentials: "include",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(claim),
        });
        return `answered ${answer.status}`;
      } catch {
        return "refused";
      }
    },
    { target, claim }
  );
}

// Run on every dialect: the claim handed back lives in the database.
test.describe("leaving an entry", { tag: EVERY_DIALECT }, () => {
  test.describe.configure({ timeout: 120_000 });

  test("closing the tab frees the entry for the editor waiting on it", async ({
    page,
    browser,
    baseURL,
  }) => {
    await leaveWhileAColleagueWaits({ page, browser, baseURL }, tab =>
      // Run as a person closing it: the page's own exit handlers fire.
      tab.close({ runBeforeUnload: true })
    );
  });

  test("following a link out of the admin frees the entry", async ({
    page,
    browser,
    baseURL,
  }) => {
    await leaveWhileAColleagueWaits({ page, browser, baseURL }, async tab => {
      await tab.goto("about:blank");
    });
  });

  test("a reload keeps the entry with the editor who reloaded", async ({
    page,
    browser,
    baseURL,
  }) => {
    // The reload hands the claim back and the page it loads claims it again.
    // The waiting editor must not slip in between, nor find it free a beat
    // later because the release landed after the new claim.
    const { document, address, stored } = await POST.prepare(page.request);
    await gotoAdmin(page, address);
    await expect(POST.field(page)).toHaveValue(stored, { timeout: 30_000 });
    const first = await claimedBy(page.request, document);

    const other = await secondEditor(browser, page, baseURL);
    try {
      await gotoAdmin(other.page, address);
      await expect(
        other.page.getByText(`${first} is editing this document.`)
      ).toBeVisible({ timeout: 30_000 });

      await page.reload();
      await expect(POST.field(page)).toBeEditable({ timeout: 30_000 });
      await expectHeldBy(page.request, document, first);

      // A whole beat of the waiting editor's, which asks again on it.
      await other.page.waitForTimeout(ONE_BEAT);
      await expectHeldBy(page.request, document, first);
      await expect(POST.field(other.page)).not.toBeEditable();
      await expect(POST.field(page)).toBeEditable();
    } finally {
      await other.context.close();
    }
  });

  test("a release sent from another site is refused, and from the admin let through", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("The suite configures no baseURL.");
    const { document } = await POST.prepare(page.request);
    const token = await claimToken(page.request, document);
    const holder = await claimedBy(page.request, document);
    const target = new URL("/admin/api/document-lock", baseURL).toString();
    const claim = { ...document, claimToken: token };

    // The same server under another name is another site to the browser:
    // `localhost` and `127.0.0.1` share no cookies.
    const elsewhere = new URL(baseURL);
    elsewhere.hostname =
      elsewhere.hostname === "localhost" ? "127.0.0.1" : "localhost";
    await page.goto(new URL("/api/health", elsewhere).toString());
    expect(await releaseFrom(page, target, claim)).toBe("refused");
    await expectHeldBy(page.request, document, holder);

    // The control: the same request, token and all, from the admin's own
    // address. Without it, a refusal above could be a wrong token or body.
    await page.goto(new URL("/api/health", baseURL).toString());
    expect(await releaseFrom(page, target, claim)).toBe("answered 200");
    await expectFree(page.request, document);
  });
});
