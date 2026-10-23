/**
 * `system:recent-edits`: the documents most recently saved, one row each, as
 * the dashboard's Recently edited card reads them.
 *
 * The rows are the activity trail's, through the same walk and the same per-row
 * read check as Recent activity (`ActivityLogService.getRecentEdits`), so the two
 * cards cannot disagree about who saved what; they differ only in grouping. What
 * this module adds is each row's status now: whether the document is published,
 * a draft, or published with changes not yet published, read as the caller for
 * the documents the card shows and no others.
 *
 * 🔴 The resolver adds no access rule of its own. Each save is judged by the
 * walk, within the scope `resolveReadableResources` asks the access layer for,
 * and each status is read through the ordinary read path as the caller.
 *
 * @module services/dashboard/recent-edits-widget-source
 */

import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";
import { activeAuditRetention } from "../../domains/audit/retention-config";
import type { VersionsService } from "../../domains/versions/versions-service";
import type { WidgetQuery } from "../../domains/widgets/query";
import type { WidgetResult } from "../../domains/widgets/result";
import {
  failUnavailableSourceOrOp,
  refuseUnconsumedQueryFields,
} from "../../domains/widgets/sources";
import { RECENT_EDITS_SOURCE_ID } from "../../domains/widgets/system-source-ids";
import { registerSystemSource } from "../../domains/widgets/system-sources";
import { NextlyError } from "../../errors/nextly-error";
import {
  readableDocumentStatuses,
  readableSingleStatus,
} from "../lib/readable-documents";

import type { ActivityLogService, RecentEdit } from "./activity-log-service";
import { readRecentEditSubjects } from "./activity-subjects";
import type { ReadCaller } from "./readable-resources";
import { resolveReadableResources } from "./resolve-readable-resources";
import { describeSelected, selectedNames } from "./selected-fields";

export { RECENT_EDITS_SOURCE_ID };

/**
 * The fields this source publishes, and the ONLY names a query may select.
 *
 * Everything a row of the card is drawn from: the document, who saved it and
 * when, from that save, and its status now. Not the save's metadata: the names
 * of the fields it changed are the trail's detail, which no card draws.
 */
const RECENT_EDITS_FIELDS = [
  { name: "id", type: "string" as const, label: "Save" },
  { name: "entryId", type: "string" as const, label: "Entry" },
  { name: "entryTitle", type: "string" as const, label: "Title" },
  { name: "collection", type: "string" as const, label: "Collection" },
  { name: "subjectKind", type: "string" as const, label: "Kind" },
  { name: "locale", type: "string" as const, label: "Language" },
  { name: "actorType", type: "string" as const, label: "Saved by kind" },
  { name: "userId", type: "string" as const, label: "Saved by" },
  { name: "userName", type: "string" as const, label: "Name" },
  { name: "identityErasedAt", type: "date" as const, label: "Identity erased" },
  { name: "createdAt", type: "date" as const, label: "When" },
  { name: "status", type: "string" as const, label: "Status" },
  {
    name: "pendingChanges",
    type: "boolean" as const,
    label: "Changes not published",
  },
];

/**
 * What this resolver does with each field of a widget query: an exhaustive
 * `Record`, as the other system sources keep, so a field added to
 * `WidgetQuery` fails `check-types` here until someone decides what it means.
 * `where` carries the card's filters, and only those it declares.
 */
const QUERY_FIELD_USE: Record<keyof WidgetQuery, "consumed" | "refused"> = {
  source: "consumed",
  op: "consumed",
  select: "consumed",
  limit: "consumed",
  where: "consumed",
  sort: "refused",
  status: "refused",
  groupBy: "refused",
  dateField: "refused",
  interval: "refused",
};

/** The card's filters, as the query's `where` carries them. */
interface RecentEditsFilters {
  collection?: string;
  onlyMine?: true;
}

/**
 * The filters a query's `where` names, or a refusal of anything else in it.
 *
 * 🔴 Refused rather than ignored: a key this source does not read would be
 * validated and then dropped, and the card would answer a different question
 * than the one its settings asked.
 */
function filtersOf(where: WidgetQuery["where"]): RecentEditsFilters {
  if (where === undefined) return {};
  const unknown = Object.keys(where).filter(
    key => key !== "collection" && key !== "onlyMine"
  );
  if (unknown.length > 0) {
    failUnavailableSourceOrOp(
      `source "${RECENT_EDITS_SOURCE_ID}" narrows by collection and onlyMine alone, not: ${unknown.join(", ")}`
    );
  }
  const { collection, onlyMine } = where;
  return {
    ...collectionFilter(collection),
    ...(onlyMineFilter(onlyMine) ? { onlyMine: true as const } : {}),
  };
}

/** The Collection filter's slug, or a refusal of any other value. */
function collectionFilter(value: unknown): { collection?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string") {
    failUnavailableSourceOrOp(
      `source "${RECENT_EDITS_SOURCE_ID}" takes a collection by its slug`
    );
  }
  return { collection: value };
}

/** Whether Only mine is on, or a refusal of a value that is not true or false. */
function onlyMineFilter(value: unknown): boolean {
  if (value !== undefined && typeof value !== "boolean") {
    failUnavailableSourceOrOp(
      `source "${RECENT_EDITS_SOURCE_ID}" takes onlyMine as true or false`
    );
  }
  return value === true;
}

/** A day, in the milliseconds the retention windows are stated in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many whole days back the trail holds rows, or `undefined` when nothing
 * prunes it: retention switched off (`false`), or an install initialised
 * without an audit policy, which registers no pass at all. Read through
 * `activeAuditRetention`, so a reloaded policy is the one reported, as it is
 * the one the passes run with. A window under a day reads as one.
 */
function retentionDays(): number | undefined {
  const built = container.has("config")
    ? container.get<NextlyServiceConfig>("config").auditRetention
    : undefined;
  const maxAge = activeAuditRetention(built)?.activityMaxAgeMs;
  return typeof maxAge === "number"
    ? Math.max(1, Math.floor(maxAge / DAY_MS))
    : undefined;
}

/** The answer's span, as the list result states it: present only when bounded. */
function windowOf(): { window?: { days: number } } {
  const days = retentionDays();
  return days === undefined ? {} : { window: { days } };
}

/** The services, resolved at CALL time, as `system:activity` resolves its own. */
function activityLog(): ActivityLogService {
  if (!container.has("activityLogService")) {
    throw NextlyError.internal({
      logContext: { reason: "activity-log-service-unregistered" },
    });
  }
  return container.get<ActivityLogService>("activityLogService");
}

function versions(): VersionsService | undefined {
  return container.has("versionsService")
    ? container.get<VersionsService>("versionsService")
    : undefined;
}

/** A document's status now, as each shown row is labelled. */
interface DocumentState {
  status?: string;
  pendingChanges?: boolean;
}

/** The key one document's state is filed under: its kind, its slug, its id and its language. */
function stateKey(edit: RecentEdit): string {
  return JSON.stringify([
    edit.subjectKind ?? "collection",
    edit.collection,
    edit.entryId,
    edit.locale,
  ]);
}

/**
 * Each shown document's status now, read as the caller, after the walk has
 * chosen the rows: one read per collection with a status, one per Single, and
 * one pending-changes query per collection or Single, all at once.
 *
 * 🔴 A label is never worth the card. A read that fails leaves its rows with no
 * status, and the card draws as it would without one. A document gone since
 * its save has no status either; its rows never get this far, since the walk
 * reads a removed document's history only as redacted rows naming nothing.
 */
async function documentStates(
  edits: readonly RecentEdit[],
  caller: ReadCaller,
  collectionsWithStatus: ReadonlySet<string>
): Promise<Map<string, DocumentState>> {
  const states = new Map<string, DocumentState>();
  const groups = new Map<
    string,
    {
      kind: "collection" | "single";
      slug: string;
      locale: string | null;
      edits: RecentEdit[];
    }
  >();
  for (const edit of edits) {
    if (edit.entryId === null) continue;
    const kind = edit.subjectKind === "single" ? "single" : "collection";
    const key = JSON.stringify([kind, edit.collection, edit.locale]);
    const group = groups.get(key) ?? {
      kind,
      slug: edit.collection,
      locale: edit.locale,
      edits: [],
    };
    group.edits.push(edit);
    groups.set(key, group);
  }
  const record = (edit: RecentEdit, state: DocumentState): void => {
    states.set(stateKey(edit), { ...states.get(stateKey(edit)), ...state });
  };
  await Promise.all(
    [...groups.values()].flatMap(group => {
      const ids = group.edits.map(edit => edit.entryId as string);
      const reads: Promise<void>[] = [];
      if (group.kind === "single") {
        reads.push(
          readableSingleStatus(group.slug, caller, group.locale).then(
            status => {
              for (const edit of group.edits) {
                if (status !== undefined) record(edit, { status });
              }
            }
          )
        );
      } else if (collectionsWithStatus.has(group.slug)) {
        reads.push(
          readableDocumentStatuses(group.slug, ids, caller, group.locale).then(
            statuses => {
              for (const edit of group.edits) {
                const status = statuses.get(edit.entryId as string);
                if (status !== undefined) record(edit, { status });
              }
            }
          )
        );
      }
      const pending = versions();
      if (pending) {
        reads.push(
          pending
            .pendingChangeLocales(group.kind, group.slug, ids)
            .then(locales => {
              // An answered read settles every row it covers: a document it
              // names none for has no pending changes in any language.
              for (const edit of group.edits) {
                const held = locales.get(edit.entryId as string);
                record(edit, {
                  pendingChanges: held?.has(group.locale) === true,
                });
              }
            })
        );
      }
      // Each read settles on its own, so one that fails costs only its labels.
      return reads.map(read => read.catch(() => undefined));
    })
  );
  return states;
}

/**
 * Answer "what was saved most recently", one row per document, as this reader
 * may see it, each with its status now.
 *
 * Only mine is the reader's own saves, a person's: a reader with no person
 * behind it has none, and an API key's saves are never a person's, however
 * their ids compare.
 */
async function resolveRecentEdits(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(query, QUERY_FIELD_USE, RECENT_EDITS_SOURCE_ID);
  const filters = filtersOf(query.where);
  const reader = caller.user?.id;
  if (filters.onlyMine && typeof reader !== "string") {
    return { op: "list", items: [], ...windowOf() };
  }
  const { collectionsWithStatus, ...subjects } = await readRecentEditSubjects();
  const { edits } = await activityLog().getRecentEdits({
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    scope: await resolveReadableResources(caller),
    caller,
    ...subjects,
    ...(filters.collection === undefined
      ? {}
      : { collection: filters.collection }),
    ...(filters.onlyMine ? { savedBy: reader } : {}),
  });
  const states = await documentStates(edits, caller, collectionsWithStatus);
  const names = selectedNames(RECENT_EDITS_FIELDS, query.select);
  const fields = describeSelected(RECENT_EDITS_FIELDS, query.select);
  return {
    op: "list",
    items: edits.map(edit => {
      const row: Record<string, unknown> = {
        ...edit,
        // Unknown until a read answers: a status or pending-changes read that
        // failed leaves its rows saying nothing, rather than "no changes".
        status: null,
        pendingChanges: null,
        ...states.get(stateKey(edit)),
      };
      return Object.fromEntries(names.map(name => [name, row[name]]));
    }),
    ...(fields ? { fields } : {}),
    // The trail holds rows for its retention period alone, so the answer says
    // how far back it looked: an empty card then says "none in that span"
    // rather than "none ever".
    ...windowOf(),
  };
}

/**
 * Publish the source and the function that answers it, from the boot-time
 * registry reset, as the other system sources are. It narrows by Collection
 * and Only mine, which reach it as the query's `where`.
 */
export function registerRecentEditsWidgetSource(): void {
  registerSystemSource(
    {
      id: RECENT_EDITS_SOURCE_ID,
      label: "Recently edited",
      kind: "system",
      titleField: "entryTitle",
      supports: ["list"],
      fields: RECENT_EDITS_FIELDS,
      filters: ["collection", "onlyMine"],
    },
    resolveRecentEdits
  );
}
