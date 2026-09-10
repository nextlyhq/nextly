/**
 * Audit domain — the activity entry a SETTINGS mutation records.
 *
 * Settings resources are not content: they have no collection, no entry and no
 * write transaction to join. They are recorded AFTER their write commits, which
 * is the opposite of {@link recordMutationActivity} and deliberate. The mutation
 * has already happened by then, so turning a completed change into a reported
 * failure because the trail could not be written would tell the caller the
 * opposite of the truth.
 *
 * Two rules shape every entry, and both come from the first resource recorded
 * this way — email providers, whose rows hold the credentials that send
 * password-reset mail:
 *
 * **Names, never values.** An entry says which fields a change touched and
 * carries no value from any of them. An audit row is read by more people than
 * the record it describes, and a trail that leaks what it audits is worse than
 * none.
 *
 * **An entry means something moved.** A form submits every field whether or not
 * the operator touched it, so an update that changed nothing still arrives here.
 * Recording it would render as "updated X" in the feed, which is a claim that
 * something happened.
 *
 * @module domains/audit/record-settings-activity
 */

import type { RequestActor, RequestActorType } from "../../auth/request-actor";
import { container } from "../../di/container";
import type {
  ActivityLogAction,
  ActivityLogService,
} from "../../services/dashboard/activity-log-service";
import { SYSTEM_CONTEXT } from "../../shared/types";

/**
 * The actor a trail row records, or `null` when this actor produces no entry.
 *
 * Answers both halves of the question at once — whether to record, and as WHAT
 * — because they are decided by the same facts and a caller that asked them
 * separately could record a row whose kind disagreed with the gate that let it
 * through.
 *
 * Every actor that can name itself belongs in the trail. The rule used to admit
 * a signed-in person alone, because a row's only identity column was a user
 * reference joined to the accounts table: a key's own id there found no account
 * and was filed as an already-erased identity, so a key write was dropped
 * rather than recorded badly. `actor_type` carries the kind now and `user_id`
 * is set only for a `user`, so a key, an import or a job records what it is.
 *
 * Exported and shared rather than restated per resource. The rule is one
 * question, and every place that answers it separately is a place it can drift
 * — which it did: the content trail carried its own copy and the two had to be
 * widened together.
 */
export function recordableActor(
  actor?: RequestActor | null
): { type: RequestActorType; id: string } | null {
  if (!actor?.id) return null;

  // A SYSTEM write is refused, and the reason is an ORDERING one rather than
  // anything about the actor itself.
  //
  // `registerServices` awaits `initializePlugins` before `init.ts` reaches
  // `runProdMigrationsIfEnabled`, so a plugin's `init()` hook writing content
  // runs BEFORE pending migrations do. On an upgraded database that has not
  // migrated yet, `activity_log` is still on its old shape, and an insert
  // naming a column it does not have fails — a failure this recorder
  // PROPAGATES, so it would take the plugin's init, and the boot, with it.
  //
  // The hazard belongs to any core column added to this table rather than to
  // this one, so it is recorded here and fixed where the ordering is decided.
  //
  // A key is not exposed to it: it arrives on a request, over a transport,
  // against a database that has finished booting.
  if (actor.type === "system") return null;

  // `SYSTEM_CONTEXT` carries the reserved user id `system`, so a seed or a
  // migration with no transport actor to override it arrives as a USER actor.
  // No account owns that id, and it is a system write wearing a user's shape —
  // so it is refused for the reason above rather than filed as a person.
  // Compared against the sentinel itself so the two cannot drift apart.
  if (actor.id === SYSTEM_CONTEXT.user?.id) return null;
  return { type: actor.type, id: actor.id };
}

/** One recorded settings mutation. */
export interface SettingsActivityInput {
  action: ActivityLogAction;
  /**
   * The activity-log `collection` these entries are filed under.
   *
   * Not a content collection. The column is a free string and the feed groups
   * by it, so a settings resource gets a name of the same shape rather than a
   * new mechanism — the alternative is a second trail with its own reader.
   */
  collection: string;
  /** The row's id. */
  entityId: string;
  /**
   * What the row was called at the time of the action.
   *
   * Denormalized deliberately: the feed outlives the record it names, and a
   * deleted row would otherwise be unlabelled — the one entry whose subject the
   * reader can no longer recover any other way.
   */
  entityTitle: string;
  /**
   * Field NAMES the action touched. Never values.
   *
   * Absent for a create and a delete: one reports every field it wrote and the
   * other every field it removed, neither of which distinguishes anything the
   * action itself has not already said.
   */
  changedFields?: ReadonlyArray<string>;
  /** Resource-specific facts worth reading later. Never a secret. */
  metadata?: Record<string, unknown>;
  actor?: RequestActor | null;
}

/**
 * Whether this mutation moved anything worth an entry.
 *
 * Empty is only meaningful for an update. A create and a delete carry no field
 * list because the action already says what they did, so an absent list there
 * is a full description rather than an empty one.
 */
function worthRecording(input: SettingsActivityInput): boolean {
  if (input.action !== "update") return true;
  return (input.changedFields?.length ?? 0) > 0;
}

/**
 * Record one settings mutation.
 *
 * PROPAGATES a write failure to its caller, which is what makes the failure
 * visible: each caller wraps this and logs against the resource it was
 * recording. An audit write that took the surrounding request down would make
 * the trail a liability rather than a record, so the caller swallows it after
 * logging — but a seam that swallowed it here would leave nothing to log.
 */
export async function recordSettingsActivity(
  input: SettingsActivityInput
): Promise<void> {
  const actor = recordableActor(input.actor);
  if (!actor) return;
  if (!worthRecording(input)) return;

  let service: ActivityLogService;
  try {
    service = container.get<ActivityLogService>("activityLogService");
  } catch {
    // Absent registration is a boot-time fact about how the host assembled its
    // container, not a write that failed.
    return;
  }

  // Deliberately NOT wrapped in a catch here. A rejection has to reach the
  // caller's own handler, which logs it against the resource being recorded —
  // swallowing it at this seam would make a trail that stopped being written
  // invisible, which is worse than the failure it hides. Callers own the
  // never-throw guarantee and the log line that goes with it.
  await service.logActivity({
    actorType: actor.type,
    userId: actor.id,
    action: input.action,
    collection: input.collection,
    entryId: input.entityId,
    // Stated rather than left to the registry: an upgraded install may hold a
    // real collection under this same namespace, and the feed must not treat a
    // credential rotation as a document in it.
    subjectKind: "settings",
    entryTitle: input.entityTitle,
    metadata: {
      ...input.metadata,
      ...(input.changedFields && input.changedFields.length > 0
        ? { changedFields: [...input.changedFields] }
        : {}),
    },
  });
}

/**
 * The top-level field names a change touched.
 *
 * Compared as JSON so a nested object is judged by content rather than by
 * identity, which would report every update as a change.
 */
export function changedTopLevelFields(
  previous: Record<string, unknown>,
  incoming: Record<string, unknown>
): string[] {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (JSON.stringify(previous[key]) !== JSON.stringify(value)) {
      changed.push(key);
    }
  }
  return changed;
}
