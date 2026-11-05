/**
 * `core/section` — a page region.
 *
 * A preset over the shared container: a landmark element, held to the site's
 * content width by default. It carries no capability `core/box` lacks.
 *
 * @module blocks/library/section
 */
import { type BlockDefinition, defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { LAYOUT } from "./categories";
import { libraryDefinition } from "./classic-spacing";
import {
  CONTAINER_CHILD_GAP,
  CONTAINER_SUPPORTS,
  containerContentModel,
  renderContainer,
} from "./container";
import type { ContainerProps } from "./container";
import { htmlTagProp } from "./html-tags";
import { sectionLooks } from "./looks";

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const section: BlockDefinition<ContainerProps, PageContext> =
  libraryDefinition(
    defineBlock({
      name: "core/section",
      version: 1,
      // What an author reads, in the Add panel and the block card: one plain
      // line. What the block does, for whoever maintains it: A page region.
      // Renders a landmark element, and opts into the site's content width once
      // the site stylesheet defines it.
      description: "A full-width band of the page.",
      // Palette metadata. The category is imported rather than spelled here so
      // nineteen blocks cannot drift into nineteen headings; keywords are what
      // let a search for a word the description never uses still find this.
      editor: {
        label: "Section",
        icon: "section",
        category: LAYOUT,
        keywords: ["container", "wrapper", "band", "region"],
        // Its looks, offered as tiles on a block already on the page.
        variations: sectionLooks(),
      },
      props: {
        as: htmlTagProp(["section", "header", "footer", "main"]),
        contained: { label: "Constrain content width", type: "checkbox" },
      },
      defaultProps: { as: "section", contained: true },
      example: { props: { as: "section", contained: true } },
      slots: {
        // Named children with no allow-list: a page region holds whatever a page
        // holds, so no starting block is more correct than none. A section that
        // arrives empty is not therefore an invisible one — the editor draws a box
        // for any container whose slot is empty, which covers every unrestricted
        // container rather than only the ones that thought to declare a default.
        children: {},
      },
      // A band pads itself: room above and below its content and a gutter beside
      // it, each a site token so a site retunes every section in one place. The
      // values grow with the viewport (see `space.section-y` and `space.gutter`).
      baseStyles: {
        base: {
          base: {
            padding: {
              blockStart: { $token: "space.section-y" },
              blockEnd: { $token: "space.section-y" },
              inlineStart: { $token: "space.gutter" },
              inlineEnd: { $token: "space.gutter" },
            },
          },
        },
      },
      childGap: CONTAINER_CHILD_GAP,
      supports: CONTAINER_SUPPORTS,
      // What it is as HTML follows the tag it renders.
      contentModel: containerContentModel,
      render: renderContainer,
    })
  );
