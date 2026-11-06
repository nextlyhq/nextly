/**
 * `find` takes a sort as one key, a comma string or an array, and an offset.
 * Evaluated by the checker, so a sort narrowed back to one string, or an
 * offset that disappeared, fails this file.
 */
import { expectTypeOf } from "vitest";

import type { FindArgs } from "./collections";

expectTypeOf<{ collection: "posts"; sort: "-createdAt" }>().toExtend<
  FindArgs<"posts">
>();
expectTypeOf<{ collection: "posts"; sort: string[] }>().toExtend<
  FindArgs<"posts">
>();
expectTypeOf<{ collection: "posts"; offset: number; limit: number }>().toExtend<
  FindArgs<"posts">
>();
expectTypeOf<FindArgs["sort"]>().toEqualTypeOf<string | string[] | undefined>();
