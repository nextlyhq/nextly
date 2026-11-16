/**
 * Two people and one Single: an editor who gains it starts from the copy
 * that was saved while they waited.
 *
 * The Single counterpart of `entry-lock-fresh-copy`: B opens the playground's
 * site settings while A holds them, A saves the tagline, and when B gains the
 * Single, by A leaving or by B taking it over, B's form shows A's tagline
 * before it lets B type. (A Single's title is set by its config and never
 * editable, so a plain field of its own carries the value.) B's read of the Single after the gain is held until the test lets it
 * go, so the form is seen read-only while the latest version is on its way.
 *
 * @module tests/single-lock-fresh-copy
 */
import { expect, type Page } from "@playwright/test";

import { freeDocument, test } from "./support/test";
import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";
import { claimedBy, SECOND_EDITOR, secondEditor } from "./support/two-editors";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.siteSettings, LOCK.usersRoles] });

const SINGLE_API = "/admin/api/singles/site-settings";

function tagline(page: Page) {
  return page.getByRole("textbox", { name: "Tagline", exact: true });
}

/**
 * Hold the page's reads of the Single's document until the returned release
 * is called, and say when the first one is asked for. Its schema and other
 * sub-resources carry more path after the slug.
 */
async function holdSingleReads(page: Page) {
  const read = new RegExp(`${SINGLE_API}(?:\\?|$)`);
  let release: () => void = () => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(read, async route => {
    if (route.request().method() !== "GET") return route.continue();
    await released;
    await route.continue();
  });
  const asked = page.waitForRequest(
    request => request.method() === "GET" && read.test(request.url()),
    { timeout: 45_000 }
  );
  return { asked, release };
}

/**
 * Fail the page's reads of the Single's document, as an unreachable server
 * would, until the returned stop is called.
 */
async function failSingleReads(page: Page) {
  const read = new RegExp(`${SINGLE_API}(?:\\?|$)`);
  let failing = true;
  await page.route(read, async route => {
    if (!failing || route.request().method() !== "GET") {
      return route.continue();
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The server could not be reached.",
          requestId: "e2e",
        },
      }),
    });
  });
  return {
    stop: () => {
      failing = false;
    },
  };
}

test.describe(
  "an editor who gains a Single starts from the saved copy",
  { tag: EVERY_DIALECT },
  () => {
    test.describe.configure({ timeout: 120_000 });

    let before = "";
    let entryId = "";
    test.beforeEach(async ({ page }) => {
      // Each test ends with B holding the Single, and closing B's page does
      // not release it, so it is freed before every test, not only the first.
      await freeDocument(page.request, "siteSettings");
      before = `Tagline before ${uniqueTag()}`;
      // Its site name is required, so a form save is refused while it is
      // empty, as it is in a fresh database. Kept when it is already set.
      const read = await page.request.get(SINGLE_API);
      expect(read.ok(), await read.text()).toBe(true);
      const single = (await read.json()) as {
        id: string;
        siteName?: string | null;
      };
      entryId = single.id;
      const { siteName } = single;
      const stored = await page.request.patch(SINGLE_API, {
        data: {
          tagline: before,
          siteName: siteName || "Nextly",
          _overwrite: true,
        },
      });
      expect(stored.ok(), await stored.text()).toBe(true);
    });

    for (const way of ["leaves", "takes over"] as const) {
      const name =
        way === "leaves"
          ? "B sees A's saved value before the form unlocks after A leaves"
          : "B sees A's saved value before the form unlocks after B takes over";

      test(name, async ({ page, browser, baseURL }) => {
        const saved = `Saved by A ${uniqueTag()}`;
        await gotoAdmin(page, "/singles/site-settings");
        await expect(tagline(page)).toBeEditable({ timeout: 30_000 });
        // A's claim has landed before B arrives, so B finds it held by A.
        expect(
          await claimedBy(page.request, {
            scopeKind: "single",
            slug: "site-settings",
            entryId,
          })
        ).not.toBe(SECOND_EDITOR);

        const other = await secondEditor(browser, page, baseURL);
        try {
          await gotoAdmin(other.page, "/singles/site-settings");
          await expect(
            other.page.getByText(/is editing this document/)
          ).toBeVisible({ timeout: 30_000 });
          await expect(tagline(other.page)).toHaveValue(before);
          await expect(tagline(other.page)).not.toBeEditable();

          await tagline(page).fill(saved);
          const stored = page.waitForResponse(
            response =>
              response.url().includes(SINGLE_API) &&
              response.request().method() === "PATCH",
            { timeout: 30_000 }
          );
          await page.getByRole("button", { name: "Save", exact: true }).click();
          expect((await stored).ok(), "A's save must be stored").toBe(true);

          const reads = await holdSingleReads(other.page);
          if (way === "leaves") {
            // Leaving inside the admin, which releases the claim as the
            // editor unmounts.
            await page
              .getByRole("navigation", { name: "Breadcrumb" })
              .getByRole("link", { name: "Singles", exact: true })
              .click();
            // The Singles page sends the browser on to the first Single, so
            // what is waited for is leaving this one.
            await page.waitForURL(
              url => !url.pathname.endsWith("/singles/site-settings")
            );
          } else {
            await other.page.getByRole("button", { name: "Take over" }).click();
          }

          await reads.asked;
          await expect(
            other.page.getByText(/Loading the latest version/)
          ).toBeVisible();
          await expect(tagline(other.page)).not.toBeEditable();

          reads.release();
          await expect(tagline(other.page)).toHaveValue(saved, {
            timeout: 30_000,
          });
          await expect(tagline(other.page)).toBeEditable();
        } finally {
          await other.context.close();
        }
      });
    }

    test("B stays read-only, and can try again, when the saved value cannot be loaded after B takes over", async ({
      page,
      browser,
      baseURL,
    }) => {
      const saved = `Saved by A ${uniqueTag()}`;
      await gotoAdmin(page, "/singles/site-settings");
      await expect(tagline(page)).toBeEditable({ timeout: 30_000 });
      expect(
        await claimedBy(page.request, {
          scopeKind: "single",
          slug: "site-settings",
          entryId,
        })
      ).not.toBe(SECOND_EDITOR);

      const other = await secondEditor(browser, page, baseURL);
      try {
        await gotoAdmin(other.page, "/singles/site-settings");
        await expect(
          other.page.getByText(/is editing this document/)
        ).toBeVisible({ timeout: 30_000 });
        // Saved outside A's form: what B is kept from is the point here.
        const stored = await page.request.patch(SINGLE_API, {
          data: { tagline: saved, _overwrite: true },
        });
        expect(stored.ok(), await stored.text()).toBe(true);

        const failing = await failSingleReads(other.page);
        await other.page.getByRole("button", { name: "Take over" }).click();

        // The editor stays, read-only over the copy from before, and says so;
        // it is not replaced by the page's "couldn't be loaded" error.
        await expect(
          other.page.getByText(/couldn't load the latest version/)
        ).toBeVisible({ timeout: 45_000 });
        await expect(tagline(other.page)).toHaveValue(before);
        await expect(tagline(other.page)).not.toBeEditable();

        failing.stop();
        await other.page.getByRole("button", { name: "Try again" }).click();
        await expect(tagline(other.page)).toHaveValue(saved, {
          timeout: 30_000,
        });
        await expect(tagline(other.page)).toBeEditable();
      } finally {
        await other.context.close();
      }
    });
  }
);
