import { expect, type APIRequestContext } from "@playwright/test";

import {
  article,
  articlesTemplate,
  documentOf,
  entryContentBlock,
  textBlock,
} from "../support/entry-articles";
import { LOCK } from "../support/locks";
import { test } from "../support/visible";

/**
 * A template's Entry content block on a PRODUCTION build: it draws the
 * entry's own blocks field as a visitor may read it, and a blocks field the
 * public may not read never reaches the page, neither its markup nor the data
 * embedded in it nor the payload a client navigation fetches.
 *
 * The `entry-articles` fixture serves each article at `/articles/<slug>` with
 * its collection's template. Its `body` the public reads; its `membersOnly`
 * only a signed-in user does. The template's Entry content block draws one,
 * then the other, and each page is read back as an anonymous visitor and as
 * the signed-in author, since a published page reads as a visitor for
 * everyone.
 *
 * @module tests/production/entry-content
 */

// The fixture's one template is written here; see support/locks.ts.
test.describe.configure({ lock: [LOCK.entryArticlesTemplate] });

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = Date.now().toString(36);
const PUBLIC_WORDS = `Public body ${STAMP}`;
const SECRET = `Members-only secret ${STAMP}`;
const SLUG = `entry-content-${STAMP}`;
const TITLE = `Entry content article ${STAMP}`;

/** The template drawing the article's title, then its blocks field `field`. */
function design(field: string): Record<string, unknown> {
  return documentOf("template", [
    {
      id: "article-title",
      type: "core/heading",
      version: 1,
      props: { text: "Untitled", level: "h1" },
      bindings: { text: { $bind: "title", fallback: "Untitled" } },
    },
    entryContentBlock("entry-content", field),
  ]);
}

/** A path as an anonymous visitor gets it, and its client payload. */
async function served(
  request: APIRequestContext,
  path: string,
  cookie?: string
): Promise<{ status: number; html: string; payload: string }> {
  const headers = { cookie: cookie ?? "" };
  const page = await request.get(path, { headers });
  const payload = await request.get(path, {
    headers: { ...headers, RSC: "1" },
  });
  return {
    status: page.status(),
    html: await page.text(),
    payload: await payload.text(),
  };
}

test.describe("a template's Entry content on a published page", () => {
  test("draws a blocks field visitors may read, and nothing at all of one they may not", async ({
    page,
    request,
  }) => {
    // 1. Sign in through the real form; dev auto-login is blocked here.
    await page.goto("/admin");
    await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
    await page
      .getByRole("textbox", { name: /password/i })
      .fill(DEV_USER.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
    const api = page.request;
    const cookie = (await page.context().cookies())
      .map(each => `${each.name}=${each.value}`)
      .join("; ");

    // 2. A published article with words in each of its blocks fields.
    await article(api, {
      title: TITLE,
      slug: SLUG,
      body: documentOf("page", [textBlock("p", PUBLIC_WORDS)]),
      membersOnly: documentOf("page", [textBlock("s", SECRET)]),
    });

    // 3. The control: drawing `body`, the article's page shows it.
    await articlesTemplate(api, design("body"), true);
    await expect
      .poll(async () => (await served(request, `/articles/${SLUG}`)).html, {
        timeout: 60_000,
      })
      .toContain(PUBLIC_WORDS);
    const control = await served(request, `/articles/${SLUG}`);
    expect(control.status).toBe(200);
    expect(control.html).toContain(TITLE);
    expect(control.payload).toContain(PUBLIC_WORDS);
    expect(control.html).toMatch(/class="[^"]*nx-b-core--entry-content/);
    expect(control.html).not.toContain(SECRET);

    // 4. Drawing `membersOnly`, which the public may not read: the page is
    //    served, and the field is nowhere in it, for a visitor or the author.
    await articlesTemplate(api, design("membersOnly"), true);
    await expect
      .poll(async () => (await served(request, `/articles/${SLUG}`)).html, {
        timeout: 60_000,
      })
      .not.toContain(PUBLIC_WORDS);
    for (const [who, as] of [
      ["anonymous", undefined],
      ["signed in", cookie],
    ] as const) {
      const shown = await served(request, `/articles/${SLUG}`, as);
      expect(shown.status, who).toBe(200);
      // Served, drawn with the template: its title is there.
      expect(shown.html, who).toContain(TITLE);
      expect(shown.payload, `${who} payload`).toContain(TITLE);
      expect(shown.html, who).not.toContain(SECRET);
      expect(shown.payload, `${who} payload`).not.toContain(SECRET);
      // And no Entry content element: the block draws nothing at all. Asked
      // of class attributes, since the page's stylesheet may name the class.
      expect(shown.html, who).not.toMatch(
        /class="[^"]*nx-b-core--entry-content/
      );
    }
  });
});
