/**
 * The comparison page reads as tracked changes, and a keyboard alone gets
 * through it: how many fields changed, Previous and Next change landing on
 * each, the unchanged fields unfolded, and side by side chosen and kept.
 *
 * The document and its versions are written through the API, so what the test
 * watches is the comparison, not the editor's save flow. Set
 * `HISTORY_SHOTS_DIR` to keep a screenshot of each state the comparison draws,
 * at 1440 light and 390 dark; those states are served as fixed comparisons, so
 * a hidden field, a removed field and a long text read the same every run.
 */
import { expect, type Page } from "@playwright/test";

import { includingHidden, test } from "./support/test";
import { gotoAdmin } from "./support/admin";

const ENTRIES = "/admin/api/collections/history-notes/entries";

/** A note saved twice: its summary and its details' subtitle change. */
async function noteWithChanges(page: Page): Promise<string> {
  const stamp = Date.now();
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Comparison note ${stamp}`,
      summary: "as first written",
      details: { subtitle: "first subtitle", byline: "Ana" },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  const updated = await page.request.patch(`${ENTRIES}/${item.id}`, {
    data: {
      summary: "as it stands now",
      details: { subtitle: "second subtitle", byline: "Ana" },
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  return item.id;
}

/** The note's two newest version numbers, newest first. */
async function newestPair(page: Page, id: string): Promise<[number, number]> {
  const response = await page.request.get(`${ENTRIES}/${id}/versions`);
  expect(response.ok(), await response.text()).toBe(true);
  const { items } = (await response.json()) as {
    items: { versionNo: number }[];
  };
  const [to, from] = items.map(item => item.versionNo);
  expect(from, "two versions").toBeDefined();
  return [to!, from!];
}

/** What has the keyboard's focus, by its accessible name or text. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    return (
      element?.getAttribute("aria-label") ?? element?.textContent?.trim() ?? ""
    );
  });
}

/** Tab forward until the control with this name has focus. */
async function tabTo(page: Page, name: string | RegExp): Promise<void> {
  for (let presses = 0; presses < 80; presses += 1) {
    const focused = await focusedName(page);
    if (typeof name === "string" ? focused === name : name.test(focused)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${String(name)}`);
}

const focusedId = (page: Page) =>
  page.evaluate(() => document.activeElement?.id ?? "");

test.describe("comparing two versions", () => {
  test("is read and moved through by keyboard alone", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await noteWithChanges(page);
    const [to, from] = await newestPair(page, id);
    await gotoAdmin(
      page,
      `/collections/history-notes/${id}/versions?from=${from}&to=${to}`
    );
    await expect(page.getByText(/^2 of \d+ fields changed$/)).toBeVisible({
      timeout: 30_000,
    });

    // Inline: the earlier summary struck through, the later one underlined.
    await expect(
      page.locator("del", { hasText: "first written" })
    ).toBeVisible();
    await expect(page.locator("ins", { hasText: "stands now" })).toBeVisible();

    // Next change lands on the second change, Previous on the first: each is
    // brought into view and given focus.
    await tabTo(page, "Next change");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedId(page)).toBe("version-change-details");
    await tabTo(page, "Previous change");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedId(page)).toBe("version-change-summary");

    // The unchanged fields unfold on request.
    await expect(
      includingHidden(page).getByText("Title", { exact: true })
    ).toHaveCount(0);
    await tabTo(page, /^Show \d+ unchanged fields?$/);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Title", { exact: true })).toBeVisible();

    // Side by side, chosen by keyboard, is kept for the next comparison.
    await tabTo(page, "Side by side");
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Side by side" })
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Side by side" })
    ).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  });

  test("keeps a screenshot of each state it draws", async ({ page }) => {
    const dir = process.env.HISTORY_SHOTS_DIR;
    test.skip(!dir, "Set HISTORY_SHOTS_DIR to keep screenshots.");
    const id = await noteWithChanges(page);
    const [to, from] = await newestPair(page, id);
    const path = `/collections/history-notes/${id}/versions?from=${from}&to=${to}`;

    for (const [name, diff, apply] of STATES) {
      for (const [width, height, theme] of [
        [1440, 900, "light"],
        [390, 844, "dark"],
      ] as const) {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        // A fixed comparison in place of the server's, so each state reads
        // the same every run. Any failure fulfils an error rather than
        // throwing out of the handler, whose message would print the request.
        await page.route(/\/versions\/diff\?/, async route => {
          try {
            await route.fulfill({
              json: { from, to, locale: null, ...diff },
            });
          } catch {
            await route.abort().catch(() => {});
          }
        });
        await page.setViewportSize({ width, height });
        await gotoAdmin(page, path, theme);
        await expect(page.getByText(/^\d+ of .*fields.* changed$/)).toBeVisible(
          {
            timeout: 30_000,
          }
        );
        // The versions beside the comparison, loaded, so a shot never catches
        // their placeholder.
        await expect(page.getByText(/^Version \d+$/).first()).toBeVisible({
          timeout: 30_000,
        });
        await apply(page);
        await page.screenshot({
          path: `${dir}/${name}-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  });
});

/** A changed value field, before and after. */
function value(
  name: string,
  label: string,
  before: unknown,
  after: unknown,
  type = "text"
) {
  return {
    kind: "value",
    name,
    label,
    declaredLabel: label,
    path: [],
    type,
    status: before === after ? "unchanged" : "changed",
    before,
    after,
  };
}

/** A changed text field as runs. */
function text(name: string, label: string, segments: [number, string][]) {
  return {
    kind: "text",
    name,
    label,
    declaredLabel: label,
    path: [],
    type: "textarea",
    status: segments.every(([op]) => op === 0) ? "unchanged" : "changed",
    segments: segments.map(([op, text]) => ({ op, text })),
  };
}

const MANY_FIELDS = {
  hasChanges: true,
  incomplete: true,
  fields: [
    value("title", "Title", "Spring launch", "Spring launch, revised"),
    text("summary", "Summary", [
      [0, "The launch moves to "],
      [-1, "April"],
      [1, "May"],
      [0, ", with the new pricing."],
    ]),
    value("featured", "Featured", false, true, "checkbox"),
    {
      ...value("metaTitle", "Meta title", "Spring", "Spring launch"),
      path: [{ name: null, declaredLabel: "SEO", type: "collapsible" }],
    },
    {
      kind: "hidden",
      reason: "no-access",
      name: "internalNotes",
      label: "Internal notes",
      declaredLabel: "Internal notes",
      path: [],
      type: "textarea",
      status: "unchanged",
    },
    // Unchanged fields as a real document holds them: each shows its value,
    // read-only, once unfolded, and an empty one says so.
    value("slug", "Slug", "spring-launch", "spring-launch"),
    value("author", "Author", "Ana Ruiz", "Ana Ruiz"),
    value("category", "Category", "News", "News"),
    value("tags", "Tags", "launch, spring", "launch, spring"),
    value(
      "publishedOn",
      "Published on",
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T09:00:00.000Z",
      "date"
    ),
    value("region", "Region", null, null),
    {
      kind: "unknown",
      name: "legacyKeyword",
      status: "removed",
      reason: "removed",
      path: [],
    },
    {
      kind: "unknown",
      name: "firstPublishedAt",
      status: "changed",
      reason: "system",
      path: [],
    },
  ],
};

const LONG_TEXT = {
  hasChanges: true,
  fields: [
    text("body", "Body", [
      [
        0,
        "Our spring collection arrives in every store this season, with new colours across the range and a fresh look for the classics. ",
      ],
      [-1, "Prices start at $40, and every order over $100 ships free. "],
      [
        1,
        "Prices start at $45, and every order ships free within the country. ",
      ],
      [
        0,
        "We worked with growers and makers we have known for years, and each piece carries the name of the place it was made. Visit a store near you or browse the full range online, where you can reserve a size and collect it the same day. ",
      ],
      [-1, "Returns are accepted for 14 days."],
      [1, "Returns are accepted for 30 days, in store or by post."],
    ]),
  ],
};

const NO_CHANGES = {
  hasChanges: false,
  fields: [
    value("title", "Title", "Spring launch", "Spring launch"),
    value("summary", "Summary", "Same text", "Same text"),
  ],
};

const nothing = async () => {};

const STATES: [string, object, (page: Page) => Promise<void>][] = [
  ["inline", MANY_FIELDS, nothing],
  [
    "side-by-side",
    MANY_FIELDS,
    async page => {
      const toggle = page.getByRole("button", { name: "Side by side" });
      if ((await toggle.getAttribute("aria-pressed")) !== "true") {
        await toggle.click();
      }
    },
  ],
  [
    "unchanged-and-system-shown",
    MANY_FIELDS,
    async page => {
      const toggle = page.getByRole("button", { name: "Side by side" });
      if ((await toggle.getAttribute("aria-pressed")) === "true") {
        await toggle.click();
      }
      await page.getByRole("button", { name: /^Show \d+ unchanged/ }).click();
      await page.getByRole("button", { name: "Show system fields" }).click();
    },
  ],
  ["long-text", LONG_TEXT, nothing],
  ["no-changes", NO_CHANGES, nothing],
];
