/**
 * WHICH setup steps exist, and what one can say, as a vocabulary anything may
 * name.
 *
 * Its own module, importing nothing, because the admin draws a tile for each
 * kind and must name them, while the code that ANSWERS a step reaches the
 * database. One module would drag that whole graph into every consumer of the
 * names.
 *
 * @module domains/widgets/setup-steps
 * @experimental The setup card is new, and these shapes may change before it settles.
 */

/** The kinds of step, in the order the card offers them. */
export const SETUP_STEP_KINDS = [
  "sample",
  "collection",
  "entry",
  "singles",
  "invite",
] as const;
export type SetupStepKind = (typeof SETUP_STEP_KINDS)[number];

/**
 * The kinds a reader may skip, and the only ones: filling in Singles and
 * inviting a teammate are things a site can do without. Sample content has
 * its own decline, and a collection and a first entry are what a site is for.
 * Published so the card offers Skip on exactly the steps the host honours one
 * on.
 */
export const SETUP_SKIPPABLE_KINDS = [
  "singles",
  "invite",
] as const satisfies readonly SetupStepKind[];
export type SkippableSetupStepKind = (typeof SETUP_SKIPPABLE_KINDS)[number];

/** The same list, read as step kinds, for asking it of any kind. */
const SKIPPABLE: readonly string[] = SETUP_SKIPPABLE_KINDS;

/** Whether a reader may skip a step of `kind`. */
export function isSkippableKind(kind: string): kind is SkippableSetupStepKind {
  return SKIPPABLE.includes(kind);
}

/**
 * What a step can say. A step whose check could not be made is never one of
 * these: the whole answer is then not known (`SetupAnswer`), so no step is
 * drawn as waiting on a guess.
 */
export type SetupStepStatus = "open" | "done" | "skipped";

/** One Single in the Singles step, and whether it has been saved since it was made. */
export interface SetupSingle {
  slug: string;
  filledIn: boolean;
}

/** One step, as the host answers it: copy and links are the admin's. */
export type SetupStep =
  | { kind: "sample"; status: SetupStepStatus }
  | { kind: "collection"; status: SetupStepStatus }
  | {
      kind: "entry";
      status: SetupStepStatus;
      /**
       * While the step is open: the first collection the reader may create an
       * entry in, which the step opens a new entry of.
       */
      collection?: string;
    }
  | {
      kind: "singles";
      status: SetupStepStatus;
      /** Every Single the reader may edit, in the registry's order. */
      singles: SetupSingle[];
    }
  | { kind: "invite"; status: SetupStepStatus };

/**
 * Every step offered to this reader and how far through them they are, or
 * "not known" as a whole when a registry could not be listed or a check
 * failed or ran out of time.
 */
export type SetupAnswer =
  | { known: false }
  | {
      known: true;
      steps: SetupStep[];
      /** Steps done or skipped: what "N of M done" counts as done. */
      done: number;
      /** Steps offered. */
      total: number;
    };

/** What the setup card's `load` answers. */
export interface SetupCardData {
  setup: SetupAnswer;
  /** Whether this reader collapsed the card to its one-line bar. */
  collapsed: boolean;
  /**
   * Whether every step offered is done or skipped. The card says "You're all
   * set" this once: the host has recorded it, so the next load leaves the card
   * out.
   */
  allSet: boolean;
}

/** Whether a step counts as done in "N of M done". */
export function stepFinished(step: Pick<SetupStep, "status">): boolean {
  return step.status === "done" || step.status === "skipped";
}

/** A known answer over `steps`, counted. */
export function talliedSetup(steps: SetupStep[]): SetupAnswer {
  return {
    known: true,
    steps,
    done: steps.filter(stepFinished).length,
    total: steps.length,
  };
}

/** What only the project's sample-content route can say of this reader. */
export interface SampleRoute {
  /**
   * Whether the route refuses this reader the load, or the project ships no
   * sample content at all. Only the admin can ask it, so the host, which
   * cannot, answers `false`.
   */
  sampleRefused: boolean;
}

/**
 * The steps the setup card draws, counted: `answer` less an open sample step
 * where the project's route refuses this reader. A sample step already
 * answered stays, as someone on the site loaded or declined it.
 *
 * ONE function for the admin's "N of M done" and the host's "You're all set"
 * (`setupAllSet`), so a step the card leaves out never holds the card open,
 * and a step it draws is never passed over.
 */
export function drawnSetup(
  answer: SetupAnswer,
  { sampleRefused }: SampleRoute
): SetupAnswer {
  if (!answer.known || !sampleRefused) return answer;
  return talliedSetup(
    answer.steps.filter(
      step => !(step.kind === "sample" && step.status === "open")
    )
  );
}

/**
 * Whether every step drawn is done or skipped: what "You're all set" says.
 * Never while setup is not known.
 */
export function setupAllSet(drawn: SetupAnswer): boolean {
  return drawn.known && drawn.done === drawn.total;
}
