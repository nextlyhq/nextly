/**
 * `core/section` — a page region.
 *
 * A preset over the shared container: a landmark element, held to the site's
 * content width by default. It carries no capability `core/box` lacks.
 *
 * @module blocks/library/section
 */
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";

import { renderContainer } from "./container";
import type { ContainerProps } from "./container";

export const section = defineBlock<ContainerProps>({
  name: "core/section",
  version: 1,
  description:
    "A page region. Renders a landmark element and holds its content to the site's content width.",
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
  supports: {
    spacing: true,
    layout: true,
    dimensions: true,
    background: true,
    border: true,
    effects: true,
    position: true,
    container: true,
  },
  render: renderContainer,
});
