/**
 * Publishing or unpublishing the parts of a document a person chooses: some of its languages,
 * and separately its shared fields. The shapes the publish and unpublish routes of an entry and a
 * Single take and answer with, shared by both clients.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module services/publishParts
 */

import {
  everyLanguageBody,
  type EveryLanguageVersion,
} from "@admin/lib/document-version";

import type { PublishAllLanguageOutcome } from "./publishAllPreview";

/** Which way the parts move. */
export type PublishPartsDirection = "publish" | "unpublish";

/** What an unpublish does, or would do, to one chosen language. */
export type UnpublishLanguageOutcome = {
  locale: string;
  outcome: "taken-down" | "stays-unpublished";
};

/** What a publish or an unpublish does, or would do, to one chosen language. */
export type PartsLanguageOutcome =
  | PublishAllLanguageOutcome
  | UnpublishLanguageOutcome;

/** What a request did, or would do, to each part it chose. */
export interface PublishPartsResult {
  id: string;
  languages: PartsLanguageOutcome[];
  shared: {
    /** Whether the shared fields' published state changes. */
    changes: boolean;
    /** Whether the shared fields were added to the request: the document's first publish. */
    added: boolean;
  };
}

/** The parts chosen, and how the request is made. */
export interface PublishPartsChoice {
  /** The languages chosen, or `"all"` for every language and the shared fields. */
  locales: readonly string[] | "all";
  /** Whether the shared fields are chosen. */
  shared?: boolean;
  /** Say what the request would do, and change nothing. */
  describe?: boolean;
  /** The version the request is made from, or the overwrite choice. */
  version?: EveryLanguageVersion;
  /** Publish without review, with the person's reason, where a workflow governs the document. */
  withoutReview?: { reason: string };
}

/** The body the routes take for `choice`. */
export function publishPartsBody(
  choice: PublishPartsChoice
): Record<string, unknown> {
  return {
    locales: choice.locales === "all" ? "all" : [...choice.locales],
    ...(choice.shared === undefined ? {} : { shared: choice.shared }),
    ...(choice.describe === true ? { describe: true } : {}),
    ...(choice.withoutReview === undefined
      ? {}
      : { withoutReview: choice.withoutReview }),
    ...everyLanguageBody(choice.version),
  };
}
