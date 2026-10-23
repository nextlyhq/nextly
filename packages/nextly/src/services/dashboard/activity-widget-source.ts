/**
 * `system:activity`: who changed what, most recent first, as the dashboard's
 * Recent activity card reads it.
 *
 * The same read the activity endpoint makes, through the same service call:
 * the per-row read check, the runs of repeated saves and the row limit are the
 * service's, so the card and the endpoint cannot come to show different rows to
 * one reader. This module only adapts a widget query to that call and its
 * answer to a widget result.
 *
 * 🔴 The resolver adds no access rule of its own. `getRecentActivity` judges
 * every row as the caller, within the scope `resolveReadableResources` asks the
 * access layer for, and a filter applied here would be a second implementation
 * of that decision.
 *
 * @module services/dashboard/activity-widget-source
 */

import { container } from "../../di/container";
import type { WidgetQuery } from "../../domains/widgets/query";
import type {
  WidgetResult,
  WidgetResultField,
} from "../../domains/widgets/result";
import { refuseUnconsumedQueryFields } from "../../domains/widgets/sources";
import { ACTIVITY_SOURCE_ID } from "../../domains/widgets/system-source-ids";
import { registerSystemSource } from "../../domains/widgets/system-sources";
import { NextlyError } from "../../errors/nextly-error";

import type {
  ActivityLogEntry,
  ActivityLogService,
} from "./activity-log-service";
import { readActivitySubjects } from "./activity-subjects";
import type { ReadCaller } from "./readable-resources";
import { resolveReadableResources } from "./resolve-readable-resources";

export { ACTIVITY_SOURCE_ID };

/**
 * The fields this source publishes, and the ONLY names a query may select.
 *
 * Everything the card draws a row from, and not `metadata`: the names of the
 * fields a save changed are the trail's detail, which no card draws, and a
 * source's field list is published to every reader who may see the source.
 */
const ACTIVITY_FIELDS = [
  { name: "id", type: "string" as const, label: "Activity" },
  { name: "actorType", type: "string" as const, label: "Actor kind" },
  { name: "userId", type: "string" as const, label: "Actor" },
  { name: "userName", type: "string" as const, label: "Name" },
  { name: "userEmail", type: "string" as const, label: "Email" },
  { name: "identityErasedAt", type: "date" as const, label: "Identity erased" },
  { name: "action", type: "string" as const, label: "Action" },
  { name: "collection", type: "string" as const, label: "Collection" },
  { name: "entryId", type: "string" as const, label: "Entry" },
  { name: "entryTitle", type: "string" as const, label: "Title" },
  { name: "subjectKind", type: "string" as const, label: "Kind" },
  { name: "createdAt", type: "date" as const, label: "When" },
  { name: "firstCreatedAt", type: "date" as const, label: "First save" },
  { name: "count", type: "number" as const, label: "Saves" },
  { name: "countAtLeast", type: "boolean" as const, label: "At least" },
];

/**
 * What this resolver does with each field of a widget query.
 *
 * An exhaustive `Record` over `keyof WidgetQuery`, as `system:releases` keeps
 * one: this source answers one fixed question, so a field it does not consume
 * would otherwise be validated and then quietly dropped, answering a different
 * question than the one asked. Keyed on the type, so a field added to
 * `WidgetQuery` fails `check-types` here until someone decides what it means
 * for this source.
 */
const QUERY_FIELD_USE: Record<keyof WidgetQuery, "consumed" | "refused"> = {
  source: "consumed",
  op: "consumed",
  select: "consumed",
  limit: "consumed",
  where: "refused",
  sort: "refused",
  status: "refused",
  groupBy: "refused",
  dateField: "refused",
  interval: "refused",
};

/**
 * The service, resolved at CALL time: this source is registered during boot's
 * registry reset, before the container necessarily holds it, and a captured
 * instance would outlive a hot reload.
 */
function service(): ActivityLogService {
  if (!container.has("activityLogService")) {
    throw NextlyError.internal({
      logContext: { reason: "activity-log-service-unregistered" },
    });
  }
  return container.get<ActivityLogService>("activityLogService");
}

/** The selected names this source declares, in the order asked, or all of them. */
function selected(select: readonly string[] | undefined): string[] {
  const declared = ACTIVITY_FIELDS.map(field => field.name);
  if (!select || select.length === 0) return declared;
  return [...new Set(select)].filter(name => declared.includes(name));
}

/** One row of the feed, reduced to `names`. */
function projected(row: ActivityLogEntry, names: readonly string[]) {
  const fields: Record<string, unknown> = { ...row };
  return Object.fromEntries(names.map(name => [name, fields[name]]));
}

/**
 * The columns to head the rows with, present only when the query chose them,
 * as the collection path and `system:releases` publish them.
 */
function describeFields(
  select: readonly string[] | undefined
): WidgetResultField[] | undefined {
  if (!select || select.length === 0) return undefined;
  const declared = new Map(ACTIVITY_FIELDS.map(field => [field.name, field]));
  const described = selected(select).flatMap(name => {
    const field = declared.get(name);
    return field ? [{ name, label: field.label, type: field.type }] : [];
  });
  return described.length > 0 ? described : undefined;
}

/**
 * Answer "who changed what", most recent first, as this reader may see it.
 *
 * `limit` goes to the service as asked: the service clamps it, for this card
 * and for the endpoint alike. A card asks one row more than it draws, and that
 * row is what tells it more exist; a run of saves is one row.
 */
async function resolveActivity(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(query, QUERY_FIELD_USE, ACTIVITY_SOURCE_ID);
  const { activities } = await service().getRecentActivity({
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    scope: await resolveReadableResources(caller),
    caller,
    ...(await readActivitySubjects()),
  });
  const names = selected(query.select);
  const fields = describeFields(query.select);
  return {
    op: "list",
    items: activities.map(row => projected(row, names)),
    ...(fields ? { fields } : {}),
  };
}

/**
 * Publish the source and the function that answers it, from the boot-time
 * registry reset, as the other system sources are.
 *
 * `supports` names `list` alone: the feed is rows, and a count of it is the
 * 24-hour figure's own, bounded walk rather than a widget operation.
 */
export function registerActivityWidgetSource(): void {
  registerSystemSource(
    {
      id: ACTIVITY_SOURCE_ID,
      label: "Recent activity",
      kind: "system",
      titleField: "entryTitle",
      supports: ["list"],
      fields: ACTIVITY_FIELDS,
    },
    resolveActivity
  );
}
