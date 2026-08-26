/**
 * Whether a plugin can actually reach the draft-split question.
 *
 * The class-usage write path must know whether a collection stores a working
 * draft: enumerating a draft subject for one that keeps none writes rows no
 * query built from a real document can reach, so nothing reconciles them and
 * nothing sweeps them.
 *
 * A type-level test in the CONSUMER rather than a runtime one in the producer,
 * because the claim is about reachability across a package boundary. `nextly`
 * emitting the symbol into its declaration file proves it was built; only an
 * import from here proves the export MAP resolves it for a package that merely
 * depends on `nextly`. The two fail independently — a symbol can be emitted and
 * still be unreachable through a subpath that does not name it.
 *
 * `.test-d.ts` rather than `.test.ts`: this package's `tsconfig.json` excludes
 * test files by glob and its `tsconfig.tests.json` excludes them too, so a
 * `.test.ts` would sit in no TypeScript program and assert nothing at all.
 *
 * What this file does NOT establish, stated so it is not read as more than it
 * is: the import is type-only, so it proves the TYPE resolves through the
 * export map and says nothing about the runtime binding. A symbol can be
 * reachable to the checker and absent from the emitted JavaScript. That half is
 * established against the artifact instead — `schemaDraftSplit` appears in
 * `dist/index.mjs`, where a type-only export such as `BatchOperationResult`
 * does not, which is what makes the presence mean a value rather than a name.
 *
 * @module draft-split-reach.test-d
 */
import type {
  DraftSplitDisabledReason,
  DraftSplitEligibility,
  SchemaEligibilityCollection,
  schemaDraftSplit,
} from "nextly";

/** The verdict carries a reason, so a caller can say WHY a collection does not draft. */
type Verdict = Awaited<ReturnType<typeof schemaDraftSplit>>;
const verdictIsEligibility: Verdict extends DraftSplitEligibility
  ? true
  : false = true;

/**
 * The input is the COLLECTION, not an assembled analysis.
 *
 * The lower-level predicate beside it takes resolved component schemas, which
 * is the work rather than the question — a plugin holding a collection config
 * could not call it without reproducing the resolution.
 */
const takesACollection: Parameters<
  typeof schemaDraftSplit
>[0] extends SchemaEligibilityCollection
  ? true
  : false = true;

/**
 * A control on the two assertions above.
 *
 * `X extends Y ? true : false` written carelessly can be `true` for unrelated
 * types — `never` extends everything, and a widened parameter would satisfy the
 * check without meaning anything. A type that must NOT match has to come out
 * false, or the pattern is certifying by never refusing.
 */
const unrelatedTypeDoesNotMatch: DraftSplitDisabledReason extends DraftSplitEligibility
  ? true
  : false = false;

export type { Verdict };
export { verdictIsEligibility, takesACollection, unrelatedTypeDoesNotMatch };
