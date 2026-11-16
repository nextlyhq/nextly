/**
 * The pages the builder's speed check measures: one page of 150 blocks shaped
 * like a real marketing page, and pages of 4, 20 and 38 blocks for the size
 * curve, all drawn inside one Layout whose header and footer carry images and
 * buttons.
 *
 * ## What the large page holds
 *
 * A hero, a row of logos, three feature cards, a component placed six times,
 * a list of posts, testimonials, an accordion of questions, a form, pricing,
 * figures, a run of text, a closing band and a gallery. "Blocks" are the nodes
 * the page's own document holds, nested ones included; a placed component
 * counts once, however many blocks its design draws.
 *
 * ## Stable on purpose
 *
 * Every node id is fixed, so the speed script can click the same block on
 * every run and every machine, and later checks can name the blocks they
 * measure. `SPEED_FIXTURE_BLOCKS` is held by a unit test, so a change to a
 * page's size is a deliberate one. Change the shape only together with the
 * script (`e2e/builder-speed/`), and say why where the change is proposed: every
 * measurement before the change was taken on the old page.
 *
 * Colours name the site's tokens, as the demo pages do.
 *
 * @module seed/speed-fixture
 */
import type {
  BlockDocument,
  BlockNode,
  ComponentDocument,
  NodeStyles,
} from "@nextlyhq/blocks-engine";

/** The block a placement is stored as. */
const INSTANCE = "nextly/component-instance";

/** The slugs the fixture's rows are stored under. */
export const SPEED_FIXTURE_SLUGS = {
  layout: "speed-fixture-site",
  header: "speed-fixture-header",
  footer: "speed-fixture-footer",
  card: "speed-fixture-card",
  pages: {
    large: "speed-fixture-150",
    small: "speed-fixture-4",
    twenty: "speed-fixture-20",
    thirtyEight: "speed-fixture-38",
  },
} as const;

/** How many blocks each fixture page holds, as the speed script relies on. */
export const SPEED_FIXTURE_BLOCKS = {
  large: 150,
  small: 4,
  twenty: 20,
  thirtyEight: 38,
} as const;

export type SpeedFixturePage = keyof typeof SPEED_FIXTURE_BLOCKS;

/**
 * The ids the speed script acts on. The large page and the 4-block page both
 * open with the same hero heading and lead, so selecting between the two
 * measures the same action on both sizes.
 */
export const SPEED_FIXTURE_IDS = {
  heading: "speed-hero-heading",
  lead: "speed-hero-lead",
  /** Four blocks in the large page's first view, for the quick clicks. */
  quick: [
    "speed-hero-heading",
    "speed-hero-lead",
    "speed-hero-start",
    "speed-hero-demo",
  ],
} as const;

const TOKEN = (name: string) => ({ $token: name });

function styled(base: Record<string, unknown>): NodeStyles {
  return { base: { base } } as unknown as NodeStyles;
}

function node(
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props, ...extra };
}

function parent(
  id: string,
  type: string,
  props: Record<string, unknown>,
  children: BlockNode[],
  extra: Partial<BlockNode> = {}
): BlockNode {
  return node(id, type, props, { ...extra, slots: { children } });
}

const heading = (id: string, text: string, level = "h2") =>
  node(id, "core/heading", { text, level });
const text = (id: string, value: string) =>
  node(id, "core/text", { text: value });
const button = (id: string, label: string, href = "#") =>
  node(id, "core/button", { label, href });
const image = (id: string, mediaId: string, alt: string, width?: string) =>
  node(
    id,
    "core/image",
    { mediaId, alt },
    width === undefined ? {} : { styles: styled({ width }) }
  );

function section(id: string, name: string, children: BlockNode[]): BlockNode {
  return parent(
    id,
    "core/section",
    { as: "section", contained: true },
    children,
    {
      name,
      styles: styled({
        padding: { blockStart: "4rem", blockEnd: "4rem" },
      }),
    }
  );
}

function columns(id: string, items: BlockNode[][]): BlockNode {
  return parent(
    id,
    "core/columns",
    { as: "div" },
    items.map((children, index) =>
      parent(
        `${id}-${String(index + 1)}`,
        "core/column",
        { as: "div" },
        children
      )
    ),
    { styles: styled({ gap: "1.5rem" }) }
  );
}

function row(id: string, children: BlockNode[]): BlockNode {
  return parent(id, "core/box", { as: "div" }, children, {
    styles: styled({
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: "1rem",
    }),
  });
}

/** The media a page draws, cycled, so any number of images can be asked for. */
function pictures(media: readonly string[]): (n: number) => string {
  if (media.length === 0) throw new Error("the speed fixture needs an image");
  return n => media[n % media.length];
}

/** The header the Layout draws: a logo, four links and an action. */
export function speedHeaderDocument(media: readonly string[]): BlockDocument {
  const picture = pictures(media);
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      parent(
        "speed-header-bar",
        "core/box",
        { as: "div", contained: true },
        [
          image("speed-header-logo", picture(0), "Site logo", "120px"),
          row("speed-header-nav", [
            button("speed-header-product", "Product"),
            button("speed-header-pricing", "Pricing"),
            button("speed-header-docs", "Docs"),
            button("speed-header-blog", "Blog"),
          ]),
          button("speed-header-action", "Start free"),
        ],
        {
          name: "Header bar",
          styles: styled({
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: { blockStart: "1rem", blockEnd: "1rem" },
            backgroundColor: TOKEN("color.surface"),
          }),
        }
      ),
    ],
  };
}

/** The footer the Layout draws: three columns of links, a picture and a line. */
export function speedFooterDocument(media: readonly string[]): BlockDocument {
  const picture = pictures(media);
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      parent(
        "speed-footer",
        "core/box",
        { as: "div", contained: true },
        [
          columns("speed-footer-columns", [
            [
              image("speed-footer-logo", picture(1), "Site mark", "120px"),
              text("speed-footer-about", "Pages people enjoy reading."),
            ],
            [
              button("speed-footer-product", "Product"),
              button("speed-footer-pricing", "Pricing"),
            ],
            [
              button("speed-footer-docs", "Docs"),
              button("speed-footer-contact", "Contact"),
            ],
          ]),
          text("speed-footer-line", "© Speed fixture. All rights reserved."),
        ],
        {
          name: "Footer",
          styles: styled({
            padding: { blockStart: "3rem", blockEnd: "3rem" },
            backgroundColor: TOKEN("color.surface"),
          }),
        }
      ),
    ],
  };
}

/** A card placed six times on the large page, with its title and text exposed. */
export function speedCardDocument(media: readonly string[]): ComponentDocument {
  const picture = pictures(media);
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      parent(
        "speed-card",
        "core/card",
        { as: "div" },
        [
          image("speed-card-image", picture(2), "Card picture"),
          heading("speed-card-title", "A feature", "h3"),
          text("speed-card-text", "What it does for the people who use it."),
          button("speed-card-link", "Learn more"),
        ],
        {
          styles: styled({
            backgroundColor: TOKEN("color.surface"),
            borderRadius: "16px",
            padding: {
              blockStart: "1.5rem",
              blockEnd: "1.5rem",
              inlineStart: "1.5rem",
              inlineEnd: "1.5rem",
            },
          }),
        }
      ),
    ],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "speed-card-title",
        propPath: "text",
        type: "text",
      },
      {
        id: "text",
        label: "Text",
        nodeId: "speed-card-text",
        propPath: "text",
        type: "text",
      },
    ],
  };
}

/**
 * The hero's heading, with its size set in pixels: the speed script drags its
 * Font size label, and a pixel value moves one pixel per pixel dragged.
 */
function heroHeading(): BlockNode {
  return node(
    SPEED_FIXTURE_IDS.heading,
    "core/heading",
    { text: "Build pages people enjoy", level: "h1" },
    { styles: styled({ fontSize: "40px" }) }
  );
}

/** The hero every fixture page opens with: 7 blocks. */
function hero(picture: (n: number) => string): BlockNode {
  return section("speed-hero", "Hero", [
    heroHeading(),
    text(
      SPEED_FIXTURE_IDS.lead,
      "A marketing page of the size real sites publish, for measuring the editor."
    ),
    row("speed-hero-actions", [
      button("speed-hero-start", "Start free"),
      button("speed-hero-demo", "Book a demo"),
    ]),
    image("speed-hero-image", picture(0), "The product at work", "480px"),
  ]);
}

/** A row of six logos: 9 blocks. */
function logos(picture: (n: number) => string): BlockNode {
  return section("speed-logos", "Logos", [
    text("speed-logos-line", "Trusted by teams of every size"),
    row(
      "speed-logos-row",
      Array.from({ length: 6 }, (_, i) =>
        image(
          `speed-logo-${String(i + 1)}`,
          picture(i + 1),
          `Logo ${String(i + 1)}`,
          "96px"
        )
      )
    ),
  ]);
}

/** Three feature cards, written out on the page: 22 blocks. */
function features(picture: (n: number) => string): BlockNode {
  return section("speed-features", "Features", [
    heading("speed-features-title", "Everything a page needs"),
    text("speed-features-lede", "Three things every site asks for."),
    columns(
      "speed-features-grid",
      ["Design", "Content", "Publish"].map((title, i) => [
        parent(`speed-feature-${String(i + 1)}`, "core/card", { as: "div" }, [
          image(`speed-feature-${String(i + 1)}-image`, picture(i), title),
          heading(`speed-feature-${String(i + 1)}-title`, title, "h3"),
          text(
            `speed-feature-${String(i + 1)}-text`,
            `${title}, without waiting.`
          ),
          button(`speed-feature-${String(i + 1)}-link`, "Read more"),
        ]),
      ])
    ),
  ]);
}

/** The card component placed six times: 15 blocks. */
function placements(cardId: string): BlockNode {
  return section("speed-components", "Components", [
    heading("speed-components-title", "One card, six places"),
    columns(
      "speed-components-grid",
      Array.from({ length: 6 }, (_, i) => [
        node(`speed-placement-${String(i + 1)}`, INSTANCE, {
          componentId: cardId,
          overrides: {
            title: `Placement ${String(i + 1)}`,
            text: "The design is the component's; the words are this page's.",
          },
        }),
      ])
    ),
  ]);
}

/** The latest posts, drawn from the collection: 5 blocks. */
function postList(): BlockNode {
  return section("speed-posts", "Latest posts", [
    heading("speed-posts-title", "From the blog"),
    parent(
      "speed-posts-list",
      "core/collection-loop",
      { collection: "posts", limit: 6 },
      [
        heading("speed-posts-item-title", "A post", "h3"),
        text("speed-posts-item-text", "One entry from the collection."),
      ]
    ),
  ]);
}

/** Three testimonials: 12 blocks. */
function testimonials(): BlockNode {
  return section("speed-quotes", "Testimonials", [
    heading("speed-quotes-title", "What people say"),
    columns(
      "speed-quotes-grid",
      [1, 2, 3].map(i => [
        node(`speed-quote-${String(i)}`, "core/quote", {
          text: "It made our pages a joy to keep up to date.",
        }),
        text(`speed-quote-${String(i)}-by`, `Customer ${String(i)}`),
      ])
    ),
  ]);
}

/** Six questions in an accordion: 15 blocks. */
function questions(): BlockNode {
  return section("speed-faq", "Questions", [
    heading("speed-faq-title", "Questions"),
    parent(
      "speed-faq-list",
      "core/accordion",
      { as: "div" },
      Array.from({ length: 6 }, (_, i) =>
        parent(
          `speed-faq-${String(i + 1)}`,
          "core/accordion-item",
          { title: `Question ${String(i + 1)}?`, open: i === 0 },
          [
            text(
              `speed-faq-${String(i + 1)}-answer`,
              "An answer, in a sentence."
            ),
          ]
        )
      )
    ),
  ]);
}

/** A contact form: 4 blocks. */
function contact(): BlockNode {
  return section("speed-contact", "Contact", [
    heading("speed-contact-title", "Talk to us"),
    text("speed-contact-lede", "We answer within a day."),
    node("speed-contact-form", "core/form", {
      method: "post",
      submitText: "Send",
      fields: [
        { label: "Name", name: "name", type: "text", required: true },
        { label: "Email", name: "email", type: "email", required: true },
        { label: "Message", name: "message", type: "textarea" },
      ],
    }),
  ]);
}

/** Three plans: 21 blocks. */
function pricing(): BlockNode {
  return section("speed-pricing", "Pricing", [
    heading("speed-pricing-title", "Pricing"),
    columns(
      "speed-pricing-grid",
      ["Free", "Team", "Business"].map((plan, i) => [
        parent(`speed-plan-${String(i + 1)}`, "core/card", { as: "div" }, [
          heading(`speed-plan-${String(i + 1)}-name`, plan, "h3"),
          text(
            `speed-plan-${String(i + 1)}-price`,
            `${String(i * 20)} a month`
          ),
          node(`speed-plan-${String(i + 1)}-list`, "core/list", {
            kind: "unordered",
            items: ["Unlimited pages", "Every block", "Email support"],
          }),
          button(`speed-plan-${String(i + 1)}-choose`, `Choose ${plan}`),
        ]),
      ])
    ),
  ]);
}

/** Four figures: 14 blocks. */
function figures(): BlockNode {
  return section("speed-figures", "Figures", [
    columns(
      "speed-figures-grid",
      ["10k", "99.9%", "40", "24/7"].map((figure, i) => [
        heading(`speed-figure-${String(i + 1)}`, figure, "h3"),
        text(`speed-figure-${String(i + 1)}-label`, "A figure worth knowing"),
      ])
    ),
  ]);
}

/** A run of text with a picture and a rule: 9 blocks. */
function story(picture: (n: number) => string): BlockNode {
  return section("speed-story", "Story", [
    heading("speed-story-title", "How it started"),
    text("speed-story-1", "A paragraph of the story."),
    text("speed-story-2", "Another paragraph of the story."),
    image("speed-story-image", picture(3), "The team"),
    text("speed-story-3", "The story goes on."),
    node("speed-story-rule", "core/divider", {}),
    heading("speed-story-next", "Where it goes next", "h3"),
    text("speed-story-4", "And ends here."),
  ]);
}

/** A closing band: 6 blocks. */
function closing(): BlockNode {
  return section("speed-closing", "Closing", [
    heading("speed-closing-title", "Ready when you are"),
    text("speed-closing-lede", "Start free, upgrade when it pays."),
    row("speed-closing-actions", [
      button("speed-closing-start", "Start free"),
      button("speed-closing-sales", "Talk to sales"),
    ]),
  ]);
}

/** A gallery of `count` images, plus its section and heading. */
function gallery(picture: (n: number) => string, count: number): BlockNode {
  return section("speed-gallery", "Gallery", [
    heading("speed-gallery-title", "Gallery"),
    parent(
      "speed-gallery-grid",
      "core/gallery",
      { as: "div" },
      Array.from({ length: count }, (_, i) =>
        image(
          `speed-gallery-${String(i + 1)}`,
          picture(i),
          `Picture ${String(i + 1)}`
        )
      )
    ),
  ]);
}

/** Every node of `nodes`, nested ones included. */
export function blocksIn(nodes: readonly BlockNode[]): BlockNode[] {
  return nodes.flatMap(item => [
    item,
    ...Object.values(item.slots ?? {}).flatMap(children =>
      blocksIn(children ?? [])
    ),
  ]);
}

/** The top-level nodes of one fixture page. */
function pageNodes(
  which: SpeedFixturePage,
  picture: (n: number) => string,
  cardId: string
): BlockNode[] {
  switch (which) {
    case "small":
      return [
        section("speed-hero", "Hero", [
          heroHeading(),
          text(
            SPEED_FIXTURE_IDS.lead,
            "A marketing page of the size real sites publish, for measuring the editor."
          ),
          button("speed-hero-start", "Start free"),
        ]),
      ];
    case "twenty":
      // The hero, the closing band, and the story cut to its first six blocks.
      return [
        hero(picture),
        closing(),
        section(
          "speed-story",
          "Story",
          (story(picture).slots?.children ?? []).slice(0, 6)
        ),
      ];
    case "thirtyEight":
      return [
        hero(picture),
        placements(cardId),
        questions(),
        node("speed-rule", "core/divider", {}),
      ];
    case "large":
      return [
        hero(picture),
        logos(picture),
        features(picture),
        placements(cardId),
        postList(),
        testimonials(),
        questions(),
        contact(),
        pricing(),
        figures(),
        story(picture),
        closing(),
        gallery(picture, 8),
      ];
  }
}

/** One fixture page's document, with exactly its stated number of blocks. */
export function speedPageDocument(
  which: SpeedFixturePage,
  media: readonly string[],
  cardId: string
): BlockDocument {
  const nodes = pageNodes(which, pictures(media), cardId);
  const count = blocksIn(nodes).length;
  if (count !== SPEED_FIXTURE_BLOCKS[which]) {
    throw new Error(
      `the ${which} speed page holds ${String(count)} blocks, not ${String(SPEED_FIXTURE_BLOCKS[which])}`
    );
  }
  return { formatVersion: 1, kind: "page", nodes };
}
