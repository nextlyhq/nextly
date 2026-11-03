/**
 * The published `PublicReader` keeps its two reads, asserted by the CHECKER:
 * a reader written against them, a provider's or a test's, still is one,
 * and the Single's read is on the extended interface the factory returns.
 */
import { expectTypeOf } from "vitest";

import type {
  createPublicReader,
  PublicReader,
  PublicSourceReader,
} from "./public-reader";

/** A reader with the two reads `PublicReader` has always had, and no more. */
interface TwoReads {
  find: PublicReader["find"];
  count: PublicReader["count"];
}

expectTypeOf<TwoReads>().toExtend<PublicReader>();
expectTypeOf<PublicSourceReader>().toExtend<PublicReader>();
expectTypeOf<
  ReturnType<typeof createPublicReader>
>().toEqualTypeOf<PublicSourceReader>();
