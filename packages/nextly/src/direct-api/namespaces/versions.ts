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
export type VersionTarget =
  | { collection: string; id: string }
  | { single: string };

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
    listVersionsForDocument: methods.listVersionsForDocument,
    markVersionSeenForDocument: methods.markVersionSeenForDocument,
    normalizeLabel: methods.normalizeLabel,
    restoreVersionForDocument: methods.restoreVersionForDocument,
    setVersionLabelForDocument: methods.setVersionLabelForDocument,
  };
}

/** The page size REST uses, and its ceiling. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
  /** Name a version, or clear its name with `null`. */
  name(
    args: VersionCall & { versionNo: number; label: string | null }
  ): Promise<MutationResult<VersionRow>>;
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
    ref: VersionRef,
    action: "read" | "update"
  ): Promise<{ user: UserContext } | null> {
    const caller = checkedCaller(defaultConfig, args);
    if (!caller) return null;
    await authorizeChecked(caller, { action, resource: ref.scopeSlug });
    const user = accessOptions(mergeConfig(defaultConfig, args)).user;
    return { user: user as UserContext };
  }

  /** Run `operation` with the key scope the call is checked with. */
  function scoped<T>(args: VersionCall, operation: () => Promise<T>) {
    return runWithCallerScope(checkedScope(defaultConfig, args), operation);
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
      const ref = await refOf(args);
      const checked = await checkedAs(args, ref, "read");
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
      const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      // One extra row proves another page exists, as REST pages.
      const window = await getService("versionsService").list(ref, {
        limit: limit + 1,
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
        ...(args.locale ? { locale: args.locale } : {}),
      });
      const hasNext = window.length > limit;
      const items = hasNext ? window.slice(0, limit) : window;
      return {
        items,
        meta: {
          total: items.length,
          page: 1,
          limit,
          totalPages: 1,
          hasNext,
          hasPrev: args.cursor !== undefined,
        },
      };
    },

    async get(args) {
      const h = await historyFunctions();
      const ref = await refOf(args);
      const checked = await checkedAs(args, ref, "read");
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
      const ref = await refOf(args);
      const checked = await checkedAs(args, ref, "read");
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
      const ref = await refOf(args);
      const checked = await checkedAs(args, ref, "update");
      const item = checked
        ? await scoped(args, () =>
            h.setVersionLabelForDocument({
              ...restArgs(ref, checked.user, args),
              versionNo: args.versionNo,
              body: { label: args.label },
              params: {},
            })
          )
        : await getService("versionsService").setLabel(
            ref,
            args.versionNo,
            h.normalizeLabel(args.label, "label")
          );
      return {
        message: item.label ? "Version named." : "Version name cleared.",
        item,
      };
    },

    async restore(args) {
      const h = await historyFunctions();
      const ref = await refOf(args);
      const checked = await checkedAs(args, ref, "update");
      const version = versionKeysOf(args);
      const fields = args.fields ? { fields: args.fields } : {};
      const actor = directApiActor(defaultConfig, args);
      const item = checked
        ? await scoped(args, () =>
            h.restoreVersionForDocument({
              ...restArgs(ref, checked.user, args),
              versionNo: args.versionNo,
              params: {},
              version,
              ...fields,
              ...(actor ? { actor } : {}),
            })
          )
        : await restoreVersion({
            scopeKind: ref.scopeKind,
            slug: ref.scopeSlug,
            entryId: ref.entryId,
            versionNo: args.versionNo,
            version,
            ...fields,
          });
      return { message: "Version restored.", item };
    },

    async markSeen(args) {
      const h = await historyFunctions();
      const ref = await refOf(args);
      const user = accessOptions(mergeConfig(defaultConfig, args)).user;
      // A person's own marker: refused, as REST refuses it, when the call
      // names no one, whether or not it is checked.
      if (!user) {
        throw NextlyError.personOnly({
          doing: "mark a version as seen",
          logContext: { reason: "direct-api-mark-seen-no-user" },
        });
      }
      const checked = await checkedAs(args, ref, "read");
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
