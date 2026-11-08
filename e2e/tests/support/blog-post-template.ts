/**
 * The blog template's post page, rebuilt as the blog fixture's collection
 * template, and the content both pages are compared on.
 *
 * The fixture (`apps/playground/src/blog-fixture`) is the blog template's own
 * posts, authors, categories and tags, renamed under `journal-`, with posts
 * served at `/journal/<slug>`. The template below draws each part the
 * hand-written page (`templates/blog/src/app/(frontend)/blog/[slug]/page.tsx`)
 * draws, in its order: the date and reading time, the title, the byline with
 * its avatar, the categories, the featured image, the contents beside the
 * body, the tags under "Topic focus", and then the post's own blocks. Each
 * optional part carries a visibility condition on the field it draws, so a
 * post without it draws nothing there, as the hand-written page's
 * `{post.x && ...}` does.
 *
 * Styled with the site's tokens, never a literal colour, so it follows the
 * site's palette in light and dark. Sizes are the hand-written page's.
 *
 * @module tests/support/blog-post-template
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** The fixture's collections, as `apps/playground/src/blog-fixture` names them. */
export const JOURNAL = {
  posts: "journal-posts",
  authors: "journal-authors",
  categories: "journal-categories",
  tags: "journal-tags",
} as const;

/** Where the fixture's posts are served. */
export const JOURNAL_ADDRESS = "/journal";

/**
 * The address an author without an avatar is drawn with: the fixture's
 * neutral silhouette (`apps/playground/public/blog-fixture`).
 */
export const AVATAR_FALLBACK = "/blog-fixture/author-fallback.svg";

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
export const TEMPLATES = `${API}/collections/templates/entries`;
export const ACTIONS = `${PLUGIN}/templates/actions`;
export const DESIGNS = `${PLUGIN}/templates/entry-designs`;
export const entriesOf = (collection: string) =>
  `${API}/collections/${collection}/entries`;

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The blog template's seed images, the same files a scaffolded blog seeds. */
const SEED_MEDIA = path.resolve(
  HERE,
  "../../../templates/blog/src/endpoints/seed/media"
);

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

type Node = Record<string, unknown>;

const TOKEN = (name: string) => ({ $token: name });

const sides = (block: unknown, inline: unknown = block) => ({
  blockStart: block,
  blockEnd: block,
  inlineStart: inline,
  inlineEnd: inline,
});

/** Styles at every width, with optional tablet and phone overrides. */
function styled(
  base: Record<string, unknown>,
  narrower: {
    tablet?: Record<string, unknown>;
    mobile?: Record<string, unknown>;
  } = {}
): Record<string, unknown> {
  return { base: { base, ...narrower } };
}

function node(
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: Node = {}
): Node {
  return { id, type, version: 1, props, ...extra };
}

/** Shown only when the entry's `field` holds a value. */
const whenSet = (field: string) => ({
  visibility: { conditions: [[{ field, op: "exists" }]] },
});

/** The small, spaced capitals the hand-written page sets its labels in. */
const LABEL = {
  fontSize: "0.625rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: TOKEN("color.muted"),
};

/** A category or tag badge: a link pill, as `CategoryBadge` and `TagBadge`. */
function badge(id: string, collection: string): Node {
  return node(
    id,
    "core/button",
    { label: "Topic", entryCollection: collection },
    {
      bindings: {
        label: { $bind: "name", source: "item", fallback: "Topic" },
        entryId: { $bind: "id", source: "item" },
      },
      styles: styled({
        backgroundColor: "transparent",
        color: TOKEN("color.text"),
        border: {
          width: sides("1px"),
          style: "solid",
          color: TOKEN("color.border"),
        },
        borderRadius: "999px",
        padding: sides("0.375rem", "0.875rem"),
        fontSize: "0.6875rem",
        fontWeight: 600,
        letterSpacing: "0.04em",
      }),
    }
  );
}

/** A list of the post's `field` relation, drawn as badges. */
function badges(
  id: string,
  field: string,
  collection: string,
  justify: "center" | "flex-start"
): Node {
  return node(
    id,
    "core/collection-loop",
    { collection, relation: { of: "entry", field }, limit: 20 },
    {
      ...whenSet(field),
      styles: styled({
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: justify,
        gap: "0.5rem",
      }),
      slots: { children: [badge(`${id}-badge`, collection)], empty: [] },
    }
  );
}

/** The rebuilt post page: the fixture's posts template. */
export function blogPostTemplate(): Record<string, unknown> {
  const header = node(
    "post-header",
    "core/box",
    { as: "div" },
    {
      name: "Header",
      styles: styled(
        {
          backgroundColor: TOKEN("color.surface"),
          border: {
            width: { blockEnd: "1px" },
            style: "solid",
            color: TOKEN("color.border"),
          },
          padding: sides("9rem", TOKEN("space.gutter")),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        },
        { mobile: { padding: sides("6rem", TOKEN("space.gutter")) } }
      ),
      slots: {
        children: [
          node(
            "post-meta",
            "core/box",
            { as: "div" },
            {
              name: "Date and reading time",
              styles: styled({
                display: "flex",
                flexDirection: "row",
                flexWrap: "wrap",
                justifyContent: "center",
                alignItems: "center",
                gap: "1rem",
                margin: { blockEnd: "2rem" },
              }),
              slots: {
                children: [
                  node(
                    "post-date",
                    "core/text",
                    { text: "" },
                    {
                      ...whenSet("publishedAt"),
                      bindings: {
                        text: {
                          $bind: "publishedAt",
                          format: {
                            type: "date",
                            options: {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            },
                          },
                        },
                      },
                      styles: styled(LABEL),
                    }
                  ),
                  node(
                    "post-meta-divider",
                    "core/text",
                    { text: "/" },
                    { styles: styled({ ...LABEL, opacity: 0.5 }) }
                  ),
                  node(
                    "post-reading-time",
                    "core/box",
                    { as: "div" },
                    {
                      ...whenSet("readingTime"),
                      name: "Reading time",
                      styles: styled({
                        display: "flex",
                        flexDirection: "row",
                        gap: "0.35em",
                      }),
                      slots: {
                        children: [
                          node(
                            "post-reading-minutes",
                            "core/text",
                            { text: "" },
                            {
                              bindings: {
                                text: {
                                  $bind: "readingTime",
                                  format: { type: "number" },
                                },
                              },
                              styles: styled(LABEL),
                            }
                          ),
                          node(
                            "post-reading-unit",
                            "core/text",
                            { text: "MIN READ" },
                            { styles: styled(LABEL) }
                          ),
                        ],
                      },
                    }
                  ),
                ],
              },
            }
          ),
          node(
            "post-title",
            "core/heading",
            { text: "Untitled", level: "h1" },
            {
              bindings: { text: { $bind: "title", fallback: "Untitled" } },
              styles: styled(
                {
                  fontSize: "6rem",
                  fontWeight: 700,
                  lineHeight: 1.05,
                  letterSpacing: "-0.04em",
                  maxWidth: "64rem",
                  margin: { blockStart: "0", blockEnd: "1.5rem" },
                  color: TOKEN("color.text"),
                },
                {
                  tablet: { fontSize: "3.75rem" },
                  mobile: { fontSize: "2.25rem" },
                }
              ),
            }
          ),
          node(
            "post-excerpt",
            "core/text",
            { text: "" },
            {
              ...whenSet("excerpt"),
              bindings: { text: { $bind: "excerpt" } },
              styles: styled({
                fontSize: "1.125rem",
                lineHeight: 1.6,
                maxWidth: "40rem",
                margin: { blockStart: "0", blockEnd: "2.5rem" },
                color: TOKEN("color.muted"),
              }),
            }
          ),
          node(
            "post-byline",
            "core/box",
            { as: "div" },
            {
              ...whenSet("byline"),
              name: "Byline",
              styles: styled({
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.75rem",
                margin: { blockEnd: "2rem" },
              }),
              slots: {
                children: [
                  node(
                    "post-avatar",
                    "core/image",
                    { alt: "", decorative: true },
                    {
                      bindings: {
                        mediaId: {
                          $bind: "byline.avatar",
                          fallback: AVATAR_FALLBACK,
                        },
                      },
                      styles: styled({
                        width: "2rem",
                        height: "2rem",
                        aspectRatio: "1 / 1",
                        objectFit: "cover",
                        borderRadius: "999px",
                        border: {
                          width: sides("1px"),
                          style: "solid",
                          color: TOKEN("color.border"),
                        },
                        overflow: "hidden",
                      }),
                    }
                  ),
                  node(
                    "post-author",
                    // The name, linked to the author's page: the entry the
                    // byline names, by its id read across the relation. Set
                    // as the hand-written page's link: plain bold text that
                    // fades on hover, never a button's fill.
                    "core/button",
                    { label: "Author", entryCollection: JOURNAL.authors },
                    {
                      bindings: {
                        label: { $bind: "byline.name", fallback: "Author" },
                        entryId: { $bind: "byline.id" },
                      },
                      styles: {
                        ...styled({
                          backgroundColor: "transparent",
                          color: TOKEN("color.text"),
                          padding: sides("0"),
                          borderRadius: "0",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          margin: sides("0"),
                        }),
                        hover: { base: { opacity: 0.7 } },
                      },
                    }
                  ),
                ],
              },
            }
          ),
          badges("post-categories", "categories", JOURNAL.categories, "center"),
        ],
      },
    }
  );

  const featured = node(
    "post-featured",
    "core/box",
    { as: "div" },
    {
      ...whenSet("featuredImage"),
      name: "Featured image",
      styles: styled(
        {
          maxWidth: "72rem",
          margin: {
            blockStart: "-6rem",
            inlineStart: "auto",
            inlineEnd: "auto",
          },
          padding: {
            inlineStart: TOKEN("space.gutter"),
            inlineEnd: TOKEN("space.gutter"),
          },
        },
        { mobile: { margin: { blockStart: "-4rem" } } }
      ),
      slots: {
        children: [
          node(
            "post-featured-image",
            "core/image",
            // Loaded at once, as the hand-written page's `priority` image is:
            // it is the first thing a visitor sees below the title. No `alt`
            // of its own, so the picture's own alternative text is drawn,
            // which the blog's hook requires before a post with a featured
            // image is saved.
            { loading: "eager" },
            {
              bindings: { mediaId: { $bind: "featuredImage" } },
              styles: styled({
                width: "100%",
                aspectRatio: "21 / 9",
                objectFit: "cover",
                border: {
                  width: sides("1px"),
                  style: "solid",
                  color: TOKEN("color.border"),
                },
                boxShadow: "0 24px 48px -12px rgb(0 0 0 / 0.18)",
              }),
            }
          ),
        ],
      },
    }
  );

  const body = node(
    "post-body",
    "core/box",
    { as: "div" },
    {
      name: "Body",
      styles: styled(
        {
          display: "grid",
          gridTemplateColumns: "16rem minmax(0, 1fr)",
          gap: "5rem",
          maxWidth: "80rem",
          margin: { inlineStart: "auto", inlineEnd: "auto" },
          padding: {
            blockStart: "6rem",
            blockEnd: "8rem",
            inlineStart: TOKEN("space.gutter"),
            inlineEnd: TOKEN("space.gutter"),
          },
        },
        {
          tablet: { gridTemplateColumns: "minmax(0, 1fr)", gap: "3rem" },
          mobile: {
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: "2.5rem",
            padding: { blockStart: "4rem", blockEnd: "5rem" },
          },
        }
      ),
      slots: {
        children: [
          node(
            "post-aside",
            "core/box",
            { as: "aside" },
            {
              name: "Contents",
              slots: {
                children: [
                  node(
                    "post-contents",
                    "core/table-of-contents",
                    {
                      title: "On this page",
                      depth: "h2-h3",
                      collapsible: true,
                    },
                    {
                      bindings: { content: { $bind: "content" } },
                      // A card, as the hand-written page boxes its contents:
                      // a hairline border, rounded corners and the page's
                      // background, its entries in the text's colour and a
                      // quieter one under the pointer. The H3s are set in by
                      // the block's own nested list.
                      styles: styled({
                        border: {
                          width: sides("1px"),
                          style: "solid",
                          color: TOKEN("color.border"),
                        },
                        borderRadius: "8px",
                        padding: sides("1.5rem"),
                        backgroundColor: TOKEN("color.background"),
                        color: TOKEN("color.text"),
                        linkColor: TOKEN("color.text"),
                        linkColorHover: TOKEN("color.muted"),
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        lineHeight: 1.6,
                      }),
                    }
                  ),
                ],
              },
            }
          ),
          node(
            "post-article",
            "core/box",
            { as: "article" },
            {
              name: "Article",
              styles: styled({ maxWidth: "48rem" }),
              slots: {
                children: [
                  node(
                    "post-content",
                    "core/rich-text",
                    {},
                    {
                      bindings: { content: { $bind: "content" } },
                      styles: styled({
                        fontSize: "1.125rem",
                        lineHeight: 1.75,
                        color: TOKEN("color.text"),
                        margin: { blockEnd: "4rem" },
                      }),
                    }
                  ),
                  node(
                    "post-tags",
                    "core/box",
                    { as: "div" },
                    {
                      ...whenSet("tags"),
                      name: "Tags",
                      styles: styled({ margin: { blockEnd: "3rem" } }),
                      slots: {
                        children: [
                          node(
                            "post-tags-label",
                            "core/text",
                            { text: "Topic focus" },
                            {
                              styles: styled({
                                ...LABEL,
                                margin: { blockEnd: "1rem" },
                              }),
                            }
                          ),
                          badges(
                            "post-tag-list",
                            "tags",
                            JOURNAL.tags,
                            "flex-start"
                          ),
                        ],
                      },
                    }
                  ),
                  node("post-own-blocks", "core/entry-content", {
                    field: "postBlocks",
                  }),
                ],
              },
            }
          ),
        ],
      },
    }
  );

  return {
    formatVersion: 1,
    kind: "template",
    nodes: [header, featured, body],
    settings: {
      seo: {
        title: [{ $bind: "title" }],
        description: [{ $bind: "excerpt" }],
        image: { $bind: "featuredImage" },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The content
// ---------------------------------------------------------------------------

/** A Lexical text run. */
const run = (text: string) => ({ type: "text", text });
const paragraph = (text: string) => ({
  type: "paragraph",
  children: [run(text)],
});
const heading = (tag: "h2" | "h3", text: string) => ({
  type: "heading",
  tag,
  children: [run(text)],
});

/**
 * The first post's body: the blog seed's first post, with two H3 sections
 * under its first H2, so the contents nest.
 */
export const FULL_POST_CONTENT = {
  root: {
    type: "root",
    children: [
      paragraph(
        "Nextly is an open-source CMS built specifically for Next.js. Unlike traditional headless CMS platforms, Nextly runs inside your Next.js application, giving you direct access to your content without any API overhead."
      ),
      heading("h2", "Why Nextly?"),
      paragraph(
        "Traditional CMSs force you to make an HTTP round-trip for every content fetch. Nextly sits next to your Next.js app and gives you a typed, in-process API. That means faster pages, fewer moving parts, and the full power of Server Components."
      ),
      heading("h3", "Reads in the same process"),
      paragraph(
        "A page reads its content through the same process that renders it, so there is no network hop to cache, retry or secure."
      ),
      heading("h3", "Types from your schema"),
      paragraph(
        "Every collection you define becomes a TypeScript type, so a renamed field is a compile error rather than a blank page."
      ),
      heading("h2", "Getting started"),
      paragraph(
        "Scaffold a new project with a single command and you are in business: Nextly creates the database schema, wires up the admin panel, and sets up an example blog so you can see everything working end-to-end."
      ),
    ],
  },
};

/** The second post's body: two paragraphs, no headings. */
export const PLAIN_POST_CONTENT = {
  root: {
    type: "root",
    children: [
      paragraph(
        "Some posts are short notes: a thought, a link worth sharing, a lesson from the week. They need no contents, no picture and no topics."
      ),
      paragraph(
        "This one is credited to an author without an avatar, so the byline shows the fallback picture."
      ),
    ],
  },
};

/** The two authors, as the blog seed describes them. */
export const AUTHORS = {
  jane: {
    name: "Jane Smith",
    bio: "Tech writer and Next.js enthusiast. Writing about modern web development and open-source tools.",
    avatar: "author-jane.svg",
  },
  // Not one of the seed's authors, who all have an avatar: the profile
  // without one, so its byline shows the fallback.
  sam: {
    name: "Sam Rivera",
    bio: "Writes short notes on shipping software.",
  },
} as const;

export const CATEGORIES = ["Tutorials", "Engineering"] as const;
export const TAGS = ["Next.js", "TypeScript"] as const;

export const FULL_POST = {
  title: "How to Build a Blog with Nextly",
  excerpt:
    "A complete walkthrough: install Nextly, pick the blog template, and go from empty repo to published blog without writing boilerplate.",
  publishedAt: "2026-04-10T10:00:00.000Z",
  featuredImage: "build-blog-with-nextly.webp",
  featuredAlt:
    "A laptop showing a blog's admin panel beside its published page",
  ownBlockText:
    "Below the article: this post's own blocks, drawn by its template's Entry content.",
} as const;

export const PLAIN_POST = {
  title: "A Short Note on Shipping",
  excerpt: "A post with none of the optional parts.",
  publishedAt: "2026-04-12T10:00:00.000Z",
} as const;

// ---------------------------------------------------------------------------
// Writing it through the API
// ---------------------------------------------------------------------------

/** The CSRF token and origin a cookie-signed write to a plugin route needs. */
export async function pluginHeaders(
  api: APIRequestContext
): Promise<Record<string, string>> {
  const csrf = await api.get(`${API}/auth/csrf`);
  expect(csrf.ok()).toBe(true);
  const { token } = (await csrf.json()) as { token: string };
  return { "x-csrf-token": token, origin: new URL(csrf.url()).origin };
}

/** A created entry's stored fields, failing with the server's words. */
export async function created(
  api: APIRequestContext,
  collection: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown> & { id: string }> {
  const response = await api.post(entriesOf(collection), { data });
  expect(
    response.ok(),
    `creating in ${collection}: ${await response.text()}`
  ).toBe(true);
  return (
    (await response.json()) as {
      item: Record<string, unknown> & { id: string };
    }
  ).item;
}

/** One of the blog seed's images in the media library, with its alt text. */
export async function seedImage(
  api: APIRequestContext,
  file: string,
  alt: string
): Promise<{ id: string; url: string }> {
  const mimeType = file.endsWith(".svg") ? "image/svg+xml" : "image/webp";
  const uploaded = await api.post(`${API}/media`, {
    multipart: {
      file: {
        name: file,
        mimeType,
        buffer: readFileSync(path.join(SEED_MEDIA, file)),
      },
      altText: alt,
    },
  });
  expect(uploaded.ok(), `uploading ${file}: ${await uploaded.text()}`).toBe(
    true
  );
  const body = (await uploaded.json()) as {
    item?: { id: string; url: string; altText?: string | null };
  };
  const item = body.item;
  if (item === undefined) throw new Error(`[e2e] ${file} answered no item.`);
  if (item.altText !== alt) {
    // Set afterwards where the upload route takes the file alone.
    const patched = await api.patch(`${API}/media/${item.id}`, {
      data: { altText: alt },
    });
    expect(patched.ok(), `alt text for ${file}: ${await patched.text()}`).toBe(
      true
    );
  }
  return { id: item.id, url: item.url };
}

/** The slug a name takes, stamped for the run so it cannot collide. */
export const slugOf = (name: string, stamp: string) =>
  `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${stamp}`;

export interface SeededJournal {
  readonly jane: Record<string, unknown> & { id: string; slug: string };
  readonly sam: Record<string, unknown> & { id: string; slug: string };
  readonly janeAvatar: { id: string; url: string };
  readonly categories: readonly (Record<string, unknown> & {
    id: string;
    slug: string;
    name: string;
  })[];
  readonly tags: readonly (Record<string, unknown> & {
    id: string;
    slug: string;
    name: string;
  })[];
  readonly image: { id: string; url: string };
  readonly full: Record<string, unknown> & { id: string; slug: string };
  readonly plain: Record<string, unknown> & { id: string; slug: string };
}

/**
 * The fixture's content for one run: two authors (Jane with an avatar, Sam
 * without), two categories, two tags, the featured image, and two published
 * posts, the full one credited to Jane and the plain one to Sam.
 */
export async function seedJournal(
  api: APIRequestContext,
  stamp: string
): Promise<SeededJournal> {
  const janeAvatar = await seedImage(
    api,
    AUTHORS.jane.avatar,
    AUTHORS.jane.name
  );
  const author = async (who: "jane" | "sam", avatar?: string) =>
    (await created(api, JOURNAL.authors, {
      title: AUTHORS[who].name,
      name: AUTHORS[who].name,
      slug: slugOf(AUTHORS[who].name, stamp),
      bio: AUTHORS[who].bio,
      ...(avatar === undefined ? {} : { avatar }),
    })) as SeededJournal["jane"];
  const jane = await author("jane", janeAvatar.id);
  const sam = await author("sam");
  const term = async (collection: string, name: string) =>
    (await created(api, collection, {
      title: name,
      name,
      slug: slugOf(name, stamp),
    })) as SeededJournal["categories"][number];
  const categories = [];
  for (const name of CATEGORIES)
    categories.push(await term(JOURNAL.categories, name));
  const tags = [];
  for (const name of TAGS) tags.push(await term(JOURNAL.tags, name));
  const image = await seedImage(
    api,
    FULL_POST.featuredImage,
    FULL_POST.featuredAlt
  );
  const full = (await created(api, JOURNAL.posts, {
    title: FULL_POST.title,
    slug: slugOf(FULL_POST.title, stamp),
    excerpt: FULL_POST.excerpt,
    content: FULL_POST_CONTENT,
    featuredImage: image.id,
    byline: jane.id,
    categories: categories.map(each => each.id),
    tags: tags.map(each => each.id),
    publishedAt: FULL_POST.publishedAt,
    postBlocks: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        node(
          "own-note",
          "core/text",
          { text: FULL_POST.ownBlockText },
          {
            styles: styled({
              padding: sides("1.25rem", "1.5rem"),
              border: {
                width: sides("1px"),
                style: "solid",
                color: TOKEN("color.border"),
              },
              borderRadius: "12px",
              color: TOKEN("color.muted"),
            }),
          }
        ),
      ],
    },
    status: "published",
  })) as SeededJournal["full"];
  const plain = (await created(api, JOURNAL.posts, {
    title: PLAIN_POST.title,
    slug: slugOf(PLAIN_POST.title, stamp),
    excerpt: PLAIN_POST.excerpt,
    content: PLAIN_POST_CONTENT,
    byline: sam.id,
    publishedAt: PLAIN_POST.publishedAt,
    status: "published",
  })) as SeededJournal["plain"];
  return { jane, sam, janeAvatar, categories, tags, image, full, plain };
}

/**
 * The fixture's posts template, published with `content`: the one an earlier
 * attempt left is deleted first, since a collection has one template.
 */
export async function publishJournalTemplate(
  page: Page,
  content: Record<string, unknown>
): Promise<string> {
  const api = page.request;
  const left = await api.get(`${DESIGNS}?collection=${JOURNAL.posts}`);
  expect(left.ok(), await left.text()).toBe(true);
  const { meta } = (await left.json()) as {
    meta: { template: { id: string } | null };
  };
  if (meta.template !== null) {
    const removed = await api.post(ACTIONS, {
      headers: await pluginHeaders(api),
      data: { action: { kind: "delete-template", id: meta.template.id } },
    });
    expect(removed.ok(), await removed.text()).toBe(true);
  }
  const template = await api.post(TEMPLATES, {
    data: {
      title: "Journal post",
      collection: JOURNAL.posts,
      content,
      status: "published",
    },
  });
  expect(
    template.ok(),
    `publishing the template: ${await template.text()}`
  ).toBe(true);
  return ((await template.json()) as { item: { id: string } }).item.id;
}
