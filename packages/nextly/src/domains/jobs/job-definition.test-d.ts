import type { NextlyConfig } from "../../shared/types/config";

import { defineJob, type JobDefinition } from "./job-registry";

// A job declared for a specific input must go into the config's `jobs` list
// as it is. `jobs` holds jobs of unrelated input shapes, so its element type
// is the default `JobDefinition`; a job whose handler takes `{ cursor }` has
// to be assignable to it without a cast, while something that is not a job
// at all must still be refused.
//
// In a `.test-d.ts` because tsconfig excludes `.test.ts`: `pnpm check-types`
// compiles this file, and the runner would transpile its types away.

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

/** Whether `T` fits one entry of the config's `jobs` list. */
type FitsJobs<T> = [T] extends [NonNullable<NextlyConfig["jobs"]>[number]]
  ? true
  : false;

const typedJob = defineJob<{ cursor: string }>({
  slug: "acme:export",
  // Underscore-prefixed: read only as a type, which lint calls unused.
  handler: _input => {
    // The handler still sees its own input type.
    assertType<Exact<typeof _input, { cursor: string }>>(true);
    return Promise.resolve();
  },
});

// Through a real config literal, which is how an application writes it.
export const _config: NextlyConfig = { jobs: [typedJob] };

assertType<FitsJobs<typeof typedJob>>(true);
assertType<FitsJobs<JobDefinition>>(true);

// Not jobs: a bare slug, a function, and a job-shaped object with no handler.
assertType<Exact<FitsJobs<{ slug: string }>, false>>(true);
assertType<Exact<FitsJobs<() => Promise<void>>, false>>(true);
assertType<
  Exact<
    FitsJobs<{ slug: string; retry: { maxAttempts: number }; sweep: boolean }>,
    false
  >
>(true);
