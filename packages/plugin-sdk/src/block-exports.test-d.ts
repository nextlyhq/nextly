import { expectTypeOf } from "vitest";

import { blockSupports, defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import type {
  BlockEditorMeta,
  BlockExample,
  BlockRenderArgs,
  BlockRenderContext,
  BlockSupports,
  BlockSupportValue,
  ComponentPath,
  NodeStyles,
  SlotLock,
  SlotSpec,
} from "@nextlyhq/plugin-sdk/blocks";

// Everything a definition asks an author to fill in is reachable from the SDK,
// so writing a block never means importing the engine directly.
expectTypeOf<SlotSpec>().toBeObject();
expectTypeOf<BlockExample<{ text: string }>>().toBeObject();
expectTypeOf<BlockEditorMeta<{ text: string }>>().toBeObject();
expectTypeOf<NodeStyles>().toBeObject();
expectTypeOf<SlotLock>().toEqualTypeOf<
  "all" | "insert" | "contentOnly" | false
>();
expectTypeOf<ComponentPath>().toEqualTypeOf<string>();
expectTypeOf<BlockSupportValue>().toEqualTypeOf<
  boolean | Record<string, boolean>
>();

// A support key is checked while it is being written rather than at boot, and
// the vocabulary covers the capabilities that have no style group of their own.
const goodSupports: BlockSupports = {
  spacing: true,
  border: { radius: true },
  customCss: true,
};
expectTypeOf(goodSupports).toMatchTypeOf<BlockSupports>();

// @ts-expect-error "spaceing" is not a support key.
const typo: BlockSupports = { spaceing: true };
void typo;

// Augmenting the interface is proved from a package that CONSUMES this one, in
// `plugin-page-builder`. Doing it here would widen the type for this package's
// own exhaustiveness guard, which is the thing that keeps the vocabulary from
// drifting away from the registry.

// The context is the app's, not the block's: an author writes no type and reads
// what this app's renderer provides.
const contextual = defineBlock<{ text: string }>({
  name: "test/contextual",
  version: 1,
  description: "Reads its locale from the render context.",
  props: { text: { type: "text" } },
  example: { props: { text: "hi" } },
  render: ({ props, ctx, className }) => {
    expectTypeOf(ctx).toEqualTypeOf<BlockRenderContext>();
    return `${className}:${String(ctx.locale)}:${props.text}`;
  },
});
expectTypeOf<Parameters<typeof contextual.render>[0]>().toEqualTypeOf<
  BlockRenderArgs<{ text: string }>
>();
void contextual;

// A slot is drawn rather than received, and what it returns is React, so a
// block places it with no assertion.
const container = defineBlock<{ text: string }>({
  name: "test/container",
  version: 1,
  description: "Draws its children.",
  props: { text: { type: "text" } },
  example: { props: { text: "hi" } },
  render: ({ renderSlot }) => renderSlot("children"),
});
void container;

// Settings shared between blocks keep their check. Assigned to a plain variable
// first, a typo would survive, because TypeScript checks for unknown keys only
// where the literal is written.
const layoutSupports = blockSupports({ spacing: true, layout: true });
expectTypeOf(layoutSupports).toMatchTypeOf<BlockSupports>();

// @ts-expect-error "spaceing" is not a support key.
blockSupports({ spacing: true, spaceing: true });

// The same check without the helper, for an author who prefers it.
const viaSatisfies = { spacing: true } satisfies BlockSupports;
void viaSatisfies;
