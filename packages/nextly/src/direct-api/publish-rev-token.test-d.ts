import type { PublishArgs } from "./types/collections";

// A publish names the version it is made from as a read returned it: the
// `_rev` token is a string ("7", or "7.es:3" from a read of Spanish), so a
// caller passes back what it read without a cast.
//
// In a `.test-d.ts` because tsconfig excludes `.test.ts`: `pnpm check-types`
// compiles this file.

const fromSpanishRead: PublishArgs = {
  collection: "posts",
  id: "post-1",
  locales: ["es"],
  data: { _rev: "7.es:3" },
};
const fromPlainRead: PublishArgs = {
  collection: "posts",
  id: "post-1",
  locales: "all",
  data: { _rev: "7" },
};

export const publishesFromReads = [fromSpanishRead, fromPlainRead];
