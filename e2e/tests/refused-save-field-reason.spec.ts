/**
 * A save the server refuses with a field's reason shows that reason on the
 * field, and keeps what the author changed.
 *
 * A Layout's areas are refused at the write when two rows fill one area: the
 * rule is a server-side `validate`, which the browser does not run, so the
 * form sends the save and the server answers 400 with the reason on `areas`.
 * The fetcher throws that answer as an `ApiError`, and before the form read
 * one, the author got "Validation failed." in a toast and nothing on the
 * field.
 *
 * Only a browser shows this whole: the request, the refusal's body and the
 * form that reads it are three layers, and a unit test stubs at least one.
 *
 * @module tests/refused-save-field-reason.spec
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { includingHidden, test } from "./support/test";

const API = "/admin/api";
// Unique to this attempt: a retry seeds again.
const RUN = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const REASON = "Two rows both fill the header area.";

test("a refused save puts the server's reason on its field and keeps the edit", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const api = page.request;
  // A component for the rows to place, and a Layout of two rows, one per area.
  const component = await api.post(`${API}/collections/components/entries`, {
    data: {
      title: `Band ${RUN}`,
      slug: `band-${RUN}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: [
          {
            id: "t",
            type: "core/heading",
            version: 1,
            props: { text: "Band", level: "h2" },
          },
        ],
      },
    },
  });
  expect(component.ok(), await component.text()).toBe(true);
  const componentId = ((await component.json()) as { item: { id: string } })
    .item.id;
  const layout = await api.post(`${API}/collections/layouts/entries`, {
    data: {
      title: `Two rows ${RUN}`,
      slug: `two-rows-${RUN}`,
      areas: [
        { area: "header", component: componentId },
        { area: "footer", component: componentId },
      ],
      status: "draft",
    },
  });
  expect(layout.ok(), await layout.text()).toBe(true);
  const layoutId = ((await layout.json()) as { item: { id: string } }).item.id;

  await gotoAdmin(page, `/collections/layouts/${layoutId}`);
  const main = page.locator("main");
  const areas = main.getByRole("combobox", { name: "Area" });
  await expect(areas).toHaveCount(2);
  await expect(areas.nth(1)).toHaveText(/footer/i);

  // The edit the server will refuse: the second row fills the header too.
  await areas.nth(1).click();
  await page.getByRole("option", { name: "header", exact: true }).click();
  await expect(areas.nth(1)).toHaveText(/header/i);

  const answer = page.waitForResponse(
    response =>
      response.request().method() === "PATCH" &&
      response.url().includes(`/collections/layouts/entries/${layoutId}`)
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const refusal = await answer;

  // The server refused it, on the field, in these words.
  expect(refusal.status()).toBe(400);
  const { error } = (await refusal.json()) as {
    error: { data: { errors: { path: string; message: string }[] } };
  };
  expect(error.data.errors).toContainEqual(
    expect.objectContaining({ path: "areas", message: REASON })
  );

  // The form says it on the Areas field, as a field's own error (the alert a
  // field draws under itself), not in a toast that only says the save
  // failed. The save state's announcement carries the reason too, but as a
  // live region rather than an alert, so finding the words anywhere on the
  // page would prove nothing.
  await expect(
    main.getByRole("alert").filter({ hasText: REASON })
  ).toBeVisible();
  await expect(
    includingHidden(page).getByText("Validation failed.", { exact: true })
  ).toHaveCount(0);

  // The author's edit is still there, and nothing was stored.
  await expect(areas.nth(1)).toHaveText(/header/i);
  const read = await api.get(
    `${API}/collections/layouts/entries/${layoutId}?status=all&depth=0`
  );
  expect(read.ok(), await read.text()).toBe(true);
  // A read by id answers with the document itself.
  const stored = (await read.json()) as { areas: { area: string }[] };
  expect(stored.areas.map(row => row.area)).toEqual(["header", "footer"]);
});
