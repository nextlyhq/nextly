/**
 * Variables in the Design panel, end to end: an author creates a variable with
 * a dark value, it is in the panel after a reload, and the compiled sheet
 * applies its dark value when the device prefers dark — and only then. A role
 * that may read Design but not change it sees the variables read-only and is
 * refused their changes; and each action an author takes on a variable is
 * kept across a reload.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { openEditorWith } from "./canvas/editor-driver";
import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { CANVAS_FRAME, canvasFrame } from "./support/canvas-frame";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage, writeHeaders } from "./support/usage-count";

// The homepage Single is reseeded and the site's variables are changed and
// restored, as the other builder files do.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const LIGHT = "#1b7f5c";
const DARK = "#8fe3c0";
const PROPERTY = "--site-color-sea";
const NODES = [
  {
    id: "variables-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the site's variables" },
  },
];

/**
 * The dark block a device preference applies, guarded so the light marker can
 * still pin light. Spelled out rather than imported: the marker is published
 * contract, so a rename on the engine side must fail here.
 */
const DEVICE_DARK_OPENING =
  /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-nx-theme="light"\]\)\{[^{}]*$/;

async function storedTokens(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

function styleWrite(page: Page) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname === SITE_STYLE &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

/**
 * Show the Design panel. The editor remembers the open panel per author, and
 * the rail button toggles, so after a reload it may already be open.
 */
async function openDesign(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  // A remembered panel is restored with the editor; give it the chance.
  const restored = await panel
    .waitFor({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (restored) return;
  await page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Design", exact: true })
    .click();
  await expect(panel).toBeVisible();
}

/** Fill one field of the open editor and wait for the save it makes. */
async function commit(
  page: Page,
  field: ReturnType<Page["getByLabel"]>,
  value: string
): Promise<void> {
  const saved = styleWrite(page);
  await field.fill(value);
  await field.press("Enter");
  await saved;
}

test("a new variable with a dark value is kept, and the sheet applies it on a dark device", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const before = await storedTokens(page);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    // On the editor's blank page, which states the canvas's colour scheme from
    // the nearest theme marker below. A page the site serves states its own,
    // as it does published, so the site's canvas route is answered as missing
    // and the editor falls back to the blank page.
    await page.route("**/page-builder-canvas", async route => {
      // A thrown handler prints the request, headers and all; answer instead.
      try {
        await route.fulfill({
          status: 404,
          contentType: "text/html",
          body: "<!doctype html><html><body><main>Not found</main></body></html>",
        });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    await openEditorWith(page, NODES, "variables-text");
    await openDesign(page);

    // "+" opens the new variable's editor with focus on its name.
    const added = styleWrite(page);
    await page.getByRole("button", { name: "Add colour" }).click();
    await added;
    await expect(
      page.getByRole("dialog", { name: "Edit New colour" })
    ).toBeVisible();
    // Addressed without its name from here, since naming it renames it.
    const editor = page.getByRole("dialog");
    const name = editor.getByLabel("Name", { exact: true });
    await expect(name).toBeFocused();
    await commit(page, name, "Sea");
    await commit(page, editor.getByLabel("Light", { exact: true }), LIGHT);
    const darkAdded = styleWrite(page);
    await editor.getByRole("button", { name: "Add dark value" }).click();
    await darkAdded;
    await commit(page, editor.getByLabel("Dark", { exact: true }), DARK);
    // Closing names its code after the label it was given.
    const named = styleWrite(page);
    await page.keyboard.press("Escape");
    await named;

    const row = () =>
      page.getByRole("button", {
        name: `Sea, light ${LIGHT}, dark ${DARK}`,
      });
    await expect(row()).toBeVisible();
    expect(JSON.stringify(await storedTokens(page))).toContain('"color.sea"');

    // Kept across a reload.
    await page.reload();
    await openDesign(page);
    await expect(row()).toBeVisible();

    // By keyboard: Enter on the row opens its editor on Name, and Escape
    // closes it back onto the row.
    await row().focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Edit Sea" }).getByLabel("Name", {
        exact: true,
      })
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row()).toBeFocused();

    // The editor meets WCAG AA in the admin's light and dark themes, its
    // destructive Remove included.
    await row().click();
    await expect(page.getByRole("dialog", { name: "Edit Sea" })).toBeVisible();
    await expectNoAxeViolations(page, { include: ".nx-vars-editor" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    try {
      await expectNoAxeViolations(page, { include: ".nx-vars-editor" });
    } finally {
      await page.evaluate(() =>
        document.documentElement.classList.remove("dark")
      );
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The compiled sheet carries the dark value under the guarded device
    // block, and the browser applies it only when the device prefers dark.
    // In the canvas's own document, where the page and its sheet are drawn.
    const canvasRoot = canvasFrame(page).locator("html");
    const sheet = await canvasRoot.evaluate(root =>
      [...root.ownerDocument.querySelectorAll("style")]
        .map(style => style.textContent ?? "")
        .join("\n")
    );
    const at = sheet.indexOf(`${PROPERTY}:${DARK}`);
    expect(at).toBeGreaterThan(-1);
    expect(sheet.slice(sheet.lastIndexOf("}", at) + 1, at)).toMatch(
      DEVICE_DARK_OPENING
    );
    const resolved = () =>
      canvasRoot.evaluate(
        (root, property) =>
          getComputedStyle(root).getPropertyValue(property).trim(),
        PROPERTY
      );
    expect(await resolved()).toBe(LIGHT);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(resolved).toBe(DARK);

    // A light marker below the root pins light there, on a dark device: the
    // sheet declares the light values at the marked element itself.
    const wrapperValue = () =>
      canvasRoot.evaluate((root, property) => {
        const wrapper = root.ownerDocument.createElement("div");
        wrapper.dataset.nxTheme = "light";
        root.ownerDocument.body.append(wrapper);
        const value = getComputedStyle(wrapper)
          .getPropertyValue(property)
          .trim();
        wrapper.remove();
        return value;
      }, PROPERTY);
    expect(await wrapperValue()).toBe(LIGHT);
    expect(await resolved()).toBe(DARK);

    // The canvas's scheme follows the NEAREST marker, as its token values do,
    // through three alternations: light > dark > light above the canvas, then
    // with the nearest flipped to dark.
    const canvas = canvasFrame(page).locator(".nx-canvas");
    const canvasMode = () =>
      canvas.evaluate((element, property) => {
        const style = getComputedStyle(element);
        return {
          scheme: style.colorScheme,
          value: style.getPropertyValue(property).trim(),
        };
      }, PROPERTY);
    const markAbove = (modes: readonly string[]) =>
      canvas.evaluate((element, chain) => {
        const holders = [
          element.ownerDocument.documentElement,
          element.ownerDocument.body,
          element.parentElement,
        ];
        holders.forEach((holder, at) => {
          const mode = chain[at];
          if (holder === null) return;
          if (mode === undefined) holder.removeAttribute("data-nx-theme");
          else holder.setAttribute("data-nx-theme", mode);
        });
      }, modes);
    try {
      await markAbove(["light", "dark", "light"]);
      await expect.poll(canvasMode).toEqual({ scheme: "light", value: LIGHT });
      await markAbove(["light", "dark", "dark"]);
      await expect.poll(canvasMode).toEqual({ scheme: "dark", value: DARK });
    } finally {
      await markAbove([]);
    }
  } finally {
    // Dropping a variable is refused until every page is counted.
    await countEveryPage(page.request);
    const restored = await page.request.patch(SITE_STYLE, {
      data: { tokens: before, _overwrite: true },
    });
    expect(restored.ok(), `restoring the variables: ${restored.status()}`).toBe(
      true
    );
  }
});

/** The site's canvas route answered as missing, so the blank page is drawn. */
async function useBlankCanvasPage(page: Page): Promise<void> {
  await page.route("**/page-builder-canvas", async route => {
    // A thrown handler prints the request, headers and all; answer instead.
    try {
      await route.fulfill({
        status: 404,
        contentType: "text/html",
        body: "<!doctype html><html><body><main>Not found</main></body></html>",
      });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
}

/**
 * What the editor's own chrome is drawn in: its root's classes and theme
 * attribute, and the scheme and ground its page computes. A preview of the
 * site's mode must leave every part of it as it was.
 */
function adminChrome(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      classes: root.className,
      theme: root.getAttribute("data-theme"),
      scheme: getComputedStyle(root).colorScheme,
      ground: getComputedStyle(document.body).backgroundColor,
    };
  });
}

test("a mode picked in the Design panel draws the canvas in it, on a device that prefers the other", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const before = await storedTokens(page);
  try {
    // Dropping a variable is refused until every page is counted.
    await countEveryPage(page.request);
    const seeded = await page.request.patch(SITE_STYLE, {
      data: {
        tokens: {
          tokens: [
            {
              name: "color.sea",
              kind: "color",
              values: { light: LIGHT, dark: DARK },
            },
          ],
        },
        _overwrite: true,
      },
    });
    expect(seeded.ok(), `seeding the variables: ${seeded.status()}`).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    // On the editor's blank page, which states the canvas's scheme from the
    // nearest theme marker, as the first test here explains.
    await useBlankCanvasPage(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await openEditorWith(page, NODES, "variables-text");
    await openDesign(page);

    const canvas = canvasFrame(page).locator(".nx-canvas");
    const canvasMode = () =>
      canvas.evaluate((element, property) => {
        const style = getComputedStyle(element);
        return {
          scheme: style.colorScheme,
          value: style.getPropertyValue(property).trim(),
        };
      }, PROPERTY);
    // The iframe ELEMENT's own scheme, which the frame's
    // prefers-color-scheme follows.
    const frameScheme = () =>
      page
        .locator(CANVAS_FRAME)
        .evaluate(frame => getComputedStyle(frame).colorScheme);
    const preview = page.getByRole("group", { name: "Preview" });
    const useDevice = page.getByRole("button", { name: "Use device" });

    // Nothing picked: the device's dark, and no tag.
    await expect(preview.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect.poll(canvasMode).toEqual({ scheme: "dark", value: DARK });
    await expect(useDevice).toHaveCount(0);
    const darkChrome = await adminChrome(page);

    // Light, on a dark device.
    await preview.getByRole("button", { name: "Light" }).click();
    await expect.poll(canvasMode).toEqual({ scheme: "light", value: LIGHT });
    await expect.poll(frameScheme).toBe("light");
    await expect(page.getByText("Light preview")).toBeVisible();
    await expect(useDevice).toBeVisible();
    expect(await adminChrome(page)).toEqual(darkChrome);

    // Use device clears the pick: the canvas and the switch follow the
    // device again, and the tag goes.
    await useDevice.click();
    await expect.poll(canvasMode).toEqual({ scheme: "dark", value: DARK });
    await expect.poll(frameScheme).toBe("normal");
    await expect(useDevice).toHaveCount(0);
    await expect(preview.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Dark, on a light device.
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(canvasMode).toEqual({ scheme: "light", value: LIGHT });
    const lightChrome = await adminChrome(page);
    await preview.getByRole("button", { name: "Dark" }).click();
    await expect.poll(canvasMode).toEqual({ scheme: "dark", value: DARK });
    await expect.poll(frameScheme).toBe("dark");
    await expect(page.getByText("Dark preview")).toBeVisible();
    expect(await adminChrome(page)).toEqual(lightChrome);
  } finally {
    // Dropping a variable is refused until every page is counted.
    await countEveryPage(page.request);
    const restored = await page.request.patch(SITE_STYLE, {
      data: { tokens: before, _overwrite: true },
    });
    expect(restored.ok(), `restoring the variables: ${restored.status()}`).toBe(
      true
    );
  }
});

const PAGES = "/admin/api/collections/pages/entries";
const PLUGIN = "/admin/api/plugins/@nextlyhq/plugin-page-builder";

/**
 * One stored variable, as the site style holds it. A type alias, so it is a
 * record `toMatchObject` takes.
 */
type StoredVariable = {
  name: string;
  label?: string;
  kind: string;
  values: { light: string; dark?: string };
};

/** The variables of a stored tokens section, as text or as JSON. */
function variablesOf(section: unknown): StoredVariable[] {
  const parsed: unknown =
    typeof section === "string" ? JSON.parse(section) : section;
  if (parsed === null || typeof parsed !== "object") return [];
  const list = (parsed as { tokens?: unknown }).tokens;
  return Array.isArray(list) ? (list as StoredVariable[]) : [];
}

/** The stored variable of that name, read as the super-admin. */
async function storedVariable(
  page: Page,
  name: string
): Promise<StoredVariable | undefined> {
  return variablesOf(await storedTokens(page)).find(
    variable => variable.name === name
  );
}

/**
 * Store these variables beside the ones the site holds, as the super-admin.
 * Added rather than replacing the set, so no variable another spec left in
 * use is dropped and refused.
 */
async function seedVariables(
  page: Page,
  before: unknown,
  added: readonly StoredVariable[]
): Promise<void> {
  const parsed: unknown =
    typeof before === "string" ? JSON.parse(before) : before;
  const section =
    parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  const kept = variablesOf(before).filter(
    variable => !added.some(entry => entry.name === variable.name)
  );
  const seeded = await page.request.patch(SITE_STYLE, {
    data: {
      tokens: { ...section, tokens: [...kept, ...added] },
      _overwrite: true,
    },
  });
  expect(
    seeded.ok(),
    `seeding the variables: ${seeded.status()} ${await seeded.text()}`
  ).toBe(true);
}

/** A draft page holding these nodes, made by the super-admin; answers its id. */
async function seedPage(
  api: APIRequestContext,
  title: string,
  nodes: readonly unknown[]
): Promise<string> {
  const created = await api.post(PAGES, {
    data: {
      title,
      slug: `variables-${uniqueTag()}`,
      content: { formatVersion: 1, kind: "page", nodes },
    },
  });
  expect(
    created.ok(),
    `seeding the page: ${created.status()} ${await created.text()}`
  ).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** Open a page's builder and wait for its canvas. */
async function openPageBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Reload the open builder and show the Design panel again. */
async function reloadDesign(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  await openDesign(page);
}

/**
 * Every write this page sends to the site style or the variable routes, as
 * "METHOD path", recorded from now on. A read is not one.
 */
function watchVariableWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    const variables =
      path === SITE_STYLE || path.startsWith(`${PLUGIN}/variables/`);
    if (variables && request.method() !== "GET") {
      writes.push(`${request.method()} ${path}`);
    }
  });
  return writes;
}

/** The value a site variable's custom property resolves to on the canvas root. */
function canvasValue(page: Page, property: string): Promise<string> {
  return canvasFrame(page)
    .locator("html")
    .evaluate(
      (root, name) => getComputedStyle(root).getPropertyValue(name).trim(),
      property
    );
}

/** The "+" labels of the Variables groups, every way to add a variable. */
const ADD_LABELS = [
  "Add colour",
  "Add type size",
  "Add spacing, radius or shadow",
  "Add another variable",
];

/**
 * The design permission (`update-site-style`) withheld: Variables shows
 * read-only, and the writes it would make are refused. The author may edit
 * pages and read Design, so the editor and the Variables panel both open;
 * what is missing is the right to change the site's design.
 */
test("a role that may read Design but not change it sees the variables read-only, and is refused their changes", async ({
  browser,
  page,
}) => {
  test.setTimeout(150_000);
  const baseURL = test.info().project.use.baseURL ?? "";
  const before = await storedTokens(page);
  const harbour: StoredVariable = {
    name: "color.harbour",
    label: "Harbour",
    kind: "color",
    values: { light: "#1d4ed8", dark: "#93c5fd" },
  };
  // One limited author for this file: signing in spends the auth budget.
  const reader = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
    "read-site-style",
  ]);
  let pageId: string | undefined;
  try {
    await seedVariables(page, before, [harbour]);
    pageId = await seedPage(page.request, "Variables read-only", NODES);
    const view = await reader.context.newPage();
    await view.setViewportSize({ width: 1440, height: 900 });
    await useBlankCanvasPage(view);
    const writes = watchVariableWrites(view);
    await openPageBuilder(view, pageId);
    await openDesign(view);

    // The variables show, said to be read-only, with no way to add one.
    const row = view.getByRole("button", {
      name: `Harbour, light ${harbour.values.light}, dark ${harbour.values.dark ?? ""}`,
    });
    await expect(row).toBeVisible();
    await expect(
      view.getByText(/You can view the site.s variables but not change them\./)
    ).toBeVisible();
    // The first test here clicks "Add colour" as the super-admin, so these
    // are the panel's real labels and their absence is the read-only mode's.
    for (const label of ADD_LABELS) {
      await expect(view.getByRole("button", { name: label })).toHaveCount(0);
    }

    // The row opens read-only: named without "Edit", its fields read-only
    // but not disabled, so a value can still be selected, and no action.
    await row.click();
    const editor = view.getByRole("dialog", { name: "Harbour", exact: true });
    await expect(editor).toBeVisible();
    const name = editor.getByLabel("Name", { exact: true });
    const light = editor.getByLabel("Light", { exact: true });
    const dark = editor.getByLabel("Dark", { exact: true });
    await expect(name).toHaveValue("Harbour");
    await expect(light).toHaveValue(harbour.values.light);
    await expect(dark).toHaveValue(harbour.values.dark ?? "");
    for (const field of [name, light, dark]) {
      await expect(field).toBeEnabled();
      await expect(field).not.toBeEditable();
    }
    // No Reset, Remove, "Use light value" or colour picker: no button at all.
    await expect(editor.getByRole("button")).toHaveCount(0);
    await name.selectText();
    expect(
      await name.evaluate(field => {
        const input = field as HTMLInputElement;
        return input.value.slice(
          input.selectionStart ?? 0,
          input.selectionEnd ?? 0
        );
      })
    ).toBe("Harbour");
    // Typing and Enter change nothing and send nothing.
    await name.press("End");
    await view.keyboard.type(" changed");
    await name.press("Enter");
    await expect(name).toHaveValue("Harbour");
    await view.keyboard.press("Escape");
    await expect(view.getByRole("dialog")).toHaveCount(0);
    // The next test's writes are recorded by this same watcher, so an empty
    // list here is the panel sending none, not a watcher that sees none.
    expect(writes).toEqual([]);

    // The writes themselves are refused, and nothing is stored.
    const stored = JSON.stringify(await storedTokens(page));
    const headers = await writeHeaders(reader.context.request);
    const changed = await reader.context.request.patch(SITE_STYLE, {
      headers,
      data: {
        tokens: {
          tokens: [
            ...variablesOf(before),
            { ...harbour, values: { light: "#000000" } },
          ],
        },
        _overwrite: true,
      },
    });
    expect(changed.status(), await changed.text()).toBe(403);
    const removed = await reader.context.request.post(
      `${PLUGIN}/variables/remove`,
      { headers, data: { ids: [harbour.name] } }
    );
    expect(removed.status(), await removed.text()).toBe(403);
    expect(JSON.stringify(await storedTokens(page))).toBe(stored);
    expect(await storedVariable(page, harbour.name)).toMatchObject(harbour);
  } finally {
    await reader.context.close();
    if (pageId !== undefined) {
      const deleted = await page.request.delete(`${PAGES}/${pageId}`);
      expect(deleted.ok(), `deleting the page: ${deleted.status()}`).toBe(true);
    }
    // Dropping a variable is refused until every page is counted.
    await countEveryPage(page.request);
    const restored = await page.request.patch(SITE_STYLE, {
      data: { tokens: before, _overwrite: true },
    });
    expect(restored.ok(), `restoring the variables: ${restored.status()}`).toBe(
      true
    );
  }
});

/**
 * Each action an author takes on a variable, kept across a reload: the panel
 * reads it back from the store, and the stored set and the canvas say so too.
 * One site, seeded once, and the actions in order.
 */
test("each variable action is kept across a reload: rename, value, dark value, reset, remove, and a refused removal", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await storedTokens(page);
  const tide: StoredVariable = {
    name: "color.tide",
    label: "Tide",
    kind: "color",
    values: { light: "#0f766e", dark: "#5eead4" },
  };
  // A stored override of a variable the site's code supplies: the engine's
  // own `color.primary`, light #2563eb and dark #60a5fa, which this site's
  // config takes whole.
  const primary: StoredVariable = {
    name: "color.primary",
    kind: "color",
    values: { light: "#be123c", dark: "#60a5fa" },
  };
  const spare: StoredVariable = {
    name: "color.spare",
    label: "Spare",
    kind: "color",
    values: { light: "#a16207" },
  };
  const violet: StoredVariable = {
    name: "color.violet",
    label: "Violet",
    kind: "color",
    values: { light: "#7c3aed" },
  };
  const title = `Uses violet ${uniqueTag()}`;
  const usingViolet = (styled: boolean) => [
    {
      id: "variables-heading",
      type: "core/heading",
      version: 1,
      props: { text: "A heading in violet", level: 2 },
      ...(styled
        ? { styles: { base: { base: { color: { $token: violet.name } } } } }
        : {}),
    },
  ];
  let pageId: string | undefined;
  try {
    await seedVariables(page, before, [tide, primary, spare, violet]);
    pageId = await seedPage(page.request, title, usingViolet(true));
    await countEveryPage(page.request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await useBlankCanvasPage(page);
    const writes = watchVariableWrites(page);
    await openPageBuilder(page, pageId);
    await openDesign(page);
    const editor = page.getByRole("dialog");
    const rowNamed = (name: string) => page.getByRole("button", { name });

    // Rename: the label changes, the code name stays.
    await rowNamed("Tide, light").click();
    await expect(page.getByRole("dialog", { name: "Edit Tide" })).toBeVisible();
    await commit(page, editor.getByLabel("Name", { exact: true }), "Lagoon");
    // CONTROL for the watcher the read-only test relies on: it sees a write.
    expect(writes.length).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await reloadDesign(page);
    await expect(rowNamed("Lagoon, light #0f766e, dark #5eead4")).toBeVisible();
    await expect(rowNamed("Tide, light")).toHaveCount(0);
    expect(await storedVariable(page, tide.name)).toMatchObject({
      label: "Lagoon",
    });

    // Edit its value.
    await rowNamed("Lagoon, light").click();
    await commit(page, editor.getByLabel("Light", { exact: true }), "#0e7490");
    await page.keyboard.press("Escape");
    await reloadDesign(page);
    await expect(rowNamed("Lagoon, light #0e7490, dark #5eead4")).toBeVisible();
    expect((await storedVariable(page, tide.name))?.values.light).toBe(
      "#0e7490"
    );
    await expect
      .poll(() => canvasValue(page, "--site-color-tide"))
      .toBe("#0e7490");

    // Clear its dark value: it follows light again.
    await rowNamed("Lagoon, light").click();
    const cleared = styleWrite(page);
    await editor.getByRole("button", { name: "Use light value" }).click();
    await cleared;
    await page.keyboard.press("Escape");
    await reloadDesign(page);
    await expect(
      rowNamed("Lagoon, light #0e7490, dark same as light")
    ).toBeVisible();
    expect((await storedVariable(page, tide.name))?.values).toEqual({
      light: "#0e7490",
    });
    // On a dark device the canvas resolves it to its light value now.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() => canvasValue(page, "--site-color-tide"))
      .toBe("#0e7490");
    await page.emulateMedia({ colorScheme: "light" });

    // Reset a variable the site's code supplies to the code's value.
    await rowNamed("Primary, light #be123c").click();
    const reset = styleWrite(page);
    await editor.getByRole("button", { name: "Reset", exact: true }).click();
    await reset;
    await page.keyboard.press("Escape");
    await reloadDesign(page);
    await expect(
      rowNamed("Primary, light #2563eb, dark #60a5fa")
    ).toBeVisible();
    // Nothing of it is stored any more: the code's own value applies.
    expect(await storedVariable(page, primary.name)).toBeUndefined();
    await expect
      .poll(() => canvasValue(page, "--site-color-primary"))
      .toBe("#2563eb");
    // And it offers no Reset, having nothing left to reset.
    await rowNamed("Primary, light").click();
    await expect(
      page.getByRole("dialog", { name: "Edit Primary" })
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Reset", exact: true })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Remove a variable nothing uses: gone after the reload.
    await rowNamed("Spare, light").click();
    // Counted as unused first, so Remove's confirm is the count's answer.
    await expect(editor.getByText("Not used anywhere")).toBeVisible();
    await editor.getByRole("button", { name: "Remove", exact: true }).click();
    const removed = styleWrite(page);
    await editor
      .getByRole("group", { name: "Remove Spare" })
      .getByRole("button", { name: "Remove Spare" })
      .click();
    await removed;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await reloadDesign(page);
    await expect(rowNamed("Lagoon, light")).toBeVisible();
    await expect(rowNamed("Spare, light")).toHaveCount(0);
    expect(await storedVariable(page, spare.name)).toBeUndefined();

    // Remove one a page uses: refused in place, naming the page, and nothing
    // is written.
    await rowNamed("Violet, light").click();
    // Counted as used before Remove is pressed, so Remove answers on the
    // count rather than confirming while the count is still being read.
    await expect(editor.getByText(/^Used in /)).toBeVisible();
    const sent = writes.length;
    await editor.getByRole("button", { name: "Remove", exact: true }).click();
    const refusal = editor.getByRole("region", {
      name: "Violet can't be removed while it's in use.",
    });
    await expect(refusal).toBeVisible();
    await expect(refusal.getByText(title)).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Remove Violet" })
    ).toHaveCount(0);
    expect(writes.length).toBe(sent);
    await page.keyboard.press("Escape");
    await reloadDesign(page);
    await expect(rowNamed("Violet, light #7c3aed")).toBeVisible();
    expect(await storedVariable(page, violet.name)).toMatchObject(violet);
  } finally {
    // Off the page before it is changed, so no open editor holds it.
    await page.goto("about:blank");
    if (pageId !== undefined) {
      // The page stops using the variable first, so the restore below may
      // drop it; its save updates the usage index.
      const freed = await page.request.patch(`${PAGES}/${pageId}`, {
        data: {
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: usingViolet(false),
          },
          _overwrite: true,
        },
      });
      expect(freed.ok(), `freeing the page: ${freed.status()}`).toBe(true);
    }
    // Dropping a variable is refused until every page is counted.
    await countEveryPage(page.request);
    const restored = await page.request.patch(SITE_STYLE, {
      data: { tokens: before, _overwrite: true },
    });
    expect(restored.ok(), `restoring the variables: ${restored.status()}`).toBe(
      true
    );
    if (pageId !== undefined) {
      const deleted = await page.request.delete(`${PAGES}/${pageId}`);
      expect(deleted.ok(), `deleting the page: ${deleted.status()}`).toBe(true);
    }
  }
});

/**
 * The marker blocks a scoped sheet writes, as `emitTokenBlocks` writes them for
 * the scope `.scope` (pinned there by a unit test). Spelled out because the
 * marker is published contract.
 */
const SCOPED_DARK =
  ':is(.scope)[data-nx-theme="dark"],[data-nx-theme="dark"] :is(.scope):not([data-nx-theme="light"],[data-nx-theme="dark"] [data-nx-theme="light"] *)';
const SCOPED_LIGHT =
  ':is(.scope)[data-nx-theme="light"],[data-nx-theme="light"] :is(.scope):not([data-nx-theme="dark"],[data-nx-theme="light"] [data-nx-theme="dark"] *)';

test("the nearest marker decides which mode a scoped sheet applies", async ({
  page,
}) => {
  // Each probe holds text, so it is a visible element the suite's locators
  // can find.
  await page.setContent(`
    <div data-nx-theme="light"><div data-nx-theme="dark"><div data-testid="dark-nearer" class="scope">probe</div></div></div>
    <div data-nx-theme="dark"><div data-nx-theme="light"><div data-testid="light-nearer" class="scope">probe</div></div></div>
    <div data-nx-theme="light"><div data-testid="self-dark" class="scope" data-nx-theme="dark">probe</div></div>
  `);
  // Each probe found by its test id, and asked which sheet's selector it
  // matches. Each holds a word, so it has a box: the suite finds by test id
  // only what is visible.
  const modeOf = (id: string) =>
    page.getByTestId(id).evaluate(
      (element, [dark, light]) => ({
        dark: element.matches(dark ?? ""),
        light: element.matches(light ?? ""),
      }),
      [SCOPED_DARK, SCOPED_LIGHT]
    );
  expect(await modeOf("dark-nearer")).toEqual({ dark: true, light: false });
  expect(await modeOf("light-nearer")).toEqual({ dark: false, light: true });
  expect(await modeOf("self-dark")).toEqual({ dark: true, light: false });
});
