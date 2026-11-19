/**
 * Where a font is used, on the Fonts screen over the Design panel, and what
 * follows from it:
 *
 * - a font's details say it is the Body font, each a link back to its picker;
 * - Remove refuses the Body or Headings font and says to choose another first,
 *   and for a font the site's variables use, lists them with what their text
 *   falls back to before it removes anything;
 * - a font that finishes adding asks "Use <font> for: Body / Headings / Both
 *   / Not now": each answer is read off the canvas's paragraph and heading,
 *   and the toast's Undo puts the font back as it was.
 *
 * Fonts are added by upload, which needs no catalogue.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Frame, type Locator, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { CANVAS_FRAME } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

// The site's fonts and variables are changed and restored.
test.describe.configure({ lock: [LOCK.siteStyle] });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_FILE = path.join(
  HERE,
  "..",
  "fixtures",
  "fonts",
  "fixture-latin-wght-normal.woff2"
);

const SITE_STYLE = "/admin/api/singles/site-style";
const PAGES = "/admin/api/collections/pages/entries";
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

const TEXTS = {
  heading: "A heading for where fonts are used",
  text: "A paragraph for where fonts are used",
} as const;

const NODES = [
  {
    id: "wu-h2",
    type: "core/heading",
    version: 1,
    props: { text: TEXTS.heading, level: "h2" },
  },
  { id: "wu-text", type: "core/text", version: 1, props: { text: TEXTS.text } },
];

/** Lora, uploaded earlier, served from this site. */
const LORA = {
  family: "Lora",
  weight: "400",
  src: [{ url: "/fonts/e2e-lora-400.woff2", format: "woff2" }],
  source: { kind: "upload" },
};

interface Stored {
  tokens: unknown;
  fonts: unknown;
}

async function stored(page: Page): Promise<Stored> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const parse = (raw: unknown) =>
    (typeof raw === "string" ? JSON.parse(raw) : raw) ?? null;
  return { tokens: parse(item.tokens), fonts: parse(item.fonts) };
}

async function seed(page: Page, style: Stored): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens: style.tokens, fonts: style.fonts, _overwrite: true },
  });
  expect(written.ok(), `writing the site style: ${written.status()}`).toBe(
    true
  );
}

let pageId: string | undefined;

/** A page holding one heading and one paragraph, opened in the builder. */
async function openBuilder(page: Page): Promise<Frame> {
  if (pageId === undefined) {
    await gotoAdmin(page, "/");
    const created = await page.request.post(PAGES, {
      data: {
        title: `Where fonts are used ${STAMP}`,
        slug: `fonts-where-used-${STAMP}`,
        status: "published",
        content: { formatVersion: 1, kind: "page", nodes: NODES },
      },
    });
    expect(created.ok(), `seeding the page: ${await created.text()}`).toBe(
      true
    );
    pageId = ((await created.json()) as { item: { id: string } }).item.id;
  }
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect((await canvasRoot(page)).getByText(TEXTS.text)).toBeVisible({
    timeout: 30_000,
  });
  const handle = await page.locator(CANVAS_FRAME).elementHandle();
  const frame = await handle?.contentFrame();
  if (frame === null || frame === undefined) throw new Error("no canvas frame");
  return frame;
}

/** The family the canvas draws the paragraph and the heading in. */
function canvasFonts(
  frame: Frame
): Promise<{ heading: string; text: string }> {
  return frame.evaluate(texts => {
    const drawn = (text: string): string => {
      const holds = (each: Element) => (each.textContent ?? "").trim() === text;
      const element = [...document.body.querySelectorAll("*")].find(
        each => holds(each) && ![...each.children].some(holds)
      );
      return element === undefined ? "" : getComputedStyle(element).fontFamily;
    };
    return { heading: drawn(texts.heading), text: drawn(texts.text) };
  }, TEXTS);
}

/** Design → Type → "Manage fonts…", and the screen it opens. */
async function manageFonts(page: Page): Promise<Locator> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: /^Type/ }).click();
  await panel.getByRole("button", { name: "Manage fonts…" }).click();
  const fonts = panel.getByRole("region", { name: "Fonts" });
  await expect(
    fonts.getByRole("heading", { name: "On this site" })
  ).toBeVisible({ timeout: 30_000 });
  return fonts;
}

/** Upload the fixture font under `family`, leaving its editor open. */
async function uploadFont(
  page: Page,
  fonts: Locator,
  family: string
): Promise<Locator> {
  await fonts.getByRole("button", { name: "Add a font" }).click();
  await page.getByRole("menuitem", { name: "Upload a font file" }).click();
  const editor = page.getByRole("dialog", { name: "Upload a font file" });
  const chooser = page.waitForEvent("filechooser");
  await editor.getByRole("button", { name: "Choose file" }).click();
  await (await chooser).setFiles(FONT_FILE);
  await editor.getByLabel("Family").fill(family);
  await editor
    .getByRole("checkbox", {
      name: "I have the right to use this font on the web",
    })
    .check();
  await editor.getByRole("button", { name: "Upload" }).click();
  await expect(editor.getByText("No file chosen")).toBeVisible({
    timeout: 30_000,
  });
  return editor;
}

/** A family's details beside the screen. */
async function details(
  page: Page,
  fonts: Locator,
  family: string
): Promise<Locator> {
  await fonts
    .getByRole("button", { name: new RegExp(`^${family},`) })
    .click();
  const open = page.getByRole("dialog", { name: family });
  await expect(open).toBeVisible();
  return open;
}

/** Lora as the site's Body font, and a Display variable naming it first. */
function loraTokens(role: "body" | "none"): unknown {
  return {
    tokens: [
      ...(role === "body"
        ? [
            {
              name: "font.body",
              kind: "fontFamily",
              values: { light: '"Lora", serif' },
            },
          ]
        : []),
      {
        name: "font.display",
        label: "Display",
        kind: "fontFamily",
        values: { light: '"Lora", Georgia, serif' },
      },
    ],
    ...(role === "body"
      ? { siteText: { body: { fontFamily: { $token: "font.body" } } } }
      : {}),
  };
}

test("a font's details say it is the Body font, and the link goes back to its picker", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await stored(page);
  try {
    await seed(page, { tokens: loraTokens("body"), fonts: [LORA] });
    await openBuilder(page);
    const fonts = await manageFonts(page);
    const open = await details(page, fonts, "Lora");
    const used = open.getByRole("list", { name: "Where it’s used" });
    await expect(used.getByRole("button", { name: "Body font" })).toBeVisible();
    await used.getByRole("button", { name: "Body font" }).click();
    // Back on Type, with the Body font's picker focused.
    await expect(page.locator('button[data-font-role="body"]')).toBeFocused();
  } finally {
    await seed(page, before);
  }
});

test("Remove refuses the Body font, and says to choose another first", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await stored(page);
  try {
    await seed(page, { tokens: loraTokens("body"), fonts: [LORA] });
    await openBuilder(page);
    const fonts = await manageFonts(page);
    const open = await details(page, fonts, "Lora");
    await open.getByRole("button", { name: "Remove" }).click();
    const refused = open.getByRole("group", { name: "Lora can’t be removed" });
    await expect(refused).toContainText(
      "Lora is your body font. Choose another body font first."
    );
    await expect(open.getByRole("button", { name: "Remove Lora" })).toHaveCount(
      0
    );
    // Nothing was removed.
    expect(JSON.stringify((await stored(page)).fonts)).toContain("Lora");
  } finally {
    await seed(page, before);
  }
});

test("Remove lists the variables using a font and their fallback, then removes it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await stored(page);
  try {
    await seed(page, { tokens: loraTokens("none"), fonts: [LORA] });
    await openBuilder(page);
    const fonts = await manageFonts(page);
    const open = await details(page, fonts, "Lora");
    await open.getByRole("button", { name: "Remove" }).click();
    const confirm = open.getByRole("group", { name: "Remove Lora" });
    await expect(confirm).toContainText("These variables will fall back:");
    await expect(confirm.getByRole("listitem")).toHaveText([
      "Display falls back to “Georgia, serif”",
    ]);
    await confirm.getByRole("button", { name: "Remove Lora" }).click();
    await expect(
      fonts.getByRole("button", { name: /^Lora,/ })
    ).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await seed(page, before);
  }
});

for (const [answer, sets] of [
  ["Body", { text: true, heading: true }],
  ["Headings", { text: false, heading: true }],
  ["Both", { text: true, heading: true }],
  ["Not now", { text: false, heading: false }],
] as const) {
  test(`a font that finishes adding asks how to use it: ${answer}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const before = await stored(page);
    const family = `Wu ${answer.replace(" ", "")} ${STAMP}`;
    try {
      await seed(page, { tokens: before.tokens, fonts: before.fonts });
      const frame = await openBuilder(page);
      const was = await canvasFonts(frame);
      const fonts = await manageFonts(page);
      const editor = await uploadFont(page, fonts, family);
      const asked = editor.getByRole("group", { name: `Use ${family} for:` });
      await expect(asked).toBeVisible();
      await asked.getByRole("button", { name: answer, exact: true }).click();
      await expect(asked).toHaveCount(0);
      // The canvas follows: a heading with no font of its own is drawn in
      // the Body font, so Body reaches it too.
      const drawsIt = (font: string) => font.includes(family);
      await expect
        .poll(async () => drawsIt((await canvasFonts(frame)).text))
        .toBe(sets.text);
      await expect
        .poll(async () => drawsIt((await canvasFonts(frame)).heading))
        .toBe(sets.heading);
      if (answer === "Not now") return;
      const toast = page
        .locator("[data-sonner-toast]")
        .filter({ hasText: `${family} is now your` });
      await expect(toast).toBeVisible();
      await toast.getByRole("button", { name: "Undo" }).click();
      await expect.poll(async () => canvasFonts(frame)).toEqual(was);
    } finally {
      await seed(page, before);
    }
  });
}
