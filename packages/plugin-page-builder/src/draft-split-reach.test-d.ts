/**
 * Whether the draft-split question is CALLABLE with the collection a plugin
 * actually holds.
 *
 * This file and `draft-split-reach.test.ts` check different things, and neither
 * subsumes the other. The runtime test proves the value survives to the emitted
 * JavaScript — a type-only import would stay green under a producer changed to
 * `export type`. This one proves the type contract, which the runtime test
 * cannot: this package's `tsconfig.json` AND its `tsconfig.tests.json` both
 * exclude test files by glob, so a `.test.ts` sits in no TypeScript program at all,
 * and Vitest's esbuild transform erases annotations rather than checking them.
 * Measured, not assumed: `tsc --listFiles` counts the runtime test ZERO times.
 *
 * So a regression narrowing `versions` back to the resolved-only shape would
 * leave every runtime assertion passing while TypeScript consumers could no
 * longer call the API at all.
 *
 * Neither file is redundant with the other, and replacing either with the other
 * trades one gap for a different one.
 *
 * @module draft-split-reach.test-d
 */
import type {
  AuthoredDraftSplitCollection,
  DraftSplitDisabledReason,
  DraftSplitEligibility,
  collectionDraftSplit,
} from "@nextlyhq/plugin-sdk";

/** The authored shorthand an author writes, not the shape config load produces. */
/**
 * Written as a STANDALONE literal, not as an intersection with the published
 * type. A fixture derived from the type under test moves with it: a narrowing
 * shifts both sides of the comparison together, so the assertion holds for a
 * parameter that no longer accepts the boolean form at all.
 */
type AuthoredShorthand = { status: true; versions: true; fields: [] };

/** The other authored form, which is the one a narrowing regression also breaks. */
type AuthoredObject = { status: true; versions: { drafts: true }; fields: [] };

/**
 * Both authored forms are assignable to the parameter the SDK publishes.
 *
 * Written as an assignment the checker EVALUATES. `@ts-expect-error` would
 * suppress whatever error landed on the following line, including one arriving
 * for an unrelated reason and including none at all once the rejection stopped
 * happening.
 */
type Param = Parameters<typeof collectionDraftSplit>[0];
const shorthandIsAccepted: AuthoredShorthand extends Param ? true : false =
  true;
const objectFormIsAccepted: AuthoredObject extends Param ? true : false = true;

/**
 * The type the SDK PUBLISHES is the one the function takes.
 *
 * Published separately from the function, so the two can drift: a rename, or a
 * second type introduced for the parameter, would leave consumers annotating
 * their collections with something the API no longer accepts. The fixtures
 * above deliberately do not reference it — a fixture derived from the type
 * under test moves with it and cannot fail — so this pair is what ties the
 * published name to the callable surface.
 */
const parameterAcceptsThePublishedType: Param extends AuthoredDraftSplitCollection
  ? true
  : false = true;

/**
 * And the other direction, which is the half a one-way check cannot see.
 *
 * `Param extends Published` alone stays true when the parameter is NARROWER
 * than the published type: a consumer annotates a value with the exported name,
 * the checker accepts it, and the call rejects it. Asserting both directions is
 * what makes the two names one type rather than two that happen to overlap.
 */
const publishedTypeIsAcceptedAsTheParameter: AuthoredDraftSplitCollection extends Param
  ? true
  : false = true;

/** The verdict carries a reason, so a caller can say WHY a collection does not draft. */
const verdictCarriesAReason: Awaited<
  ReturnType<typeof collectionDraftSplit>
> extends DraftSplitEligibility
  ? true
  : false = true;

/**
 * The control, and it is load-bearing.
 *
 * `X extends Y ? true : false` written carelessly is `true` for unrelated
 * types — `never` extends everything, and a parameter widened to `any` would
 * satisfy all three assertions above without meaning anything. A type that must
 * NOT match has to come out false, or the pattern certifies by never refusing.
 */
const unrelatedTypeIsRejected: DraftSplitDisabledReason extends Param
  ? true
  : false = false;

export type { Param, AuthoredShorthand, AuthoredObject };
export {
  parameterAcceptsThePublishedType,
  publishedTypeIsAcceptedAsTheParameter,
  shorthandIsAccepted,
  objectFormIsAccepted,
  verdictCarriesAReason,
  unrelatedTypeIsRejected,
};
