import { test } from "../support/visible";

/**
 * The blog template's post page, rebuilt with a collection template and
 * bindings, compared part by part with the hand-written page, from a
 * PRODUCTION build.
 *
 * Two posts are authored through the API the editor writes with and read back
 * as an anonymous visitor: one with every optional part (headings at two
 * levels, a featured image, categories, tags, its own blocks below the
 * article) and one with none of them. Each part is compared with what the
 * hand-written page draws for the same data, using that page's own helpers
 * rather than a restatement of them: the date formatter, the heading
 * extractor, the reading time's words and the author, category and tag
 * addresses.
 *
 * Parts are listed one test each, so the file says what is compared. Every
 * part is `fixme` until the blog-shaped collections, the public author
 * profiles and the post template exist for this suite; the post's own blocks
 * also wait for the block that draws an entry's content in its template.
 *
 * Not compared, because the rebuilt page does not draw them: the reading
 * progress bar, the share bar, the author card's biography, the previous and
 * next links and the related posts.
 *
 * @module tests/production/blog-post-template
 */

test.describe("the blog post page, rebuilt with a template", () => {
  test.describe("a post with every optional part", () => {
    test.fixme("draws the title as the page's one H1", () => {});

    test.fixme(
      "draws the publication date in the hand-written page's words, with its machine value in datetime",
      () => {}
    );

    test.fixme("draws the reading time as `N MIN READ`", () => {});

    test.fixme(
      "draws the excerpt, which is also the page's meta description",
      () => {}
    );

    test.fixme(
      "draws the body with every heading carrying the id the hand-written page gives it",
      () => {}
    );

    test.fixme(
      "lists the body's H2 and H3 headings in the table of contents, each link reaching its heading",
      () => {}
    );

    test.fixme(
      "draws the featured image from the post's media, with its alternative text",
      () => {}
    );

    test.fixme(
      "draws the author's name, linked to their page, and their avatar from its address",
      () => {}
    );

    test.fixme(
      "draws the author's fallback avatar for a stored address that is a bare filename",
      () => {}
    );

    test.fixme(
      "lists the categories and tags in the post's order, each linked to its page",
      () => {}
    );

    test.fixme(
      "carries the hand-written page's title, description, canonical address, image and robots metadata",
      () => {}
    );

    test.fixme(
      "draws the post's own blocks below the article, after the template's parts",
      () => {}
    );

    test.fixme("has no serious or critical accessibility findings", () => {});
  });

  test.describe("a post with none of them", () => {
    test.fixme(
      "leaves out the table of contents, the featured image, the category and tag lists and its own blocks, drawing no empty boxes",
      () => {}
    );
  });

  test.describe("a post with its own design", () => {
    test.fixme(
      "draws its own design, while the other posts draw the template, and the template shows it is overridden",
      () => {}
    );
  });
});
