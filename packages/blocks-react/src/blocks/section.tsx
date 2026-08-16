/**
 * `core/section` — a page region.
 *
 * A preset over the shared container: a landmark element, held to the site's
 * content width by default. It carries no capability `core/box` lacks.
 *
 * @module blocks/library/section
 */
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { CONTAINER_SUPPORTS, renderContainer } from "./container";
import type { ContainerProps } from "./container";

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const section = defineBlock<ContainerProps, PageContext>({
  name: "core/section",
  version: 1,
  description:
    "A page region. Renders a landmark element, and opts into the site's content width once the site stylesheet defines it.",
  props: {
    as: { type: "select", options: ["section", "header", "footer", "main"] },
    contained: { type: "checkbox" },
  },
  defaultProps: { as: "section", contained: true },
  example: { props: { as: "section", contained: true } },
  slots: {
    // Named children with no allow-list: a page region holds whatever a page
    // holds. Plasmic's guidance is to always give a slot default contents, so
    // an empty section is never an invisible one.
    children: { template: [] },
  },
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
