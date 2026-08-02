import type { BlockSupportKeys } from "@nextlyhq/plugin-sdk/blocks";

/**
 * Every key the authoring type accepts, as a value.
 *
 * It lives in a `.test-d.ts` rather than beside the runtime test that reads it
 * because the package's `tsconfig.json` excludes `**\/*.test.ts` from the
 * project. A `Record<keyof BlockSupportKeys, true>` written there would never be
 * checked by anything: Vitest only transpiles, so the exhaustiveness that makes
 * this a guard rather than a hand-maintained list would quietly not exist.
 *
 * Exhaustive by construction. A key added to the interface and not added here
 * fails to compile, and a key here that the interface does not declare fails
 * the same way.
 */
export const AUTHORING_KEYS: Record<keyof BlockSupportKeys, true> = {
  spacing: true,
  layout: true,
  dimensions: true,
  typography: true,
  color: true,
  background: true,
  border: true,
  shadow: true,
  effects: true,
  position: true,
  container: true,
  customCss: true,
};
