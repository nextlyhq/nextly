import type { ReactNode } from "react";
import { expectTypeOf } from "vitest";

import { blockSupports, defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import type {
  BlockEditorMeta,
  BlockExample,
  BlockSeoContribution,
  BlockSeoImage,
  BlockRenderArgs,
  BlockRenderContext,
  BlockRenderResult,
  BlockSupports,
  ComponentPath,
  BlockPart,
  NodeStyles,
  SlotLock,
  SlotSpec,
} from "@nextlyhq/plugin-sdk/blocks";

// Everything a definition asks an author to fill in is reachable from the SDK,
// so writing a block never means importing the engine directly.
expectTypeOf<SlotSpec>().toBeObject();
expectTypeOf<BlockExample<{ text: string }>>().toBeObject();
expectTypeOf<BlockEditorMeta<{ text: string }>>().toBeObject();
// A block's `seo` return type is vocabulary belonging to the definition, so an
// author factoring that logic into a helper must not have to reach past the SDK
// for the name of what it returns.
expectTypeOf<BlockSeoContribution>().toBeObject();
// The image contribution names its own type, and an author factoring candidate
// construction into a helper needs to spell it without reaching past the SDK.
expectTypeOf<BlockSeoImage>().not.toBeAny();
expectTypeOf<NodeStyles>().toBeObject();
// A block naming an element it renders declares it through this, so an author
// writing a reusable part declaration or a helper has to be able to NAME the
// type. Reaching it through the transitive engine package instead crosses the
// stable plugin boundary and does not resolve under a strict pnpm layout.
expectTypeOf<BlockPart>().toBeObject();
expectTypeOf<SlotLock>().toEqualTypeOf<
  "all" | "insert" | "contentOnly" | false
>();
expectTypeOf<ComponentPath>().toEqualTypeOf<string>();
// The engine's `BlockSupportValue` is deliberately NOT re-exported here. It is
// what the registry STORES from every source, so as authoring vocabulary it
// would undo this module's whole point: a shared setting typed with it accepts
// a flag name the per-key unions refuse. The checked spellings are these.
const perKey: BlockSupports["spacing"] = { padding: true };
void perKey;

// @ts-expect-error "paddding" is not a spacing flag, wherever the value is written.
const perKeyTypo: BlockSupports["spacing"] = { paddding: true };
void perKeyTypo;

// What `render` returns, as an author names it. The engine's own is `unknown`,
// because a runtime-free package cannot name React; re-exported, it could not
// type the very helper someone would reach for it to type.
expectTypeOf<BlockRenderResult>().toEqualTypeOf<
  ReactNode | Promise<ReactNode>
>();

// The point of naming it: a helper written against it satisfies the definition.
const helper = (args: BlockRenderArgs<{ text: string }>): BlockRenderResult =>
  args.props.text;
const viaHelper = defineBlock<{ text: string }>({
  name: "test/via-helper",
  version: 1,
  description: "Renders through a helper typed with the exported result type.",
  props: { text: { type: "text" } },
  example: { props: { text: "hi" } },
  render: helper,
});
void viaHelper;

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

// A support that declares no sub-flags takes the whole group or nothing. Given
// its flags to `Record`, the empty union would build `{}`, and `{}` accepts
// every object — so a nested typo under such a key would reach the registry at
// boot instead of stopping here.
// @ts-expect-error "layout" declares no sub-flags, so it takes no object.
const flaglessObject: BlockSupports = { layout: { typo: true } };
void flaglessObject;

// A key that does declare them still refuses one it does not.
// @ts-expect-error "paddding" is not a spacing flag.
const nestedTypo: BlockSupports = { spacing: { paddding: true } };
void nestedTypo;

// What a block places into its own JSX. A promise is not a legal child under
// either supported peer, so this stays exactly `ReactNode`: React 19 already
// counts a settled-node promise as one, and React 18 refuses async blocks
// outright, so widening it would only break every block that draws a slot.
expectTypeOf<
  BlockRenderArgs<{ text: string }>["renderSlot"]
>().returns.toEqualTypeOf<ReactNode>();

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

// `conditionalSlots` is reserved for core while the Block API freeze decides
// what a block author should write. It is withheld by NAMING it in the SDK's
// `Omit`, because an `@internal` tag removes nothing from a published type and
// that `Omit` inherits every property it does not name — the field was on this
// surface for a whole review round while a string search of this package
// reported it absent.
//
// So the reservation is asserted at the TYPE level, which is the only place it
// is true or false. Widening the `Omit` again would make this compile, and the
// suite would go green with the field quietly public.
defineBlock<{ text: string }>({
  name: "test/reserved-field",
  version: 1,
  description: "Cannot declare a field reserved for the core library.",
  props: { text: { type: "text" } },
  example: { props: { text: "hi" } },
  // @ts-expect-error `conditionalSlots` is not part of the authoring surface.
  conditionalSlots: ["children"],
  render: () => null,
});
