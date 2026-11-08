import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import {
  buildMetadata,
  type MetadataEntry,
} from "../../../packages/nextly/src/runtime/seo/build-metadata";
import { extractToc } from "../../../templates/blog/src/lib/extract-toc";
import { formatPublishedDate } from "../../../templates/blog/src/lib/format-date";
import { expectNoAxeViolations } from "../support/axe";
import {
  ACTIONS,
  AVATAR_FALLBACK,
  blogPostTemplate,
  created,
  DESIGNS,
  entriesOf,
  FULL_POST,
  JOURNAL,
  JOURNAL_ADDRESS,
  pluginHeaders,
  publishJournalTemplate,
  seedJournal,
  slugOf,
  TEMPLATES,
  type SeededJournal,
} from "../support/blog-post-template";
import { test } from "../support/visible";

/**
 * The blog template's post page, rebuilt with a collection template and
 * bindings, compared part by part with the hand-written page, from a
 * PRODUCTION build.
 *
 * The blog fixture is the blog template's own posts, authors, categories and
 * tags, registered under `journal-` and served at `/journal/<slug>` with the
 * template in `../support/blog-post-template`. Two posts are written through
 * the API the editor writes with and read back as an anonymous visitor: one
 * with every optional part (headings at two levels, a featured image,
 * categories, tags and its own blocks below the article) and one with none
 * of them.
 *
 * Each part is compared with what the hand-written page
 * (`templates/blog/src/app/(frontend)/blog/[slug]/page.tsx`) draws for the
 * same post, through that page's own functions rather than a restatement of
 * them: `formatPublishedDate` for the date, `extractToc` for the heading ids
 * and the contents, `buildMetadata` for the metadata, and the `/authors/`,
 * `/categories/` and `/tags/` addresses its links name. The reading time is
 * the one the template's own hook stored.
 *
 * Intentional differences, each asserted so the test fails if it changes:
 * - the excerpt is drawn under the title (the hand-written page uses it only
 *   as the meta description);
 * - an author without an avatar is drawn with the fallback picture, where
 *   the hand-written page draws the name's first letter;
 * - the canonical address is the fixture's `/journal/<slug>`, where the
 *   hand-written page names its `/blog/<slug>`;
 * - the date is formatted in the site's time zone, where the hand-written
 *   page uses the server's (the same here, both UTC), and its `datetime` is
 *   that day, where the hand-written page writes the stored instant;
 * - the author's name is not yet a link (the test that would check it is
 *   `fixme`, and says why).
 *
 * Not compared, because the rebuilt page does not draw them: the reading
 * progress bar, the share bar, the author card's biography, the previous and
 * next links, the related posts, the Article and BreadcrumbList JSON-LD and
 * the OpenGraph article fields.
 *
 * @module tests/production/blog-post-template
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = Date.now().toString(36);

/** The hand-written page's date: `formatPublishedDate` as it calls it. */
const HAND_WRITTEN_DATE: Intl.DateTimeFormatOptions = {
  month: "long",
  day: "numeric",
  year: "numeric",
  // The site's zone, which the rebuilt page formats in. The hand-written
  // page leaves it to the server, which is UTC on every machine this runs.
  timeZone: "UTC",
};

/** Sign in through the real form; dev auto-login is blocked here. */
async function signIn(page: Page): Promise<APIRequestContext> {
  await page.goto("/admin");
  await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
  await page
    .getByRole("textbox", { name: /password/i })
    .fill(DEV_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
  return page.request;
}

/** A post as the hand-written page reads it: its relations populated. */
async function stored(
  api: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  const response = await api.get(`${entriesOf(JOURNAL.posts)}/${id}?depth=2`);
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as Record<string, unknown> & {
    item?: Record<string, unknown>;
  };
  return body.item ?? body;
}

/** A record's field as a record, failing when it is not one. */
function recordAt(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const field = value[key];
  if (typeof field !== "object" || field === null) {
    throw new Error(`[e2e] the post's ${key} was read as ${String(field)}`);
  }
  return field as Record<string, unknown>;
}

/** The path an address names, on this site or another. */
const pathOf = (address: string | null | undefined, base: string) =>
  address === null || address === undefined
    ? address
    : new URL(address, base).pathname;

/** Open `path` as an anonymous visitor, once it is served with the template. */
async function visit(
  browser: Browser,
  path: string,
  marker: string
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await expect
    .poll(
      async () => {
        const response = await page.goto(path);
        return (
          response?.status() === 200 && (await page.content()).includes(marker)
        );
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] }
    )
    .toBe(true);
  return { page, close: () => context.close() };
}

let seeded: SeededJournal;
let templateId: string;

// Every test reads what the first wrote, in order.
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 30_000 });

test.describe("the blog post page, rebuilt with a template", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const api = await signIn(page);
    seeded = await seedJournal(api, STAMP);
    templateId = await publishJournalTemplate(page, blogPostTemplate());
    await context.close();
  });

  test.describe("a post with every optional part", () => {
    let page: Page;
    let close: (() => Promise<void>) | undefined;
    let post: Record<string, unknown>;
    const path = () => `${JOURNAL_ADDRESS}/${seeded.full.slug}`;

    test.beforeAll(async ({ browser }) => {
      const signedIn = await browser.newContext();
      const admin = await signedIn.newPage();
      post = await stored(await signIn(admin), seeded.full.id);
      await signedIn.close();
      ({ page, close } = await visit(browser, path(), FULL_POST.title));
    });
    test.afterAll(async () => {
      // Unset when the page was never served, which the failure says.
      await close?.();
    });

    test("draws the title as the page's one H1", async () => {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        String(post.title)
      );
      await expect(page.locator("h1")).toHaveCount(1);
    });

    test("draws the publication date in the hand-written page's words, with its machine value in datetime", async () => {
      const time = page.locator("time").first();
      // The day in the site's zone, a valid machine date. An intentional
      // difference: the hand-written page writes the stored instant whole.
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: HAND_WRITTEN_DATE.timeZone,
      }).format(new Date(String(post.publishedAt)));
      await expect(time).toHaveAttribute("datetime", day);
      const words = formatPublishedDate(
        String(post.publishedAt),
        HAND_WRITTEN_DATE
      );
      expect(words).not.toBeNull();
      expect((await time.textContent())?.trim()).toBe(words);
      // Set in capitals, as the hand-written page's meta row is.
      await expect(time).toHaveCSS("text-transform", "uppercase");
    });

    test("draws the reading time as `N MIN READ`", async () => {
      expect(typeof post.readingTime).toBe("number");
      const unit = page.getByText("MIN READ", { exact: true });
      const minutes = unit.locator("xpath=preceding-sibling::*[1]");
      expect(
        `${(await minutes.textContent())?.trim()} ${(await unit.textContent())?.trim()}`
      ).toBe(`${String(post.readingTime)} MIN READ`);
    });

    test("draws the excerpt, which is also the page's meta description", async () => {
      // An intentional difference: the hand-written page does not draw it.
      await expect(
        page.getByText(String(post.excerpt), { exact: true })
      ).toBeVisible();
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        String(post.excerpt)
      );
    });

    test("draws the body with every heading carrying the id the hand-written page gives it", async () => {
      const headings = page.locator("article").locator("h2, h3");
      const drawn = await headings.evaluateAll(each =>
        each.map(heading => ({
          level: heading.tagName === "H2" ? 2 : 3,
          id: heading.id,
          text: heading.textContent?.trim() ?? "",
        }))
      );
      // The hand-written page's ids, from the same headings with none.
      const bare = drawn
        .map(
          ({ level, text }) => `<h${String(level)}>${text}</h${String(level)}>`
        )
        .join("");
      expect(drawn).toEqual(extractToc(bare).toc);
      expect(drawn.map(each => each.level)).toEqual([2, 3, 3, 2]);
    });

    test("lists the body's H2 and H3 headings in the table of contents, each link reaching its heading", async () => {
      const contents = page.getByRole("navigation", { name: "On this page" });
      const links = await contents.getByRole("link").evaluateAll(each =>
        each.map(link => ({
          href: link.getAttribute("href"),
          text: link.textContent?.trim() ?? "",
        }))
      );
      const bare = await page
        .locator("article")
        .locator("h2, h3")
        .evaluateAll(each =>
          each
            .map(h => {
              const tag = h.tagName.toLowerCase();
              return `<${tag}>${h.textContent?.trim() ?? ""}</${tag}>`;
            })
            .join("")
        );
      // The hand-written page's contents, from the same headings.
      const toc = extractToc(bare).toc;
      expect(links).toEqual(
        toc.map(({ id, text }) => ({ href: `#${id}`, text }))
      );
      // An H3 sits in the list of the H2 before it.
      await expect(contents.locator("li li a")).toHaveCount(
        toc.filter(each => each.level === 3).length
      );
      for (const { id, text } of toc) {
        await expect(page.locator(`[id="${id}"]`)).toHaveText(text);
      }
    });

    test("draws the featured image from the post's media, with its alternative text", async () => {
      const media = recordAt(post, "featuredImage");
      // The hand-written page's alt: the media's own, else the title.
      const alt = String(media.altText || post.title);
      const image = page.getByRole("img", { name: alt, exact: true });
      await expect(image).toBeVisible();
      expect(pathOf(await image.getAttribute("src"), page.url())).toBe(
        pathOf(String(media.url), page.url())
      );
    });

    test("draws the author's name and their avatar from the media library", async () => {
      const byline = recordAt(post, "byline");
      const name = page.getByText(String(byline.name), { exact: true });
      await expect(name).toBeVisible();
      const avatar = name.locator("xpath=..").locator("img");
      expect(pathOf(await avatar.getAttribute("src"), page.url())).toBe(
        pathOf(String(recordAt(byline, "avatar").url), page.url())
      );
    });

    // The hand-written page links the name to `/authors/<slug>`. A binding
    // cannot yet follow the one-to-one byline to the author's entry, so no
    // link block can name it; a list can, which is how the categories and
    // tags link.
    test.fixme(
      "links the author's name to their page, as the hand-written page does",
      () => {}
    );

    test("lists the categories and tags in the post's order, each linked to its page", async () => {
      for (const [field, route] of [
        ["categories", "/categories/"],
        ["tags", "/tags/"],
      ] as const) {
        const expected = (post[field] as Record<string, unknown>[]).map(
          each => ({
            href: `${route}${String(each.slug)}`,
            text: String(each.name),
          })
        );
        const drawn = await page
          .locator(`a[href^="${route}"]`)
          .evaluateAll(each =>
            each.map(link => ({
              href: link.getAttribute("href"),
              text: link.textContent?.trim() ?? "",
            }))
          );
        expect(drawn, field).toEqual(expected);
      }
      await expect(
        page.getByText("Topic focus", { exact: true })
      ).toBeVisible();
    });

    test("carries the hand-written page's title, description, canonical address, image and robots metadata", async () => {
      const media = recordAt(post, "featuredImage");
      const seo = (post.seo ?? {}) as Record<string, unknown>;
      // As the hand-written page calls it, at the fixture's address.
      const expected = buildMetadata(
        { seo: (post.seo ?? null) as MetadataEntry["seo"] },
        {
          fallback: {
            title: String(post.title),
            description: String(post.excerpt),
            image: String(
              (seo.ogImage as { url?: string } | null)?.url ?? media.url
            ),
            canonical: `${JOURNAL_ADDRESS}/${String(post.slug)}`,
          },
        }
      );
      await expect(page).toHaveTitle(String(expected.title));
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        String(expected.description)
      );
      const canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute("href");
      expect(pathOf(canonical, page.url())).toBe(
        expected.alternates?.canonical
      );
      // The intentional difference: the hand-written page names `/blog/`.
      expect(pathOf(canonical, page.url())).not.toContain("/blog/");
      const images = expected.openGraph?.images;
      const image = Array.isArray(images) ? images[0] : images;
      const ogImage = await page
        .locator('meta[property="og:image"]')
        .getAttribute("content");
      expect(pathOf(ogImage, page.url())).toBe(
        pathOf(
          typeof image === "object" && "url" in image
            ? String(image.url)
            : String(image),
          page.url()
        )
      );
      const robots = expected.robots as { index: boolean; follow: boolean };
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        `${robots.index ? "index" : "noindex"}, ${robots.follow ? "follow" : "nofollow"}`
      );
    });

    test("draws the post's own blocks below the article, after the template's parts", async () => {
      const own = page.getByText(FULL_POST.ownBlockText, { exact: true });
      await expect(own).toBeVisible();
      // After the body and the tags, in the article, in document order.
      const order = await page.locator("article").evaluate((article, words) => {
        const text = (needle: string) =>
          [...article.querySelectorAll("*")].findIndex(
            each =>
              each.children.length === 0 && each.textContent?.trim() === needle
          );
        return [text("Getting started"), text("Topic focus"), text(words)];
      }, FULL_POST.ownBlockText);
      expect(order.every(at => at >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    test("has no serious or critical accessibility findings", async () => {
      await expectNoAxeViolations(page);
    });
  });

  test.describe("a post with none of them", () => {
    test("leaves out the table of contents, the featured image, the category and tag lists and its own blocks, drawing no empty boxes", async ({
      browser,
    }) => {
      const { page, close } = await visit(
        browser,
        `${JOURNAL_ADDRESS}/${seeded.plain.slug}`,
        "A Short Note on Shipping"
      );
      try {
        const html = await page.content();
        await expect(
          page.getByRole("navigation", { name: "On this page" })
        ).toHaveCount(0);
        await expect(
          page.locator('a[href^="/categories/"], a[href^="/tags/"]')
        ).toHaveCount(0);
        await expect(
          page.getByText("Topic focus", { exact: true })
        ).toHaveCount(0);
        // The lists and the Entry content draw no element at all, not an
        // empty one. Asked of class attributes, since the stylesheet names
        // the classes.
        for (const block of [
          "collection-loop",
          "table-of-contents",
          "entry-content",
        ]) {
          expect(html, block).not.toMatch(
            new RegExp(`class="[^"]*nx-b-core--${block}`)
          );
        }
        // One picture: the byline's, which is the fallback for an author
        // without an avatar. The hand-written page draws the name's first
        // letter there: an intentional difference.
        const images = page.locator("img");
        await expect(images).toHaveCount(1);
        expect(pathOf(await images.getAttribute("src"), page.url())).toBe(
          AVATAR_FALLBACK
        );
        await expect(
          page.getByText(String(seeded.sam.name), { exact: true })
        ).toBeVisible();
        await expectNoAxeViolations(page);
      } finally {
        await close();
      }
    });
  });

  test.describe("a post with its own design", () => {
    test("draws its own design, while the other posts draw the template, and the template shows it is overridden", async ({
      page,
      browser,
    }) => {
      test.setTimeout(180_000);
      const api = await signIn(page);
      const title = `Redesigned post ${STAMP}`;
      const own = await created(api, JOURNAL.posts, {
        title,
        slug: slugOf("Redesigned post", STAMP),
        excerpt: "A post drawn with its own design.",
        byline: seeded.jane.id,
        publishedAt: FULL_POST.publishedAt,
        status: "published",
      });
      const OWN_HEADING = `Drawn by its own design ${STAMP}`;
      const given = await api.post(ACTIONS, {
        headers: await pluginHeaders(api),
        data: {
          action: {
            kind: "give-entry-design",
            collection: JOURNAL.posts,
            entry: own.id,
          },
        },
      });
      expect(given.ok(), await given.text()).toBe(true);
      const designId = (
        (await given.json()) as { item: { template: { id: string } } }
      ).item.template.id;
      const designed = await api.patch(`${TEMPLATES}/${designId}`, {
        data: {
          content: {
            formatVersion: 1,
            kind: "template",
            nodes: [
              {
                id: "own-mark",
                type: "core/heading",
                version: 1,
                props: { text: OWN_HEADING, level: "h2" },
              },
              {
                id: "own-title",
                type: "core/heading",
                version: 1,
                props: { text: "Untitled", level: "h1" },
                bindings: { text: { $bind: "title", fallback: "Untitled" } },
              },
            ],
          },
          status: "draft",
          // Replaces what is stored: this edit is not about stale ones.
          _overwrite: true,
        },
      });
      expect(designed.ok(), await designed.text()).toBe(true);
      const published = await api.post(ACTIONS, {
        headers: await pluginHeaders(api),
        data: { action: { kind: "publish-template", id: designId } },
      });
      expect(published.ok(), await published.text()).toBe(true);

      // That post alone is drawn with its own design.
      const redesigned = await visit(
        browser,
        `${JOURNAL_ADDRESS}/${String(own.slug)}`,
        OWN_HEADING
      );
      try {
        await expect(
          redesigned.page.getByRole("heading", {
            level: 1,
            name: title,
            exact: true,
          })
        ).toBeVisible();
        await expect(redesigned.page.getByText("Topic focus")).toHaveCount(0);
      } finally {
        await redesigned.close();
      }
      const other = await visit(
        browser,
        `${JOURNAL_ADDRESS}/${seeded.full.slug}`,
        FULL_POST.title
      );
      try {
        expect(await other.page.content()).not.toContain(OWN_HEADING);
        await expect(
          other.page.getByText("Topic focus", { exact: true })
        ).toBeVisible();
      } finally {
        await other.close();
      }

      // The template's own designs list the post's, published.
      const listed = await api.get(`${DESIGNS}?collection=${JOURNAL.posts}`);
      expect(listed.ok(), await listed.text()).toBe(true);
      const { items, meta } = (await listed.json()) as {
        items: { entryId: string; status: string }[];
        meta: { template: { id: string } | null };
      };
      expect(meta.template?.id).toBe(templateId);
      expect(items.map(({ entryId, status }) => ({ entryId, status }))).toEqual(
        [{ entryId: own.id, status: "published" }]
      );
    });
  });
});
