/**
 * A recovery point is never offered back as current once the document has
 * been written since it began.
 *
 * Only an editor save deletes an author's recovery point, so a write that
 * reaches the document another way (a REST update, a publish) used to leave the
 * older point in place, and the editor offered it on the next open as if it
 * were the work at risk: restoring it would revert the later write. The server
 * now says, from the counters it keeps, whether the point is from an older
 * version and whose: one its author wrote over is not offered, and any other is
 * offered with a warning.
 */
import { expect, request, type APIRequestContext } from "@playwright/test";

import {
  createSignedInUser,
  superAdminRoleId,
  uniqueTag,
} from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The posts flow shares the autosave state other specs use.
test.describe.configure({ lock: [LOCK.siteSettings] });

const POSTS = "/admin/api/collections/posts/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
const AUTOSAVE = /\/collections\/posts\/entries\/[^/]+\/versions\/autosave$/;
const OFFER =
  /These edits began from an older version\. Other author .+ changed the document at .+\. Restoring them replaces those changes\./;

/**
 * Another account, signed in on its own. A write by the recovery point's own
 * author is a real save, which deletes their point; the case that leaves an
 * older point behind is someone else's write.
 */
async function anotherAuthor(
  admin: APIRequestContext,
  baseURL: string
): Promise<APIRequestContext> {
  const tag = uniqueTag();
  const other = await createSignedInUser(admin, baseURL, {
    email: `older-point-${tag}@example.com`,
    name: `Other author ${tag}`,
    roleIds: [await superAdminRoleId(admin)],
  });
  return request.newContext({ baseURL, storageState: other.storageState });
}

test("a post another author wrote through REST after its recovery point is offered as older", async ({
  page,
  baseURL,
}) => {
  const title = `Older point ${Date.now()}`;
  await gotoAdmin(page, "/collections/posts/create");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("button", { name: /save draft/i }).click();
  await page.waitForURL(/\/collections\/posts$/, { timeout: 30_000 });
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/collections\/posts\/(?!create$)[^/]+$/, {
    timeout: 30_000,
  });
  const id = page.url().split("/").pop() ?? "";

  const written = page.waitForResponse(
    r => AUTOSAVE.test(r.url()) && r.request().method() === "PUT",
    { timeout: 30_000 }
  );
  await page
    .getByRole("textbox", { name: "Excerpt", exact: true })
    .fill("typed in the editor, never saved");
  expect((await written).status()).toBeLessThan(400);

  // Someone else then writes the document through the API.
  const other = await anotherAuthor(page.request, baseURL ?? "");
  const patched = await other.patch(`${POSTS}/${id}`, {
    data: { excerpt: "written through the API afterwards", _overwrite: true },
  });
  expect(patched.ok(), await patched.text()).toBe(true);
  await other.dispose();

  const read = page.waitForResponse(
    r => AUTOSAVE.test(r.url()) && r.request().method() === "GET",
    { timeout: 30_000 }
  );
  await page.reload();
  const answer = (await (await read).json()) as { superseded?: string } | null;
  // The server says the point is from an older version someone else wrote.
  expect(answer?.superseded).toBe("by-another");
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  // Offered still, since it is this author's work, but said to be older, naming who wrote since.
  await expect(page.getByText(OFFER)).toBeVisible({ timeout: 15_000 });
});

test("a component another author wrote after its recovery point says it is from an older version", async ({
  page,
  baseURL,
}) => {
  const stamp = Date.now();
  const created = await page.request.post(COMPONENTS, {
    data: { title: `Older point ${stamp}`, slug: `older-point-${stamp}` },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  expect(typeof id).toBe("string");

  const autosave = `${COMPONENTS}/${id}/versions/autosave`;
  const recorded = await page.request.put(autosave, {
    data: { title: `Older point ${stamp}`, description: "never saved" },
  });
  expect(recorded.ok(), await recorded.text()).toBe(true);

  const other = await anotherAuthor(page.request, baseURL ?? "");
  const patched = await other.patch(`${COMPONENTS}/${id}`, {
    data: { description: "written afterwards", _overwrite: true },
  });
  expect(patched.ok(), await patched.text()).toBe(true);
  await other.dispose();

  const read = await page.request.get(autosave);
  expect(read.ok()).toBe(true);
  const answer = (await read.json()) as { superseded?: string } | null;
  expect(answer?.superseded).toBe("by-another");
});
