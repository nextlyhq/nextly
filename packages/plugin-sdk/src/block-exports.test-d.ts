import { expectTypeOf } from "vitest";

import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import type {
  BlockEditorMeta,
  BlockExample,
  BlockRenderArgs,
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

// The context a block renders against is the renderer's to name, and a block
// that declares one gets it typed rather than as `unknown`.
interface TestContext {
  locale: string;
}
const contextual = defineBlock<{ text: string }, TestContext>({
  name: "test/contextual",
  version: 1,
  description: "Reads its locale from the render context.",
  props: { text: { type: "text" } },
  example: { props: { text: "hi" } },
  render: ({ props, ctx, className }) => {
    expectTypeOf(ctx).toEqualTypeOf<TestContext>();
    return `${className}:${ctx.locale}:${props.text}`;
  },
});
expectTypeOf<Parameters<typeof contextual.render>[0]>().toEqualTypeOf<
  BlockRenderArgs<{ text: string }, TestContext>
>();
void contextual;

// A block that declares no context still renders; `ctx` is simply unknown.
const plain = defineBlock<{ text: string }>({
  name: "test/plain",
  version: 1,
  description: "Needs nothing from the renderer.",
  props: { text: { type: "text" } },
  example: { props: { text: "hi" } },
  render: ({ props }) => props.text,
});
expectTypeOf<Parameters<typeof plain.render>[0]>().toHaveProperty("ctx");
void plain;
