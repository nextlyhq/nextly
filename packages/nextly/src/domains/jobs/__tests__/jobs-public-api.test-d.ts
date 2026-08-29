/**
 * The public jobs API, checked at the type level.
 *
 * `nextly.jobs.queue` promises that `input` is inferred FROM the task slug. A
 * runtime test cannot see that promise at all — a wrong input shape is a
 * compile error or it is nothing — so the guarantee lives or dies here.
 *
 * Augmentation is done locally in this file rather than globally, so the
 * unaugmented fallbacks stay observable in the same run: a project with no
 * declared jobs must still be able to call `queue`, and asserting only the
 * augmented case would let a change that broke the fallback pass.
 */

import { expectTypeOf } from "vitest";

import type {
  JobInput,
  JobInputFor,
  JobSlug,
  QueueJobArgs,
  QueueJobResult,
} from "../../../direct-api/types/jobs";
import { defineJob } from "../job-registry";

// ---------------------------------------------------------------------------
// Unaugmented: a project that has declared no job types can still queue.
// ---------------------------------------------------------------------------

// Without a `jobs` key on GeneratedTypes the slug is any string, the same
// fallback CollectionSlug takes. A union here would make the API unusable
// before codegen or augmentation exists.
expectTypeOf<JobSlug>().toEqualTypeOf<string>();

// The input is an OBJECT or null — not `unknown`, and not `never`.
//
// `never` would refuse every call. `unknown` accepted values the storage cannot
// hold: `nextly_jobs.input` is a JSON column, so a `Date` returns as a string, a
// `Map` as `{}`, and a bare string that happens to be valid JSON text — "123",
// "true", "{}" — is PARSED by the adapter and delivered as a number, boolean or
// object while the handler stays typed `string`. An object-or-null input makes
// all of that unrepresentable rather than caught later.
expectTypeOf<JobInputFor<"anything">>().toEqualTypeOf<JobInput>();

// Concretely: an object is fine, and the values that do not survive the round
// trip are refused where they are written.
expectTypeOf<{ userId: string }>().toMatchTypeOf<JobInput>();
expectTypeOf<null>().toMatchTypeOf<JobInput>();
expectTypeOf<Date>().not.toMatchTypeOf<JobInput>();
expectTypeOf<string>().not.toMatchTypeOf<JobInput>();
expectTypeOf<Map<string, string>>().not.toMatchTypeOf<JobInput>();

// ---------------------------------------------------------------------------
// The argument shape the design fixed.
// ---------------------------------------------------------------------------

expectTypeOf<QueueJobArgs>().toMatchTypeOf<{
  task: string;
  input: JobInput;
}>();

// `runAt`, NOT Payload's `waitUntil`: the field names a START time, and
// `waitUntil` reads as a deadline. Asserted so the divergence is deliberate
// rather than something a later edit can quietly undo.
expectTypeOf<QueueJobArgs["runAt"]>().toEqualTypeOf<Date | null | undefined>();
expectTypeOf<QueueJobArgs>().not.toMatchTypeOf<{ waitUntil: unknown }>();

// Queueing answers with the row's id and whether an equal dedupe key already
// held one — the caller cannot otherwise tell "queued" from "already queued".
expectTypeOf<QueueJobResult>().toEqualTypeOf<{
  id: string;
  deduped: boolean;
}>();

// ---------------------------------------------------------------------------
// `defineJob` infers its handler's input from the type argument.
// ---------------------------------------------------------------------------

const emailJob = defineJob<{ userId: string }>({
  slug: "email:welcome",
  handler: async input => {
    expectTypeOf(input).toEqualTypeOf<{ userId: string }>();
  },
});

expectTypeOf(emailJob.slug).toEqualTypeOf<string>();
expectTypeOf(emailJob.sweep).toEqualTypeOf<boolean>();
