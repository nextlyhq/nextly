/**
 * Every block the core library ships, on one page, at its DEFAULTS.
 *
 * ## What it is for
 *
 * The block library is otherwise only visible by authoring a page by hand in the
 * admin, which stores it in one contributor's database and loses it on a reset.
 * This document is version-controlled, so the whole library can be looked at on a
 * fresh checkout and the same page can be compared between two revisions.
 *
 * ## Defaults ONLY
 *
 * No node carries `styles`. A block library is judged by what an author gets
 * before styling anything, and a default that stops one property short — a
 * container that lays out a grid and leaves the gutter at zero, a control with a
 * border and no space behind it — is only visible undressed. Styling this page
 * would hide precisely what it exists to show, so a node that looks wrong here is
 * reporting something about the block rather than about the fixture.
 *
 * ## Where the values come from
 *
 * Prop values are each block's own `example`, which its definition declares and
 * the inserter shows an author, so this page and the palette cannot disagree
 * about what a working block looks like.
 *
 * ## What the type does and does not check
 *
 * `BlockDocument` checks the SHAPE — that a node carries an id, a type, a version
 * and props, and that slots hold nodes. It does not check the type NAME:
 * `BlockNode.type` is `string` and `props` is `Record<string, unknown>`, so a
 * misspelled block or a prop the block never declares compiles cleanly and renders
 * a placeholder or nothing at all.
 *
 * `kitchen-sink.test.ts` is what checks those, and it is the reason this file can
 * be trusted: it resolves every node type against `coreBlocks`, requires every
 * registered block to appear, and holds the nesting rules the engine enforces.
 *
 * @module seed/kitchen-sink
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";

/** The slug this page is served at: `/blocks/kitchen-sink`. */
export const KITCHEN_SINK_SLUG = "kitchen-sink";

export const KITCHEN_SINK_TITLE = "Every block, at its defaults";

/**
 * A local asset rather than a remote one.
 *
 * The engine refuses a fetch the host has not allowed, so a fixture pointing at
 * an external image would render nothing on a site with the default policy and
 * read as a broken `core/image` rather than as a refused URL.
 */
const LOCAL_IMAGE = "/next.svg";

export const KITCHEN_SINK_DOCUMENT: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    // ---- The page's own title, and what it is for ----------------------------
    {
      id: "ks-intro",
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true },
      slots: {
        children: [
          {
            id: "ks-intro-heading",
            type: "core/heading",
            version: 1,
            // The SAME string the row is stored under. The route derives page
            // metadata from the first heading in preference to the stored
            // title, so two spellings would disagree across the admin, the tab
            // and the document with nothing reporting it.
            props: { text: KITCHEN_SINK_TITLE, level: "h1" },
          },
          {
            id: "ks-intro-text",
            type: "core/text",
            version: 1,
            props: {
              text: "Nothing on this page carries authored styles. It shows what the block library gives an author before they change anything, which is the only view in which a block that stopped one property short of finishing looks wrong.",
            },
          },
        ],
      },
    },
    { id: "ks-rule-1", type: "core/divider", version: 1, props: {} },

    // ---- Layout: the containers, and the two blocks that need a parent -------
    {
      id: "ks-layout",
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true },
      slots: {
        children: [
          {
            id: "ks-layout-heading",
            type: "core/heading",
            version: 1,
            props: { text: "Layout", level: "h2" },
          },
          // A row and its columns. `core/column` names `core/columns` as its
          // only parent, so this is the only arrangement in which it is legal.
          {
            id: "ks-row",
            type: "core/columns",
            version: 1,
            props: { as: "div" },
            slots: {
              children: [
                {
                  id: "ks-col-1",
                  type: "core/column",
                  version: 1,
                  props: { as: "div" },
                  slots: {
                    children: [
                      {
                        id: "ks-col-1-h",
                        type: "core/heading",
                        version: 1,
                        props: { text: "One", level: "h3" },
                      },
                      {
                        id: "ks-col-1-t",
                        type: "core/text",
                        version: 1,
                        props: {
                          text: "Two columns sit side by side with a gutter between them.",
                        },
                      },
                    ],
                  },
                },
                {
                  id: "ks-col-2",
                  type: "core/column",
                  version: 1,
                  props: { as: "div" },
                  slots: {
                    children: [
                      {
                        id: "ks-col-2-h",
                        type: "core/heading",
                        version: 1,
                        props: { text: "Two", level: "h3" },
                      },
                      {
                        id: "ks-col-2-t",
                        type: "core/text",
                        version: 1,
                        props: {
                          text: "A row of one would be a box, so a row starts with two.",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          // A card holding an image at its top edge — the composition the clip
          // exists for, and the one a default padding on the card would break.
          {
            id: "ks-card",
            type: "core/card",
            version: 1,
            props: { as: "div" },
            slots: {
              children: [
                {
                  id: "ks-card-image",
                  type: "core/image",
                  version: 1,
                  props: { src: LOCAL_IMAGE, alt: "A full-bleed card image" },
                },
                {
                  id: "ks-card-text",
                  type: "core/text",
                  version: 1,
                  props: {
                    text: "An image at a card's top edge follows the rounded corner instead of overhanging it.",
                  },
                },
              ],
            },
          },
          {
            id: "ks-box",
            type: "core/box",
            version: 1,
            props: { as: "div" },
            slots: {
              children: [
                {
                  id: "ks-box-text",
                  type: "core/text",
                  version: 1,
                  props: {
                    text: "A box is the plain container everything else is a preset over.",
                  },
                },
              ],
            },
          },
          { id: "ks-spacer", type: "core/spacer", version: 1, props: {} },
        ],
      },
    },

    // ---- Content: the blocks that carry words and pictures -------------------
    {
      id: "ks-content",
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true },
      slots: {
        children: [
          {
            id: "ks-content-heading",
            type: "core/heading",
            version: 1,
            props: { text: "Content", level: "h2" },
          },
          {
            id: "ks-rich",
            type: "core/rich-text",
            version: 1,
            props: {
              content: {
                root: {
                  type: "root",
                  children: [
                    {
                      type: "paragraph",
                      children: [
                        {
                          type: "text",
                          text: "A passage of formatted text, stored as a tree rather than as markup.",
                          format: 0,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
          {
            id: "ks-list",
            type: "core/list",
            version: 1,
            props: {
              kind: "unordered",
              items: [
                "A list renders its items in order",
                "Ordered and unordered are one block",
                "The marker is the browser's own",
              ],
            },
          },
          {
            id: "ks-quote",
            type: "core/quote",
            version: 1,
            props: {
              text: "Simplicity is the soul of efficiency.",
              attribution: "Austin Freeman",
            },
          },
          {
            id: "ks-image",
            type: "core/image",
            version: 1,
            props: {
              src: LOCAL_IMAGE,
              alt: "A standalone image",
              caption: "An image can carry a caption.",
            },
          },
          // A gallery admits only images, which is the asymmetry it documents:
          // `core/image` declares no parent, so an image is placeable anywhere.
          {
            id: "ks-gallery",
            type: "core/gallery",
            version: 1,
            props: { as: "div" },
            slots: {
              children: [
                {
                  id: "ks-gallery-1",
                  type: "core/image",
                  version: 1,
                  props: { src: LOCAL_IMAGE, alt: "First tile" },
                },
                {
                  id: "ks-gallery-2",
                  type: "core/image",
                  version: 1,
                  props: { src: LOCAL_IMAGE, alt: "Second tile" },
                },
                {
                  id: "ks-gallery-3",
                  type: "core/image",
                  version: 1,
                  props: { src: LOCAL_IMAGE, alt: "Third tile" },
                },
              ],
            },
          },
        ],
      },
    },

    // ---- Interactive: the blocks a visitor operates --------------------------
    {
      id: "ks-interactive",
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true },
      slots: {
        children: [
          {
            id: "ks-interactive-heading",
            type: "core/heading",
            version: 1,
            props: { text: "Interactive", level: "h2" },
          },
          {
            id: "ks-accordion",
            type: "core/accordion",
            version: 1,
            props: { as: "div" },
            slots: {
              children: [
                {
                  id: "ks-acc-1",
                  type: "core/accordion-item",
                  version: 1,
                  props: { title: "What is included?", open: false },
                  slots: {
                    children: [
                      {
                        id: "ks-acc-1-t",
                        type: "core/text",
                        version: 1,
                        props: {
                          text: "A section only the accordion may hold, so it cannot be dropped between two others.",
                        },
                      },
                    ],
                  },
                },
                {
                  id: "ks-acc-2",
                  type: "core/accordion-item",
                  version: 1,
                  props: { title: "Can one start open?", open: true },
                  slots: {
                    children: [
                      {
                        id: "ks-acc-2-t",
                        type: "core/text",
                        version: 1,
                        props: {
                          text: "This one does, which is what `open` states.",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            id: "ks-button",
            type: "core/button",
            version: 1,
            props: { label: "Get started", href: "/signup" },
          },
          // A form is here for its controls. A host CSS reset takes away the
          // border and background a user agent draws on an input, and a control
          // with neither, on a page of the same colour, is present, focusable,
          // submittable and invisible.
          {
            id: "ks-form",
            type: "core/form",
            version: 1,
            props: {
              method: "post",
              submitText: "Send",
              fields: [
                { label: "Name", name: "name", type: "text", required: true },
                {
                  label: "Email",
                  name: "email",
                  type: "email",
                  required: true,
                },
                { label: "Message", name: "message", type: "textarea" },
              ],
            },
          },
          {
            id: "ks-embed",
            type: "core/embed",
            version: 1,
            props: {
              src: "https://example.com/player",
              title: "A product demo",
            },
          },
        ],
      },
    },

    // ---- From the database: the one block that reads content -----------------
    {
      id: "ks-loop-section",
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true },
      slots: {
        children: [
          {
            id: "ks-loop-heading",
            type: "core/heading",
            version: 1,
            props: { text: "From the database", level: "h2" },
          },
          // The seeded `posts` collection, which the same seed run creates — so
          // this draws real rows rather than an empty state that would read as a
          // broken block.
          {
            id: "ks-loop",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", limit: 3 },
            slots: {
              children: [
                {
                  id: "ks-loop-item",
                  type: "core/text",
                  version: 1,
                  props: { text: "One entry from the collection." },
                },
              ],
            },
          },
        ],
      },
    },
  ],
};
