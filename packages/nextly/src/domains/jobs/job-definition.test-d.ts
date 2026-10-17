import type { JobInput } from "../../direct-api/types/jobs";
import type { PluginContributions } from "../../plugins/contributions";
import type { NextlyConfig } from "../../shared/types/config";

import {
  type AnyJobDefinition,
  defineJob,
  type JobDefinition,
} from "./job-registry";

// A job declared for a specific input must go into the config's `jobs` list,
// and a plugin's `contributes.jobs`, as it is. Both hold jobs of unrelated
// input shapes as `AnyJobDefinition`; a job whose handler takes `{ cursor }`
// has to fit without a cast, something that is not a job must still be
// refused, and the handler of an entry must not be callable with an input
// someone made up.
//
// In a `.test-d.ts` because tsconfig excludes `.test.ts`: `pnpm check-types`
// compiles this file, and the runner would transpile its types away.

/** Whether `T` is `any`, which a plain two-way assignability check lets through. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * `Exact<A, B>` is `false` when the two types differ in either direction, and
 * when only one of them is `any`: `any` is assignable both ways to anything,
 * so without that guard a type that degraded to `any` would read as exact.
 */
type Exact<A, B> =
  IsAny<A> extends true
    ? IsAny<B>
    : IsAny<B> extends true
      ? false
      : [A] extends [B]
        ? [B] extends [A]
          ? true
          : false
        : false;

declare function assertType<T extends true>(proof: T): void;

/** Whether `T` fits one entry of `Slot`. */
type Fits<Slot, T> = [T] extends [Slot] ? true : false;

/**
 * What each list of jobs makes of `T`: the config's `jobs`, then a plugin's
 * `contributes.jobs`. Asked of both at once, so one assertion covers both.
 */
type Verdicts<T> = [
  Fits<NonNullable<NextlyConfig["jobs"]>[number], T>,
  Fits<NonNullable<PluginContributions["jobs"]>[number], T>,
];

const typedJob = defineJob<{ cursor: string }>({
  slug: "acme:export",
  // Underscore-prefixed: read only as a type, which lint calls unused.
  handler: _input => {
    // The handler still sees its own input type.
    assertType<Exact<typeof _input, { cursor: string }>>(true);
    return Promise.resolve();
  },
});

// Through real literals, which is how an application and a plugin write them.
export const _config: NextlyConfig = { jobs: [typedJob] };
export const _contributes: PluginContributions = { jobs: [typedJob] };

assertType<Exact<Verdicts<typeof typedJob>, [true, true]>>(true);
assertType<Exact<Verdicts<JobDefinition>, [true, true]>>(true);

// Not jobs: a bare slug, a function, and a job-shaped object with no handler.
assertType<Exact<Verdicts<{ slug: string }>, [false, false]>>(true);
assertType<Exact<Verdicts<() => Promise<void>>, [false, false]>>(true);
assertType<
  Exact<
    Verdicts<{ slug: string; retry: { maxAttempts: number }; sweep: boolean }>,
    [false, false]
  >
>(true);

// The handler stays contravariant on `JobDefinition`: a typed job is not a
// default `JobDefinition`, whose handler takes any job input, so it cannot be
// widened to one and then handed `null`. Only a list's entry type compares
// its handler bivariantly, which is what lets typed and inline jobs share one.
assertType<
  Exact<[typeof typedJob] extends [JobDefinition] ? true : false, false>
>(true);
assertType<Exact<Parameters<AnyJobDefinition["handler"]>[0], JobInput>>(true);

// A job written inline, as the object `defineJob` returns rather than through
// it, keeps its handler's input typed as any job input, as it was before
// typed jobs fit the lists. Underscore-prefixed: read only as a type.
export const _inline: NextlyConfig = {
  jobs: [
    {
      slug: "acme:inline",
      retry: { maxAttempts: 1 },
      sweep: false,
      handler: _input => {
        assertType<Exact<typeof _input, JobInput>>(true);
        return Promise.resolve();
      },
    },
  ],
};
export const _inlineContributed: PluginContributions = {
  jobs: [
    {
      slug: "acme:inline",
      retry: { maxAttempts: 1 },
      sweep: false,
      handler: _input => {
        assertType<Exact<typeof _input, JobInput>>(true);
        return Promise.resolve();
      },
    },
  ],
};
