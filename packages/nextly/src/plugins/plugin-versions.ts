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
  assertVersionLanguageReadable,
  redactSnapshotForUser,
  resolveVersionsPolicy,
  stripAutosavePasswords,
} from "../api/versions-access";
import {
  everyLanguage,
  registeredWriteAsNamedLanguagesFor,
  withRuleLanguage,
} from "../auth/access/rule-language";
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

/**
 * What the plugin handed its hooks, for every read a checked write makes of
 * the document, so a read hook that narrows by the request or the context
 * answers as it would for the caller's own read.
 */
function hookInputsOf(resolved: ResolvedOpts): {
  request?: Request;
  context?: Record<string, unknown>;
} {
  return {
    ...(resolved.request === undefined ? {} : { request: resolved.request }),
    ...(resolved.context === undefined ? {} : { context: resolved.context }),
  };
}

/** The person a checked history write is made as. */
interface HistoryWriter {
  user: UserContext;
  authenticatedScope?: AuthenticatedScope;
  actor: RequestActor;
  /** What the plugin handed its hooks, for the write's later reads. */
  hookInputs: { request?: Request; context?: Record<string, unknown> };
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
  logContext: Record<string, unknown>,
  // The version a label names, whose own language is asked about.
  versionNo?: number
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
    hookInputsOf(resolved)
  );
  // A version is named in its own language's history, so the writer must be
  // able to read that language. Asked before the update rule, as REST's label
  // route asks it, so a caller refused both is told the version is not there
  // rather than that it may not change it.
  if (versionNo !== undefined) {
    await assertVersionLanguageReadable(
      {
        scopeKind: ref.scopeKind,
        slug: ref.scopeSlug,
        entryId: ref.entryId,
        user,
        authenticatedScope,
      },
      versionNo,
      hookInputsOf(resolved)
    );
  }
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
  write: "label" | "discard" | "autosave",
  // The version a label names, and the language a discard or an autosave
  // names, as the plugin passes it.
  at: { versionNo?: number; locale?: string | null } = {}
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
  // `authorizeChecked` asks, telling the rule the languages that route tells
  // it: a discard or an autosave the language it names, kept as named, and a
  // label every language. Set here rather than inherited, so a plugin calling
  // from inside an operation in one language is judged as REST judges the
  // route, not in that operation's language.
  await withRuleLanguage(
    write === "label"
      ? everyLanguage()
      : registeredWriteAsNamedLanguagesFor(at.locale || undefined),
    () =>
      authorizeChecked(caller, {
        action: "update",
        resource: ref.scopeSlug,
      })
  );

  // The handler's half, in the handler's order.
  const user = resolved.user as unknown as UserContext;
  // Page history was refused above, so the kind is a collection or a Single.
  await assertHandlerGates(
    { ...ref, scopeKind: ref.scopeKind },
    user,
    resolved,
    write,
    logContext,
    at.versionNo
  );
  const authenticatedScope = resolved.authenticatedScope;

  return {
    user,
    authenticatedScope,
    actor: directApiActor({}, config) ?? { type: "user", id: user.id },
    hookInputs: hookInputsOf(resolved),
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
  ref: VersionRef,
  locale: string | null,
  writer: HistoryWriter
): Promise<number> {
  refuseUnnamedKey(ref, writer, "discard");
  // Only collections and Singles have a working draft; page history was
  // refused before this, when the writer was judged.
  const scopeKind = ref.scopeKind === "single" ? "single" : "collection";
  const { removed } = await discardWorkingDraft({
    scopeKind,
    slug: ref.scopeSlug,
    entryId: ref.entryId,
    user: writer.user,
    locale,
    authenticatedScope: writer.authenticatedScope,
    actor: writer.actor,
    ...writer.hookInputs,
  });
  return removed;
}

/**
 * Refuse a write made with an API key whose own id is not known here. A
 * plugin does not yet receive a key's id, and a discard or a recovery point
 * made with one would have to be recorded as, or filed under, the key's
 * owner, who did not make it: a recovery point so filed would overwrite the
 * owner's own unsaved work.
 */
function refuseUnnamedKey(
  ref: VersionRef,
  writer: HistoryWriter,
  write: "discard" | "autosave"
): void {
  if (writer.actor.id !== undefined) return;
  throw NextlyError.forbidden({
    logContext: {
      reason: "checked-history-write-by-unnamed-key",
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
    setLabel(ref, versionNo, label, by, opts) {
      return asCalled(opts, async resolved => {
        const writer = await checkedWriter(ref, resolved, "label", {
          versionNo,
        });
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
        // The version is a copy of the document, so it is handed back as the
        // writer may read it. Redacted before anything is written: a
        // redaction that cannot be made refuses the call with nothing changed,
        // rather than failing after the label and its history event are in.
        const shown = await service().get(ref, versionNo);
        await redactSnapshotForUser(
          shown.snapshot,
          ref.scopeKind,
          ref.scopeSlug,
          writer.user,
          writer.authenticatedScope
        );
        const row = await service().setLabel(ref, versionNo, label, namer);
        return { ...row, snapshot: shown.snapshot };
      });
    },

    deleteWorkingDraft(ref, locale, opts) {
      return asCalled(opts, async resolved => {
        const writer = await checkedWriter(ref, resolved, "discard", {
          locale,
        });
        if (!writer) return service().deleteWorkingDraft(ref, locale);
        return discardAsWriter(ref, locale, writer);
      });
    },

    autosave(input, opts) {
      return asCalled(opts, async resolved => {
        const writer = await checkedWriter(input.ref, resolved, "autosave", {
          locale: input.locale,
        });
        if (writer) refuseUnnamedKey(input.ref, writer, "autosave");
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
