/**
 * A document is translated on a page of its own: each translatable field's
 * published source beside the value being written, saved to that language
 * alone; a field with no published source written as original content; and the
 * editor's old language addresses moved on to it.
 *
 * Runs on the playground's authors, whose Biography and Role / Title are kept
 * per language and whose other fields are shared, on a site of English (the
 * default), Spanish and Arabic (written right to left).
 *
 * @module tests/translation-page
 */
import {
  expect,
  type Locator,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
// Whether a computed style draws a visible focus mark, shared with its guard
// test in scripts.
import { focusMarkShown } from "./support/focus-mark.mjs";
import { createEntry, expectOk } from "./support/runtime-collection";
import { ownSeat, test } from "./support/test";

const AUTHORS = "/admin/api/collections/authors/entries";

const ENGLISH_BIOGRAPHY = "Wrote the first published program.";
const SPANISH_BIOGRAPHY = "Escribió el primer programa publicado.";
const ARABIC_BIOGRAPHY = "كتبت أول برنامج منشور.";

/** What a field with no source says, whatever the language. */
const NO_SOURCE = /^No other language has this published and up to date/;

/** An author of its own, in English, published unless told otherwise. */
async function createAuthor(
  page: Page,
  data: Record<string, unknown>
): Promise<{ id: string; title: string }> {
  const title = `Translated author ${uniqueTag()}`;
  const id = await createEntry(page.request, "authors", {
    title,
    status: "published",
    ...data,
  });
  return { id, title };
}

/** Publishes an author's values in one language other than the default. */
async function publishIn(
  page: Page,
  id: string,
  language: string,
  data: Record<string, unknown>
): Promise<void> {
  await expectOk(
    await page.request.patch(`${AUTHORS}/${id}?locale=${language}`, {
      data: { ...data, status: "published", _overwrite: true },
    }),
    `publishing the author in ${language}`
  );
}

/** One language of an author as stored, with no other shown in its place. */
async function storedIn(
  page: Page,
  id: string,
  language: string
): Promise<Record<string, unknown>> {
  const read = await page.request.get(
    `${AUTHORS}/${id}?locale=${language}&fallback-locale=none&status=all`
  );
  await expectOk(read, `reading the author in ${language}`);
  return (await read.json()) as Record<string, unknown>;
}

/** Where one field's value came from. */
interface Origin {
  origin?: string;
  sourceLocale?: string;
}

/** Where one language's values came from, as the language overview says. */
async function originsIn(
  page: Page,
  id: string,
  language: string
): Promise<Record<string, Origin | undefined>> {
  const read = await page.request.get(
    `${AUTHORS}/${id}?locale=${language}&translation-status=1&status=all`
  );
  await expectOk(read, "reading the language overview");
  const { _translations: languages } = (await read.json()) as {
    _translations?: Record<string, { fields?: Record<string, Origin> }>;
  };
  const fields = languages?.[language]?.fields;
  if (fields === undefined) {
    throw new Error(`the overview records no origins in ${language}`);
  }
  return fields;
}

/** An author's translation page, within the admin. */
const translationPath = (id: string, query: string) =>
  `/translations/collections/authors/${id}?${query}`;

/** One field of the page: its source, and the value written from it. */
function fieldNamed(page: Page, name: string) {
  const row = page.getByRole("group", { name, exact: true });
  const source = row.locator('[data-slot="translation-source"]');
  const target = row.locator('[data-slot="translation-target"]');
  return {
    row,
    source,
    /** The source's value, marked with the language it is in. */
    sourceValue: source.locator("[lang]"),
    target,
    input: target.getByRole("textbox", { name, exact: true }),
    noSource: target.getByText(NO_SOURCE),
  };
}

/** The page's save, which names the language it saves. */
const saveButton = (page: Page) =>
  page.locator('[data-slot="translation-save"]');

/** The editor's own save. */
const editorSave = (page: Page) => page.locator('[data-primary="true"]');

/** The editor's Role / Title, in the language the editor is in. */
const editorRole = (page: Page) =>
  page
    .locator("main")
    .getByRole("textbox", { name: "Role / Title", exact: true });

/** Saves the page, and what the save sent. */
async function save(
  page: Page,
  id: string,
  language: string
): Promise<Record<string, unknown>> {
  const isSave = (request: Request) =>
    request.method() === "PATCH" &&
    new URL(request.url()).pathname === `${AUTHORS}/${id}`;
  const answered = page.waitForResponse(response => isSave(response.request()));
  await saveButton(page).click();
  const response = await answered;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(
    page.getByText(`${language} saved`, { exact: true })
  ).toBeVisible();
  return response.request().postDataJSON() as Record<string, unknown>;
}

/** How far what `element` holds runs past the width it is shown in. */
async function sidewaysOverflow(element: Locator): Promise<number> {
  return element.evaluate(node => node.scrollWidth - node.clientWidth);
}

test.describe("writing a translation", () => {
  test("Spanish is written beside its English source, and saved to Spanish alone", async ({
    page,
  }) => {
    const { id, title } = await createAuthor(page, {
      bio: ENGLISH_BIOGRAPHY,
      jobTitle: "Mathematician",
      articleCount: 7,
    });
    await gotoAdmin(page, translationPath(id, "locale=es"));

    await expect(
      page.getByRole("heading", { level: 1, name: title })
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="page-header-description"]')
    ).toHaveText("Spanish translation");

    const biography = fieldNamed(page, "Biography");
    await expect(biography.source).toContainText("English");
    await expect(biography.sourceValue).toHaveText(ENGLISH_BIOGRAPHY);
    await expect(biography.sourceValue).toHaveAttribute("lang", "en");
    await expect(biography.sourceValue).toHaveAttribute("dir", "ltr");
    await expect(biography.target).toContainText("Spanish");
    await expect(biography.input).toHaveAttribute("lang", "es");
    await expect(biography.input).toHaveAttribute("dir", "ltr");
    // Nobody wrote the Spanish, so it is empty rather than the English.
    await expect(biography.input).toHaveValue("");

    // The shared fields are named, and none of them is a control here.
    const shared = page.getByRole("region", { name: "Shared fields" });
    await expect(shared.getByText("Title", { exact: true })).toBeVisible();
    await expect(
      shared.getByText("Article Count", { exact: true })
    ).toBeVisible();
    await expect(
      shared.getByRole("link", { name: "the editor" })
    ).toHaveAttribute("href", `/admin/collections/authors/${id}`);
    const main = page.locator("main");
    await expect(
      main.getByRole("textbox", { name: "Title", exact: true })
    ).toHaveCount(0);
    await expect(main.getByRole("spinbutton")).toHaveCount(0);

    await expect(saveButton(page)).toHaveText("Save Spanish");
    await expect(saveButton(page)).toBeDisabled();
    await biography.input.fill(SPANISH_BIOGRAPHY);
    const sent = await save(page, id, "Spanish");
    expect(sent.bio).toBe(SPANISH_BIOGRAPHY);
    // Neither a field nobody changed nor one every language shares.
    expect(sent).not.toHaveProperty("jobTitle");
    expect(sent).not.toHaveProperty("articleCount");
    // Saved, so there is nothing left to save and the words stay.
    await expect(saveButton(page)).toBeDisabled();
    await expect(biography.input).toHaveValue(SPANISH_BIOGRAPHY);

    const spanish = await storedIn(page, id, "es");
    expect(spanish.bio).toBe(SPANISH_BIOGRAPHY);
    expect(spanish.jobTitle ?? null).toBeNull();
    const english = await storedIn(page, id, "en");
    expect(english.bio).toBe(ENGLISH_BIOGRAPHY);
    expect(english.jobTitle).toBe("Mathematician");
    expect(english.articleCount).toBe(7);
  });

  test("in the editor, the shared fields the page names are controls", async ({
    page,
  }) => {
    // What the lookups above find where those controls are drawn, so finding
    // none on the page says they are not on it.
    const { id, title } = await createAuthor(page, { articleCount: 7 });
    await gotoAdmin(page, `/collections/authors/${id}`);

    const main = page.locator("main");
    await expect(
      main.getByRole("textbox", { name: "Title", exact: true })
    ).toHaveValue(title);
    await expect(main.getByRole("spinbutton")).toHaveValue("7");
  });

  test("Arabic is written right to left, and its label stays in the admin's direction", async ({
    page,
  }) => {
    const { id } = await createAuthor(page, { bio: ENGLISH_BIOGRAPHY });
    await gotoAdmin(page, translationPath(id, "locale=ar"));

    const biography = fieldNamed(page, "Biography");
    await expect(biography.input).toHaveAttribute("lang", "ar");
    await expect(biography.input).toHaveAttribute("dir", "rtl");
    await expect(biography.input).toHaveCSS("direction", "rtl");
    // The control's own, so the field around it was not turned with it.
    await expect(biography.row).toHaveCSS("direction", "ltr");
    await expect(
      biography.target.locator("label").filter({ hasText: "Biography" })
    ).toHaveCSS("direction", "ltr");
    await expect(biography.sourceValue).toHaveCSS("direction", "ltr");
    await expect(saveButton(page)).toHaveText("Save Arabic");
  });

  test("a source written right to left is shown in its direction, and another can be chosen", async ({
    page,
  }) => {
    const { id } = await createAuthor(page, { bio: ENGLISH_BIOGRAPHY });
    await publishIn(page, id, "ar", { bio: ARABIC_BIOGRAPHY });
    await gotoAdmin(page, translationPath(id, "locale=es&source=ar"));

    const biography = fieldNamed(page, "Biography");
    await expect(biography.sourceValue).toHaveText(ARABIC_BIOGRAPHY);
    await expect(biography.sourceValue).toHaveAttribute("lang", "ar");
    await expect(biography.sourceValue).toHaveAttribute("dir", "rtl");

    // Two languages it could be translated from, so the field offers both.
    await page
      .getByRole("combobox", { name: "Source language for Biography" })
      .click();
    await page.getByRole("option", { name: "English" }).click();
    await expect(biography.sourceValue).toHaveText(ENGLISH_BIOGRAPHY);
    await expect(biography.sourceValue).toHaveAttribute("lang", "en");
    await expect(biography.sourceValue).toHaveAttribute("dir", "ltr");
  });

  test("with nothing published, Spanish is written first, as original content", async ({
    page,
  }) => {
    const { id } = await createAuthor(page, {
      bio: ENGLISH_BIOGRAPHY,
      status: "draft",
    });
    await gotoAdmin(page, translationPath(id, "locale=es"));

    // The English is written and not published, so it is no source.
    const biography = fieldNamed(page, "Biography");
    await expect(biography.noSource).toBeVisible();
    await expect(biography.source).toHaveCount(0);

    await biography.input.fill(SPANISH_BIOGRAPHY);
    const sent = await save(page, id, "Spanish");
    expect(sent._provenance).toEqual({ bio: { origin: "original" } });

    expect((await storedIn(page, id, "es")).bio).toBe(SPANISH_BIOGRAPHY);
    expect((await originsIn(page, id, "es")).bio?.origin).toBe("original");
  });

  test("a field the published English leaves empty is written as original content, beside one that is translated", async ({
    page,
  }) => {
    const { id } = await createAuthor(page, { bio: ENGLISH_BIOGRAPHY });
    await gotoAdmin(page, translationPath(id, "locale=es"));

    const biography = fieldNamed(page, "Biography");
    await expect(biography.sourceValue).toHaveText(ENGLISH_BIOGRAPHY);
    await expect(biography.noSource).toHaveCount(0);
    const role = fieldNamed(page, "Role / Title");
    await expect(role.noSource).toBeVisible();
    await expect(role.source).toHaveCount(0);

    await biography.input.fill(SPANISH_BIOGRAPHY);
    await role.input.fill("Matemática");
    const sent = await save(page, id, "Spanish");
    expect(sent).toMatchObject({
      bio: SPANISH_BIOGRAPHY,
      jobTitle: "Matemática",
    });
    expect(sent._provenance).toEqual({ jobTitle: { origin: "original" } });

    const origins = await originsIn(page, id, "es");
    expect(origins.jobTitle?.origin).toBe("original");
    expect(origins.bio?.sourceLocale).toBe("en");
    expect(origins.bio?.origin).not.toBe("original");
  });
});

test.describe("an address naming a language on the editor", () => {
  ownSeat(1);

  /** Addresses the editor answers itself, and how it leaves their query. */
  const STAYS = [
    { what: "the default language", query: "locale=en", left: "" },
    {
      what: "the default language, with a source",
      query: "locale=en&translate=es",
      left: "",
    },
    {
      what: "a language the site does not have",
      query: "locale=xx",
      left: "?locale=xx",
    },
  ] as const;

  for (const { what, query, left } of STAYS) {
    test(`naming ${what} stays on the editor`, async ({ page }) => {
      const { id } = await createAuthor(page, { jobTitle: "Mathematician" });
      await publishIn(page, id, "es", { jobTitle: "Matemática" });
      await gotoAdmin(page, `/collections/authors/${id}?${query}`);

      // The editor drawn, in English: everything a move waits on has arrived.
      await expect(editorSave(page)).toBeVisible();
      await expect(editorRole(page)).toHaveValue("Mathematician");
      await expect(page).toHaveURL(`/admin/collections/authors/${id}${left}`);
    });
  }

  /** Addresses of another language, and where its translation page is. */
  const MOVES = [
    {
      what: "another language, with a source of its own",
      query: "locale=es&translate=ar",
      to: "locale=es&source=ar",
    },
    {
      what: "another language, with the default one as its source",
      query: "locale=es&translate=en",
      to: "locale=es",
    },
    { what: "another language alone", query: "locale=es", to: "locale=es" },
    {
      what: "another language, with itself as its source",
      query: "locale=es&translate=es",
      to: "locale=es",
    },
  ] as const;

  for (const { what, query, to } of MOVES) {
    test(`naming ${what} opens its translation page`, async ({ page }) => {
      const { id } = await createAuthor(page, { jobTitle: "Mathematician" });
      await gotoAdmin(page, `/collections/authors/${id}?${query}`);

      await expect(page).toHaveURL(`/admin${translationPath(id, to)}`);
      await expect(saveButton(page)).toHaveText("Save Spanish");
      await expect(fieldNamed(page, "Role / Title").input).toHaveValue("");
    });
  }

  test("going back from where a link moved to leaves it, rather than moving again", async ({
    page,
  }) => {
    const { id } = await createAuthor(page, { jobTitle: "Mathematician" });
    const list = /\/admin\/collections\/authors$/;
    const entries = page.getByRole("table", { name: "Entries table" });

    await gotoAdmin(page, "/collections/authors");
    await expect(entries).toBeVisible();
    await gotoAdmin(page, `/collections/authors/${id}?locale=es`);
    await expect(page).toHaveURL(`/admin${translationPath(id, "locale=es")}`);
    await expect(saveButton(page)).toBeVisible();
    await page.goBack();
    await expect(entries).toBeVisible();
    await expect(page).toHaveURL(list);

    // The default language's address, whose keys are taken off in place.
    await gotoAdmin(page, `/collections/authors/${id}?locale=en`);
    await expect(page).toHaveURL(`/admin/collections/authors/${id}`);
    await expect(editorSave(page)).toBeVisible();
    await page.goBack();
    await expect(entries).toBeVisible();
    await expect(page).toHaveURL(list);
  });

  test("going back from a language opened in the editor returns to the editor", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { id } = await createAuthor(page, { jobTitle: "Mathematician" });
    const editor = `/collections/authors/${id}`;

    await gotoAdmin(page, editor);
    await page.getByRole("button", { name: "Open Spanish" }).click();
    await expect(page).toHaveURL(`/admin${translationPath(id, "locale=es")}`);
    await expect(saveButton(page)).toBeVisible();
    // Within the admin, so a move of its router and not a load of the page.
    await page.evaluate(() => window.history.back());
    await expect(editorRole(page)).toHaveValue("Mathematician");
    await expect(editorSave(page)).toBeVisible();
    await expect(page).toHaveURL(`/admin${editor}`);
  });
});

test.describe("using the page", () => {
  ownSeat(2);

  /** What has focus, named as a person would read it, for a failure message. */
  function focusedName(page: Page): Promise<string> {
    return page.evaluate(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) return "(body)";
      return (
        active.getAttribute("aria-label") ??
        active.textContent?.trim().slice(0, 40) ??
        active.tagName
      );
    });
  }

  /** Presses `key` until `target` has focus, or says where focus went. */
  async function pressUntilFocused(
    page: Page,
    target: Locator,
    key: string
  ): Promise<void> {
    const visited: string[] = [];
    for (let at = 0; at < 200; at += 1) {
      if (await target.evaluate(node => node === document.activeElement)) {
        return;
      }
      await page.keyboard.press(key);
      visited.push(await focusedName(page));
    }
    throw new Error(
      `${key} never reached ${String(target)}; focus went through:\n${visited.slice(-40).join("\n")}`
    );
  }

  /** `target` holds focus and draws a mark of it. Polled: a ring can ease in. */
  async function expectFocusShown(target: Locator): Promise<void> {
    await expect(target).toBeFocused();
    await expect
      .poll(
        async () =>
          focusMarkShown(
            await target.evaluate(node => {
              const style = getComputedStyle(node);
              return {
                outlineStyle: style.outlineStyle,
                outlineWidth: style.outlineWidth,
                outlineColor: style.outlineColor,
                boxShadow: style.boxShadow,
              };
            })
          ),
        { message: `${String(target)} shows no focus mark` }
      )
      .toBe(true);
  }

  /** An author whose Spanish can be written from English or Arabic. */
  async function authorWithTwoSources(page: Page): Promise<string> {
    const { id } = await createAuthor(page, {
      bio: ENGLISH_BIOGRAPHY,
      jobTitle: "Mathematician",
    });
    await publishIn(page, id, "ar", { bio: ARABIC_BIOGRAPHY });
    return id;
  }

  test("on a phone the source is above the translation, and every control is on screen", async ({
    page,
  }) => {
    const width = 390;
    await page.setViewportSize({ width, height: 844 });
    const id = await authorWithTwoSources(page);
    await gotoAdmin(page, translationPath(id, "locale=es"));

    const biography = fieldNamed(page, "Biography");
    await expect(biography.sourceValue).toHaveText(ENGLISH_BIOGRAPHY);
    const from = await biography.source.boundingBox();
    const to = await biography.target.boundingBox();
    if (from === null || to === null) throw new Error("the field is not drawn");
    expect(from.y + from.height).toBeLessThanOrEqual(to.y);

    const controls = await page
      .locator("main")
      .locator("button, a[href]")
      .filter({ visible: true })
      .evaluateAll(nodes =>
        nodes.map(node => {
          const { left, right } = node.getBoundingClientRect();
          const name = node.getAttribute("aria-label") ?? node.textContent;
          return { name: name?.trim() ?? "", left, right };
        })
      );
    // The page's own controls are among those measured, so finding none off
    // the screen says something about them.
    expect(controls.map(control => control.name)).toEqual(
      expect.arrayContaining([
        "Open in editor",
        "Save Spanish",
        "Source language for Biography",
      ])
    );
    expect(
      controls.filter(({ left, right }) => left < 0 || right > width),
      "controls past the edge of the screen"
    ).toEqual([]);

    expect(
      await sidewaysOverflow(page.locator("html")),
      "the document scrolls sideways"
    ).toBeLessThanOrEqual(0);
    expect(
      await sidewaysOverflow(page.locator("#nextly-main-content:visible")),
      "the content area scrolls sideways"
    ).toBeLessThanOrEqual(0);
  });

  for (const theme of ["light", "dark"] satisfies Theme[]) {
    test(`meets the accessibility rules in the ${theme} theme`, async ({
      page,
    }) => {
      const id = await authorWithTwoSources(page);
      await gotoAdmin(page, translationPath(id, "locale=es"), theme);
      await expect(fieldNamed(page, "Biography").sourceValue).toHaveText(
        ENGLISH_BIOGRAPHY
      );
      await expectNoAxeViolations(page);
    });
  }

  test("is written and saved by keyboard alone, showing where the focus is", async ({
    page,
  }) => {
    const { id } = await createAuthor(page, { bio: ENGLISH_BIOGRAPHY });
    await gotoAdmin(page, translationPath(id, "locale=es"));

    const { input } = fieldNamed(page, "Biography");
    await expect(input).toBeVisible();
    await pressUntilFocused(page, input, "Tab");
    await expectFocusShown(input);
    await page.keyboard.type(SPANISH_BIOGRAPHY);

    // The save is in the page's head, before the fields, and takes focus only
    // once there is something to save.
    await expect(saveButton(page)).toBeEnabled();
    await pressUntilFocused(page, saveButton(page), "Shift+Tab");
    await expectFocusShown(saveButton(page));
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Spanish saved", { exact: true })
    ).toBeVisible();
    expect((await storedIn(page, id, "es")).bio).toBe(SPANISH_BIOGRAPHY);
  });
});

test.describe("a site with one language", () => {
  ownSeat(3);

  /** Cut every `locales` list in a JSON answer down to its first language. */
  function oneLanguage(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(oneLanguage);
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).map(
        ([key, inner]) =>
          key === "locales" && Array.isArray(inner)
            ? [key, inner.slice(0, 1)]
            : [key, oneLanguage(inner)]
      );
      return Object.fromEntries(entries);
    }
    return value;
  }

  async function serveOneLanguage(route: Route): Promise<void> {
    try {
      const response = await route.fetch();
      const body = (await response.json()) as unknown;
      await route.fulfill({ response, json: oneLanguage(body) });
    } catch {
      // The page went away mid-request; nothing is left to answer.
    }
  }

  test("a translation address opens the editor, which offers no other language whatever its address names", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { id } = await createAuthor(page, { jobTitle: "Mathematician" });
    const editor = `/collections/authors/${id}`;
    const openSpanish = page.getByRole("button", { name: "Open Spanish" });

    // With the site's three languages, the editor offers the others.
    await gotoAdmin(page, editor);
    await expect(openSpanish).toBeVisible();

    // The languages arrive with the startup request and with admin-meta; both
    // are answered from here as a one-language site would answer them.
    await page.route("**/admin/api/startup?**", serveOneLanguage);
    await page.route("**/admin/api/admin-meta**", serveOneLanguage);

    await gotoAdmin(page, translationPath(id, "locale=es"));
    await expect(page).toHaveURL(`/admin${editor}`);
    await expect(editorSave(page)).toBeVisible();
    await expect(editorRole(page)).toHaveValue("Mathematician");
    await expect(openSpanish).toHaveCount(0);

    await gotoAdmin(page, `${editor}?locale=es`);
    await expect(editorSave(page)).toBeVisible();
    await expect(editorRole(page)).toHaveValue("Mathematician");
    await expect(openSpanish).toHaveCount(0);
    await expect(page).toHaveURL(`/admin${editor}?locale=es`);
  });
});
