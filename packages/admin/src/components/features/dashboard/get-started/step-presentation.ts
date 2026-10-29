/**
 * What each Get started step is called and where it leads.
 *
 * Exhaustive over the step kinds core publishes, so a kind added there with no entry here does
 * not compile. The copy lives in the admin because it is UI text pointing at admin routes, which
 * core renders neither of.
 *
 * @module components/features/dashboard/get-started/step-presentation
 */

import {
  GET_STARTED_SKIPPABLE_KINDS,
  type GetStartedStep,
  type GetStartedStepKind,
} from "nextly/config";

import { buildRoute, ROUTES } from "@admin/constants/routes";

export interface StepPresentation {
  label: string;
  /** Where the step is done. */
  href: string;
}

const BY_KIND: Record<
  GetStartedStepKind,
  (
    single: string | undefined,
    singleLabel: string | undefined
  ) => StepPresentation
> = {
  collection: () => ({
    label: "Create a collection",
    href: ROUTES.BUILDER_COLLECTIONS_NEW,
  }),
  // The content surface, not the schema builder: told to add a first entry and sent to the
  // builder, a reader arrives at field definitions, the one place an entry cannot be added.
  entry: () => ({ label: "Add your first entry", href: ROUTES.COLLECTIONS }),
  single: (single, singleLabel) => ({
    label: `Fill in ${singleLabel ?? single ?? "a Single"}`,
    href: buildRoute(ROUTES.SINGLE_EDIT, { slug: single ?? "" }),
  }),
  invite: () => ({ label: "Invite a teammate", href: ROUTES.USERS_CREATE }),
};

/** A step's label and link, a Single's named by its label when it is known. */
export function stepPresentation(
  step: GetStartedStep,
  singleLabels: ReadonlyMap<string, string>
): StepPresentation {
  const label =
    step.single === undefined ? undefined : singleLabels.get(step.single);
  // A server newer than this admin can send a kind it has no words for: drawn
  // as a plain row naming the step, never a crash that takes the card with it.
  const present = BY_KIND[step.kind] as
    | (typeof BY_KIND)[GetStartedStepKind]
    | undefined;
  return present === undefined
    ? { label: `Finish setup: ${step.key}`, href: ROUTES.DASHBOARD }
    : present(step.single, label);
}

/** Whether a reader may skip this step: core's list, the one its skips are applied by. */
export function isSkippable(step: GetStartedStep): boolean {
  return GET_STARTED_SKIPPABLE_KINDS.includes(step.kind);
}
