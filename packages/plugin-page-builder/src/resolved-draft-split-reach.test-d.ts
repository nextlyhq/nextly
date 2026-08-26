/**
 * Whether the draft-split question can be asked of a collection the SCHEMA
 * BUILDER created, and whether the two forms of it can be confused.
 *
 * A Builder collection lives in the dynamic registry, which stores `versions`
 * already resolved. The authored form cannot take that record: the checker
 * rejects it, and from untyped code it answers `false` for a collection whose
 * drafts are ON, because nothing named `drafts.enabled` is there to read. That
 * failure is silent and disables pending changes for every Builder collection,
 * so the contract is asserted at the type level where it can actually fail.
 *
 * A type test rather than a runtime one, deliberately. This package's
 * `tsconfig.json` AND its `tsconfig.tests.json` both exclude test files by
 * glob, so a `.test.ts` sits in no TypeScript program and Vitest's esbuild
 * transform erases annotations rather than checking them.
 *
 * @module resolved-draft-split-reach.test-d
 */
import type {
  ResolvedDraftSplitCollection,
  collectionDraftSplit,
  resolvedCollectionDraftSplit,
} from "@nextlyhq/plugin-sdk";

/** What the dynamic registry stores: `versions` already resolved. */
type RegistryRecord = {
  status: true;
  versions: { drafts: { enabled: true } };
  fields: [];
};

/** What an author writes in config. Neither form is the other. */
type AuthoredRecord = { status: true; versions: true; fields: [] };

type ResolvedParam = Parameters<typeof resolvedCollectionDraftSplit>[0];
type AuthoredParam = Parameters<typeof collectionDraftSplit>[0];

/** The registry's record is answerable, which is the whole point of publishing it. */
const registryRecordIsAccepted: RegistryRecord extends ResolvedParam
  ? true
  : false = true;

/**
 * And the authored form is NOT answerable by it.
 *
 * The control, and it is load-bearing twice over. A parameter widened to `any`
 * — or to a type with only optional members — would satisfy the assertion above
 * without meaning anything, and a pattern that never refuses certifies nothing.
 * It also states the reason there are two functions rather than one.
 */
const authoredIsRejectedByTheResolvedForm: AuthoredRecord extends ResolvedParam
  ? true
  : false = false;

/**
 * The other direction, which is the defect this publication exists to prevent.
 *
 * Before this export, a plugin holding a registry record had only the authored
 * function to call. This asserts the checker stops that, rather than trusting
 * that it does.
 */
const registryRecordIsRejectedByTheAuthoredForm: RegistryRecord extends AuthoredParam
  ? true
  : false = false;

/** The published input type is the one the function takes, in both directions. */
const parameterAcceptsThePublishedType: ResolvedParam extends ResolvedDraftSplitCollection
  ? true
  : false = true;
const publishedTypeIsAcceptedAsTheParameter: ResolvedDraftSplitCollection extends ResolvedParam
  ? true
  : false = true;

export type { RegistryRecord, AuthoredRecord, ResolvedParam, AuthoredParam };
export {
  registryRecordIsAccepted,
  authoredIsRejectedByTheResolvedForm,
  registryRecordIsRejectedByTheAuthoredForm,
  parameterAcceptsThePublishedType,
  publishedTypeIsAcceptedAsTheParameter,
};
