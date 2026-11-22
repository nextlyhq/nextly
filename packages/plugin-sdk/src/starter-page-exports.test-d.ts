/**
 * The starter page contract, as a site or a plugin writes a starter against
 * it. Type-level claims only: the page builder's boot check tests what is
 * refused at run time. What is held here is that a starter written from this
 * subpath alone type-checks, that it needs a name, a short description and
 * its blocks, and that `defineStarterPage` hands it back unchanged.
 */
import { expectTypeOf } from "vitest";

import {
  defineStarterPage,
  type BlockNode,
  type StarterPageDefinition,
} from "@nextlyhq/plugin-sdk/blocks";

// A starter written against the subpath alone, styled with a site variable.
const heading: BlockNode = {
  id: "title",
  type: "core/heading",
  version: 1,
  props: { text: "Welcome", level: "h1" },
  styles: { base: { base: { color: { $token: "color.primary" } } } },
};

const landing = defineStarterPage({
  id: "landing",
  label: "Landing",
  description: "A heading, a short welcome and a button.",
  blocks: [heading],
});

expectTypeOf(landing).toEqualTypeOf<StarterPageDefinition>();
expectTypeOf<StarterPageDefinition["blocks"]>().toEqualTypeOf<
  readonly BlockNode[]
>();

// A name, a short description and the blocks are each required.
// @ts-expect-error A starter with no description is not one.
const undescribed: StarterPageDefinition = {
  id: "about",
  label: "About",
  blocks: [],
};
void undescribed;

const wholeDocument: StarterPageDefinition = {
  id: "about",
  label: "About",
  description: "Who we are.",
  // @ts-expect-error A starter's blocks are blocks, not a whole document.
  blocks: { formatVersion: 1, kind: "page", nodes: [] },
};
void wholeDocument;
