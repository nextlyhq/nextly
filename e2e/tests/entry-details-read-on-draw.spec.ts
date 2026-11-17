/**
 * An entry's details (its address, and who made and changed it) are read only
 * where something draws them: the address chip under the title and the side
 * panel's Details. Opening a page straight into the builder draws neither,
 * so it sends no `?details=1` request and the canvas waits on one fewer read.
 * The entry page draws both and reads them once.
 *
 * Counted as the browser sends them, because the property is the request
 * itself, which a component test can only stand in for.
 */
import { expect, type Page } from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

/** How long the admin must send nothing before a load counts as done. */
const QUIET_MS = 1_500;
/** The longest a load is watched once its page is drawn. */
const WATCH_MS = 15_000;

/** Records every admin API read whose query asks for an entry's details. */
function recordDetailsReads(page: Page): {
  details: string[];
  settled: () => Promise<void>;
} {
  const details: string[] = [];
  let last = Date.now();
  page.on("request", request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/admin/api/")) return;
    last = Date.now();
    if (url.searchParams.get("details") === "1") {
      details.push(`${url.pathname}${url.search}`);
    }
  });
  return {
    details,
    // Reads drawn after the first paint arrive late, so a load is over only
    // once the admin has sent nothing for a while.
    settled: async () => {
      const started = Date.now();
      while (Date.now() - last < QUIET_MS && Date.now() - started < WATCH_MS) {
        await page.waitForTimeout(250);
      }
    },
  };
}

test("opening a page in the builder reads no details", async ({ page }) => {
  const tag = uniqueTag();
  const id = await createEntry(page.request, "pages", {
    title: `Details on draw ${tag}`,
    slug: `details-on-draw-${tag}`,
  });
  const reads = recordDetailsReads(page);

  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  await reads.settled();

  expect(reads.details).toEqual([]);
});

test("the entry page reads its details once", async ({
  page,
}) => {
  const tag = uniqueTag();
  const id = await createEntry(page.request, "posts", {
    title: `Details shown ${tag}`,
    slug: `details-shown-${tag}`,
  });
  const reads = recordDetailsReads(page);

  await gotoAdmin(page, `/collections/posts/${id}`);
  // Drawn: the chip under the title is one of the parts that ask.
  await expect(page.getByTestId("document-address")).toContainText(
    `details-shown-${tag}`,
    { timeout: 30_000 }
  );
  await reads.settled();

  // The positive control for the builder case: the same recorder sees the
  // read where it is drawn, once though two parts draw it.
  expect(reads.details).toHaveLength(1);
  expect(reads.details[0]).toContain(`/collections/posts/entries/${id}?`);
});
