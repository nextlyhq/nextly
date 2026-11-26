/**
 * A colour box lists the site's colour variables as it is typed in, and Enter
 * connects one, in a real browser: typed "yellow 500", saved, reloaded, and
 * still "Yellow 500" by name, stored as a reference to the variable.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  clickBlock,
  openEditorWith,
  pressSave,
  selection,
} from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

// The homepage Single is reseeded, and the site's variables are changed and
// put back.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const HOMEPAGE = "/admin/api/singles/homepage";

const YELLOWS = [
  {
    name: "color.yellow.500",
    label: "Yellow 500",
    kind: "color",
    values: { light: "#f5c518" },
  },
  {
    name: "color.yellow.300",
    label: "Yellow 300",
    kind: "color",
    values: { light: "#fde68a" },
  },
];

const TEXT = "suggest-text";
const NODES = [
  {
    id: TEXT,
    type: "core/text",
    version: 1,
    props: { text: "Words to colour" },
  },
];

async function storedTokens(api: APIRequestContext): Promise<unknown> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const raw = item.tokens ?? null;
  return typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
}

async function storeTokens(page: Page, tokens: unknown): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

/** The text block's stored colour, as the homepage holds it. */
async function storedColour(api: APIRequestContext): Promise<unknown> {
  const response = await api.get(HOMEPAGE);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const raw = item.layout;
  const layout = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
    nodes?: {
      id: string;
      styles?: { base?: { base?: { color?: unknown } } };
    }[];
  };
  return layout.nodes?.find(node => node.id === TEXT)?.styles?.base?.base
    ?.color;
}

/** The text block's Style tab, its Text section open. */
async function textStyle(page: Page) {
  await clickBlock(page, TEXT);
  await expect.poll(() => selection(page)).toEqual([TEXT]);
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  const text = inspector.getByRole("button", {
    name: /^Text(\s?has changes)?$/,
  });
  if ((await text.getAttribute("aria-expanded")) !== "true") await text.click();
  await expect(text).toHaveAttribute("aria-expanded", "true");
  return inspector;
}

test("a typed name connects the colour variable, and it is still that variable after a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const kept = await storedTokens(page.request);
  try {
    await storeTokens(page, { tokens: YELLOWS });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, TEXT);
    const inspector = await textStyle(page);

    const box = inspector.locator('[data-property="color"] input');
    await box.fill("");
    await box.pressSequentially("yellow 5");
    // Listed under the box, best first, while it is typed.
    const list = page.getByRole("listbox", {
      name: "Matching color variables",
    });
    await expect(list.getByRole("option")).toHaveText([
      "Yellow 500",
      "Yellow 300",
    ]);
    await expect(page.getByRole("combobox", { name: /Colou?r/ })).toBeVisible();
    await box.pressSequentially("00");
    await page.keyboard.press("Enter");

    // Connected: the field now names the variable rather than holding text.
    await expect(
      inspector.locator('[data-property="color"]').getByText("Yellow 500")
    ).toBeVisible();
    await pressSave(page);
    await expect
      .poll(() => storedColour(page.request))
      .toEqual({ $token: "color.yellow.500" });

    await page.reload();
    const again = await textStyle(page);
    await expect(
      again.locator('[data-property="color"]').getByText("Yellow 500")
    ).toBeVisible();
  } finally {
    await storeTokens(page, kept ?? { tokens: [] });
  }
});
