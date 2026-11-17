/**
 * The site's fluid range in the browser: changing it in the Type tab makes
 * every size made with "Fluid…" again across the new range, and leaves a
 * fluid value written by hand, the built-in spacing's, as it is.
 */
import { expect, type Page } from "@playwright/test";

import { openEditorWith } from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const NODES = [
  {
    id: "fluid-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the site's fluid range" },
  },
];
// 16px at 360px growing to 20px at 1280px, as "Fluid…" writes it.
const LEAD = "clamp(1rem, 0.9022rem + 0.4348vw, 1.25rem)";
// The same two sizes across 360px to 1440px.
const LEAD_WIDER = "clamp(1rem, 0.9167rem + 0.3704vw, 1.25rem)";
const STACK = "clamp(1rem, 0.875rem + 0.5vw, 1.25rem)";

interface StoredSet {
  tokens?: { name: string; values: { light: string } }[];
  fluidRange?: { min: number; max: number };
}

async function stored(page: Page): Promise<StoredSet | null> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return (item.tokens ?? null) as StoredSet | null;
}

async function seed(page: Page, tokens: unknown): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

const valueOf = (set: StoredSet | null, name: string) =>
  set?.tokens?.find(token => token.name === name)?.values.light;

test("changing the fluid range remakes a size made with Fluid…, and leaves the built-in spacing", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await stored(page);
  try {
    await seed(page, {
      tokens: [
        {
          name: "font-size.lead",
          kind: "dimension",
          values: { light: LEAD },
          fluid: { small: 16, large: 20 },
        },
        { name: "line-height.lead", kind: "number", values: { light: "1.4" } },
        // A hand-written fluid value, as the built-in spacing is.
        { name: "space.stack", kind: "dimension", values: { light: STACK } },
      ],
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "fluid-text");
    const panel = page.getByRole("region", { name: "Design panel" });
    await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
    if (!(await panel.isVisible())) {
      await page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Design", exact: true })
        .click();
    }
    await panel.getByRole("tab", { name: /^Type/ }).click();
    const range = panel.getByRole("group", { name: "Fluid range" });
    await expect(range.getByLabel("Smallest screen")).toHaveValue("360");
    const largest = range.getByLabel("Largest screen");
    await largest.fill("1440");
    await largest.press("Enter");

    await expect
      .poll(async () => (await stored(page))?.fluidRange)
      .toEqual({
        min: 360,
        max: 1440,
      });
    const after = await stored(page);
    expect(valueOf(after, "font-size.lead")).toBe(LEAD_WIDER);
    expect(valueOf(after, "space.stack")).toBe(STACK);
  } finally {
    await seed(page, before);
  }
});
