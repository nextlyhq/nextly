/**
 * Whether a document can join a release, and the id it joins under.
 *
 * Decided here, in the releases domain, so every way in — REST, the Direct
 * API, the admin — makes the same checks. They were the REST route's alone
 * once, and the Direct API then accepted a member REST refuses, which was
 * recorded, scheduled, and failed at its instant with nobody watching.
 *
 * The domain asks only two questions of the outside world, through
 * {@link ReleaseTargetReader}: can the caller read this document, and does its
 * collection or Single have a draft/published lifecycle. The answers come from
 * the content API and the schema registries, which only the wiring holds.
 *
 * @module domains/releases/release-targets
 */
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { NextlyError } from "../../errors";

/** The document a member names, as the caller sent it. */
export interface ReleaseTargetInput {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
}

/**
 * Who is asking, whole: the person, whether the call is trusted, and — for a
 * scoped API key or a caller whose rules read roles — the key's own grants and
 * the role set. Carried entire so the read is judged as THIS caller; reduced
 * to a user id, a key would be judged by its owner's grants and a role rule
 * by an empty role list.
 */
export interface ReleaseTargetCaller {
  userId: string | null;
  trusted: boolean;
  authenticatedScope?: AuthenticatedScope;
  userRoles?: string[];
}

/** What the domain needs to know about a target, from outside it. */
export interface ReleaseTargetReader {
  /**
   * The document, read as the caller (or unchecked for a trusted caller), in
   * any status — a release most often publishes a draft. `null` when it is
   * not there or the caller may not read it: the two are one answer, so this
   * cannot be used to probe for ids.
   */
  readDocument(
    target: ReleaseTargetInput,
    caller: ReleaseTargetCaller
  ): Promise<{ id?: unknown } | null>;
  /**
   * Whether the collection or Single declares a draft/published lifecycle, as
   * the schema declared it. `false` when that cannot be answered: a member
   * whose lifecycle is unknown is one the drain may not be able to perform.
   */
  declaresLifecycle(
    scopeKind: ReleaseTargetInput["scopeKind"],
    scopeSlug: string
  ): Promise<boolean>;
}

/**
 * Refuse a target that cannot be released, and answer the id the member must
 * carry — for a Single, the row's own rather than whatever the caller sent.
 */
export async function resolveReleaseTarget(
  reader: ReleaseTargetReader,
  target: ReleaseTargetInput,
  caller: ReleaseTargetCaller
): Promise<string> {
  const found = await reader.readDocument(target, caller);
  if (found === null) {
    // A typo or a stale id is accepted happily by the write path — nothing
    // joins a member to a document — and then fails at the scheduled instant,
    // holding the release open.
    throw NextlyError.notFound({
      logContext: { reason: "release-member-target-missing", ...target },
    });
  }

  // A target with no publish lifecycle can never satisfy the member:
  // materialisation works by writing the status field, so with the lifecycle
  // disabled the drain records a failed action and the release stays
  // scheduled forever. Read from the SCHEMA, not probed on the row — a
  // collection with the lifecycle disabled may legally define an ordinary
  // field called `status`, which materialisation would then overwrite.
  if (!(await reader.declaresLifecycle(target.scopeKind, target.scopeSlug))) {
    throw NextlyError.invalidInput({
      message: `\`${target.scopeSlug}\` has no draft/published lifecycle, so it cannot be scheduled in a release.`,
      logContext: {
        reason: "target-without-lifecycle",
        scopeKind: target.scopeKind,
        scopeSlug: target.scopeSlug,
      },
    });
  }

  // A Single is addressed by slug, so any id reaches here — but release
  // visibility compares stored decisions against the row's real id, and a
  // member carrying a stale one is invisible to reads until a drain runs.
  if (target.scopeKind === "single") {
    if (typeof found.id !== "string") {
      throw NextlyError.internal({
        logContext: {
          reason: "single-without-id",
          scopeSlug: target.scopeSlug,
        },
      });
    }
    return found.id;
  }
  return target.entryId;
}
