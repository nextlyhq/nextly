import type { BlockSupportKeys } from "@nextlyhq/plugin-sdk/blocks";

/**
 * Every key the authoring type accepts, with the sub-flags it recognises.
 *
 * It lives in a `.test-d.ts` rather than beside the runtime test that reads it
 * because the package's `tsconfig.json` excludes `**\/*.test.ts` from the
 * project. Written there it would never be checked by anything: Vitest only
 * transpiles, so the exhaustiveness that makes this a guard rather than a
 * hand-maintained list would quietly not exist.
 *
 * Exhaustive by construction in both directions. A key added to the interface
 * and not added here fails to compile; so does a flag named here that the
 * interface does not declare for that key.
 */
export const AUTHORING_SUPPORTS: {
  [K in keyof BlockSupportKeys]: BlockSupportKeys[K][];
} = {
  spacing: ["margin", "padding"],
  layout: [],
  dimensions: [],
  typography: [],
  color: ["text", "link"],
  background: ["color", "image", "gradient"],
  border: ["line", "radius"],
  shadow: [],
  effects: [],
  position: [],
  container: [],
  list: [],
  customCss: [],
};
