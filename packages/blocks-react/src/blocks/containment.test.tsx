/**
 * Every container that shares the Section's rendering is contained the same
 * way: the content-width class on its own element and nothing around it.
 *
 * The site sheet pads a contained element's content in to the content width
 * and leaves the element itself full width, so its background reaches the
 * edges. That only works while the class sits on the one element the block
 * draws, with the block's children directly inside it: a wrapper would add a
 * node to every flow, flex and grid layout, and the padding would land on the
 * wrong box.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockDefinition } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { accordion } from "./accordion";
import { box } from "./box";
import { card } from "./card";
import { column } from "./column";
import { columns } from "./columns";
import { CONTENT_WIDTH_CLASS } from "./container";
import type { ContainerProps } from "./container";
import { gallery } from "./gallery";
import { section } from "./section";

const CONTAINERS = [
  section,
  box,
  columns,
  column,
  card,
  accordion,
  gallery,
].map(
  definition =>
    [
      definition.name,
      definition as unknown as BlockDefinition<ContainerProps, PageContext>,
    ] as const
);

function drawn(
  definition: BlockDefinition<ContainerProps, PageContext>,
  contained: boolean
): string {
  return renderToStaticMarkup(
    definition.render({
      props: { ...definition.defaultProps, contained },
      node: { id: "n1", type: definition.name, version: 1, props: {} },
      className: "nx-n1",
      partClass: () => "",
      ctx: {} as PageContext,
      renderSlot: () => <span>child</span>,
    })
  );
}

describe("a contained container", () => {
  it.each(CONTAINERS)(
    "%s carries the class on its own element, with its children directly inside",
    (_, definition) => {
      const html = drawn(definition, true);
      expect(html).toMatch(
        new RegExp(
          `^<([a-z]+) class="nx-n1 ${CONTENT_WIDTH_CLASS}"><span>child</span></\\1>$`
        )
      );
    }
  );

  it.each(CONTAINERS)(
    "%s carries no class when it is not contained",
    (_, definition) => {
      const html = drawn(definition, false);
      expect(html).not.toContain(CONTENT_WIDTH_CLASS);
      expect(html).toMatch(
        /^<([a-z]+) class="nx-n1"><span>child<\/span><\/\1>$/
      );
    }
  );
});
