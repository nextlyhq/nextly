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
 * trusted. Every recovery point, trusted or checked, is stored as REST stores
 * one, without password values.
 *
 * @module plugins/plugin-versions
 */

import {
  assertDocumentUpdatable,
  assertVersionDocumentReadable,
  redactSnapshotForUser,
  resolveVersionsPolicy,
  stripAutosavePasswords,
} from "../api/versions-access";
import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { runWithCallerScope } from "../auth/caller-scope";
import { canReadEntity, readAccessCaller } from "../auth/entity-read-access";
import { runAsPrincipal } from "../auth/principal-scope";
import type { RequestActor } from "../auth/request-actor";
import {
  authorizeChecked,
  checkedCaller,
  directApiActor,
} from "../direct-api/namespaces/helpers";
import type { DirectAPIConfig } from "../direct-api/types";
import type { UserContext } from "../domains/singles/types";
import { discardWorkingDraft } from "../domains/versions/discard-working-draft";
import {
  serializeVersionSnapshot,
  type AutosaveWriteResult,
  type VersionRef,
  type VersionRow,
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
   * naming anyone else is refused. Stored, whoever the call is made as,
   * without password values, as REST stores one.
   */
  autosave(
    input: AutosaveInput,
    opts?: ServiceOpts
  ): Promise<AutosaveWriteResult>;
}

/** A plugin's options, as every plugin service resolves them. */
type ResolvedOpts = Awaited<ReturnType<typeof resolveServiceOpts>>;

/**
 * Run one write as the call names it: in a frame of its own, with the person
 * it names (or none) and the scope it resolved, as `services.collections` runs
 * its calls. Without the fresh frame, a write the plugin makes from inside an
 * operation run as one of its own people would be judged as that person
 * rather than as the caller it names.
 */
async function asCalled<T>(
  opts: ServiceOpts | undefined,
  run: (resolved: ResolvedOpts) => Promise<T>
): Promise<T> {
  const named = opts ?? {};
  const resolved = await resolveServiceOpts(named);
  return runAsPrincipal(named.principal ?? null, () =>
    runWithCallerScope(resolved.authenticatedScope, () => run(resolved))
  );
}

/**
 * The snapshot as the store will keep it, copied so it can be stripped
 * without changing the plugin's object. Read back from the store's own
 * serialization, so it takes what the store takes: a function is left out, a
 * `toJSON` is honoured, and what cannot be written is refused as it always was.
 */
function storedCopy(snapshot: unknown): unknown {
  return JSON.parse(serializeVersionSnapshot(snapshot)) as unknown;
}

/** The person a checked history write is made as. */
interface HistoryWriter {
  user: UserContext;
  authenticatedScope?: AuthenticatedScope;
  actor: RequestActor;
}

/**
 * The history handler's own gates, in its order: the entity read permission
 * (refused as not found), the document readable (not found), the document
 * updatable (forbidden), and for an autosave the entity's autosave setting.
 */
async function assertHandlerGates(
  ref: VersionRef & { scopeKind: "collection" | "single" },
  user: UserContext,
  resolved: ResolvedOpts,
  write: "label" | "discard" | "autosave",
  logContext: Record<string, unknown>
): Promise<void> {
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
  // With what the plugin handed its hooks, so a read hook that narrows by the
  // request or the context answers as it would for the caller's own read.
  await assertVersionDocumentReadable(
    ref.scopeKind,
    ref.scopeSlug,
    ref.entryId,
    user,
    authenticatedScope,
    {
      ...(resolved.request === undefined ? {} : { request: resolved.request }),
      ...(resolved.context === undefined ? {} : { context: resolved.context }),
    }
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
  resolved: ResolvedOpts,
  write: "label" | "discard" | "autosave"
): Promise<HistoryWriter | null> {
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
  // Page history was refused above, so the kind is a collection or a Single.
  await assertHandlerGates(
    { ...ref, scopeKind: ref.scopeKind },
    user,
    resolved,
    write,
    logContext
  );
  const authenticatedScope = resolved.authenticatedScope;

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

/**
 * A checked discard, made the way REST's is: through the shared discard,
 * which removes the draft while it holds the document, so a save landing
 * meanwhile is not lost, and records the discard in the document's history.
 *
 * That record names who acted, and a plugin does not know an API key's own
 * id, so a discard made with a key is refused rather than recorded against
 * the key's owner, who did not make it. The count is of the drafts removed.
 */
async function discardAsWriter(
  versions: VersionsService,
  ref: VersionRef,
  locale: string | null,
  writer: HistoryWriter
): Promise<number> {
  if (writer.actor.id === undefined) {
    throw NextlyError.forbidden({
      logContext: {
        // A key's own id does not reach plugin services yet, so a discard
        // made with one cannot be recorded as the key.
        reason: "checked-history-discard-by-key",
        scopeKind: ref.scopeKind,
        scopeSlug: ref.scopeSlug,
        entryId: ref.entryId,
      },
    });
  }
  // Only collections and Singles have a working draft; page history was
  // refused before this, when the writer was judged.
  const scopeKind = ref.scopeKind === "single" ? "single" : "collection";
  const before = await versions.listWorkingDraftParts(ref);
  await discardWorkingDraft({
    scopeKind,
    slug: ref.scopeSlug,
    entryId: ref.entryId,
    user: writer.user,
    locale,
    authenticatedScope: writer.authenticatedScope,
    actor: writer.actor,
  });
  const after = await versions.listWorkingDraftParts(ref);
  return Math.max(0, before.length - after.length);
}

/** `ctx.services.versions`' writes, over the host's versions service. */
export function pluginVersionWrites(
  service: () => VersionsService
): PluginVersionWrites {
  return {
    setLabel(ref, versionNo, label, by, opts) {
      return asCalled(opts, async resolved => {
        const writer = await checkedWriter(ref, resolved, "label");
        if (!writer) return service().setLabel(ref, versionNo, label, by);
        if (by && !namesWriter(by.actor, writer)) {
          refuseOtherAuthor(ref, "label");
        }
        // The namer is the writer, by the name the writer is known by: never
        // a name the plugin passes, which could be anyone's. A key whose own
        // id is not known here is named by no one, as an event naming its
        // owner would put a person against a change they did not make.
        const namer =
          writer.actor.id === undefined
            ? undefined
            : { actor: writer.actor, personName: writer.user.name ?? null };
        const row = await service().setLabel(ref, versionNo, label, namer);
        // The version is a copy of the document, so it is handed back as the
        // caller may read it: a field their read rules withhold stays out, as
        // it does from every version read.
        await redactSnapshotForUser(
          row.snapshot,
          ref.scopeKind,
          ref.scopeSlug,
          writer.user,
          writer.authenticatedScope
        );
        return row;
      });
    },

    deleteWorkingDraft(ref, locale, opts) {
      return asCalled(opts, async resolved => {
        const writer = await checkedWriter(ref, resolved, "discard");
        if (!writer) return service().deleteWorkingDraft(ref, locale);
        return discardAsWriter(service(), ref, locale, writer);
      });
    },

    autosave(input, opts) {
      return asCalled(opts, async resolved => {
        const writer = await checkedWriter(input.ref, resolved, "autosave");
        const named = input.createdBy ?? null;
        if (writer && named !== null && named !== writer.user.id) {
          refuseOtherAuthor(input.ref, "autosave");
        }
        // Stored as REST stores one, without password values, whoever the
        // call is made as.
        const snapshot = storedCopy(input.snapshot);
        await stripAutosavePasswords(
          input.ref.scopeKind,
          input.ref.scopeSlug,
          snapshot
        );
        return service().autosave({
          ...input,
          snapshot,
          ...(writer ? { createdBy: writer.user.id } : {}),
        });
      });
    },
  };
}
