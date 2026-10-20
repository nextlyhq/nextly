/**
 * `ctx.services.versions`: the plugin view of version history, with its writes
 * checked when the plugin says who it acts for.
 *
 * Naming a version, discarding a working draft and recording an autosave each
 * take a trailing {@link ServiceOpts}. A write made as a signed-in person is
 * judged as the REST history routes judge that person, by the same gates in the
 * same order: `update-<slug>` to write at all, then the document must be one
 * they can read (refused as not found, so the refusal does not confirm it
 * exists) and one they may update, and an autosave needs the entity's autosave
 * to be on. The person is the author, as on REST: a write naming no namer or
 * author is recorded as theirs, and one naming someone else is refused. A
 * page's history has no REST write to be judged as, so a checked write to it is
 * refused rather than guessed at.
 *
 * The plugin acting as itself, with no options or `{ as: "system" }`, stays
 * trusted and writes exactly what it is given, as before.
 *
 * @module plugins/plugin-versions
 */

import {
  assertDocumentUpdatable,
  assertVersionDocumentReadable,
  resolveVersionsPolicy,
} from "../api/versions-access";
import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { canReadEntity, readAccessCaller } from "../auth/entity-read-access";
import type { RequestActor } from "../auth/request-actor";
import type { DirectAPIConfig } from "../direct-api/types";
import {
  authorizeChecked,
  checkedCaller,
  directApiActor,
} from "../direct-api/namespaces/helpers";
import type { UserContext } from "../domains/singles/types";
import type {
  AutosaveWriteResult,
  VersionRef,
  VersionRow,
} from "../domains/versions/versions-repository";
import type { VersionsService } from "../domains/versions/versions-service";
import { NextlyError } from "../errors/nextly-error";

import { resolveServiceOpts, type ServiceOpts } from "./service-opts";

/** The history reads a plugin is handed as they are. */
export const PLUGIN_VERSIONS_READS = [
  "list",
  "get",
  "getAutosave",
  "pendingEditRows",
] as const satisfies readonly (keyof VersionsService)[];

/** Who named a version, as `VersionsService.setLabel` takes it. */
type NamedBy = Parameters<VersionsService["setLabel"]>[3];

/** One autosave, as `VersionsService.autosave` takes it. */
type AutosaveInput = Parameters<VersionsService["autosave"]>[0];

/** The history writes, each checked when the plugin says who it acts for. */
export interface PluginVersionWrites {
  /**
   * @experimental Name a version, or clear its name with `null`. Made as a
   * person, the person needs to read and update the document, and is the one
   * who named it: `by` left out records them, and a `by` naming anyone else is
   * refused.
   */
  setLabel(
    ref: VersionRef,
    versionNo: number,
    label: string | null,
    by?: NamedBy,
    opts?: ServiceOpts
  ): Promise<VersionRow>;
  /**
   * @experimental Discard a document's working draft in one locale. Made as a
   * person, the person needs to read and update the document.
   */
  deleteWorkingDraft(
    ref: VersionRef,
    locale: string | null,
    opts?: ServiceOpts
  ): Promise<number>;
  /**
   * @experimental Record an author's recovery point. Made as a person, the
   * person needs to read and update the document, its autosave must be on, and
   * the point is theirs: `createdBy` left out files it under them, and one
   * naming anyone else is refused.
   */
  autosave(
    input: AutosaveInput,
    opts?: ServiceOpts
  ): Promise<AutosaveWriteResult>;
}

/** The person a checked history write is made as. */
interface HistoryWriter {
  user: UserContext;
  authenticatedScope?: AuthenticatedScope;
  actor: RequestActor;
}

/**
 * The person this write is made as, judged as REST judges them, or `null` for
 * the plugin acting as itself.
 *
 * Resolved by the rule every plugin service uses, then asked the seam's own
 * question, so a call checked on `services.versions` refuses whom a checked
 * Direct API call refuses: a call naming nobody is refused as unauthenticated,
 * a plugin-defined person among them, since history has no rule such a person
 * can be judged by.
 */
async function checkedWriter(
  ref: VersionRef,
  opts: ServiceOpts | undefined,
  write: "label" | "discard" | "autosave"
): Promise<HistoryWriter | null> {
  if (opts === undefined) return null;
  const resolved = await resolveServiceOpts(opts);
  const config: DirectAPIConfig = {
    overrideAccess: resolved.overrideAccess,
    user: resolved.user,
    actor: resolved.authenticatedScope,
  };
  const caller = checkedCaller({}, config);
  if (!caller) return null;

  const logContext = {
    write,
    scopeKind: ref.scopeKind,
    scopeSlug: ref.scopeSlug,
    entryId: ref.entryId,
    userId: caller.userId,
  };
  if (ref.scopeKind === "page") {
    throw NextlyError.forbidden({
      logContext: { ...logContext, reason: "checked-page-history-write" },
    });
  }

  // The route's half: both the collection and the Single history routes
  // earn `update-<slug>` through `requireCollectionAccess`, whose decision
  // `authorizeChecked` asks.
  await authorizeChecked(caller, {
    action: "update",
    resource: ref.scopeSlug,
  });

  // The handler's half, in the handler's order.
  const user = resolved.user as unknown as UserContext;
  const authenticatedScope = resolved.authenticatedScope;
  if (
    !(await canReadEntity(
      ref.scopeSlug,
      readAccessCaller({ user, authenticatedScope })
    ))
  ) {
    throw NextlyError.notFound({
      logContext: { ...logContext, reason: "history-write-read-denied" },
    });
  }
  await assertVersionDocumentReadable(
    ref.scopeKind,
    ref.scopeSlug,
    ref.entryId,
    user,
    authenticatedScope
  );
  await assertDocumentUpdatable(
    ref.scopeKind,
    ref.scopeSlug,
    ref.entryId,
    user,
    authenticatedScope
  );
  if (write === "autosave") {
    const policy = await resolveVersionsPolicy(ref.scopeKind, ref.scopeSlug);
    if (!policy?.drafts?.autosave?.enabled) {
      throw NextlyError.forbidden({
        logContext: { ...logContext, reason: "autosave-not-enabled" },
      });
    }
  }

  return {
    user,
    authenticatedScope,
    actor: directApiActor({}, config) ?? { type: "user", id: user.id },
  };
}

/**
 * Whether `named` is the writer. A key carries no id the writer can be
 * matched on, so a key is matched by kind alone; the actor recorded is always
 * the writer's own, never the one the plugin named.
 */
function namesWriter(named: RequestActor, writer: HistoryWriter): boolean {
  if (named.type !== writer.actor.type) return false;
  return writer.actor.id === undefined || named.id === writer.actor.id;
}

function refuseOtherAuthor(
  ref: VersionRef,
  write: "label" | "autosave"
): never {
  throw NextlyError.forbidden({
    logContext: {
      reason: "checked-history-write-names-another-author",
      write,
      scopeKind: ref.scopeKind,
      scopeSlug: ref.scopeSlug,
      entryId: ref.entryId,
    },
  });
}

/** `ctx.services.versions`' writes, over the host's versions service. */
export function pluginVersionWrites(
  service: () => VersionsService
): PluginVersionWrites {
  return {
    async setLabel(ref, versionNo, label, by, opts) {
      const writer = await checkedWriter(ref, opts, "label");
      if (!writer) return service().setLabel(ref, versionNo, label, by);
      if (by && !namesWriter(by.actor, writer)) refuseOtherAuthor(ref, "label");
      return service().setLabel(ref, versionNo, label, {
        actor: writer.actor,
        personName: by?.personName ?? writer.user.name ?? null,
      });
    },

    async deleteWorkingDraft(ref, locale, opts) {
      await checkedWriter(ref, opts, "discard");
      return service().deleteWorkingDraft(ref, locale);
    },

    async autosave(input, opts) {
      const writer = await checkedWriter(input.ref, opts, "autosave");
      if (!writer) return service().autosave(input);
      const named = input.createdBy ?? null;
      if (named !== null && named !== writer.user.id) {
        refuseOtherAuthor(input.ref, "autosave");
      }
      return service().autosave({ ...input, createdBy: writer.user.id });
    },
  };
}
