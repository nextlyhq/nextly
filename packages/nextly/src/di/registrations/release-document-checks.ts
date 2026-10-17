/**
 * What a release's readiness checks ask of the rest of the system, answered
 * the way the release's run would answer it.
 *
 * The run performs each member at its instant as the member's recorded
 * author, through the ordinary content write: the access gate that write
 * meets (`checkCollectionAccess` / `checkSingleAccess`, for `update` and then
 * the lifecycle action), and the validation it makes of what goes live. So
 * these resolve the author the way the run does (`resolveRunAs`) and ask
 * those same two things, rather than a permission lookup of their own that
 * could pass a member the run then refuses.
 *
 * The run happens on nobody's request, so the author is judged outside the
 * request this is asked from: inheriting it, an API key's scope would be
 * judged in the author's place.
 *
 * @module di/registrations/release-document-checks
 */
import { runDetachedFromRequest } from "../../auth/caller-scope";
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import { CollectionAccessService } from "../../domains/collections/services/collection-access-service";
import { collectionTableName } from "../../domains/collections/services/collection-utils";
import { databaseRunAs } from "../../domains/jobs/jobs-runner";
import type { ReleaseCheckScope } from "../../domains/releases/readiness/check-sources";
import {
  documentRefKey,
  type DocumentRef,
} from "../../domains/releases/releases-repository";
import type { ReleaseDocumentChecks } from "../../domains/releases/services/releases-service";
import { resolveSingleForRequest } from "../../domains/singles/services/ensure-runtime-table";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import { checkSingleAccess } from "../../domains/singles/services/single-query-service";
import type { DynamicSingleRecord } from "../../schemas/dynamic-singles/types";
import type { ReleaseMemberAction } from "../../schemas/releases/types";
import type { CollectionsHandler } from "../../services/collections-handler";
import { resolveRunAs } from "../../shared/lib/resolve-run-as";
import { container } from "../container";

import type { RegistrationContext } from "./types";

type Adapter = RegistrationContext["adapter"];
type Logger = RegistrationContext["logger"];
type Author = Parameters<ReleaseDocumentChecks["mayPerform"]>[0];

/** The checks, bound to one registration's adapter and logger. */
export function releaseDocumentChecks(
  adapter: Adapter,
  logger: Logger
): ReleaseDocumentChecks {
  return {
    actingAs: async authorId => {
      const resolved = await resolveRunAs(databaseRunAs(adapter), authorId);
      return resolved.ok ? resolved.user : null;
    },
    // Detached from the request: a read-only evaluation of a NAMED identity,
    // the author, whom the release's run acts as on nobody's request.
    mayPerform: (user, scope, action) =>
      runDetachedFromRequest(() =>
        authorMayPerform(adapter, logger, user, scope, action)
      ),
    existing: refs => existingDocuments(adapter, logger, refs),
    heldDraftLocales: ref =>
      ref.scopeKind === "single"
        ? singleEntries().releaseHeldDraftLocales({ slug: ref.scopeSlug })
        : collections().releaseHeldDraftLocales({
            collectionName: ref.scopeSlug,
            entryId: ref.entryId,
          }),
    publishProblems: async (ref, user) =>
      ref.scopeKind === "single"
        ? singleEntries().releasePublishIssues({ slug: ref.scopeSlug, user })
        : collections().releasePublishIssues({
            collectionName: ref.scopeSlug,
            entryId: ref.entryId,
            user,
          }),
  };
}

/** Resolved per call, so this does not depend on registration order. */
function rbacService(): RBACAccessControlService | undefined {
  return container.has("rbacAccessControlService")
    ? container.get<RBACAccessControlService>("rbacAccessControlService")
    : undefined;
}

function collections(): CollectionsHandler {
  return container.get<CollectionsHandler>("collectionsHandler");
}

function singleEntries(): SingleEntryService {
  return container.get<SingleEntryService>("singleEntryService");
}

/**
 * Whether the author passes the gate the run's write meets: `update`, as any
 * write of the document must, and then the lifecycle action itself, never as
 * route-authorized, since no route stands in front of the run.
 */
async function authorMayPerform(
  adapter: Adapter,
  logger: Logger,
  user: Author,
  scope: ReleaseCheckScope,
  action: ReleaseMemberAction
): Promise<boolean> {
  const rbac = rbacService();
  for (const operation of ["update", action] as const) {
    const denied =
      scope.scopeKind === "single"
        ? await checkSingleAccess({
            slug: scope.scopeSlug,
            operation,
            user,
            overrideAccess: false,
            routeAuthorized: false,
            rbacAccessControlService: rbac,
            logger,
          })
        : await new CollectionAccessService(
            adapter,
            logger,
            rbac
          ).checkCollectionAccess({
            collectionName: scope.scopeSlug,
            operation,
            user,
            overrideAccess: false,
            routeAuthorized: false,
          });
    if (denied !== null) return false;
  }
  return true;
}

/**
 * Which of these documents still exist, read unchecked: whether a document is
 * there is not a question of who asks. One query per collection, and one per
 * Single.
 */
async function existingDocuments(
  adapter: Adapter,
  logger: Logger,
  refs: readonly DocumentRef[]
): Promise<ReadonlySet<string>> {
  const byScope = new Map<string, DocumentRef[]>();
  for (const ref of refs) {
    const key = `${ref.scopeKind}:${ref.scopeSlug}`;
    byScope.set(key, [...(byScope.get(key) ?? []), ref]);
  }
  const existing = new Set<string>();
  for (const group of byScope.values()) {
    const [first] = group;
    const found =
      first.scopeKind === "single"
        ? (await singleRowExists(adapter, first.scopeSlug, logger))
          ? group
          : []
        : await existingEntries(adapter, first.scopeSlug, group);
    for (const ref of found) existing.add(documentRefKey(ref));
  }
  return existing;
}

/** The refs among `group` whose entries are in this collection's table. */
async function existingEntries(
  adapter: Adapter,
  slug: string,
  group: readonly DocumentRef[]
): Promise<DocumentRef[]> {
  if (!container.has("collectionRegistryService")) return [];
  const record = await container
    .get<{
      getCollectionBySlug(slug: string): Promise<unknown>;
    }>("collectionRegistryService")
    .getCollectionBySlug(slug);
  if (record === null || record === undefined) return [];
  const table = collectionTableName(record, slug);
  if (!(await adapter.tableExists(table))) return [];
  const rows = await adapter.select<{ id: string }>(table, {
    columns: ["id"],
    where: {
      and: [
        {
          column: "id",
          op: "IN",
          value: [...new Set(group.map(ref => ref.entryId))],
        },
      ],
    },
  });
  const ids = new Set(rows.map(row => String(row.id)));
  return group.filter(ref => ids.has(ref.entryId));
}

/**
 * Whether a Single has its stored row, asked of its table directly: a read
 * that cannot create the row the way the Single's content read does. `false`
 * for a Single that is not registered or whose table is not there yet.
 */
export async function singleRowExists(
  adapter: Adapter,
  slug: string,
  logger: Logger
): Promise<boolean> {
  if (!container.has("singleRegistryService")) return false;
  // Resolved the way every request-scoped Single read opens: the registry row,
  // and its runtime table registered in THIS process. A worker that booted
  // before a UI-defined Single existed has the table in the database but not
  // in its schema registry, and a query there would fail rather than answer.
  // The logger carries the reason when that registration cannot be made.
  const single = await resolveSingleForRequest(
    adapter,
    container.get<{
      getSingleBySlug(slug: string): Promise<DynamicSingleRecord | null>;
    }>("singleRegistryService"),
    slug,
    logger
  );
  const table = single?.tableName;
  if (table === undefined || !(await adapter.tableExists(table))) return false;
  const rows = await adapter.select<{ id: string }>(table, {
    columns: ["id"],
    limit: 1,
  });
  return rows.length > 0;
}
