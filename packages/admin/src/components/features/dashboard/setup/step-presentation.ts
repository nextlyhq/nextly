/**
 * What each setup step is called, what its tile says under the title, and
 * where it leads.
 *
 * Exhaustive over the step kinds core publishes, so a kind added there with no
 * entry here does not compile. The copy lives in the admin because it is UI
 * text pointing at admin routes, which core renders neither of.
 *
 * @module components/features/dashboard/setup/step-presentation
 */

import type { SetupStep, SetupStepKind } from "nextly/config";

import { buildRoute, ROUTES } from "@admin/constants/routes";

export interface StepPresentation {
  label: string;
  /** One short line under the label: what is done, or what the step asks. */
  detail: string;
  /** Where the step is done, when it is a link; the Singles open a list instead. */
  href?: string;
  /** The link's own words, for an open step. */
  action?: string;
}

/** "N of M filled in", for the Singles step. */
export function filledIn(step: Extract<SetupStep, { kind: "singles" }>): {
  done: number;
  total: number;
} {
  return {
    done: step.singles.filter(single => single.filledIn).length,
    total: step.singles.length,
  };
}

const BY_KIND: {
  [K in SetupStepKind]: (
    step: Extract<SetupStep, { kind: K }>
  ) => StepPresentation;
} = {
  // The run itself, its outcome and its failures are drawn by the tile's own
  // sample-content control, so the presentation holds only the words.
  sample: step => ({
    label: "Start with sample content",
    detail:
      step.status === "done" ? "Answered" : "A ready-made site to look around",
  }),
  collection: step => ({
    label: "Create a collection",
    detail: step.status === "done" ? "Done" : "Define your first content type",
    href: ROUTES.BUILDER_COLLECTIONS_NEW,
    action: "Create",
  }),
  // A new entry of the first collection the reader may create in, never the
  // collections index: told to add an entry, a reader should land where one is
  // added.
  entry: step => ({
    label: "Add your first entry",
    detail: step.status === "done" ? "Done" : "Write something to publish",
    ...(step.collection === undefined
      ? {}
      : {
          href: buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, {
            slug: step.collection,
          }),
          action: "Add",
        }),
  }),
  singles: step => {
    const { done, total } = filledIn(step);
    return {
      label: "Fill in your Singles",
      detail: `${done} of ${total} filled in`,
    };
  },
  invite: step => ({
    label: "Invite a teammate",
    detail: step.status === "done" ? "Done" : "Optional",
    href: ROUTES.USERS_CREATE,
    action: "Invite",
  }),
};

/** A step's words and link. */
export function stepPresentation(step: SetupStep): StepPresentation {
  // A server newer than this admin can send a kind it has no words for: drawn
  // as a plain tile naming the kind, never a crash that takes the card with it.
  const present = BY_KIND[step.kind] as
    | ((step: SetupStep) => StepPresentation)
    | undefined;
  return present === undefined
    ? { label: "Finish setup", detail: step.kind }
    : present(step);
}

/** Where a Single is filled in. */
export function singleHref(slug: string): string {
  return buildRoute(ROUTES.SINGLE_EDIT, { slug });
}
