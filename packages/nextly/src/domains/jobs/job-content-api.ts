/**
 * The Direct API, bound to the identity a job resolved.
 *
 * ## The hole this closes
 *
 * `resolveRunAs` establishes who a job runs as and fails closed when it cannot.
 * None of that reaches the work unless the calls the handler makes carry it —
 * and by default they do not. `packages/nextly/AGENTS.md` states it plainly:
 *
 * > `overrideAccess` defaults to `true` (trusted server context). Enforcing
 * > access control requires `overrideAccess: false` plus a `user`.
 *
 * So a handler doing the obvious thing — importing `nextly` and calling
 * `find` — runs every scheduled operation with trusted-system authority while
 * the carefully resolved identity sits unused in its context. The identity
 * design would be decorative.
 *
 * ## Why binding rather than documenting
 *
 * "Remember to pass `{ overrideAccess: false, user }` on every call" is a rule
 * that holds until the first call that forgets, and a forgotten one does not
 * fail — it succeeds with MORE authority. A guarantee that degrades silently
 * toward privilege is not a guarantee.
 *
 * ## Why the bypass cannot be re-enabled through this client
 *
 * A handler passing `overrideAccess: true` is ignored. If it were honoured the
 * binding would be a default rather than a guarantee, and any helper that
 * spread its own options last would quietly restore system authority.
 *
 * A job that genuinely needs trusted access imports `nextly` directly. That is
 * then a visible, deliberate line in the handler rather than an invisible
 * default — which is the whole difference.
 *
 * ## Why no identity means ANONYMOUS, not system
 *
 * A job queued without an identity acts as nobody. Nobody is not the system:
 * leaving `overrideAccess` at its `true` default for that case would make the
 * least-privileged job the most-privileged one.
 *
 * @module domains/jobs/job-content-api
 */

import type {
  CollectionSlug,
  CountArgs,
  CountResult,
  CreateArgs,
  DeleteArgs,
  DeleteResult,
  DuplicateArgs,
  FindArgs,
  FindByIDArgs,
  FindSingleArgs,
  FindSinglesArgs,
  ListResult,
  MutationResult,
  RowFromCollectionSlug,
  RowFromSingleSlug,
  SingleListResult,
  SingleSlug,
  UpdateArgs,
  UpdateSingleArgs,
} from "../../direct-api/types";
import type { Nextly } from "../../init/nextly-instance";
import type { UserContext } from "../collections/services/collection-types";

/**
 * The options this client OWNS, and which a handler therefore cannot pass.
 *
 * Every one of them decides authorization, and each is a distinct way to have
 * the bound identity ignored.
 *
 * - `overrideAccess` turns enforcement off outright.
 * - `user` is the identity itself.
 * - `actor` is an `AuthenticatedScope`, and `apiKeyScopeAllows` reads its
 *   `permissions` array as AUTHORITATIVE rather than consulting the bound
 *   user's grants — so a handler could hand itself `["delete-posts"]`.
 * - `trusted` widens which collections a populated relationship may reach.
 * - `enforceFieldAccess` / `fieldAccessUser` decide whether field rules run at
 *   all, and whose identity they run against.
 * - `frameworkFilter` exempts a where clause from `assertFilterableFields`,
 *   whose whole subject is a caller probing a field it may not read.
 *
 * They are stripped from the call rather than overridden. Overriding reaches
 * only the options this client sets, which leaves the rest to arrive from an
 * ordinary spread; a value that is never set here must be unable to arrive at
 * all.
 */
const JOB_OWNED_ACCESS_OPTIONS = [
  "overrideAccess",
  "user",
  "actor",
  "trusted",
  "enforceFieldAccess",
  "fieldAccessUser",
  "frameworkFilter",
] as const;

type JobOwnedAccessOption = (typeof JOB_OWNED_ACCESS_OPTIONS)[number];

/**
 * The `DirectAPIConfig` options that carry no authority and are forwarded.
 *
 * Listed so the guard below can prove the two lists COVER the config. Without
 * that, a new authorization-bearing option added upstream would be forwarded by
 * default and nothing here would notice — which is exactly how the five doors
 * above stayed open.
 */
type ForwardedOption =
  // Shared config.
  | "req"
  | "context"
  | "locale"
  | "fallbackLocale"
  | "showHiddenFields"
  | "disableErrors"
  | "disableTransaction"
  // How deep relationships are populated. Shaping, not authority: WHICH
  // collections a populate may reach is governed by `trusted`, which this
  // client owns, so a deeper read still cannot cross a boundary the bound
  // identity may not cross.
  | "depth"
  // Output shaping.
  | "richTextFormat"
  // Which collections hold form definitions and submissions — namespace
  // configuration.
  | "forms"
  // Document (soft) locks, and not an escalation: it defaults to `true`, so
  // locks are already ignored. Passing it can only make a job RESPECT a lock it
  // would otherwise have walked through, which is the safe direction.
  | "overrideLock"
  // Which document, and which part of it.
  | "collection"
  | "id"
  | "slug"
  | "data"
  | "overrides"
  | "duplicateFromID"
  // Query shaping. `where` and `search` choose rows; they do not decide who may
  // see them, and the filterable-field guard that governs probing through
  // `where` is reached via `frameworkFilter`, which this client owns.
  | "where"
  | "search"
  | "sort"
  | "limit"
  | "page"
  | "offset"
  | "pagination"
  | "select"
  | "populate"
  // Lifecycle SELECTION. `status` and `draft` say which lifecycle a read asks
  // for; whether the caller may HAVE it is decided by `resolveStatusFilter`
  // from the access options this client owns.
  | "status"
  | "draft"
  // `findSingles` filters.
  | "source"
  | "migrationStatus"
  | "locked"
  // Side-effect suppression.
  | "disableRevalidate"
  | "disableVerificationEmail"
  | "overwriteExistingFiles";

/**
 * Every argument key of every bound operation.
 *
 * The complete surface this client wraps, not the shared config alone.
 * `frameworkFilter` is declared on `FindArgs` and `CountArgs` rather than on
 * `DirectAPIConfig`, so a check over the shared config reports complete while
 * an operation-specific authorization option passes straight through.
 */
type AllBoundArgKeys = {
  [K in BoundOperation]: keyof NonNullable<Parameters<Nextly[K]>[0]>;
}[BoundOperation];

/**
 * Fails to compile when `DirectAPIConfig` gains an option neither list names.
 *
 * The error names the offending key, and the fix is a decision: either it
 * carries authority and belongs in `JOB_OWNED_ACCESS_OPTIONS`, or it does not
 * and belongs in `ForwardedOption`.
 */
type UnclassifiedOption = Exclude<
  AllBoundArgKeys,
  JobOwnedAccessOption | ForwardedOption
>;
type AssertEveryOptionClassified = [UnclassifiedOption] extends [never]
  ? true
  : ["unclassified Direct API option", UnclassifiedOption];
const _everyOptionClassified: AssertEveryOptionClassified = true;
void _everyOptionClassified;

/** One operation's arguments, minus what this client owns. */
type JobArgs<TArgs> = Omit<TArgs, JobOwnedAccessOption>;

/**
 * The subset of the Direct API this binds.
 *
 * Written out per operation rather than mapped over `Nextly`. A mapped type
 * collapses each generic signature to its constraint, so
 * `find({ collection: "posts" })` came back typed as the union of EVERY
 * collection's row in a project with generated types, and `findSingles()` lost
 * its optional argument. The argument types are still the Direct API's own, so
 * only the method list is restated here — and that list already exists below.
 */
export interface JobContentApi {
  find: <TSlug extends CollectionSlug>(
    args: JobArgs<FindArgs<TSlug>>
  ) => Promise<ListResult<RowFromCollectionSlug<TSlug>>>;
  findByID: <TSlug extends CollectionSlug>(
    args: JobArgs<FindByIDArgs<TSlug>>
  ) => Promise<RowFromCollectionSlug<TSlug> | null>;
  create: <TSlug extends CollectionSlug>(
    args: JobArgs<CreateArgs<TSlug>>
  ) => Promise<MutationResult<RowFromCollectionSlug<TSlug>>>;
  update: <TSlug extends CollectionSlug>(
    args: JobArgs<UpdateArgs<TSlug>>
  ) => Promise<MutationResult<RowFromCollectionSlug<TSlug>>>;
  delete: <TSlug extends CollectionSlug = CollectionSlug>(
    args: JobArgs<DeleteArgs<TSlug>>
  ) => Promise<MutationResult<{ id: string }> | DeleteResult>;
  count: (args: JobArgs<CountArgs>) => Promise<CountResult>;
  duplicate: <TSlug extends CollectionSlug>(
    args: JobArgs<DuplicateArgs<TSlug>>
  ) => Promise<MutationResult<RowFromCollectionSlug<TSlug>>>;
  findSingle: <TSlug extends SingleSlug>(
    args: JobArgs<FindSingleArgs<TSlug>>
  ) => Promise<RowFromSingleSlug<TSlug>>;
  updateSingle: <TSlug extends SingleSlug>(
    args: JobArgs<UpdateSingleArgs<TSlug>>
  ) => Promise<MutationResult<RowFromSingleSlug<TSlug>>>;
  findSingles: (args?: JobArgs<FindSinglesArgs>) => Promise<SingleListResult>;
}

/**
 * The content operations a job is expected to reach for.
 *
 * Deliberately not the whole Direct API. Authentication and account operations
 * take their own identity arguments and mean something different inside a
 * background job; binding them here would imply a job can log somebody in.
 */
const BOUND_OPERATIONS = [
  "find",
  "findByID",
  "create",
  "update",
  "delete",
  "count",
  "duplicate",
  "findSingle",
  "updateSingle",
  "findSingles",
] as const;

export type BoundOperation = (typeof BOUND_OPERATIONS)[number];

/**
 * The contract each bound operation must still satisfy.
 *
 * The interface above is written out per operation, which is what preserves the
 * per-slug generics a mapped type collapses. The cost is a second statement of
 * a shape the Direct API owns, and the runtime object reaches it through an
 * assertion — so nothing would otherwise compare the two, and a changed
 * argument or result contract upstream would leave this silently stale.
 *
 * Checked at the constraint rather than per slug: instantiating the generic is
 * what a mapped type cannot do, but a change to the ARGUMENT or RESULT type is
 * visible without it, and that is the drift worth catching.
 */
type JobParams<K extends BoundOperation> =
  Parameters<Nextly[K]> extends [infer TArgs]
    ? [args: JobArgs<TArgs>]
    : // The optional-argument case, which `findSingles` is: a required parameter
      // here would report drift for an operation that correctly keeps its
      // argument optional, and losing that optionality is one of the defects this
      // interface exists to fix.
      [args?: JobArgs<NonNullable<Parameters<Nextly[K]>[0]>>];

type BoundContract<K extends BoundOperation> = (
  ...args: JobParams<K>
) => ReturnType<Nextly[K]>;

/**
 * Fails to compile when a bound signature stops matching the Direct API.
 *
 * Bidirectional: one direction alone would accept an interface that merely
 * widened its arguments or narrowed its result, which is drift that still
 * compiles at every call site and only shows up as a wrong shape at runtime.
 */
type AssertBoundContractsMatch = {
  [K in BoundOperation]: JobContentApi[K] extends BoundContract<K>
    ? BoundContract<K> extends JobContentApi[K]
      ? true
      : ["bound signature drifted from the Direct API", K]
    : ["bound signature drifted from the Direct API", K];
};
const _boundContractsMatch: AssertBoundContractsMatch = {
  find: true,
  findByID: true,
  create: true,
  update: true,
  delete: true,
  count: true,
  duplicate: true,
  findSingle: true,
  updateSingle: true,
  findSingles: true,
};
void _boundContractsMatch;

/** The Direct API surface this needs, named so the runner can inject a double. */
export type JobContentSource = Pick<Nextly, BoundOperation>;

export function createJobContentApi(
  user: UserContext | null,
  source: JobContentSource
): JobContentApi {
  const bound = {} as Record<BoundOperation, unknown>;
  for (const name of BOUND_OPERATIONS) {
    // The generic per-slug signatures cannot be preserved through this loop, so
    // the call is made untyped here and the assembled object is asserted to
    // `JobContentApi` once. The types callers see are the Direct API's own; the
    // erasure is confined to these two lines.
    // Called ON `source`, never through an extracted reference. The module-level
    // `nextly` facade is arrow functions and survives extraction, but a real
    // `Nextly` INSTANCE reaches its context through `this` — extracting the
    // method there loses it, and the call fails inside `mergeConfig` reading
    // `ctx.defaultConfig` of undefined. A wrapper that only works against one
    // of the two shapes its own type admits is not bound to anything.
    const operation = (args: unknown): unknown =>
      (source[name] as (a: unknown) => unknown).call(source, args);
    bound[name] = (args: unknown) => {
      // CLEARED to `undefined`, not deleted. Every operation begins with
      // `mergeConfig(ctx.defaultConfig, args)`, which is `{ ...defaultConfig,
      // ...args }` — so a DELETED key is merely absent from `args` and the
      // instance default survives into the authorized call. An instance
      // configured with `actor` would have reinstated an API-key scope whose
      // `permissions` array is read as authoritative, behind a wrapper
      // advertising a bound identity; a configured `user` would have been
      // reinstated for a job that runs as nobody. Present-and-undefined wins
      // the spread, which is what makes the clearing reach the merge.
      const caller = { ...((args ?? {}) as Record<string, unknown>) };
      for (const owned of JOB_OWNED_ACCESS_OPTIONS) caller[owned] = undefined;
      return operation({
        ...caller,
        // Applied AFTER the stripped arguments, so a future edit that stopped
        // stripping would still not let an explicit `overrideAccess: true`
        // through.
        overrideAccess: false,
        ...(user === null ? {} : { user }),
      });
    };
  }
  return bound as unknown as JobContentApi;
}
