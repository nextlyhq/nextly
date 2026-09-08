/**
 * Site style storage, proven on served pages rather than on internals.
 *
 * The Site Style single is the stored tier of the page builder's layered
 * style model: config defaults under it, the engine's guaranteed tokens under
 * both. Everything below writes through the ordinary single write path and
 * then reads what a visitor's browser would receive, because the property
 * under test is the whole road — stored JSON to compiled site sheet to
 * response body — and any shorter assertion passes on a broken join.
 *
 * Three properties, in the order they can fail:
 *
 * 1. A stored token reaches a published page's site sheet, in BOTH modes.
 *    The token's name exists nowhere else — not in the engine defaults, not
 *    in this app's config — so its custom property appearing in the response
 *    can only mean the stored document was read and layered in.
 * 2. A stored named class reaches the same sheet as a `.nx-c-<slug>` rule,
 *    and a node referencing it by ID actually renders with the class's
 *    computed style — the served-output proof that the sheet is not merely
 *    printed but applied.
 * 3. Writes fail closed: a token value that would fetch is refused by the
 *    single's validator, and the page keeps serving the last good value.
 *
 * Safe to write against: the suite owns its database and empties it before
 * every run.
 */
import { expect, test, type APIResponse } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

test.describe.configure({ mode: "serial" });

const SITE_STYLE = "/admin/api/singles/site-style";
const ENTRIES = "/admin/api/collections/block-pages/entries";

const PAGE_SLUG = "site-style-dogfood";
const PAGE_HEADING = "Styled by the site style single";

/**
 * A token name no other tier defines. `color.primary` would also prove the
 * override wins, but a page would still render ITS property from the engine
 * default and the assertion would have to parse which value won; a name only
 * the stored document knows separates "storage reached the sheet" from
 * everything else with a plain substring.
 */
const TOKEN_NAME = "color.e2e-accent";
const TOKEN_PROPERTY = "--site-color-e2e-accent";
const TOKEN_LIGHT = "#1b7f5c";
const TOKEN_DARK = "#8fe3c0";

/**
 * The dark block this app must emit, and the only one that can work here.
 *
 * The engine supports two `darkMode` strategies. `attribute` writes
 * `[data-nx-theme="dark"]`, which a host activates by setting that attribute;
 * `media` writes an at-rule the operating system activates. **This app has no
 * theme toggle and sets `data-nx-theme` nowhere**, so the attribute form would
 * emit dark values that can never apply — which is not hypothetical: the
 * docblock on `SITE_STYLE_RESOLVED` in `apps/playground/src/lib/site-content.ts`
 * records routes that omitted the token set, fell back to the attribute
 * default, and silently served dark values no visitor could ever see.
 *
 * So accepting either form here would leave the suite green across exactly
 * that regression. The configured strategy decides which form is correct, and
 * for this app it is settled: `media`.
 *
 * Spelled out rather than imported from the engine, deliberately. This string
 * is published contract — a host wires its own toggle to `data-nx-theme` in
 * markup this repository never sees — so importing the engine's constant would
 * make the expectation follow a rename and keep passing. Expectation and
 * output would be two derivations of one source, which cannot detect that
 * source changing.
 *
 * Requires the at-rule to be followed IMMEDIATELY by `{`, because the guard
 * has to OPEN the block rather than merely appear before it: `@media (...);`
 * followed by a bare rule contains the same text while the browser discards
 * the empty at-rule and applies the dark value unconditionally. The two
 * `[^{}]*` runs are the selector and whatever declarations precede this one in
 * the same block — the site's own dark tokens are emitted there too — neither
 * of which can contain a brace.
 */
const DARK_BLOCK_OPENING =
  /@media \(prefers-color-scheme:dark\)\{[^{}]*\{[^{}]*$/;

/**
 * The stored font face, and the family its `@font-face` declares.
 *
 * A family no other tier names, for the reason the token above is named that
 * way: a family the engine or this app's config already ships would appear in
 * the sheet whether or not the stored document was read.
 *
 * The file need not exist. The claim is that a stored face reaches the served
 * sheet as a rule a browser would act on — whether the browser then finds the
 * file is the host's business, and asserting on a real download would make
 * this a test of static serving instead.
 */
const FONT_FAMILY = "E2E Sans";
const FONT_URL = "/fonts/e2e-sans.woff2";

/** The stored class, and the colour its rule applies. */
const CLASS_ID = "e2e-accent-class";
const CLASS_SLUG = "e2e-accent";
const CLASS_COLOR = "#0f5132";
const CLASS_COLOR_RGB = "rgb(15, 81, 50)";

/** A node id, stable per fixture so a failure names the same node every run. */
const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;

/**
 * The page document: one heading carrying the stored class BY ID, which is
 * how documents reference the class library. Its computed colour is what
 * proves the served sheet was applied rather than merely emitted.
 */
const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: id("01"),
      type: "core/heading",
      version: 1,
      props: { text: PAGE_HEADING, level: "h1" },
      classes: [CLASS_ID],
    },
  ],
};

/** The stored tier this suite writes: one token with both modes, one class. */
const STORED_STYLE = {
  tokens: {
    tokens: [
      {
        name: TOKEN_NAME,
        kind: "color",
        values: { light: TOKEN_LIGHT, dark: TOKEN_DARK },
      },
    ],
  },
  classes: [
    {
      id: CLASS_ID,
      slug: CLASS_SLUG,
      orderIndex: 0,
      styles: { base: { base: { color: CLASS_COLOR } } },
    },
  ],
  fonts: [
    {
      family: FONT_FAMILY,
      src: [{ url: FONT_URL, format: "woff2" }],
    },
  ],
};

/** Fail with the server's message rather than with a bare status code. */
async function expectOk(response: APIResponse, what: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${await response.text()}`
    );
  }
}

/** The site sheet's CSS text, cut out of a served page's raw HTML. */
function siteSheetOf(html: string): string {
  // The renderer stamps the shared sheet with its content hash; matching the
  // attribute rather than "a <style> element" keeps the assertion off the
  // page's OWN sheet, which is a different artifact with different inputs.
  const match = /<style data-nx-site-sheet="[^"]*">([\s\S]*?)<\/style>/.exec(
    html
  );
  if (!match?.[1]) {
    throw new Error("The response carries no site sheet <style> element.");
  }
  return match[1];
}

/**
 * The prelude opening the block that the declaration at `index` sits in:
 * every selector and at-rule since the previous block closed.
 *
 * Scoping matters because the alternative is to search the whole sheet before
 * the declaration, and a guard found there need not be the one enclosing it —
 * any earlier token's dark block satisfies that search while this token's
 * value sits unguarded in the light block. Declarations within a block are
 * separated by `;` and every block ends with `}`, so the text since the last
 * `}` is exactly what opened the block this declaration is in.
 *
 * The scoping is TEXTUAL rather than a parse, which is sound for what this
 * emitter writes and has two known limits, both of which fail in the safe
 * direction — a spurious failure, never a defect hidden. A second rule inside
 * one at-rule block would put a `}` between the at-rule and the declaration
 * and lose the guard; the emitter writes one selector per media block, so this
 * is latent rather than live. A `}` inside a quoted value earlier in the same
 * block would truncate the prelude the same way.
 */
function enclosingPreludeOf(sheet: string, index: number): string {
  return sheet.slice(sheet.lastIndexOf("}", index) + 1, index);
}

/**
 * Seeds the stored style and the fixture page, in a hook rather than a test
 * so no `--grep` can deselect it out from under the assertions.
 */
test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");

  // Its own context: `request` is test-scoped and cannot be taken by a
  // `beforeAll`. The signed-in state is the same one every test runs with.
  const api = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });

  try {
    // PATCH is idempotent, so a retried run re-writes the same document and
    // needs no duplicate handling.
    await expectOk(
      await api.patch(SITE_STYLE, { data: STORED_STYLE }),
      "storing the site style"
    );

    const created = await api.post(ENTRIES, {
      data: {
        title: "Site style dogfood",
        slug: PAGE_SLUG,
        content: DOCUMENT,
        status: "published",
      },
    });
    // 409 IS the success case on a retry: the unique index on `slug` is what
    // reports "this run already seeded me" — see blocks-page.spec.ts.
    if (created.status() !== 409) {
      await expectOk(created, `seeding ${PAGE_SLUG}`);
    }
  } finally {
    await api.dispose();
  }
});

test("a stored token reaches the published page's site sheet, both modes", async ({
  request,
}) => {
  // Raw HTML rather than the DOM: the claim is about what the server SENDS.
  const response = await request.get(`/blocks/${PAGE_SLUG}`);
  await expectOk(response, "fetching the published page");
  const sheet = siteSheetOf(await response.text());

  // The light value on the root block, verbatim.
  expect(sheet).toContain(`${TOKEN_PROPERTY}:${TOKEN_LIGHT}`);
  // The dark value under the mode selector, which is what "modes are in the
  // stored schema from day one" buys: nothing but the stored document could
  // have put a dark block for this property into the sheet.
  const darkIndex = sheet.indexOf(`${TOKEN_PROPERTY}:${TOKEN_DARK}`);
  expect(darkIndex).toBeGreaterThan(-1);
  // The block the declaration actually sits in has to BE the media block. A
  // search of everything before it would accept a guard belonging to some
  // other token while this value sat unguarded in the light block, and
  // accepting the attribute form would accept dark values this app can never
  // activate.
  expect(enclosingPreludeOf(sheet, darkIndex)).toMatch(DARK_BLOCK_OPENING);
});

test("the browser resolves the stored token to each mode's value", async ({
  page,
}) => {
  // The sheet being correct and the sheet APPLYING are different claims, and
  // the assertion above can only reach the first. The failure this app has
  // already had produced a sheet that read correctly — dark values were
  // present and syntactically fine — under a selector nothing in the app ever
  // sets, so no visitor saw them and no text assertion could tell. Asking the
  // browser under each colour scheme is what separates emitted from applied.
  //
  // Read off the heading rather than the root: custom properties inherit, so
  // this resolves whether the emitter declared them on `:root` or on a scoped
  // wrapper, and does not encode which one it chose.
  const resolved = async (): Promise<string> =>
    (
      await page
        .getByRole("heading", { name: PAGE_HEADING })
        .evaluate(
          (element, property) =>
            getComputedStyle(element).getPropertyValue(property),
          TOKEN_PROPERTY
        )
    ).trim();

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/blocks/${PAGE_SLUG}`);
  expect(await resolved()).toBe(TOKEN_LIGHT);

  // No reload: a media query re-evaluates when the scheme changes, so this
  // also proves the dark value is behind the query rather than merely present.
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await resolved()).toBe(TOKEN_DARK);
});

test("a stored font face reaches the published page as a rule a browser would act on", async ({
  request,
}) => {
  // The third authorable tier, and the one neither assertion above reaches. A
  // token becomes a custom property and a class becomes a selector; a font
  // becomes an AT-RULE, which is emitted by different code down a different
  // path, so a break between stored font data and the served sheet shows up
  // here or nowhere.
  const response = await request.get(`/blocks/${PAGE_SLUG}`);
  await expectOk(response, "fetching the published page");
  const sheet = siteSheetOf(await response.text());

  // The family, quoted as the emitter writes it. A face that failed validation
  // contributes NOTHING rather than half a rule, so the family appearing at all
  // means the stored face was read, validated and emitted whole.
  expect(sheet).toContain(`@font-face`);
  expect(sheet).toContain(`font-family:"${FONT_FAMILY}"`);

  // The source, with its format. Asserting the url alone would pass on a rule
  // that named the file and told the browser nothing about how to parse it.
  expect(sheet).toContain(`url("${FONT_URL}") format("woff2")`);

  // `swap` is the emitter's default and the reason it has one: text stays
  // readable while the file loads. Its absence would be a face that renders
  // invisible text on a slow connection, which is a real regression and not a
  // formatting difference.
  expect(sheet).toContain("font-display:swap");
});

test("a stored class is emitted as a rule and applied to a referencing node", async ({
  page,
  request,
}) => {
  // The rule text in the served sheet names the class by its CSS name. A
  // regex rather than a substring, because the emitter scopes the selector
  // under the page root and formats its declarations with spaces — the claim
  // is "a rule for this class applies this colour", not a byte layout.
  const response = await request.get(`/blocks/${PAGE_SLUG}`);
  await expectOk(response, "fetching the published page");
  expect(siteSheetOf(await response.text())).toMatch(
    new RegExp(`\\.nx-c-${CLASS_SLUG}\\s*\\{\\s*color:\\s*${CLASS_COLOR}`)
  );

  // ...and the COMPUTED colour proves the browser resolved a node's class
  // reference through that rule — the difference between a sheet that was
  // served and one that also governs the page.
  await page.goto(`/blocks/${PAGE_SLUG}`);
  await expect(page.getByRole("heading", { name: PAGE_HEADING })).toHaveCSS(
    "color",
    CLASS_COLOR_RGB
  );
});

test("a token value that would fetch is refused, and the page keeps the last good style", async ({
  request,
}) => {
  // `url(...)` in a token is the one thing the engine refuses as an ERROR:
  // the eventual stylesheet contains only a var() substitution, so no origin
  // policy downstream would ever see the URL. The write path must be where it
  // stops.
  const refused = await request.patch(SITE_STYLE, {
    data: {
      tokens: {
        tokens: [
          {
            name: TOKEN_NAME,
            kind: "color",
            values: { light: "url(https://evil.example/pixel.png)" },
          },
        ],
      },
    },
  });
  expect(refused.ok()).toBe(false);

  // Fail-closed means failed: the stored document is unchanged, so the page
  // still serves the value the suite wrote first. Asserted rather than
  // assumed, because a validator that reported an error AFTER persisting
  // would pass the status check above and still poison every page.
  const response = await request.get(`/blocks/${PAGE_SLUG}`);
  await expectOk(response, "fetching the published page after the refusal");
  expect(siteSheetOf(await response.text())).toContain(
    `${TOKEN_PROPERTY}:${TOKEN_LIGHT}`
  );
});
