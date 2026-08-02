import type { BlockSupports } from "@nextlyhq/plugin-sdk/blocks";
import { expectTypeOf } from "vitest";

/**
 * A plugin adds its own support key to the vocabulary the compiler checks.
 *
 * Proved from here rather than from inside the SDK, and the location is the
 * point: this package consumes the SDK the way a plugin does, naming it by the
 * specifier a plugin would use. An augmentation has to name a module that
 * resolves from the file doing the augmenting, and that is exactly what fails
 * when the target lives in a package the plugin only has transitively.
 *
 * Type-only. Nothing calls `registerSupport("testOnlyAnimation")`, so the
 * runtime vocabulary is untouched.
 */
declare module "@nextlyhq/plugin-sdk/blocks" {
  interface BlockSupportKeys {
    testOnlyAnimation: true;
    testOnlyTransition: "enter" | "exit";
  }
}

const augmented: BlockSupports = { testOnlyAnimation: true, spacing: true };
void augmented;

// Both spellings of "no sub-flags" are read the same way, and neither is handed
// to `Record`: a support key is not a property key, so a plugin declaring one
// would otherwise fail to build on the declaration rather than on its own code.
declare module "@nextlyhq/plugin-sdk/blocks" {
  interface BlockSupportKeys {
    testOnlyParallax: never;
  }
}
const flagless: BlockSupports = { testOnlyParallax: true };
void flagless;

// A declared flag set is checked like a built-in one's.
const withFlags: BlockSupports = { testOnlyTransition: { enter: true } };
void withFlags;

// @ts-expect-error "exti" is not a flag this support declares.
const flagTypo: BlockSupports = { testOnlyTransition: { exti: true } };
void flagTypo;

// @ts-expect-error a key nobody declared is still refused.
const stillClosed: BlockSupports = { testOnlyAnimtion: true };
void stillClosed;

// Both flagless spellings have to RESOLVE, not merely be accepted. Handing
// either to `Record` breaks its key constraint, and a consumer only sees that
// as an error with `skipLibCheck` off, since the offending instantiation sits
// in the SDK's built declarations rather than in anything the plugin wrote.
// Naming the resolved type catches it from here, where `skipLibCheck` is on.
expectTypeOf<
  Required<BlockSupports>["testOnlyAnimation"]
>().toEqualTypeOf<boolean>();
expectTypeOf<
  Required<BlockSupports>["testOnlyParallax"]
>().toEqualTypeOf<boolean>();
