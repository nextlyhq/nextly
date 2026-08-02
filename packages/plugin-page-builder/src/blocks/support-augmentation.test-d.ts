import type { BlockSupports } from "@nextlyhq/plugin-sdk/blocks";

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
  }
}

const augmented: BlockSupports = { testOnlyAnimation: true, spacing: true };
void augmented;

// @ts-expect-error a key nobody declared is still refused.
const stillClosed: BlockSupports = { testOnlyAnimtion: true };
void stillClosed;
