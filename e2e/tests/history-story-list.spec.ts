/**
 * The History panel tells what happened: what is pinned, who did what, saves
 * folded under the publish that shipped them, the language being edited, and
 * a long history read a day at a time.
 *
 * Histories are written through the API, so what the test watches is the
 * panel, not the editor's save flow. Set `HISTORY_SHOTS_DIR` to keep a
 * screenshot of each state.
 */
import { expect, type Page } from "@playwright/test";

// The suite's `test`, which renews the session, so this spec is not signed out
// once a run passes the token's lifetime.
import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";

const NOTES = "/admin/api/collections/history-notes/entries";
const AUTHORS = "/admin/api/collections/authors/entries";

/**
 * Keep pictures of a state when asked to: wide in light and on a phone in
 * dark, reopening the panel for each and applying the state's own choices.
 */
async function shots(
  page: Page,
  path: string,
  name: string,
  apply: () => Promise<void> = async () => {}
): Promise<void> {
  const dir = process.env.HISTORY_SHOTS_DIR;
  if (!dir) return;
  for (const [width, height, theme] of [
    [1440, 900, "light"],
    [390, 844, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await openHistory(page, path, theme === "dark" ? "dark" : undefined);
    await apply();
    await page.screenshot({ path: `${dir}/${name}-${width}-${theme}.png` });
  }
}

async function write(
  page: Page,
  method: "post" | "patch",
  url: string,
  data: Record<string, unknown>
): Promise<{ id: string }> {
  const response = await page.request[method](url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  const { item } = (await response.json()) as { item: { id: string } };
  return item;
}

/** A published note, saved twice since, with a draft over it. */
async function noteWithADraft(page: Page): Promise<string> {
  const { id } = await write(page, "post", NOTES, {
    title: `Story ${Date.now()}`,
    summary: "first words",
  });
  await write(page, "patch", `${NOTES}/${id}`, { summary: "second words" });
  await write(page, "patch", `${NOTES}/${id}`, {
    summary: "third words",
    status: "published",
  });
  // No status: a published note keeps its live row and holds this as a
  // draft. Naming "draft" would withdraw it instead.
  await write(page, "patch", `${NOTES}/${id}`, {
    summary: "a draft over it",
    details: { subtitle: "new subtitle" },
  });
  return id;
}

async function openHistory(page: Page, path: string, theme?: "dark") {
  await gotoAdmin(
    page,
    `${path}${path.includes("?") ? "&" : "?"}history=1`,
    theme
  );
  await expect(
    page.getByRole("list", { name: "History, newest first" })
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("the history list tells what happened", () => {
  test("one language: pinned draft and publish, saves folded under the publish", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await noteWithADraft(page);
    await openHistory(page, `/collections/history-notes/${id}`);

    await expect(
      page.getByRole("button", { name: /Current draft/ })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Currently published/ })
    ).toContainText("By ");
    await expect(
      page.getByRole("button", { name: /saves? in this publish/ })
    ).toBeVisible();

    // Named shows nothing on a history nobody named, and says so.
    await page.getByRole("button", { name: "Named" }).click();
    await expect(
      page.getByText("Nothing to show for this filter.")
    ).toBeVisible();
    const note = `/collections/history-notes/${id}`;
    await shots(page, note, "one-language");
    await shots(page, note, "empty-filter", () =>
      page.getByRole("button", { name: "Named" }).click()
    );
  });

  test("several languages: opens on the language being edited, All languages one choice away", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { id } = await write(page, "post", AUTHORS, {
      bio: "English biography",
      jobTitle: "Editor",
      status: "published",
    });
    await write(page, "patch", `${AUTHORS}/${id}?locale=es`, {
      bio: "Biografía en español",
      status: "published",
    });
    await write(page, "patch", `${AUTHORS}/${id}?locale=es`, {
      bio: "Biografía revisada",
    });
    await openHistory(page, `/collections/authors/${id}?locale=es`);

    const languages = page.getByRole("combobox", { name: "Languages shown" });
    await expect(languages).toContainText("Spanish and shared fields");

    await languages.click();
    await page.getByRole("option", { name: "All languages" }).click();
    await expect(languages).toContainText("All languages");
    const author = `/collections/authors/${id}?locale=es`;
    await shots(page, author, "several-languages");
    await shots(page, author, "all-languages", async () => {
      await page.getByRole("combobox", { name: "Languages shown" }).click();
      await page.getByRole("option", { name: "All languages" }).click();
    });
  });

  test("a long history on a phone, in dark", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { id } = await write(page, "post", NOTES, {
      title: `Long story ${Date.now()}`,
      summary: "save 0",
    });
    for (let n = 1; n <= 30; n += 1) {
      await write(page, "patch", `${NOTES}/${id}`, {
        summary: `save ${n}`,
        ...(n % 10 === 0 ? { status: "published" } : {}),
      });
    }
    await openHistory(page, `/collections/history-notes/${id}`, "dark");
    await expect(
      page.getByRole("button", { name: /saves? in this publish/ }).first()
    ).toBeVisible();
    await shots(page, `/collections/history-notes/${id}`, "long-list");
  });
});
