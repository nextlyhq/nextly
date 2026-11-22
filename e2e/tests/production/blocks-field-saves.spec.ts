import { expect } from "@playwright/test";

import { test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

/**
 * A blocks field saves a page drawn from the site's core blocks on a
 * production build, on a Single and on a page alike.
 *
 * A production build bundles the page builder into each route, so the field
 * type a save is judged by can come from a copy of the plugin that never
 * started; the save must still be judged against the started site's blocks
 * rather than refused.
 */
const PAGE = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "saves-text",
      type: "core/text",
      version: 1,
      props: { text: "Saved on a production build" },
    },
  ],
};

test("a Single and a page each save a core block", async ({
  page,
  request,
}) => {
  await signIn(page);
  const cookies = await page.context().cookies();
  const headers = {
    cookie: cookies.map(c => `${c.name}=${c.value}`).join("; "),
    "content-type": "application/json",
  };

  const single = await request.patch("/admin/api/singles/homepage", {
    headers,
    data: { layout: PAGE, _overwrite: true },
  });
  expect(
    single.ok(),
    `the Single's save failed: ${single.status()} ${await single.text()}`
  ).toBe(true);

  const slug = `blocks-saves-${Date.now()}`;
  const created = await request.post("/admin/api/collections/pages/entries", {
    headers,
    data: { title: slug, slug, content: PAGE },
  });
  expect(
    created.ok(),
    `the page's save failed: ${created.status()} ${await created.text()}`
  ).toBe(true);
});
