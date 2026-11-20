/**
 * Who each part of a document waits for, as the review state read names it: the part's assignee,
 * while they may take its stage's primary step; else, for a part no one is assigned, its stage's
 * default reviewer, where they may take that step, as a step into the stage would have assigned
 * them; else everyone who may take it, named by the roles that may. An assignee who may not take
 * it on this part (they lost the step, or brought the part into a stage whose step refuses that)
 * leaves the work to everyone who may, so it is never stranded with someone who cannot move it. A
 * stage with no step out of it waits for no one.
 *
 * Read on the pool, after the review state's own transaction: who holds a permission is asked of
 * the role and permission services, which read on the pool (`holders`). Each person or role is
 * asked once per action, and every name is read in one statement per kind.
 *
 * @module domains/workflows/part-waits-for
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { primaryStep } from "./define-workflow";
import { holderAnswers, holderKey, namesOf, rolesHolding } from "./holders";
import type { RegisteredWorkflow } from "./registry";
import type { ReviewAssignee } from "./review-state-repository";
import { primaryAction, takesStep } from "./steps";
import type { ResolvedWorkflowStep, Workflow } from "./types";
import {
  readWorkflowSettings,
  type WorkflowSettings,
} from "./workflow-settings-repository";

/** A role a part waits for, by id and name. @experimental */
export interface WaitingRole {
  id: string;
  /** Null for a role assigned and since removed. */
  name: string | null;
}

/**
 * Who a part waits for: one person (`user`, as an assignee names a person), or anyone holding one
 * of some roles. Null for a part that waits for no one.
 *
 * @experimental
 */
export type PartWaitingFor =
  | { kind: "user"; id: string; name: string | null }
  | { kind: "roles"; roles: WaitingRole[] };

/** One part as this asks of it: where it stands, who it is assigned to, and who brought it there. */
export interface WaitingPartInput {
  stage: string | null;
  assignee: ReviewAssignee | null;
  /** Who brought the part into its stage: a step refusing self-approval refuses them it. */
  enteredBy: string | null;
}

/**
 * Whom one part waits for, by id: one person or role (its assignee or its stage's default
 * reviewer), everyone who may take a step needing `action`, or, in a stage with no step out of it,
 * no one.
 *
 * @experimental
 */
export type PartWaits =
  | { kind: "one"; who: ReviewAssignee }
  | { kind: "holders"; action: string }
  | null;

/** Who a part waits for, by id, before the names are read. */
type Waiting = ReviewAssignee | { kind: "roles"; ids: string[] } | null;

/**
 * Whom a part in a stage with a step out of it waits for: its assignee, while they may take the
 * stage's primary step; else, unassigned, the stage's default reviewer, while they may; else
 * everyone who may. The one rule what a part waits for is decided by, read part by part and listed
 * caller by caller alike.
 */
function waitsFor(args: {
  /** Whether the part is assigned, and if so whether its assignee may take the step. */
  assignee: "none" | "holds" | "lacks";
  /** Whether the stage has a default reviewer, and if so whether they may take the step. */
  reviewer: "none" | "holds" | "lacks";
}): "assignee" | "reviewer" | "holders" {
  if (args.assignee === "holds") return "assignee";
  if (args.assignee === "none" && args.reviewer === "holds") return "reviewer";
  return "holders";
}

/**
 * Decides whom the parts of one collection or Single wait for, by `waitsFor`, part by part.
 *
 * @experimental
 */
export interface PartWaitsDecider {
  /**
   * Asks, a batch per action, whether each person or role `parts` name (an assignee, or for an
   * unassigned part its stage's default reviewer) holds its stage's primary step, so `decide`
   * answers them from what was asked: many parts cost a few statements, never one per person.
   */
  prime(parts: readonly WaitingPartInput[]): Promise<void>;
  /** Whom `part` waits for. */
  decide(part: WaitingPartInput): Promise<PartWaits>;
}

/**
 * Whom each part of the collection or Single `slug` under `workflow` waits for: the one place both
 * the read and the waiting list ask it. A person or role "may take" a part's stage's primary step
 * when they hold its permission and, a person, the step does not refuse them as the one who brought
 * this part into the stage. Each person or role is asked the permission once per action, in
 * batches where the parts are primed, and the workflow's settings are read once.
 *
 * @experimental
 */
export function partWaitsDecider(
  adapter: DrizzleAdapter,
  workflow: Workflow,
  slug: string
): PartWaitsDecider {
  let settings: WorkflowSettings | undefined;
  const holds = new Map<string, boolean>();
  const heldKey = (who: ReviewAssignee, action: string) =>
    `${holderKey(who)}:${action}`;
  /** The stage's default reviewer, from the workflow's settings, read once. */
  const reviewerOf = async (stage: string) => {
    settings ??=
      (await readWorkflowSettings(adapter, workflow.slug))?.settings ?? {};
    return settings.defaultReviewers?.[stage];
  };
  /** Asks each of `whos` not asked yet whether they hold `action`, all in one batch. */
  const ask = async (whos: readonly ReviewAssignee[], action: string) => {
    const unasked = whos.filter(who => !holds.has(heldKey(who, action)));
    if (unasked.length === 0) return;
    const answers = await holderAnswers(adapter, unasked, action, slug);
    for (const who of unasked) {
      holds.set(heldKey(who, action), answers.get(holderKey(who)) === "holds");
    }
  };
  /** Whether `who`, if anyone, may take `taken` on a part `enteredBy` brought into its stage. */
  const answer = async (
    who: ReviewAssignee | undefined | null,
    taken: StageStep,
    enteredBy: string | null
  ): Promise<"none" | "holds" | "lacks"> => {
    if (!who) return "none";
    await ask([who], taken.action);
    return holds.get(heldKey(who, taken.action)) === true &&
      takesAsPerson(who, taken.step, enteredBy)
      ? "holds"
      : "lacks";
  };
  return {
    async prime(parts) {
      const byAction = new Map<string, ReviewAssignee[]>();
      for (const part of parts) {
        const taken = stageStep(workflow, part.stage);
        const who = taken && (part.assignee ?? (await reviewerOf(taken.stage)));
        if (taken && who) {
          byAction.set(taken.action, [
            ...(byAction.get(taken.action) ?? []),
            who,
          ]);
        }
      }
      for (const [action, whos] of byAction) await ask(whos, action);
    },
    async decide(part) {
      const taken = stageStep(workflow, part.stage);
      if (taken === null) return null;
      const reviewer = part.assignee
        ? undefined
        : await reviewerOf(taken.stage);
      const whom = waitsFor({
        assignee: await answer(part.assignee, taken, part.enteredBy),
        reviewer: await answer(reviewer, taken, part.enteredBy),
      });
      if (whom === "assignee" && part.assignee) {
        return { kind: "one", who: part.assignee };
      }
      if (whom === "reviewer" && reviewer)
        return { kind: "one", who: reviewer };
      return { kind: "holders", action: taken.action };
    },
  };
}

/** A stage's primary step and the action it needs. */
interface StageStep {
  stage: string;
  action: string;
  step: ResolvedWorkflowStep;
}

/** `stage`'s primary step, or null where there is no stage or no step out of it. */
function stageStep(workflow: Workflow, stage: string | null): StageStep | null {
  if (stage === null) return null;
  const action = primaryAction(workflow, stage);
  const step = primaryStep(workflow, stage);
  return action === null || step === undefined ? null : { stage, action, step };
}

/**
 * Whether `who` is not refused `step` as the one who brought the part into its stage: a role's
 * other holders may take it; a person refused self-approval may not.
 */
function takesAsPerson(
  who: ReviewAssignee,
  step: ResolvedWorkflowStep,
  enteredBy: string | null
): boolean {
  return (
    who.kind !== "user" ||
    takesStep(step, { kind: "user", userId: who.id }, who.id, enteredBy)
  );
}

/**
 * Who each of `parts` waits for, in order, for a document of the collection or Single `slug` under
 * `registered`'s workflow.
 *
 * @experimental
 */
export async function partsWaitingFor(
  adapter: DrizzleAdapter,
  registered: RegisteredWorkflow,
  slug: string,
  parts: readonly WaitingPartInput[]
): Promise<(PartWaitingFor | null)[]> {
  const decider = partWaitsDecider(adapter, registered.workflow, slug);
  await decider.prime(parts);
  const byAction = new Map<string, string[]>();
  /** Everyone who may take a step needing `action`, by the roles that may. */
  const holders = async (action: string): Promise<Waiting> => {
    let ids = byAction.get(action);
    if (ids === undefined) {
      ids = await rolesHolding(adapter, action, slug);
      byAction.set(action, ids);
    }
    return { kind: "roles", ids };
  };

  const waiting: Waiting[] = [];
  for (const part of parts) {
    const decided = await decider.decide(part);
    if (decided === null) waiting.push(null);
    else if (decided.kind === "one") waiting.push(decided.who);
    else waiting.push(await holders(decided.action));
  }
  return named(adapter, waiting);
}

/** Each part's waiting, with the names of the people and roles it names. */
async function named(
  adapter: DrizzleAdapter,
  waiting: readonly Waiting[]
): Promise<(PartWaitingFor | null)[]> {
  const users: string[] = [];
  const roles: string[] = [];
  for (const each of waiting) {
    if (each === null) continue;
    if ("ids" in each) roles.push(...each.ids);
    else if (each.kind === "user") users.push(each.id);
    else roles.push(each.id);
  }
  const names = await namesOf(adapter, { users, roles });
  const role = (id: string): WaitingRole => ({
    id,
    name: names.roles.get(id) ?? null,
  });
  return waiting.map((each): PartWaitingFor | null => {
    if (each === null) return null;
    if ("ids" in each) {
      return {
        kind: "roles",
        roles: each.ids
          .map(role)
          .sort(
            (a, b) =>
              (a.name ?? "").localeCompare(b.name ?? "") ||
              a.id.localeCompare(b.id)
          ),
      };
    }
    if (each.kind === "user") {
      return {
        kind: "user",
        id: each.id,
        name: names.users.get(each.id) ?? null,
      };
    }
    // A role assigned: anyone holding it.
    return { kind: "roles", roles: [role(each.id)] };
  });
}
