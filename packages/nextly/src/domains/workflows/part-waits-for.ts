/**
 * Who each part of a document waits for, as the review state read names it: the part's assignee;
 * else its stage's default reviewer, where they may take the stage's primary step, as a step into
 * the stage would have assigned them; else the roles that may take that step. A stage with no step
 * out of it waits for no one.
 *
 * Read on the pool, after the review state's own transaction: who holds a permission is asked of
 * the role and permission services, which read on the pool (`holders`). Each stage and each action
 * is answered once for the whole document, and every name is read in one statement per kind.
 *
 * @module domains/workflows/part-waits-for
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { holderAnswer, namesOf, rolesHolding } from "./holders";
import type { RegisteredWorkflow } from "./registry";
import type { ReviewAssignee } from "./review-state-repository";
import { primaryAction } from "./steps";
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

/** One part as this asks of it: where it stands, and who it is assigned to. */
export interface WaitingPartInput {
  stage: string | null;
  assignee: ReviewAssignee | null;
}

/** Who a part waits for, by id, before the names are read. */
type Waiting = ReviewAssignee | { kind: "roles"; ids: string[] } | null;

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
  const { workflow } = registered;
  let settings: WorkflowSettings | undefined;
  const byStage = new Map<string, Waiting>();
  const byAction = new Map<string, string[]>();

  /** Who an unassigned part in `stage` waits for, whose primary step needs `action`. */
  const unassigned = async (stage: string, action: string) => {
    const known = byStage.get(stage);
    if (known !== undefined) return known;
    settings ??=
      (await readWorkflowSettings(adapter, workflow.slug))?.settings ?? {};
    const reviewer = settings.defaultReviewers?.[stage];
    let waiting: Waiting;
    if (
      reviewer &&
      (await holderAnswer(adapter, reviewer, action, slug)) === "holds"
    ) {
      waiting = reviewer;
    } else {
      let ids = byAction.get(action);
      if (ids === undefined) {
        ids = await rolesHolding(adapter, action, slug);
        byAction.set(action, ids);
      }
      waiting = { kind: "roles", ids };
    }
    byStage.set(stage, waiting);
    return waiting;
  };

  const waiting: Waiting[] = [];
  for (const part of parts) {
    const action =
      part.stage === null ? null : primaryAction(workflow, part.stage);
    if (part.stage === null || action === null) waiting.push(null);
    else if (part.assignee) waiting.push(part.assignee);
    else waiting.push(await unassigned(part.stage, action));
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
