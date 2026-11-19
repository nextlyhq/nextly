/**
 * The light and dark preview in the builder's top bar.
 *
 * - The ☀/☾ switch is offered once some variable has a dark value, beside
 *   the device buttons, and goes again with the last one.
 * - Pressing ☾ draws the whole canvas dark at once, the page and the header
 *   and footer of its header & footer set, and the Design panel's values,
 *   whatever the author's own device prefers; ☀ draws them light again.
 * - It is a preview only: nothing is written, the pick is kept while the
 *   author moves between pages in the session, a new session starts light,
 *   and the published page still follows the visitor's device.
 *
 * Seeded through the admin API: the site's variables (every built-in colour
 * light only, so the site starts with no dark value), a published header and
 * footer, a set holding both made the site's default, and two published
 * pages naming nothing. The site's variables and its previous default set
 * are put back afterwards.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-dark-preview.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin, toRgb } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

test.describe.configure({
  mode: "serial",
  lock: [LOCK.siteStyle, LOCK.siteDefaultLayout],
});

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const SITE_STYLE = `${API}/singles/site-style`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const SWITCH_NAME = "Preview in dark mode";
const TOOLTIP = "Preview only. Visitors see what their own device is set to.";

/** The built-in colours that carry a dark value until a site states otherwise. */
const BUILT_IN_COLOURS = [
  "color.primary",
  "color.text",
  "color.background",
  "color.surface",
  "color.border",
  "color.border-strong",
  "color.muted",
] as const;

/** Primary's two values: a button's ground is drawn in it. */
const PRIMARY = { light: "#2f6b4f", dark: "#4fa57a" } as const;
/** A spacing step with a dark value, whose row in Design says the value shown. */
const GAP = { light: "8px", dark: "12px" } as const;

const BUTTONS = {
  page: `Page button ${STAMP}`,
  header: `Header button ${STAMP}`,
  footer: `Footer button ${STAMP}`,
} as const;

interface StoredToken {
  name: string;
  kind: string;
  values: { light: string; dark?: string };
}

/** Every built-in colour light only: a site with no dark value at all. */
function lightOnlyColours(primary: StoredToken["values"]): StoredToken[] {
  return BUILT_IN_COLOURS.map(name => ({
    name,
    kind: "color",
    values: name === "color.primary" ? primary : { light: "#3b3f46" },
  }));
}

const NO_DARK: StoredToken[] = lightOnlyColours({ light: PRIMARY.light });
/** The same site with Primary and a spacing step given dark values. */
const WITH_DARK: StoredToken[] = [
  ...lightOnlyColours(PRIMARY),
  { name: "space.gap", kind: "dimension", values: GAP },
];

interface Seeded {
  first: { id: string; slug: string };
  second: { id: string; slug: string };
  previousDefault: string | null;
  tokens: unknown;
}

let seeded: Seeded | undefined;

async function idOf(
  response: {
    ok(): boolean;
    status(): number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  },
  what: string
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

function button(id: string, label: string) {
  return {
    id,
    type: "core/button",
    version: 1,
    props: { label, href: "/start" },
  };
}

async function component(
  api: APIRequestContext,
  area: "header" | "footer"
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: `dark-preview-${area}`,
        slug: `dark-preview-${area}-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [button("b", BUTTONS[area])],
        },
        status: "published",
      },
    }),
    `creating the ${area}`
  );
}

async function pageEntry(
  api: APIRequestContext,
  name: string
): Promise<{ id: string; slug: string }> {
  const slug = `dark-preview-${name}-${STAMP}`;
  const id = await idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `Dark preview ${name} ${STAMP}`,
        slug,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [button("cta", BUTTONS.page)],
        },
      },
    }),
    `creating the ${name} page`
  );
  return { id, slug };
}

/** Make a header & footer set the site's default, through the one route that may. */
async function makeDefault(page: Page, id: string): Promise<void> {
  const csrf = (await (await page.request.get(`${API}/auth/csrf`)).json()) as {
    token: string;
  };
  const made = await page.request.post(`${PLUGIN}/layouts/${id}/make-default`, {
    headers: { "x-csrf-token": csrf.token, origin: new URL(page.url()).origin },
    data: {},
  });
  expect(made.ok(), `make-default: ${made.status()} ${await made.text()}`).toBe(
    true
  );
}

async function storedTokens(api: APIRequestContext): Promise<unknown> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

/** State the site's variables, over whatever it holds. */
async function setTokens(api: APIRequestContext, tokens: unknown) {
  // Dropping a variable is refused until every page is counted.
  await countEveryPage(api);
  const stored = await api.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(
    stored.ok(),
    `writing the variables: ${stored.status()} ${await stored.text()}`
  ).toBe(true);
}

async function seed(page: Page): Promise<Seeded> {
  if (seeded !== undefined) return seeded;
  await gotoAdmin(page, "/");
  const api = page.request;
  const choices = (await (
    await api.get(`${PLUGIN}/layouts/choices`)
  ).json()) as { meta: { defaultLayout: string | null } };
  const tokens = await storedTokens(api);
  const header = await component(api, "header");
  const footer = await component(api, "footer");
  const set = await idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: `Dark preview ${STAMP}`,
        slug: `dark-preview-${STAMP}`,
        areas: [
          { area: "header", component: header },
          { area: "footer", component: footer },
        ],
        status: "published",
      },
    }),
    "creating the header & footer set"
  );
  await makeDefault(page, set);
  seeded = {
    first: await pageEntry(api, "first"),
    second: await pageEntry(api, "second"),
    previousDefault: choices.meta.defaultLayout,
    tokens,
  };
  return seeded;
}

test.afterAll(async ({ browser }) => {
  if (seeded === undefined) return;
  const page = await browser.newPage();
  try {
    await gotoAdmin(page, "/");
    await setTokens(page.request, seeded.tokens);
    if (seeded.previousDefault !== null) {
      await makeDefault(page, seeded.previousDefault);
    }
  } finally {
    await page.close();
  }
});

/** Open the builder on a page, with its header and footer drawn around it. */
async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  const root = await canvasRoot(page);
  await expect(root.locator('[data-nx-region="header"]')).toContainText(
    BUTTONS.header,
    { timeout: 30_000 }
  );
  await expect(root.locator('[data-nx-region="footer"]')).toContainText(
    BUTTONS.footer
  );
  await expect(root.getByText(BUTTONS.page)).toBeVisible();
}

function darkSwitch(page: Page): Locator {
  return page.getByRole("button", { name: SWITCH_NAME });
}

async function openDesign(page: Page): Promise<Locator> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

async function designTab(page: Page, name: string): Promise<Locator> {
  const panel = await openDesign(page);
  const tab = panel.getByRole("tab", { name: new RegExp(`^${name}`) });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return panel;
}

/**
 * The ground a button is drawn on, as an rgb() string: the element holding
 * its words, wherever on the canvas it is, the header's and footer's
 * included.
 */
async function buttonGround(page: Page, label: string): Promise<string> {
  const root = await canvasRoot(page);
  return root
    .locator("a, button")
    .filter({ hasText: label })
    .first()
    .evaluate(element => getComputedStyle(element).backgroundColor);
}

/** Each part's button ground, the page's and its header's and footer's. */
async function grounds(page: Page) {
  return {
    page: await buttonGround(page, BUTTONS.page),
    header: await buttonGround(page, BUTTONS.header),
    footer: await buttonGround(page, BUTTONS.footer),
  };
}

function everyPart(rgb: string) {
  return { page: rgb, header: rgb, footer: rgb };
}

/** The writes the editor sends while `act` runs: none for a preview. */
async function writesDuring(page: Page, act: () => Promise<void>) {
  const writes: string[] = [];
  const listen = (request: { method(): string; url(): string }) => {
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  };
  page.on("request", listen);
  try {
    await act();
    // Long enough for a held write to have been sent.
    await page.waitForTimeout(1_500);
  } finally {
    page.off("request", listen);
  }
  return writes;
}

test("is offered once the site has its first dark value, and goes with the last one", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { first } = await seed(page);
  await setTokens(page.request, { tokens: NO_DARK });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBuilder(page, first.id);
  const panel = await designTab(page, "Colours");
  const primaryRow = panel.getByRole("button", { name: /^Primary, light / });
  // CONTROL: the variables have arrived, so an absent switch is an answer.
  await expect(primaryRow).toBeVisible();
  await expect(darkSwitch(page)).toHaveCount(0);

  // The site's first dark value, given in Design.
  await primaryRow.click();
  const editor = page.getByRole("dialog", { name: "Edit Primary" });
  await editor.getByRole("button", { name: "Add dark value" }).click();
  const dark = editor.getByLabel("Dark", { exact: true });
  await dark.fill(PRIMARY.dark);
  await dark.press("Enter");
  await page.keyboard.press("Escape");

  // Beside the device buttons, in the top bar's centre.
  await expect(darkSwitch(page)).toBeVisible();
  const centre = page.locator('[data-topbar="centre"]');
  await expect(centre.getByRole("button", { name: SWITCH_NAME })).toHaveCount(
    1
  );
  await expect(darkSwitch(page)).toHaveAttribute("aria-pressed", "false");
  await darkSwitch(page).hover();
  await expect(page.getByRole("tooltip")).toHaveText(TOOLTIP);

  // Its target is at least 24 by 24 pixels, it shows focus, and it meets
  // WCAG AA in the admin's light and dark themes.
  const box = await darkSwitch(page).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  await darkSwitch(page).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(darkSwitch(page)).toBeFocused();
  expect(
    await darkSwitch(page).evaluate(
      element => getComputedStyle(element).boxShadow
    )
  ).not.toBe("none");
  await expectNoAxeViolations(page, { include: '[data-topbar="centre"]' });
  await page.evaluate(() =>
    document.querySelector(".nextly-admin")?.classList.add("dark")
  );
  try {
    await expectNoAxeViolations(page, { include: '[data-topbar="centre"]' });
  } finally {
    await page.evaluate(() =>
      document.querySelector(".nextly-admin")?.classList.remove("dark")
    );
  }

  // Previewing dark, the last dark value is removed: the switch goes and the
  // canvas is light again.
  await darkSwitch(page).click();
  const lightGround = await toRgb(page, PRIMARY.light);
  const darkGround = await toRgb(page, PRIMARY.dark);
  await expect
    .poll(() => buttonGround(page, BUTTONS.page))
    .toBe(`rgb(${darkGround.join(", ")})`);
  await primaryRow.click();
  await editor.getByRole("button", { name: "Remove dark value" }).click();
  await page.keyboard.press("Escape");
  await expect(darkSwitch(page)).toHaveCount(0);
  await expect
    .poll(() => buttonGround(page, BUTTONS.page))
    .toBe(`rgb(${lightGround.join(", ")})`);
});

for (const device of ["light", "dark"] as const) {
  test(`draws the page, its header and its footer dark at once on a ${device} device, and light again`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const { first } = await seed(page);
    await setTokens(page.request, { tokens: WITH_DARK });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: device });
    await openBuilder(page, first.id);
    const panel = await designTab(page, "Spacing");
    const gapRow = panel.getByRole("button", { name: /^Gap, / });
    const light = `rgb(${(await toRgb(page, PRIMARY.light)).join(", ")})`;
    const dark = `rgb(${(await toRgb(page, PRIMARY.dark)).join(", ")})`;

    // Light first, whatever the device prefers.
    await expect(darkSwitch(page)).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => grounds(page)).toEqual(everyPart(light));
    await expect(gapRow).toHaveAccessibleName(/^Gap, 8px/);

    // At once: the same document, never reloaded.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__notReloaded = true;
    });
    await darkSwitch(page).click();
    await expect(darkSwitch(page)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => grounds(page)).toEqual(everyPart(dark));
    await expect(gapRow).toHaveAccessibleName(/^Gap, 12px/);

    await darkSwitch(page).click();
    await expect.poll(() => grounds(page)).toEqual(everyPart(light));
    await expect(gapRow).toHaveAccessibleName(/^Gap, 8px/);
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__notReloaded
      )
    ).toBe(true);
  });
}

test("is a preview only: kept between pages, light in a new session, and the published page follows the visitor", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const { first, second } = await seed(page);
  await setTokens(page.request, { tokens: WITH_DARK });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await openBuilder(page, first.id);
  const tokensBefore = await storedTokens(page.request);
  const light = `rgb(${(await toRgb(page, PRIMARY.light)).join(", ")})`;
  const dark = `rgb(${(await toRgb(page, PRIMARY.dark)).join(", ")})`;

  // Pressing it writes nothing: not the page, not the site.
  const writes = await writesDuring(page, async () => {
    await darkSwitch(page).click();
    await expect.poll(() => grounds(page)).toEqual(everyPart(dark));
  });
  expect(writes).toEqual([]);
  expect(await storedTokens(page.request)).toEqual(tokensBefore);

  // Another page, in the same session: still dark.
  await openBuilder(page, second.id);
  await expect(darkSwitch(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => grounds(page)).toEqual(everyPart(dark));

  // A new session (a new tab): light.
  const fresh = await context.newPage();
  try {
    await fresh.setViewportSize({ width: 1440, height: 900 });
    await fresh.emulateMedia({ colorScheme: "light" });
    await openBuilder(fresh, second.id);
    await expect(darkSwitch(fresh)).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => grounds(fresh)).toEqual(everyPart(light));
  } finally {
    await fresh.close();
  }

  // The published page, on a light device, while the builder still
  // previews dark: light, and marked for no mode.
  const visitor = await context.newPage();
  try {
    await visitor.emulateMedia({ colorScheme: "light" });
    await visitor.goto(`/${first.slug}`);
    const cta = visitor.locator("a, button").filter({ hasText: BUTTONS.page });
    await expect(cta.first()).toBeVisible({ timeout: 30_000 });
    expect(
      await cta
        .first()
        .evaluate(element => getComputedStyle(element).backgroundColor)
    ).toBe(light);
    expect(await visitor.locator("[data-nx-theme]").count()).toBe(0);
    // And on a dark device, the visitor's own dark.
    await visitor.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() =>
        cta
          .first()
          .evaluate(element => getComputedStyle(element).backgroundColor)
      )
      .toBe(dark);
  } finally {
    await visitor.close();
  }
});
