/**
 * Direct API `nextly.versions.*`: a document's history, from server code.
 *
 * The same operations as the REST history routes: list a document's versions,
 * read one, compare two, name one, restore one into the working draft, and
 * mark one seen. A document is named as `{ collection, id }` or `{ single }`.
 *
 * ## What `overrideAccess` means here
 *
 * Trusted by default, as the rest of the Direct API is: a trusted call reads
 * every language and field of the history and its writes are judged by no
 * rule. A call with `overrideAccess: false` and a `user` is judged as REST
 * judges that person, by running the function each REST route runs after the
 * route's own permission check (`read-<slug>` for the reads, `update-<slug>`
 * for naming and restoring), so one caller gets one answer through either
 * door. Marking a version seen is a person's own marker, so it needs a user
 * however it is called.
 *
 * @module direct-api/namespaces/versions
 * @experimental Until the history feature is complete.
 */

import type { ComparisonQuery } from "../../api/versions-access";
import { runWithCallerScope } from "../../auth/caller-scope";
import { getService } from "../../di";
import { resolveSingleDocumentId } from "../../domains/singles/services/single-document-access";
import type { UserContext } from "../../domains/singles/types";
import type { VersionDiff } from "../../domains/versions/diff";
import {
  restoreVersion,
  type RestoreVersionResult,
} from "../../domains/versions/restore-version";
import type {
  VersionMeta,
  VersionRef,
  VersionRow,
} from "../../domains/versions/versions-repository";
import { NextlyError } from "../../errors/nextly-error";
import type { DirectAPIConfig } from "../types";
import type { ListResult, MutationResult } from "../types/shared";

import type { NextlyContext } from "./context";
import {
  accessOptions,
  authorizeChecked,
  checkedCaller,
  checkedScope,
  directApiActor,
  mergeConfig,
  runAsCaller,
} from "./helpers";

/** The document whose history a call reads: an entry, or a Single. */
type VersionTarget = { collection: string; id: string } | { single: string };

/** Every call names its document, and may say who it acts for. */
type VersionCall = VersionTarget & DirectAPIConfig;

/**
 * The history functions REST runs, loaded on first use. Their modules reach
 * `init`, which builds this namespace, so a static import would put this module
 * on that import cycle; loaded inside a call, never at module load, nothing
 * waits on them while modules load.
 */
async function historyFunctions() {
  const [access, methods] = await Promise.all([
    import("../../api/versions-access"),
    import("../../dispatcher/handlers/versions-methods"),
  ]);
  return {
    assertComparisonRequest: access.assertComparisonRequest,
    compareDocumentVersions: access.compareDocumentVersions,
    getVersionDiffForDocument: methods.getVersionDiffForDocument,
    getVersionForDocument: methods.getVersionForDocument,
    assertVersionPaging: methods.assertVersionPaging,
    listVersionsForDocument: methods.listVersionsForDocument,
    pageOfVersions: methods.pageOfVersions,
    markVersionSeenForDocument: methods.markVersionSeenForDocument,
    normalizeLabel: methods.normalizeLabel,
    restoreVersionForDocument: methods.restoreVersionForDocument,
    setVersionLabelForDocument: methods.setVersionLabelForDocument,
  };
}

/** @experimental */
export interface VersionsNamespace {
  /** A page of the document's versions, newest first, without snapshots. */
  list(
    args: VersionCall & { locale?: string; limit?: number; cursor?: number }
  ): Promise<ListResult<VersionMeta>>;
  /** One version with its snapshot, and the fields withheld from the caller. */
  get(
    args: VersionCall & { versionNo: number }
  ): Promise<VersionRow & { withheld: string[] }>;
  /**
   * A typed comparison: an explicit pair (`from` and `to`), or a target and a
   * named baseline the server resolves, as REST's `versions/diff` takes them.
   * A trusted call gets relationship and upload ids without their display
   * labels, which are read as a person may read them.
   */
  compare(
    args: VersionCall & {
      from?: number;
      to?: number;
      baseline?: string;
      locale?: string;
      modifiedOnly?: boolean;
    }
  ): Promise<VersionDiff>;
  /**
   * Name a version, or clear its name with `null`. Answers the version
   * without its snapshot, as REST's rename does, whoever calls.
   */
  name(
    args: VersionCall & { versionNo: number; label: string | null }
  ): Promise<MutationResult<VersionMeta>>;
  /**
   * Restore a version into the working draft: the fields `fields` names, or
   * every field it holds, and never what is published. Refused where the
   * collection or Single keeps no drafts. `_rev` or `_overwrite` says which
   * version of the document the restore was made from, as a save says it.
   */
  restore(
    args: VersionCall & {
      versionNo: number;
      fields?: readonly string[];
      _rev?: string;
      _overwrite?: boolean;
    }
  ): Promise<MutationResult<RestoreVersionResult>>;
  /** Record that a person was shown a version. People only. */
  markSeen(
    args: VersionCall & { versionNo: number }
  ): Promise<MutationResult<{ versionNo: number; locale: string | null }>>;
}

/** A call's document as a version ref, resolving a Single to its row. */
async function refOf(target: VersionTarget): Promise<VersionRef> {
  if ("single" in target) {
    // The live id comes from the server, never the call, as on REST.
    const id = await resolveSingleDocumentId(target.single);
    if (id === null) {
      throw NextlyError.notFound({
        logContext: { reason: "single-not-materialized", slug: target.single },
      });
    }
    return { scopeKind: "single", scopeSlug: target.single, entryId: id };
  }
  return {
    scopeKind: "collection",
    scopeSlug: target.collection,
    entryId: target.id,
  };
}

/** The `_rev` and `_overwrite` a restore names, and nothing else. */
function versionKeysOf(args: {
  _rev?: string;
  _overwrite?: boolean;
}): Record<string, unknown> {
  return {
    ...(args._rev !== undefined ? { _rev: args._rev } : {}),
    ...(args._overwrite !== undefined ? { _overwrite: args._overwrite } : {}),
  };
}

export function createVersionsNamespace(ctx: NextlyContext): VersionsNamespace {
  const defaultConfig = ctx.defaultConfig;
  const operations = versionOperations(defaultConfig);
  // Each call runs as the caller it names, under one language list and one
  // access memo, as every collection operation does.
  return {
    list: args => runAsCaller(defaultConfig, args, a => operations.list(a)),
    get: args => runAsCaller(defaultConfig, args, a => operations.get(a)),
    compare: args =>
      runAsCaller(defaultConfig, args, a => operations.compare(a)),
    name: args => runAsCaller(defaultConfig, args, a => operations.name(a)),
    restore: args =>
      runAsCaller(defaultConfig, args, a => operations.restore(a)),
    markSeen: args =>
      runAsCaller(defaultConfig, args, a => operations.markSeen(a)),
  };
}

/** The operations themselves, before each is run as its caller. */
function versionOperations(defaultConfig: DirectAPIConfig): VersionsNamespace {
  /**
   * The person a call is checked as, after the REST route's own permission
   * check, or `null` for a trusted call. The check runs in every language, as
   * the history routes judge it.
   */
  async function checkedAs(
    args: VersionCall,
    action: "read" | "update"
  ): Promise<{ user: UserContext } | null> {
    const caller = checkedCaller(defaultConfig, args);
    if (!caller) return null;
    // Judged by the target's slug, before a Single's row is looked up: the
    // answer is the same whether or not the Single has a row yet, as REST's
    // route answers before its handler resolves one.
    const resource = "single" in args ? args.single : args.collection;
    await authorizeChecked(caller, { action, resource });
    const user = accessOptions(mergeConfig(defaultConfig, args)).user;
    return { user: user as UserContext };
  }

  /** Run `operation` with the key scope the call is checked with. */
  function scoped<T>(args: VersionCall, operation: () => Promise<T>) {
    return runWithCallerScope(checkedScope(defaultConfig, args), operation);
  }

  /**
   * A trusted call's name: written as the service writes one, recorded in
   * the document's history against the call's actor where it names one, and
   * answered without the snapshot, as a checked call is.
   */
  async function trustedName(
    ref: VersionRef,
    args: VersionCall & { versionNo: number },
    label: string | null
  ): Promise<VersionMeta> {
    const actor = directApiActor(defaultConfig, args);
    const person = accessOptions(mergeConfig(defaultConfig, args)).user;
    const row = await getService("versionsService").setLabel(
      ref,
      args.versionNo,
      label,
      actor
        ? {
            actor,
            // A person's name only for a person: a call made as an API key is
            // the key's, never its owner's, so it keeps the key's identity alone.
            personName:
              actor.type === "user"
                ? ((person as { name?: string } | undefined)?.name ?? null)
                : null,
          }
        : undefined
    );
    const { snapshot: _snapshot, ...meta } = row;
    return meta;
  }

  /** The common arguments of the REST functions, for a checked caller. */
  function restArgs(ref: VersionRef, user: UserContext, args: VersionCall) {
    return {
      scopeKind: ref.scopeKind,
      slug: ref.scopeSlug,
      entryId: ref.entryId,
      user,
      authenticatedScope: checkedScope(defaultConfig, args),
    };
  }

  return {
    async list(args) {
      const h = await historyFunctions();
      const checked = await checkedAs(args, "read");
      const ref = await refOf(args);
      if (checked) {
        return scoped(args, () =>
          h.listVersionsForDocument({
            ...restArgs(ref, checked.user, args),
            ...(args.limit !== undefined ? { limit: args.limit } : {}),
            ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
            ...(args.locale ? { locale: args.locale } : {}),
          })
        );
      }
      // Paged as REST pages, through the same step: its default, its
      // ceiling, and its refusal of a page size or cursor that is not a
      // positive integer.
      h.assertVersionPaging(args);
      return h.pageOfVersions(ref, {
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
        languages: args.locale ? { locale: args.locale } : {},
      });
    },

    async get(args) {
      const h = await historyFunctions();
      const checked = await checkedAs(args, "read");
      const ref = await refOf(args);
      if (checked) {
        return scoped(args, () =>
          h.getVersionForDocument({
            ...restArgs(ref, checked.user, args),
            versionNo: args.versionNo,
          })
        );
      }
      const row = await getService("versionsService").get(ref, args.versionNo);
      return { ...row, withheld: [] };
    },

    async compare(args) {
      const h = await historyFunctions();
      const query: ComparisonQuery = {
        from: args.from,
        to: args.to,
        baseline: args.baseline,
        locale: args.locale,
        modifiedOnly: args.modifiedOnly === true,
      };
      h.assertComparisonRequest(query);
      const checked = await checkedAs(args, "read");
      const ref = await refOf(args);
      if (checked) {
        return scoped(args, () =>
          h.getVersionDiffForDocument({
            ...restArgs(ref, checked.user, args),
            ...query,
          })
        );
      }
      // The comparison REST's runs once its gates pass, with no one to redact for.
      return h.compareDocumentVersions({
        scopeKind: ref.scopeKind,
        slug: ref.scopeSlug,
        entryId: ref.entryId,
        query,
      });
    },

    async name(args) {
      const h = await historyFunctions();
      const checked = await checkedAs(args, "update");
      const ref = await refOf(args);
      const item: VersionMeta = checked
        ? await scoped(args, () =>
            h.setVersionLabelForDocument({
              ...restArgs(ref, checked.user, args),
              versionNo: args.versionNo,
              body: { label: args.label },
              params: {},
            })
          )
        : await trustedName(ref, args, h.normalizeLabel(args.label, "label"));
      return {
        message: item.label ? "Version named." : "Version name cleared.",
        item,
      };
    },

    async restore(args) {
      const h = await historyFunctions();
      const checked = await checkedAs(args, "update");
      const ref = await refOf(args);
      const version = versionKeysOf(args);
      const fields = args.fields ? { fields: args.fields } : {};
      const actor = directApiActor(defaultConfig, args);
      // The request behind the call, for the update's hooks, as an ordinary
      // write hands it.
      const request = accessOptions(mergeConfig(defaultConfig, args)).request;
      const item = checked
        ? await scoped(args, () =>
            h.restoreVersionForDocument({
              ...restArgs(ref, checked.user, args),
              versionNo: args.versionNo,
              params: {},
              version,
              ...fields,
              ...(actor ? { actor } : {}),
              ...(request ? { request } : {}),
            })
          )
        : await restoreVersion({
            scopeKind: ref.scopeKind,
            slug: ref.scopeSlug,
            entryId: ref.entryId,
            versionNo: args.versionNo,
            version,
            ...fields,
            // Who it was made for, never judged as them: a trusted call.
            ...(actor ? { actor } : {}),
            ...(request ? { request } : {}),
          });
      return { message: "Version restored.", item };
    },

    async markSeen(args) {
      const h = await historyFunctions();
      const user = accessOptions(mergeConfig(defaultConfig, args)).user;
      // A person's own marker: refused, as REST refuses it, when the call
      // names no one, whether or not it is checked.
      if (!user) {
        throw NextlyError.personOnly({
          doing: "mark a version as seen",
          logContext: { reason: "direct-api-mark-seen-no-user" },
        });
      }
      const checked = await checkedAs(args, "read");
      const ref = await refOf(args);
      const item = await scoped(args, () =>
        h.markVersionSeenForDocument({
          ...restArgs(ref, checked?.user ?? (user as UserContext), args),
          versionNo: args.versionNo,
        })
      );
      return { message: "Marked as seen.", item };
    },
  };
}
