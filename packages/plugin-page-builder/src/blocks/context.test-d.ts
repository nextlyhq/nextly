import type { BlockRenderContext } from "@nextlyhq/plugin-sdk/blocks";
import { expectTypeOf } from "vitest";

import "./context-augmentation";
import type { PageContext } from "./context";

// The augmentation and the named shape describe the same thing, so an app
// writing `interface BlockRenderContext extends PageContext {}` gets exactly
// what blocks compiled here get. `locale` comes from the SDK's own base.
expectTypeOf<Exclude<keyof BlockRenderContext, "locale">>().toEqualTypeOf<
  keyof PageContext
>();
expectTypeOf<BlockRenderContext["data"]>().toEqualTypeOf<PageContext["data"]>();
expectTypeOf<BlockRenderContext["item"]>().toEqualTypeOf<PageContext["item"]>();
expectTypeOf<BlockRenderContext["queries"]>().toEqualTypeOf<
  PageContext["queries"]
>();
