/**
 * "Ready to publish?": what holds each part a person chose to publish, where a workflow governs
 * the document. Each problem is hard (Publish waits for it): a part whose stage does not allow
 * publishing, a part the server's description refuses as not approved, and a field the
 * description refuses. Each says how it is resolved: the step that moves the part on, where the
 * person may take it, or who the part waits for.
 *
 * Soft problems (a rule that warns and lets the publish go) are not listed: the readiness checks
 * releases run are asked of a release, and there is none to ask for one document.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/ready-to-publish
 */

import { validationIssues } from "@admin/lib/api/parseApiError";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

import { leadingReviewStep } from "../EntryForm/document-actions";
import type { LanguageLabel } from "../publishAllOutcomes";
import { waitingForWords } from "../review/review-words";

import { SHARED_PATH, type PartsChoice } from "./publish-parts-choice";

/** The code the publish gate refuses a part with while it holds no current approval. */
export const NOT_APPROVED = "NOT_APPROVED";

/** One thing that holds Publish, and how it is resolved. */
export interface ReadyProblem {
  /** Unique within the list. */
  key: string;
  /** What holds it, naming the part or the field. */
  text: string;
  /** Whether it is a part waiting for approval, which publishing without review goes past. */
  unapproved: boolean;
  /** The step that moves the part on, where the person may take it. */
  fix?: { part: PartReview; step: ReviewStep };
  /** Who can unblock it, as words, where the person cannot. */
  waitingFor?: string;
}

/** The chosen parts, each by the path a refusal names it with and its review-state part. */
function chosenParts(
  choice: PartsChoice
): { path: string; part: string | null }[] {
  return [
    ...choice.locales.map(locale => ({ path: locale, part: locale })),
    ...(choice.shared ? [{ path: SHARED_PATH, part: null }] : []),
  ];
}

/** A part's own words: its language, the shared fields, or the whole of an untranslated document. */
function partLabel(
  part: string | null,
  translated: boolean,
  labelOf: LanguageLabel
): string {
  if (part !== null) return labelOf(part);
  return translated ? "Shared fields" : "This document";
}

/** A part held in a stage that does not allow publishing, with its fix or who unblocks it. */
function unapprovedProblem(
  path: string,
  label: string,
  review: PartReview
): ReadyProblem {
  const leading = leadingReviewStep(review.steps);
  const step =
    leading !== undefined &&
    leading.mayTake &&
    leading.kind !== "request-changes"
      ? leading
      : undefined;
  const waiting = waitingForWords(review.waitingFor);
  return {
    key: `part:${path}`,
    text: `${label}: not approved (${review.stageLabel ?? review.stage ?? ""})`,
    unapproved: true,
    ...(step === undefined ? {} : { fix: { part: review, step } }),
    ...(step === undefined && waiting !== null ? { waitingFor: waiting } : {}),
  };
}

/**
 * Every hard problem with publishing `choice`: from the review state of each chosen part, and
 * from the refusal of the server's description of the same request.
 */
export function readyProblems({
  choice,
  parts,
  refusal,
  translated,
  labelOf,
}: {
  choice: PartsChoice;
  /** The document's review state, part by part. */
  parts: readonly PartReview[];
  /** What the server refused the description (or the publish) with, if anything. */
  refusal: unknown;
  /** Whether the document has languages, which decides the shared part's name. */
  translated: boolean;
  labelOf: LanguageLabel;
}): ReadyProblem[] {
  const chosen = chosenParts(choice);
  const problems: ReadyProblem[] = [];
  for (const { path, part } of chosen) {
    const review = parts.find(candidate => candidate.part === part);
    if (review === undefined || review.stage === null || review.publishable) {
      continue;
    }
    problems.push(
      unapprovedProblem(path, partLabel(part, translated, labelOf), review)
    );
  }
  const listed = new Set(problems.map(problem => problem.key));
  const paths = new Set(chosen.map(each => each.path));
  for (const issue of validationIssues(refusal)) {
    if (issue.message === undefined || issue.path === undefined) continue;
    if (paths.has(issue.path)) {
      // A part the gate refuses as not approved, where the review state did not already say so.
      if (issue.code !== NOT_APPROVED || listed.has(`part:${issue.path}`)) {
        continue;
      }
      const part = issue.path === SHARED_PATH ? null : issue.path;
      problems.push({
        key: `part:${issue.path}`,
        text: `${partLabel(part, translated, labelOf)}: ${issue.message}`,
        unapproved: true,
      });
      listed.add(`part:${issue.path}`);
      continue;
    }
    // A field the description refuses (a required value missing): named by its path.
    problems.push({
      key: `field:${issue.path}:${issue.message}`,
      text: `${issue.path}: ${issue.message}`,
      unapproved: false,
    });
  }
  return problems;
}
