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

/** The stored class, and the colour its rule applies. */
const CLASS_ID = "e2e-accent-class";
const CLASS_SLUG = "e2e-accent";
const CLASS_COLOR = "#0f5132";
const CLASS_COLOR_RGB = "rgb(15, 83, 50)";

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
  expect(sheet.slice(0, darkIndex)).toContain('[data-nx-theme="dark"]');
});

test("a stored class is emitted as a rule and applied to a referencing node", async ({
  page,
  request,
}) => {
  // The rule text in the served sheet names the class by its CSS name...
  const response = await request.get(`/blocks/${PAGE_SLUG}`);
  await expectOk(response, "fetching the published page");
  expect(siteSheetOf(await response.text())).toContain(
    `.nx-c-${CLASS_SLUG}{color:${CLASS_COLOR}`
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
