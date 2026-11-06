/**
 * Fixing a problem that would stop a release, in a real browser. A post was
 * added by someone who has since lost the right to publish posts, so the
 * release's page marks it as needing a fix and offers neither Schedule… nor
 * Publish now… until it is. Taking it out from the problem itself, and adding
 * it back as someone who may publish it, leaves nothing in the way, and the
 * release schedules.
 */
import { expect, type APIRequestContext } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { cancel, ok, post, readRelease } from "./support/releases-api";
import { test } from "./support/test";

// It changes a role it made, and reads the role list.
test.describe.configure({ lock: [LOCK.usersRoles] });

const API = "/admin/api";

/** What the person who adds the post may do, before losing `publish-posts`. */
const ADDER = [
  "read-content-releases",
  "create-content-releases",
  "read-posts",
  "update-posts",
  "publish-posts",
  "unpublish-posts",
];

/** Give a role exactly these permissions, by slug. */
async function setRolePermissions(
  admin: APIRequestContext,
  roleId: string,
  slugs: readonly string[]
): Promise<void> {
  const { items } = await ok<{ items: Array<{ id: string; slug: string }> }>(
    await admin.get(`${API}/permissions?page=1&limit=1000`)
  );
  const permissionIds = slugs.map(slug => {
    const found = items.find(item => item.slug === slug);
    if (!found) throw new Error(`[e2e] No permission "${slug}".`);
    return found.id;
  });
  await ok(
    await admin.patch(`${API}/roles/${roleId}`, { data: { permissionIds } })
  );
}

/** `YYYY-MM-DDTHH:MM` in UTC, as a datetime-local field takes it. */
const wallClockUtc = (at: Date): string => at.toISOString().slice(0, 16);

test("names what would stop a release, and schedules it once that is fixed", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const stamp = Date.now().toString(36);
  const postTitle = `Release e2e ${stamp}`;
  const postId = await post(page, stamp);
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/releases`, {
      data: { title: `Fix a problem e2e ${stamp}` },
    })
  );
  const releaseId = item.id;
  const adder = await signInAsLimitedUser(
    browser,
    page.request,
    baseURL ?? "",
    ADDER
  );
  try {
    await ok(
      await adder.context.request.post(`${API}/releases/${releaseId}/members`, {
        data: {
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: postId,
          action: "publish",
        },
      })
    );
    // The person who added it may no longer publish posts.
    await setRolePermissions(
      page.request,
      adder.roleId,
      ADDER.filter(slug => slug !== "publish-posts")
    );

    await gotoAdmin(page, `/releases/${releaseId}`);
    const row = page
      .getByRole("group", { name: /^Posts/ })
      .getByRole("listitem", { name: new RegExp(`^${postTitle}`) });
    await expect(row.getByText("Needs a fix")).toBeVisible();
    await expect(
      row.getByText("The person who added it may no longer publish it")
    ).toBeVisible();

    // Nothing can be scheduled or published until it is fixed, and the page
    // says why.
    const scheduleButton = page.getByRole("button", { name: "Schedule…" });
    await expect(scheduleButton).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Publish now…" })
    ).toBeDisabled();
    await expect(
      page.getByText("Fix the document marked below first.")
    ).toBeVisible();
    await expect(
      page.getByText(
        "1 needs a fix before this release can be scheduled or published."
      )
    ).toBeVisible();
    await expectNoAxeViolations(page, { include: "main" });

    // The fix: take it out, from the problem itself, and add it back as
    // someone who may publish it.
    await row.getByRole("button", { name: "Remove it" }).click();
    const remove = page.getByRole("alertdialog");
    // Not scanned with axe: its one finding is the confirm button's white on
    // the destructive red, a pairing the design system accepts below 4.5:1 and
    // records in packages/ui's contrast/accepted.ts.
    await expect(remove).toBeVisible();
    await remove.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(remove).toHaveCount(0);
    await expect(row).toHaveCount(0);

    await page.getByRole("button", { name: "Add documents" }).click();
    const picker = page.getByRole("dialog");
    await picker.getByLabel("Find a document").fill(stamp);
    await picker.getByRole("checkbox", { name: postTitle }).click();
    await picker.getByRole("button", { name: "Add 1 document" }).click();
    await expect(picker).toHaveCount(0);
    await expect(row.getByText("Ready", { exact: true })).toBeVisible();

    // Nothing is in the way now.
    const at = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await expect(scheduleButton).toBeEnabled();
    await scheduleButton.click();
    const schedule = page.getByRole("dialog", {
      name: "Schedule this release",
    });
    await schedule.getByLabel("Date and time").fill(wallClockUtc(at));
    await schedule.getByLabel("Timezone").fill("UTC");
    await expect(schedule.getByText(/would stop this release/)).toHaveCount(0);
    await schedule.getByRole("button", { name: "Schedule release" }).click();
    await expect(schedule).toHaveCount(0);
    await expect
      .poll(async () => (await readRelease(page, releaseId)).state)
      .toBe("scheduled");
  } finally {
    await cancel(page, releaseId).catch(() => undefined);
    await adder.context.close();
  }
});
