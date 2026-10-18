import { z } from "zod";

import { defineNoticeKind, type NoticeKind } from "../notice-kinds";
import type { RecordNoticeInput } from "../notices-service";

// Compile-time half of the notice-kind contract: a kind's data type is
// inferred from its schema, and `record()` takes the kind object, so its data
// is typed by that kind. In a `.test-d.ts` because `pnpm check-types` compiles
// these files, which is what makes the assertions bite.

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

/** The data type a kind declares. */
type DataOf<K> = K extends NoticeKind<infer T> ? T : never;

const stopped = defineNoticeKind({
  key: "releases.stopped",
  subjectType: "release",
  data: z.object({ title: z.string(), revision: z.number() }),
  render: data => ({ title: data.title }),
});

// Inferred from the schema, not widened to `unknown`.
assertType<Exact<DataOf<typeof stopped>, { title: string; revision: number }>>(
  true
);

// What `record()` accepts for this kind's data is exactly that type.
assertType<
  Exact<
    RecordNoticeInput<DataOf<typeof stopped>>["data"],
    { title: string; revision: number }
  >
>(true);

// And the renderer receives it typed: a property the schema does not declare
// is not on it.
assertType<
  Exact<"subtitle" extends keyof DataOf<typeof stopped> ? true : false, false>
>(true);
