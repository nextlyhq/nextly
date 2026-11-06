/**
 * The demo site's welcome page, built the way an author builds one with the
 * page builder's shared parts, and published.
 *
 * ## What it is built from
 *
 * - **A pattern**, "Hero": a starting point copied into the page. The page
 *   owns its copy, so the copy is the page's to change, and changing the
 *   pattern later leaves the page alone.
 * - **A component with exposed fields**, "Feature card": placed three times,
 *   each placement giving its own title, description and link. The card's
 *   design stays the component's: a change to it reaches every placement.
 * - **A Layout with a locked header**, "Site": its header and footer are
 *   components drawn around the page. On the page they are read-only, and the
 *   header's own blocks carry the Layers lock as well, so it stays as designed
 *   until someone deliberately unlocks it in the header's own view.
 *
 * The page names that Layout itself rather than changing the site's default,
 * so every other page keeps whatever the site already draws around it.
 *
 * ## How it is written
 *
 * Through the Direct API, as the seed writes everything else, and through the
 * same planner the editor and the API insert a pattern with, so the hero's
 * copy carries fresh ids and its origin exactly as an author's insert would.
 * Everything is validated by the page builder's own field rules on the way in.
 *
 * ## Styled with the site's tokens
 *
 * Colours, surfaces and spacing name the site's tokens (`color.surface`,
 * `space.gutter`, ...), never a literal colour, so the page follows the site's
 * palette and its dark values. Sizes that are this page's own design are
 * literal, with a smaller value on phones.
 *
 * @module seed/composition-demo
 */
import {
  applyOps,
  planInsertPattern,
  registryNestingSource,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";

/** Where the welcome page is served: `/site/welcome`, and `/welcome`. */
const DEMO_PAGE_SLUG = "welcome";
const DEMO_PAGE_TITLE = "Welcome to Nextly";
const DEMO_LAYOUT_TITLE = "Site";
const DEMO_PATTERN_TITLE = "Hero";
const DEMO_CARD_TITLE = "Feature card";
const DEMO_HEADER_TITLE = "Site header";
const DEMO_FOOTER_TITLE = "Site footer";

/** The slugs the demo's parts are stored under, which make the seed idempotent. */
const DEMO_SLUGS = {
  page: DEMO_PAGE_SLUG,
  layout: "demo-site",
  pattern: "demo-hero",
  card: "demo-feature-card",
  header: "demo-site-header",
  footer: "demo-site-footer",
} as const;

/** The block a placement is stored as. */
const INSTANCE = "nextly/component-instance";

const TOKEN = (name: string) => ({ $token: name });

const sides = (value: unknown) => ({
  blockStart: value,
  blockEnd: value,
  inlineStart: value,
  inlineEnd: value,
});

const hairline = (side: "blockStart" | "blockEnd") => ({
  width: { [side]: "1px" },
  style: "solid",
  color: TOKEN("color.border"),
});

/**
 * Styles at every width, with an optional phone-width override: the default
 * state, keyed by breakpoint. Typed through
 * `unknown` once, here, because a style value may be a literal or a token
 * reference and `NodeStyles` spells each property's own type.
 */
function styled(
  base: Record<string, unknown>,
  mobile?: Record<string, unknown>
): NodeStyles {
  return {
    base: { base, ...(mobile ? { mobile } : {}) },
  } as unknown as NodeStyles;
}

function node(
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props, ...extra };
}

function text(id: string, value: string, styles?: NodeStyles): BlockNode {
  return node(id, "core/text", { text: value }, styles ? { styles } : {});
}

/**
 * A text-look link: a button that reads as a link in the site's colour.
 * `inline` drops its side padding, for a link that starts a line; `desktop`
 * hides it on phones, where the header keeps only its one action.
 */
function navLink(
  id: string,
  label: string,
  href: string,
  options: { inline?: boolean; desktop?: boolean } = {}
): BlockNode {
  const side = options.inline === true ? "0" : "0.75rem";
  return node(
    id,
    "core/button",
    { label, href },
    {
      styles: styled({
        backgroundColor: "transparent",
        color: TOKEN("color.text"),
        padding: { inlineStart: side, inlineEnd: side },
        fontWeight: 500,
      }),
      ...(options.desktop === true
        ? { visibility: { devices: { mobile: false } } }
        : {}),
    }
  );
}

/**
 * The header the Layout draws above every page: the site's name, two links
 * and the one action. The row carries the Layers lock, so it is changed only
 * by someone who unlocks it on purpose.
 */
export function siteHeaderDocument(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      node(
        "site-header-bar",
        "core/box",
        { as: "div", contained: true },
        {
          locked: true,
          name: "Header bar",
          styles: styled(
            {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              padding: {
                blockStart: "1rem",
                blockEnd: "1rem",
                inlineStart: TOKEN("space.gutter"),
                inlineEnd: TOKEN("space.gutter"),
              },
            },
            { flexWrap: "wrap" }
          ),
          slots: {
            children: [
              text(
                "site-header-name",
                "Nextly",
                styled({
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: TOKEN("color.text"),
                })
              ),
              node(
                "site-header-nav",
                "core/box",
                { as: "div" },
                {
                  styles: styled({
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: "0.25rem",
                  }),
                  slots: {
                    children: [
                      navLink("site-header-features", "Features", "#features", {
                        desktop: true,
                      }),
                      navLink(
                        "site-header-docs",
                        "Documentation",
                        "https://nextlyhq.com/docs",
                        { desktop: true }
                      ),
                      node("site-header-start", "core/button", {
                        label: "Open the admin",
                        href: "/admin",
                      }),
                    ],
                  },
                }
              ),
            ],
          },
        }
      ),
    ],
  };
}

/** The footer the Layout draws below every page. */
export function siteFooterDocument(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      node(
        "site-footer-bar",
        "core/box",
        { as: "div", contained: true },
        {
          locked: true,
          name: "Footer bar",
          styles: styled(
            {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              padding: {
                blockStart: "2rem",
                blockEnd: "2rem",
                inlineStart: TOKEN("space.gutter"),
                inlineEnd: TOKEN("space.gutter"),
              },
              border: hairline("blockStart"),
            },
            { flexDirection: "column", alignItems: "flex-start" }
          ),
          slots: {
            children: [
              text(
                "site-footer-note",
                "Built with the Nextly page builder: one Layout, one pattern and one component.",
                styled({ color: TOKEN("color.muted"), fontSize: "0.875rem" })
              ),
              navLink(
                "site-footer-source",
                "Source on GitHub",
                "https://github.com/nextlyhq/nextly",
                { inline: true }
              ),
            ],
          },
        }
      ),
    ],
  };
}

/**
 * A card a page places and fills in: a title, a description and a link, each
 * exposed, so a placement sets its own and the design stays the card's.
 */
export function featureCardDocument(): ComponentDocument {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      node(
        "card",
        "core/card",
        { as: "div" },
        {
          styles: styled({
            backgroundColor: TOKEN("color.surface"),
            border: {
              width: sides("1px"),
              style: "solid",
              color: TOKEN("color.border"),
            },
            borderRadius: "16px",
            padding: sides("1.75rem"),
            height: "100%",
          }),
          slots: {
            children: [
              node(
                "card-title",
                "core/heading",
                { text: "A feature", level: "h3" },
                {
                  styles: styled({
                    fontSize: "1.25rem",
                    fontWeight: 650,
                    letterSpacing: "-0.01em",
                  }),
                }
              ),
              text(
                "card-description",
                "What it does for the people who use it.",
                styled({ color: TOKEN("color.muted"), lineHeight: 1.6 })
              ),
              node(
                "card-link",
                "core/button",
                { label: "Learn more", href: "/" },
                {
                  styles: styled({
                    backgroundColor: "transparent",
                    color: TOKEN("color.primary"),
                    padding: { inlineStart: "0", inlineEnd: "0" },
                    fontWeight: 600,
                  }),
                }
              ),
            ],
          },
        }
      ),
    ],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "card-title",
        propPath: "text",
        type: "text",
      },
      {
        id: "description",
        label: "Description",
        nodeId: "card-description",
        propPath: "text",
        type: "text",
      },
      {
        id: "link",
        label: "Link",
        nodeId: "card-link",
        propPath: "href",
        type: "link",
      },
    ],
  };
}

/**
 * The hero a page starts from: what the site is, the two things to do next,
 * and a look at the editor.
 */
export function heroPatternDocument(heroImage: string | null): BlockDocument {
  return {
    formatVersion: 1,
    kind: "pattern",
    nodes: [
      node(
        "hero",
        "core/section",
        // Full width, so its surface spans the page; the blocks inside set
        // their own widths and centre themselves.
        { as: "section", contained: false },
        {
          name: "Hero",
          styles: styled(
            {
              backgroundColor: TOKEN("color.surface"),
              textAlign: "center",
              padding: { blockStart: "6rem", blockEnd: "5rem" },
              border: hairline("blockEnd"),
            },
            { padding: { blockStart: "3.5rem", blockEnd: "3rem" } }
          ),
          slots: {
            children: [
              text(
                "hero-eyebrow",
                "The page builder",
                styled({
                  color: TOKEN("color.primary"),
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                })
              ),
              node(
                "hero-title",
                "core/heading",
                { text: "Build pages, not pipelines", level: "h1" },
                {
                  styles: styled(
                    {
                      fontSize: "3.75rem",
                      fontWeight: 800,
                      lineHeight: 1.05,
                      letterSpacing: "-0.03em",
                      maxWidth: "48rem",
                      margin: { inlineStart: "auto", inlineEnd: "auto" },
                    },
                    { fontSize: "2.5rem" }
                  ),
                }
              ),
              text(
                "hero-lede",
                "Your editors get a real page builder. Your developers keep a typed schema, one database and no glue code.",
                styled(
                  {
                    color: TOKEN("color.muted"),
                    fontSize: "1.25rem",
                    lineHeight: 1.6,
                    maxWidth: "40rem",
                    margin: { inlineStart: "auto", inlineEnd: "auto" },
                  },
                  { fontSize: "1.0625rem" }
                )
              ),
              node(
                "hero-actions",
                "core/box",
                { as: "div" },
                {
                  styles: styled({
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    gap: "0.75rem",
                    padding: { blockStart: "0.5rem" },
                  }),
                  slots: {
                    children: [
                      node("hero-start", "core/button", {
                        label: "Start building",
                        href: "/admin",
                      }),
                      node(
                        "hero-docs",
                        "core/button",
                        {
                          label: "Read the documentation",
                          href: "https://nextlyhq.com/docs",
                        },
                        {
                          styles: styled({
                            backgroundColor: TOKEN("color.background"),
                            color: TOKEN("color.text"),
                            border: {
                              width: sides("1px"),
                              style: "solid",
                              color: TOKEN("color.border-strong"),
                            },
                          }),
                        }
                      ),
                    ],
                  },
                }
              ),
              ...(heroImage === null
                ? []
                : [
                    node(
                      "hero-image",
                      "core/image",
                      {
                        mediaId: heroImage,
                        alt: "A laptop on a desk showing the Nextly dashboard, beside a notebook and puzzle pieces",
                        loading: "eager",
                      },
                      {
                        styles: styled({
                          maxWidth: "64rem",
                          width: "100%",
                          margin: {
                            blockStart: "2.5rem",
                            inlineStart: "auto",
                            inlineEnd: "auto",
                          },
                          borderRadius: "16px",
                          border: {
                            width: sides("1px"),
                            style: "solid",
                            color: TOKEN("color.border"),
                          },
                        }),
                      }
                    ),
                  ]),
            ],
          },
        }
      ),
    ],
  };
}

/** One placement of the feature card, with its own values. */
function card(
  id: string,
  componentId: string,
  values: { title: string; description: string; link: string }
): BlockNode {
  return node(
    `${id}-column`,
    "core/column",
    { as: "div" },
    {
      slots: {
        children: [node(id, INSTANCE, { componentId, overrides: values })],
      },
    }
  );
}

/**
 * The page's own blocks, below the hero it inserts: the three features, each
 * a placement of the card, and a closing band.
 */
function welcomePageBody(cardId: string): BlockNode[] {
  return [
    node(
      "welcome-features",
      "core/section",
      { as: "section", contained: true },
      {
        cssId: "features",
        name: "Features",
        styles: styled(
          { padding: { blockStart: "5rem", blockEnd: "5rem" } },
          { padding: { blockStart: "3rem", blockEnd: "3rem" } }
        ),
        slots: {
          children: [
            node(
              "welcome-features-title",
              "core/heading",
              { text: "Everything a page needs, in one place", level: "h2" },
              {
                styles: styled(
                  {
                    textAlign: "center",
                    fontSize: "2.25rem",
                    fontWeight: 750,
                    letterSpacing: "-0.02em",
                  },
                  { fontSize: "1.75rem" }
                ),
              }
            ),
            text(
              "welcome-features-lede",
              "Three parts, shared across the site and filled in on each page.",
              styled({
                textAlign: "center",
                color: TOKEN("color.muted"),
                fontSize: "1.125rem",
                margin: { blockEnd: "1.5rem" },
              })
            ),
            node(
              "welcome-features-grid",
              "core/columns",
              { as: "div" },
              {
                styles: styled({ gap: "1.5rem" }),
                slots: {
                  children: [
                    card("welcome-card-patterns", cardId, {
                      title: "Patterns",
                      description:
                        "Start a section from a saved design, then make it this page's own. The hero above began as one.",
                      link: "https://nextlyhq.com/docs/page-builder",
                    }),
                    card("welcome-card-components", cardId, {
                      title: "Components",
                      description:
                        "Design a block once and place it anywhere. Each place fills in its own words; one publish updates them all.",
                      link: "https://nextlyhq.com/docs/page-builder",
                    }),
                    card("welcome-card-layouts", cardId, {
                      title: "Layouts",
                      description:
                        "A header and a footer drawn around every page that uses them, locked so a page cannot change them by accident.",
                      link: "https://nextlyhq.com/docs/page-builder/layouts",
                    }),
                  ],
                },
              }
            ),
          ],
        },
      }
    ),
    node(
      "welcome-closing",
      "core/section",
      { as: "section", contained: true },
      {
        name: "Closing",
        styles: styled(
          {
            textAlign: "center",
            padding: { blockStart: "4rem", blockEnd: "5rem" },
          },
          { padding: { blockStart: "2.5rem", blockEnd: "3rem" } }
        ),
        slots: {
          children: [
            node(
              "welcome-quote",
              "core/quote",
              {
                text: "The page a visitor gets is the page the author built.",
              },
              {
                styles: styled({
                  maxWidth: "40rem",
                  margin: { inlineStart: "auto", inlineEnd: "auto" },
                  fontSize: "1.375rem",
                }),
              }
            ),
          ],
        },
      }
    ),
  ];
}

/**
 * The welcome page: the hero pattern inserted at the top, through the planner
 * every insert takes, then the page's own blocks.
 */
export function welcomePageDocument(
  pattern: { id: string; document: BlockDocument },
  cardId: string
): BlockDocument {
  const body: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: welcomePageBody(cardId),
  };
  const plan = planInsertPattern(
    body,
    pattern,
    { index: 0 },
    registryNestingSource()
  );
  if (plan.problem !== undefined) {
    throw new Error(
      `[seed] the hero pattern could not be inserted: ${plan.problem}`
    );
  }
  return applyOps(body, plan.pageOps).document;
}

/** The slice of the Nextly client the demo seeder uses. */
export interface DemoStore {
  find(args: {
    collection: string;
    where: { slug: { equals: string } };
    limit: number;
  }): Promise<{ items: Array<{ id?: unknown; content?: unknown }> }>;
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<{ item: { id?: unknown } }>;
}

/** Whether a create was refused because the row is already there. */
function isDuplicateRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "DUPLICATE"
  );
}

/** The row stored under `slug`, or `undefined`. */
async function storedRow(
  nextly: DemoStore,
  collection: string,
  slug: string
): Promise<{ id: string; content?: unknown } | undefined> {
  const existing = await nextly.find({
    collection,
    where: { slug: { equals: slug } },
    limit: 1,
  });
  const row = existing.items[0];
  return typeof row?.id === "string" ? { ...row, id: row.id } : undefined;
}

/**
 * The published row stored under `slug`, made if there is none.
 *
 * The find and the create are two operations and `slug` is unique, so two
 * seed runs starting together (the app's own on boot and a contributor's
 * `db:seed`) can both find nothing, and the loser's insert is refused as a
 * duplicate. That refusal means the row is there, which is what this exists
 * to reach, so the winner's row is read and used.
 */
async function ensure(
  nextly: DemoStore,
  collection: string,
  slug: string,
  data: () => Record<string, unknown> | Promise<Record<string, unknown>>
): Promise<{ id: string; content?: unknown; created: boolean }> {
  const found = await storedRow(nextly, collection, slug);
  if (found !== undefined) return { ...found, created: false };
  const fields = await data();
  try {
    const made = await nextly.create({
      collection,
      data: { ...fields, slug, status: "published" },
    });
    if (typeof made.item.id !== "string") {
      throw new Error(`[seed] creating ${collection}/${slug} answered no id`);
    }
    return { id: made.item.id, content: fields.content, created: true };
  } catch (error) {
    if (!isDuplicateRefusal(error)) throw error;
    const winner = await storedRow(nextly, collection, slug);
    if (winner === undefined) throw error;
    return { ...winner, created: false };
  }
}

/**
 * Seed the welcome page and its parts, each idempotent on its slug: a part
 * already there is used as it stands, and a page already there is left alone,
 * so a re-seed never discards what someone changed.
 *
 * @returns whether the page was created by this run.
 */
export async function seedCompositionDemo(
  nextly: DemoStore,
  options: {
    /** The hero's image id, asked for only when the page is to be made. */
    heroImage: () => Promise<string | null>;
  }
): Promise<{ created: number }> {
  if ((await storedRow(nextly, "pages", DEMO_SLUGS.page)) !== undefined) {
    return { created: 0 };
  }

  const header = await ensure(nextly, "components", DEMO_SLUGS.header, () => ({
    title: DEMO_HEADER_TITLE,
    area: "header",
    content: siteHeaderDocument(),
  }));
  const footer = await ensure(nextly, "components", DEMO_SLUGS.footer, () => ({
    title: DEMO_FOOTER_TITLE,
    area: "footer",
    content: siteFooterDocument(),
  }));
  const feature = await ensure(nextly, "components", DEMO_SLUGS.card, () => ({
    title: DEMO_CARD_TITLE,
    description: "A feature with a title, a description and a link.",
    content: featureCardDocument(),
  }));
  const pattern = await ensure(
    nextly,
    "patterns",
    DEMO_SLUGS.pattern,
    async () => ({
      title: DEMO_PATTERN_TITLE,
      description: "What the site is, two things to do next, and a picture.",
      granularity: "section",
      content: heroPatternDocument(await options.heroImage()),
    })
  );
  const layout = await ensure(nextly, "layouts", DEMO_SLUGS.layout, () => ({
    title: DEMO_LAYOUT_TITLE,
    description: "The site's header and footer.",
    areas: [
      { area: "header", component: header.id },
      { area: "footer", component: footer.id },
    ],
  }));

  // The hero is copied from the pattern as stored, so a pattern someone has
  // edited since an earlier seed is the one the page starts from.
  const page = await ensure(nextly, "pages", DEMO_SLUGS.page, () => ({
    title: DEMO_PAGE_TITLE,
    layout: layout.id,
    noHeaderFooter: false,
    content: welcomePageDocument(
      { id: pattern.id, document: pattern.content as BlockDocument },
      feature.id
    ),
  }));
  return { created: page.created ? 1 : 0 };
}
