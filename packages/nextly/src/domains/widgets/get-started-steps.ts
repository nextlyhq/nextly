/**
 * WHICH Get started steps exist, and what one can say, as a vocabulary
 * anything may name.
 *
 * Its own module, importing only core's widget ids (which import nothing), for
 * the reason `onboarding-steps.ts` is: the admin draws a row for each kind and
 * must name them, and the code that ANSWERS a step reaches the Direct API and
 * the database. A single module would drag that whole graph into every
 * consumer of the names.
 *
 * @module domains/widgets/get-started-steps
 */

import { CORE_WIDGET_ID } from "./core-widgets/ids";

/** The Get started card's widget id: the one card the steps are drawn on. */
export const GET_STARTED_WIDGET_ID = CORE_WIDGET_ID.getStarted;

/** The kinds of step, in the order the card offers them. */
export const GET_STARTED_STEP_KINDS = [
  "collection",
  "entry",
  "single",
  "invite",
] as const;
export type GetStartedStepKind = (typeof GET_STARTED_STEP_KINDS)[number];

/**
 * The kinds a reader may skip: the ones that ask for something a site can do
 * without. Creating a collection and a first entry are what a site is for.
 * Published so the card offers Skip on exactly the steps the host honours one on.
 */
export const GET_STARTED_SKIPPABLE_KINDS: readonly GetStartedStepKind[] = [
  "single",
  "invite",
];

/**
 * What a step can say.
 *
 * `unknown` is its own answer, never folded into another: a step that could not
 * be checked is neither done nor waiting, and drawing it as either tells the
 * reader something nobody found out.
 */
export type GetStartedStepStatus = "open" | "done" | "skipped" | "unknown";

/** One step, as the host answers it: copy and links are the admin's. */
export interface GetStartedStep {
  /** Stable per step: the kind, or `single:<slug>` for a Single's. */
  key: string;
  kind: GetStartedStepKind;
  status: GetStartedStepStatus;
  /** The Single a `single` step is about. */
  single?: string;
}

/** Every step offered to this reader, and how far through them they are. */
export interface GetStartedAnswer {
  /**
   * Whether the install's collections or Singles could not be listed at all.
   * Then the steps that depend on them are not known either, and the card says
   * it could not check setup rather than show them as waiting.
   */
  unknown: boolean;
  steps: GetStartedStep[];
  /** Steps done or skipped: what "x of y done" counts as done. */
  done: number;
  /** Steps offered. */
  total: number;
}
